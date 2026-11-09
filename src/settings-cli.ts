// settings-cli — `agent-factory config show | check <project>` and `agent-factory team update <project> [<commit>]`
// (#229; docs/DESIGN.md section 5 "Settings"). The settings live in the factory home, never in the product repo, and
// these commands are for the human: the coordinator's deny list covers the user and team settings (#227).
//
//   config show    every key: its value, the layer and `file:line` it came from, its class, and the team's mode
//   config check   the layers resolved and the project file's readers run on the result: exit 0, or 1 with each error
//   team update    the resolved values at the team's new commit against the pinned one, a check, then the pin moved

import { readFile, rename, writeFile } from "node:fs/promises";
import { codeOf } from "./core/dispatch/records.js";
import type { Result } from "./core/forge/api.js";
import { hostGit } from "./core/git.js";
import { pluginConfigOf } from "./core/plugin/config.js";
import { pluginListOf } from "./core/process/plugins.js";
import { projectPath, readyFieldsOf } from "./core/project.js";
import { layered, readTeamAt, teamDir, type Layered, type Pin, type Read } from "./core/settings/layers.js";
import { canonical, where, type Problem, type Resolved } from "./core/settings/resolve.js";
import { plainName } from "./core/spec.js";

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

// readerErrors : what the project file's own readers refuse in the resolved settings
function readerErrors(path: string, effective: object): readonly Problem[] {
  const ready = readyFieldsOf(path, effective);
  const connectors = pluginConfigOf(path, effective);
  const plugins = pluginListOf(path, effective);
  return [ready, connectors, plugins].flatMap((r) =>
    r.kind === "failed" ? [{ level: "error" as const, text: r.reason }] : [],
  );
}

function allProblems(path: string, layers: Layered): readonly Problem[] {
  return [...layers.problems, ...readerErrors(path, layers.effective)];
}

function valueText(r: Resolved): string {
  return r.value === undefined ? "-" : JSON.stringify(r.value);
}

const WIDEST = 60;

// shortText : a value as config show's table prints it: a long list cut, with its length (--json prints it whole)
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

// table : columns padded to their widest cell
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

// checkProblems : what config check finds in the project's resolved settings, for a command that checks before it
// moves a pin (plugin update)
export async function checkProblems(
  io: Pick<SettingsIo, "home" | "env">,
  project: string,
): Promise<Result<readonly Problem[]>> {
  const loaded = await loadProject(io.home, project);
  if (loaded.kind === "failed") {
    return loaded;
  }
  const layers = await layered({ home: io.home, env: io.env, project: loaded.value });
  return { kind: "ok", value: allProblems(loaded.value.path, layers) };
}

async function check(io: SettingsIo, project: string): Promise<number> {
  const loaded = await loadProject(io.home, project);
  if (loaded.kind === "failed") {
    io.err(`agent-factory config check: ${loaded.reason}\n`);
    return 1;
  }
  const layers = await resolved(io, loaded.value);
  const problems = allProblems(loaded.value.path, layers);
  printProblems(io, problems);
  if (problems.some((p) => p.level === "error")) {
    return 1;
  }
  io.out(`settings ok: ${project} (${pinText(layers.pin)})\n`);
  return 0;
}

// ---- team update

const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

async function headOf(io: SettingsIo, team: string): Promise<Result<string>> {
  const got = await hostGit({
    args: ["rev-parse", "--verify", "HEAD^{commit}"],
    repo: { kind: "repo", path: teamDir(io.home, team) },
    env: io.env,
    ownHelper: { kind: "none" },
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

// changes : one line per key whose resolved value differs between the two pins
export function changes(before: readonly Resolved[], after: readonly Resolved[]): readonly string[] {
  return after.flatMap((a) => {
    const b = before.find((r) => r.key.id === a.key.id);
    return b === undefined || canonical(b.value) === canonical(a.value)
      ? []
      : [`${a.key.id}: ${valueText(b)} -> ${valueText(a)}`];
  });
}

const PIN_FIELD = /("team"\s*:\s*")[^"]*(")/;

async function movePin(path: string, text: string, pin: Pin): Promise<Result<string>> {
  const next = text.replace(PIN_FIELD, `$1${pin.team}@${pin.commit}$2`);
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temp, next, { mode: 0o600 });
    await rename(temp, path);
    return { kind: "ok", value: path };
  } catch {
    return { kind: "failed", reason: `cannot write ${path}` };
  }
}

type Update = { readonly loaded: Loaded; readonly pin: Pin; readonly commit: string };

async function updateTo(io: SettingsIo, u: Update): Promise<number> {
  const before = await resolved(io, u.loaded);
  const next: Pin = { team: u.pin.team, commit: u.commit };
  const after = await resolved(io, u.loaded, await readTeamAt(io.home, next, io.env));
  const lines = changes(before.values, after.values);
  io.out(lines.length === 0 ? "no resolved value changes\n" : lines.map((l) => `${l}\n`).join(""));
  const problems = allProblems(u.loaded.path, after);
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

const CONFIG: Readonly<Record<string, (io: SettingsIo, project: string) => Promise<number>>> = { show, check };

function configRun(sub: string): ((io: SettingsIo, project: string) => Promise<number>) | undefined {
  return Object.hasOwn(CONFIG, sub) ? CONFIG[sub] : undefined;
}

// configCommand : config show <project> [--json] | config check <project>
export function configCommand(positionals: readonly string[], io: SettingsIo): Promise<number> {
  const [sub = "", project, ...rest] = positionals;
  const run = configRun(sub);
  if (run === undefined || project === undefined || rest.length > 0) {
    io.err("usage: agent-factory config show <project> [--json] | config check <project>\n");
    return Promise.resolve(64);
  }
  return run(io, project);
}

// teamCommand : team update <project> [<commit>]
export function teamCommand(positionals: readonly string[], io: SettingsIo): Promise<number> {
  const [sub, project, commit, ...rest] = positionals;
  if (sub !== "update" || project === undefined || rest.length > 0) {
    io.err("usage: agent-factory team update <project> [<commit>]\n");
    return Promise.resolve(64);
  }
  return update(io, project, commit);
}
