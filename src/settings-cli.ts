// settings-cli — `agent-factory config show | check | set <project>` and `agent-factory team update <project> [<commit>]`
// (docs/explanation/architecture.md section 5 "Settings"). The settings live in the factory home, never in the product repo, and
// these commands are for the human: the coordinator's deny list covers the user and team settings (#227).
//
//   config show    every key: its value, the layer and `file:line` it came from, its class, and the team's mode
//   config check   the layers resolved and the project file's readers run on the result, and the pinned plugins looked
//                  at for a second process (#426): exit 0, or 1 with each error
//                  (a clone whose origin is not the project's repo is one of those errors: core/origin.ts), and each
//                  Claude Code plugin the factory knows read back: its state, a warning when it is not on; and a
//                  warning for each pin with no eval proof (core/eval/pin-proof.ts), which never fails the check
//   team update    the resolved values at the team's new commit against the pinned one, a check, then the pin moved
//   config set     one key written, refused on an error whose key and rule the current file does not have
//
// Both writers save through a temporary file and a rename, refused when the file no longer holds the text that was
// checked, so an edit made in between is never lost without a word.

import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { KNOWN_PLUGINS, pluginState, stateLine } from "./core/agent/claude-plugins.js";
import { coordinatorDir } from "./core/coordinator.js";
import type { Result } from "./core/forge/api.js";
import { hostGit } from "./core/git.js";
import { originProblem } from "./core/origin.js";
import { pluginConfigOf } from "./core/plugin/config.js";
import { readPins } from "./core/process/pins.js";
import { pluginListOf, refText } from "./core/process/plugins.js";
import { ENGINE_ROOT, pinProof } from "./core/eval/pin-proof.js";
import { projectPath, readyFieldsOf } from "./core/project.js";
import { layered, readTeamAt, teamDir, type Layered, type Pin, type Read } from "./core/settings/layers.js";
import { runEnv, settingOf } from "./core/settings/machine.js";
import { keyById, PROJECT_META, type Key } from "./core/settings/keys.js";
import { canonical, didYouMean, where, type Problem, type Resolved } from "./core/settings/resolve.js";
import { pathKey } from "./core/settings/lines.js";
import { partnerOf, valueAt, withValues, type Change } from "./core/settings/write.js";
import { plainName } from "./core/spec.js";
import { codeOf } from "./core/field.js";

export type SettingsIo = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly home: string;
  readonly json: boolean;
};

type Loaded = { readonly path: string; readonly text: string; readonly value: object };

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadProject(home: string, project: string): Promise<Result<Loaded>> {
  if (!plainName(project)) {
    return { kind: "failed", reason: `${JSON.stringify(project)} is not a plain project name` };
  }
  const path = projectPath(home, project);
  const text = await readFile(path, "utf8").catch((e: unknown) => (codeOf(e) === "ENOENT" ? "" : undefined));
  if (text === undefined || text === "") {
    return { kind: "failed", reason: `${path}: ${text === "" ? "no project file" : "cannot be read"}` };
  }
  return parsedProject(path, text);
}

function parsedProject(path: string, text: string): Result<Loaded> {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    value = undefined;
  }
  return isObject(value)
    ? { kind: "ok", value: { path, text, value } }
    : { kind: "failed", reason: `${path}: is not a JSON object` };
}

async function resolved(io: SettingsIo, loaded: Loaded, team?: Read): Promise<Layered> {
  const base = { home: io.home, env: io.env, project: loaded };
  return layered(team === undefined ? base : { ...base, team });
}

function readerErrors(path: string, effective: object, env: NodeJS.ProcessEnv): readonly Problem[] {
  const readers = [
    { key: "ready", rule: "readyFieldsOf", read: readyFieldsOf(path, effective, env) },
    { key: "policy", rule: "pluginConfigOf", read: pluginConfigOf(path, effective) },
    { key: "plugins", rule: "pluginListOf", read: pluginListOf(path, effective) },
  ];
  return readers.flatMap(({ key, rule, read }) =>
    read.kind === "failed" ? [{ level: "error" as const, key, rule, text: read.reason }] : [],
  );
}

async function pinsProblems(home: string, project: string): Promise<readonly Problem[]> {
  const pins = await readPins(home, project);
  return pins.kind === "failed" ? [{ level: "error", key: "plugins", rule: "readPins", text: pins.reason }] : [];
}

async function proofProblems(
  home: string,
  project: string,
  path: string,
  effective: object,
): Promise<readonly Problem[]> {
  const refs = pluginListOf(path, effective);
  const pins = await readPins(home, project);
  if (refs.kind === "failed" || pins.kind === "failed") {
    return [];
  }
  const found = await Promise.all(
    refs.value.map(async (ref) => {
      const pin = pins.value[refText(ref)];
      return pin === undefined ? "" : pinProof([home, ENGINE_ROOT], ref, pin);
    }),
  );
  return found
    .filter((why) => why !== "")
    .map((text) => ({ level: "warning", key: "plugins", rule: "pinProof", text }));
}

async function cloneProblems(env: NodeJS.ProcessEnv): Promise<readonly Problem[]> {
  const why = await originProblem(env);
  return why === "" ? [] : [{ level: "error", key: "clone", rule: "originProblem", text: why }];
}

async function pluginLines(
  env: NodeJS.ProcessEnv,
  home: string,
): Promise<{ readonly on: readonly string[]; readonly problems: readonly Problem[] }> {
  const clone = settingOf(env, "clone") ?? "";
  const folders = [...(clone === "" ? [] : [clone]), coordinatorDir(home)];
  const lines = await Promise.all(
    KNOWN_PLUGINS.map(async (id) => {
      const state = await pluginState(id, { env, folders });
      return { id, on: state.kind === "on", text: stateLine(id, state) };
    }),
  );
  return {
    on: lines.filter((l) => l.on).map((l) => l.text),
    problems: lines
      .filter((l) => !l.on)
      .map((l) => ({ level: "warning" as const, key: l.id, rule: "pluginState", text: l.text })),
  };
}

function allProblems(path: string, layers: Layered, env: NodeJS.ProcessEnv): readonly Problem[] {
  return [...layers.problems, ...readerErrors(path, layers.effective, env)];
}

function valueText(r: Resolved): string {
  return r.value === undefined ? "-" : JSON.stringify(r.value);
}

const WIDEST = 60;

function shortText(r: Resolved): string {
  const full = valueText(r);
  return full.length <= WIDEST || !Array.isArray(r.value)
    ? full
    : `${full.slice(0, WIDEST)}… (${r.value.length} entries)`;
}

function rowOf(r: Resolved): readonly string[] {
  const mode = r.mode === "default" ? "" : ` (team: ${r.mode})`;
  return [
    r.key.id,
    shortText(r),
    r.sources.map((s) => s.layer).join("+"),
    r.sources.map(where).join(", "),
    `${r.key.class}${mode}`,
  ];
}

function table(rows: readonly (readonly string[])[]): string {
  const widths = (rows[0] ?? []).map((_c, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows
    .map(
      (r) =>
        `${r
          .map((c, i) => c.padEnd(widths[i] ?? 0))
          .join("  ")
          .trimEnd()}\n`,
    )
    .join("");
}

function printProblems(io: SettingsIo, problems: readonly Problem[]): void {
  io.err(problems.map((p) => `${p.level}: ${p.text}\n`).join(""));
}

function jsonOf(r: Resolved): object {
  return {
    key: r.key.id,
    value: r.value,
    layers: r.sources.map((s) => s.layer),
    where: r.sources.map(where),
    class: r.key.class,
    mode: r.mode,
  };
}

async function show(io: SettingsIo, project: string): Promise<number> {
  const loaded = await loadProject(io.home, project);
  if (loaded.kind === "failed") {
    io.err(`agent-factory config show: ${loaded.reason}\n`);
    return 1;
  }
  const layers = await resolved(io, loaded.value);
  io.out(
    io.json
      ? `${JSON.stringify(layers.values.map(jsonOf), null, 2)}\n`
      : table([["key", "value", "layer", "where", "class"], ...layers.values.map(rowOf)]),
  );
  printProblems(io, layers.problems);
  return layers.problems.some((p) => p.level === "error") ? 1 : 0;
}

function pinText(pin: Pin | "none"): string {
  return pin === "none" ? "no team" : `team ${pin.team}@${pin.commit.slice(0, 12)}`;
}

export async function checkProblems(
  io: Pick<SettingsIo, "home" | "env">,
  project: string,
): Promise<Result<readonly Problem[]>> {
  const loaded = await loadProject(io.home, project);
  if (loaded.kind === "failed") {
    return loaded;
  }
  const layers = await layered({ home: io.home, env: io.env, project: loaded.value });
  return { kind: "ok", value: allProblems(loaded.value.path, layers, io.env) };
}

export async function candidateProblems(
  io: Pick<SettingsIo, "home" | "env">,
  path: string,
  text: string,
): Promise<readonly Problem[]> {
  const loaded = parsedProject(path, text);
  if (loaded.kind === "failed") {
    return [{ level: "error", key: path, rule: "parsedProject", text: loaded.reason }];
  }
  return allProblems(path, await layered({ home: io.home, env: io.env, project: loaded.value }), io.env);
}

async function check(io: SettingsIo, project: string): Promise<number> {
  const loaded = await loadProject(io.home, project);
  if (loaded.kind === "failed") {
    io.err(`agent-factory config check: ${loaded.reason}\n`);
    return 1;
  }
  const layers = await resolved(io, loaded.value);
  const plugins = await pluginLines(runEnv(io.env, layers), io.home);
  const problems = [
    ...allProblems(loaded.value.path, layers, io.env),
    ...(await pinsProblems(io.home, project)),
    ...(await proofProblems(io.home, project, loaded.value.path, layers.effective)),
    ...(await cloneProblems(runEnv(io.env, layers))),
    ...plugins.problems,
  ];
  io.out(plugins.on.map((line) => `${line}\n`).join(""));
  printProblems(io, problems);
  if (problems.some((p) => p.level === "error")) {
    return 1;
  }
  io.out(`settings ok: ${project} (${pinText(layers.pin)})\n`);
  return 0;
}

const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

async function headOf(io: SettingsIo, team: string): Promise<Result<string>> {
  const got = await hostGit({
    args: ["rev-parse", "--verify", "HEAD^{commit}"],
    repo: { kind: "repo", path: teamDir(io.home, team) },
    env: io.env,
    stdin: { kind: "none" },
  });
  return got.kind === "ok"
    ? { kind: "ok", value: got.stdout.trim() }
    : { kind: "failed", reason: `cannot read the commit of ${teamDir(io.home, team)}` };
}

async function targetOf(io: SettingsIo, team: string, given: string | undefined): Promise<Result<string>> {
  const commit = given === undefined ? await headOf(io, team) : { kind: "ok" as const, value: given };
  return commit.kind === "ok" && !COMMIT.test(commit.value)
    ? { kind: "failed", reason: `${JSON.stringify(commit.value)} is not a full commit id` }
    : commit;
}

export function changes(before: readonly Resolved[], after: readonly Resolved[]): readonly string[] {
  return after.flatMap((a) => {
    const b = before.find((r) => r.key.id === a.key.id);
    return b === undefined || canonical(b.value) === canonical(a.value)
      ? []
      : [`${a.key.id}: ${valueText(b)} -> ${valueText(a)}`];
  });
}

const PIN_FIELD = /("team"\s*:\s*")[^"]*(")/;

export async function saveFile(path: string, checked: string, next: string): Promise<Result<string>> {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temp, next, { mode: 0o600 });
    if ((await readFile(path, "utf8")) !== checked) {
      await rm(temp, { force: true });
      return { kind: "failed", reason: `${path}: the file changed; run it again` };
    }
    await rename(temp, path);
    return { kind: "ok", value: path };
  } catch {
    await rm(temp, { force: true });
    return { kind: "failed", reason: `cannot write ${path}` };
  }
}

function movePin(path: string, text: string, pin: Pin): Promise<Result<string>> {
  return saveFile(path, text, text.replace(PIN_FIELD, `$1${pin.team}@${pin.commit}$2`));
}

type Update = { readonly loaded: Loaded; readonly pin: Pin; readonly commit: string };

async function updateTo(io: SettingsIo, u: Update): Promise<number> {
  const before = await resolved(io, u.loaded);
  const next: Pin = { team: u.pin.team, commit: u.commit };
  const after = await resolved(io, u.loaded, await readTeamAt(io.home, next, io.env));
  const lines = changes(before.values, after.values);
  io.out(lines.length === 0 ? "no resolved value changes\n" : lines.map((l) => `${l}\n`).join(""));
  const problems = allProblems(u.loaded.path, after, io.env);
  printProblems(io, problems);
  if (problems.some((p) => p.level === "error")) {
    io.err(`agent-factory team update: the check failed; the pin stays at ${u.pin.commit.slice(0, 12)}\n`);
    return 1;
  }
  const moved = await movePin(u.loaded.path, u.loaded.text, next);
  if (moved.kind === "failed") {
    io.err(`agent-factory team update: ${moved.reason}\n`);
    return 1;
  }
  io.out(`pinned ${next.team}@${next.commit}\n`);
  return 0;
}

async function pinnedProject(
  io: SettingsIo,
  project: string,
): Promise<Result<{ readonly loaded: Loaded; readonly pin: Pin }>> {
  const loaded = await loadProject(io.home, project);
  if (loaded.kind === "failed") {
    return loaded;
  }
  const { pin } = await resolved(io, loaded.value);
  return pin === "none"
    ? { kind: "failed", reason: `${loaded.value.path} pins no team; add "team": "<team>@<commit>" to it first` }
    : { kind: "ok", value: { loaded: loaded.value, pin } };
}

async function planned(io: SettingsIo, project: string, given: string | undefined): Promise<Result<Update>> {
  const pinned = await pinnedProject(io, project);
  if (pinned.kind === "failed") {
    return pinned;
  }
  const commit = await targetOf(io, pinned.value.pin.team, given);
  return commit.kind === "ok" ? { kind: "ok", value: { ...pinned.value, commit: commit.value } } : commit;
}

async function update(io: SettingsIo, project: string, given: string | undefined): Promise<number> {
  const plan = await planned(io, project, given);
  if (plan.kind === "failed") {
    io.err(`agent-factory team update: ${plan.reason}\n`);
    return 1;
  }
  const { pin, commit } = plan.value;
  if (commit === pin.commit) {
    io.out(`already pinned at ${pin.team}@${commit}\n`);
    return 0;
  }
  return updateTo(io, plan.value);
}

function valueOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function keyOf(id: string): Result<Key> {
  if (id === PROJECT_META) {
    return { kind: "failed", reason: "the team pin moves only through agent-factory team update" };
  }
  const key = keyById(id);
  return key === undefined
    ? { kind: "failed", reason: `${id} is not a settings key${didYouMean(id)}` }
    : { kind: "ok", value: key };
}

type Target = { readonly key: Key; readonly loaded: Loaded; readonly value: unknown };

async function setTarget(io: SettingsIo, project: string, id: string, text: string): Promise<Result<Target>> {
  const key = keyOf(id);
  if (key.kind === "failed") {
    return key;
  }
  const loaded = await loadProject(io.home, project);
  return loaded.kind === "ok"
    ? { kind: "ok", value: { key: key.value, loaded: loaded.value, value: valueOf(text) } }
    : loaded;
}

type Planned = { readonly edits: readonly Change[]; readonly next: string };

async function plannedSet(io: SettingsIo, t: Target): Promise<Result<Planned>> {
  const before = await resolved(io, t.loaded);
  const resolvedOf = (id: string): unknown => before.values.find((r) => r.key.id === id)?.value;
  const partner = partnerOf(t.key, t.loaded.value, resolvedOf);
  const edits = [{ path: t.key.path, value: t.value }, ...(partner === undefined ? [] : [partner])];
  const next = withValues(t.loaded.text, edits);
  return next.kind === "ok" ? { kind: "ok", value: { edits, next: next.value } } : next;
}

function identity(p: Problem): string {
  return JSON.stringify([p.key, p.rule]);
}

async function checkedSet(io: SettingsIo, t: Target): Promise<Result<Planned>> {
  const plan = await plannedSet(io, t);
  if (plan.kind === "failed") {
    return plan;
  }
  const was = await candidateProblems(io, t.loaded.path, t.loaded.text);
  const known = new Set(was.filter((p) => p.level === "error").map(identity));
  const now = await candidateProblems(io, t.loaded.path, plan.value.next);
  const fresh = now.filter((p) => p.level === "error" && !known.has(identity(p)));
  const rest = now
    .filter((p) => !fresh.includes(p))
    .map((p) => ({ level: "warning" as const, key: p.key, rule: p.rule, text: p.text }));
  printProblems(io, [...fresh, ...rest]);
  return fresh.length === 0 ? plan : { kind: "failed", reason: `refused; ${t.loaded.path} is unchanged` };
}

function shadowedWarnings(values: readonly Resolved[]): readonly Problem[] {
  return values
    .filter((r) => !r.sources.some((s) => s.layer === "project"))
    .map((r) => ({
      level: "warning" as const,
      key: r.key.id,
      rule: "lower-wins",
      text: `${r.key.id}: ${r.sources.map(where).join(", ")} wins over the project file; the value in use is ${valueText(r)}`,
    }));
}

async function setKey(io: SettingsIo, project: string, id: string, text: string): Promise<number> {
  const fail = (reason: string): number => {
    io.err(`agent-factory config set: ${reason}\n`);
    return 1;
  };
  const t = await setTarget(io, project, id, text);
  if (t.kind === "failed") {
    return fail(t.reason);
  }
  const { loaded, key, value } = t.value;
  if (canonical(valueAt(loaded.value, key.path)) === canonical(value)) {
    io.out(`unchanged: ${id} is already ${JSON.stringify(value)} in ${loaded.path}\n`);
    return 0;
  }
  const plan = await checkedSet(io, t.value);
  if (plan.kind === "failed") {
    return fail(plan.reason);
  }
  const saved = await saveFile(loaded.path, loaded.text, plan.value.next);
  return saved.kind === "failed" ? fail(saved.reason) : printSet(io, project, plan.value.edits);
}

async function printSet(io: SettingsIo, project: string, edits: readonly Change[]): Promise<number> {
  const loaded = await loadProject(io.home, project);
  if (loaded.kind === "failed") {
    io.err(`agent-factory config set: ${loaded.reason}\n`);
    return 1;
  }
  const ids = new Set(edits.map((c) => pathKey(c.path)));
  const values = (await resolved(io, loaded.value)).values.filter((r) => ids.has(pathKey(r.key.path)));
  io.out(table([["key", "value", "layer", "where", "class"], ...values.map(rowOf)]));
  printProblems(io, shadowedWarnings(values));
  return 0;
}

const CONFIG: Readonly<Record<string, (io: SettingsIo, project: string) => Promise<number>>> = { show, check };

function configRun(sub: string | undefined): ((io: SettingsIo, project: string) => Promise<number>) | undefined {
  return sub !== undefined && Object.hasOwn(CONFIG, sub) ? CONFIG[sub] : undefined;
}

const CONFIG_USAGE =
  "usage: agent-factory config show <project> [--json] | config check <project> | config set <project> <key> [--] <value>\n";

function isThree(list: readonly string[]): list is readonly [string, string, string] {
  return list.length === 3;
}

function setArgs(positionals: readonly string[]): readonly [string, string, string] | undefined {
  const args = positionals.slice(1);
  return positionals[0] === "set" && isThree(args) ? args : undefined;
}

export function configCommand(positionals: readonly string[], io: SettingsIo): Promise<number> {
  const set = setArgs(positionals);
  if (set !== undefined) {
    return setKey(io, ...set);
  }
  const [sub, project, ...rest] = positionals;
  const run = configRun(sub);
  if (run === undefined || project === undefined || rest.length > 0) {
    io.err(CONFIG_USAGE);
    return Promise.resolve(64);
  }
  return run(io, project);
}

export function teamCommand(positionals: readonly string[], io: SettingsIo): Promise<number> {
  const [sub, project, commit, ...rest] = positionals;
  if (sub !== "update" || project === undefined || rest.length > 0) {
    io.err("usage: agent-factory team update <project> [<commit>]\n");
    return Promise.resolve(64);
  }
  return update(io, project, commit);
}
