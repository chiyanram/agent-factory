// init-cli — `agent-factory init [<project>] [--repo <path>] [--yes]`, the guided setup (#369; the operator's option B
// on #30, 2026-11-10). Plain code, no model run. Run inside the product clone (or name it with --repo), it:
//
//   1. reads the clone (core/init/detect.ts): the git host and project from origin, the build tool, the test and
//      migration folders, the CI files and the toolchain file;
//   2. asks one numbered round (core/init/round.ts), only what the files do not already hold; Enter or --yes takes
//      every recommendation;
//   3. writes `runner` to $FACTORY_HOME/user.json and the project's settings to $FACTORY_HOME/projects/<project>.json,
//      never to the repo or a shell profile, after config check passes on the result; a value the files hold is
//      replaced only after the person sees the diff and says yes (--yes keeps it, and exits 3);
//   4. pins each listed plugin through `plugin update`, after it says what that does and the person says yes;
//   5. checks each piece (core/init/checks.ts) and prints ✓ or ✗ with the fix, then the next commands in order.
//
// It never handles a secret and never runs a command only a human runs (setup claude, onboard, onboard accept,
// start, approve, waive): it prints them. Exit 0 every check passed, 1 a check failed or init was refused, 3 an
// existing value was kept under --yes, 64 usage.

import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { codeOf } from "./core/dispatch/records.js";
import type { Result } from "./core/forge/api.js";
import { hostGit } from "./core/git.js";
import { readKnowledge } from "./core/onboard/home.js";
import { initialProject } from "./core/plugin/config.js";
import { marketplaceDir, readPins } from "./core/process/pins.js";
import { pluginListOf, refText, type PluginRef } from "./core/process/plugins.js";
import { projectPath } from "./core/project.js";
import { userPath } from "./core/settings/layers.js";
import { settingName, settingOf } from "./core/settings/machine.js";
import { canonical } from "./core/settings/resolve.js";
import { plainName } from "./core/spec.js";
import {
  checkLines,
  claudeCheck,
  gitHostCheck,
  nodeCheck,
  srtCheck,
  tokenCheck,
  toolchainChecks,
  wallCheck,
  type Check,
  type Probes,
} from "./core/init/checks.js";
import { detect, type Detected } from "./core/init/detect.js";
import { applied, at, changeOf, diffLines, projectEntries, questionsFor, type Change } from "./core/init/plan.js";
import { answersOf, asking, HOW_TO_ANSWER, valueOf, type Question } from "./core/init/round.js";
import { pinUpdate } from "./plugin-pin-cli.js";
import { candidateProblems, checkProblems } from "./settings-cli.js";

export type InitIo = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  // the factory home
  readonly home: string;
  // one line the person types; none off a terminal, where only --yes can answer
  readonly readLine?: (prompt: string) => Promise<string>;
  readonly probes: Probes;
  // each marketplace init knows, by its name: where to clone it from when it is not in the factory home yet
  readonly markets: Readonly<Record<string, string>>;
};

export type InitArgs = {
  readonly project: string | undefined;
  // the folder in the clone init reads
  readonly dir: string;
  readonly yes: boolean;
};

// the marketplaces init can clone by itself (GUIDE "The project file")
export const KNOWN_MARKETS: Readonly<Record<string, string>> = { chiyanram: "https://github.com/chiyanram/skills" };

export const INIT_HELP = `  init [<project>] [--repo <path>] [--yes]
                               set up this laptop and a project in one guided run, from inside the product clone:
                               it reads the clone, asks one round of choices (Enter or --yes takes the recommended),
                               writes runner to <home>/user.json and the project file, pins the plugins, checks each
                               piece with its fix, and prints the commands only you run next. Rerun-safe
`;

const TRIES = 3;

function fail(io: InitIo, reason: string): number {
  io.err(`agent-factory init: ${reason}\n`);
  return 1;
}

type Json = { readonly kind: "none" } | { readonly kind: "ok"; readonly value: object };

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// readJson : a settings file as JSON; none when it is not there; refused when it is there and not a JSON object, so
// init never replaces a file it cannot read
async function readJson(path: string): Promise<Result<Json>> {
  const text = await readFile(path, "utf8").catch((e: unknown) => (codeOf(e) === "ENOENT" ? undefined : ""));
  if (text === undefined) {
    return { kind: "ok", value: { kind: "none" } };
  }
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value)
      ? { kind: "ok", value: { kind: "ok", value } }
      : { kind: "failed", reason: `${path} is not a JSON object; fix it by hand first` };
  } catch {
    return { kind: "failed", reason: `${path} cannot be read as JSON; fix it by hand first` };
  }
}

function heldOf(json: Json): object {
  return json.kind === "ok" ? json.value : {};
}

// writeJson : the file in place at once (a temp file, then a rename), mode 600, in a folder of mode 700
async function writeJson(path: string, value: object): Promise<Result<string>> {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, path);
    return { kind: "ok", value: path };
  } catch {
    return { kind: "failed", reason: `cannot write ${path}` };
  }
}

function orNone(items: readonly string[], none: string): string {
  return items.length === 0 ? none : items.join(", ");
}

function toolLine(d: Detected): string {
  if (d.toolchain === "none") {
    return "none declared";
  }
  return `${d.toolchain.file} (${orNone(
    d.toolchain.tools.map((t) => `${t.name} ${t.version}`),
    "no tools",
  )})`;
}

function foundLines(d: Detected): string {
  const named = d.hostName === "" ? "" : ` at ${d.hostName}`;
  const extra = d.integrationTests ? " (they hold src/integrationTest/**)" : "";
  return [
    `Found in ${d.clone}:`,
    `  git host   ${d.host}${named}, project ${d.project} (origin)`,
    `  build      ${orNone(
      d.builds.map((b) => `${b.name} (${b.file})`),
      "none found",
    )}`,
    `  tests      the built-in test globs${extra}`,
    `  migrations ${orNone(
      d.oneWayDoor.map((o) => `${o.tool} ${o.glob}`),
      "none found",
    )}`,
    `  CI         ${orNone(d.ci, "none found")}`,
    `  toolchain  ${toolLine(d)}`,
  ]
    .map((l) => `${l}\n`)
    .join("");
}

// picked : the round's answers: the recommendations under --yes or on an empty reply, else the reply, asked again
// when it does not read
async function picked(io: InitIo, questions: readonly Question[], yes: boolean): Promise<Result<readonly number[]>> {
  if (questions.length === 0) {
    io.out("Nothing to ask: the files already hold every answer.\n");
    return { kind: "ok", value: [] };
  }
  io.out(`\n${questions.map(asking).join("")}${HOW_TO_ANSWER}.\n`);
  const recommended = answersOf(questions, "");
  if (yes && recommended.kind === "ok") {
    io.out("--yes: taking every recommendation\n");
    return { kind: "ok", value: recommended.picks };
  }
  return readPicks(io, questions);
}

async function readPicks(io: InitIo, questions: readonly Question[]): Promise<Result<readonly number[]>> {
  if (io.readLine === undefined) {
    return {
      kind: "failed",
      reason: "init asks questions: run it in a terminal, or pass --yes to take every recommendation",
    };
  }
  for (let i = 0; i < TRIES; i += 1) {
    const answers = answersOf(questions, await io.readLine("> "));
    if (answers.kind === "ok") {
      return { kind: "ok", value: answers.picks };
    }
    io.err(`${answers.why}\n`);
  }
  return { kind: "failed", reason: "no answer read; nothing was written" };
}

// yesNo : the person's yes to one step; --yes takes `whenYes`; off a terminal, no
async function yesNo(io: InitIo, yes: boolean, prompt: string, whenYes: boolean): Promise<boolean> {
  if (yes || io.readLine === undefined) {
    return yes && whenYes;
  }
  return saidYes((await io.readLine(prompt)).trim(), prompt.includes("[Y/n]"));
}

// saidYes : a typed yes, or Enter where the prompt's default is yes
function saidYes(said: string, yesByDefault: boolean): boolean {
  return /^y(es)?$/i.test(said) || (said === "" && yesByDefault);
}

type Plan = {
  readonly name: string;
  readonly detected: Detected;
  readonly project: Json;
  readonly user: Json;
  readonly projectChanges: readonly Change[];
  readonly userChanges: readonly Change[];
};

function plannedLines(path: string, changes: readonly Change[]): string {
  const lines = diffLines(changes);
  return lines.length === 0 ? `${path}: no change\n` : `${path}:\n${lines.map((l) => `${l}\n`).join("")}`;
}

function replacements(plan: Plan): number {
  return [...plan.projectChanges, ...plan.userChanges].filter((c) => c.kind === "replace").length;
}

// replaceOk : whether the replacements go in; --yes keeps every value the files hold
async function replaceOk(io: InitIo, plan: Plan, yes: boolean): Promise<boolean> {
  const n = replacements(plan);
  if (n === 0) {
    return true;
  }
  if (yes) {
    io.out(
      `--yes keeps the ${n} value(s) marked ~ as they are; run agent-factory init without --yes to replace them\n`,
    );
    return false;
  }
  return yesNo(io, yes, `Replace the ${n} value(s) marked ~? [y/N] `, false);
}

type Written = { readonly projectFile: object; readonly kept: boolean };

function baseOf(plan: Plan): object {
  const fresh: unknown = JSON.parse(initialProject());
  if (plan.project.kind === "ok") {
    return plan.project.value;
  }
  return isObject(fresh) ? fresh : {};
}

// refusedResult : config check's errors on the project file init would write, as one reason; "" when none
async function refusedResult(io: InitIo, path: string, value: object): Promise<string> {
  const problems = (await candidateProblems(io, path, JSON.stringify(value))).filter((p) => p.level === "error");
  return problems.length === 0
    ? ""
    : `config check refuses the result, so nothing was written:\n  ${problems.map((p) => p.text).join("\n  ")}`;
}

async function writeAll(io: InitIo, plan: Plan, replace: boolean): Promise<Result<Written>> {
  const projectFile = applied(baseOf(plan), plan.projectChanges, replace);
  const path = projectPath(io.home, plan.name);
  const refused = await refusedResult(io, path, projectFile);
  if (refused !== "") {
    return { kind: "failed", reason: refused };
  }
  const steps: readonly [string, Json, readonly Change[], object][] = [
    [userPath(io.home), plan.user, plan.userChanges, applied(heldOf(plan.user), plan.userChanges, replace)],
    [path, plan.project, plan.projectChanges, projectFile],
  ];
  for (const [file, was, changes, value] of steps) {
    const done = await writeIfChanged(io, file, was, changes, value);
    if (done.kind === "failed") {
      return done;
    }
  }
  return { kind: "ok", value: { projectFile, kept: !replace && replacements(plan) > 0 } };
}

async function writeIfChanged(
  io: InitIo,
  file: string,
  was: Json,
  changes: readonly Change[],
  value: object,
): Promise<Result<string>> {
  const unchanged =
    was.kind === "ok" && (canonical(was.value) === canonical(value) || changes.every((c) => c.kind === "same"));
  if (unchanged) {
    return { kind: "ok", value: file };
  }
  const done = await writeJson(file, value);
  if (done.kind === "ok") {
    io.out(`wrote ${file}\n`);
  }
  return done;
}

async function there(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

// cloneMarket : the marketplace's clone in the factory home, made through hostGit when it is not there
async function cloneMarket(io: InitIo, ref: PluginRef): Promise<Result<string>> {
  const dir = marketplaceDir(io.home, ref.marketplace);
  if (await there(dir)) {
    return { kind: "ok", value: dir };
  }
  const url = io.markets[ref.marketplace];
  if (url === undefined) {
    return { kind: "failed", reason: `init does not know where ${ref.marketplace} comes from; git clone it to ${dir}` };
  }
  await mkdir(dirname(dir), { recursive: true, mode: 0o700 });
  const got = await hostGit({
    args: ["clone", "--quiet", url, dir],
    repo: { kind: "none" },
    env: io.env,
    stdin: { kind: "none" },
  });
  return got.kind === "ok"
    ? { kind: "ok", value: dir }
    : { kind: "failed", reason: `cannot clone ${url}: ${got.kind === "refused" ? got.reason : got.stderr.trim()}` };
}

async function pinnedAt(io: InitIo, name: string, word: string): Promise<string> {
  const pins = await readPins(io.home, name);
  const pin = pins.kind === "ok" ? pins.value[word] : undefined;
  return pin === undefined ? "" : pin.commit.slice(0, 12);
}

async function pinOne(io: InitIo, name: string, ref: PluginRef, yes: boolean): Promise<Check> {
  const word = refText(ref);
  const commit = await pinnedAt(io, name, word);
  if (commit !== "") {
    return { ok: true, line: `plugin ${word} pinned at ${commit}`, fix: "" };
  }
  const how = `agent-factory plugin update ${name} ${word}`;
  const from = io.markets[ref.marketplace] ?? ref.marketplace;
  io.out(
    `\nPin ${word}: clone ${from} to ${marketplaceDir(io.home, ref.marketplace)} if it is not there, then ${how}: it copies the plugin by its hash, shows its files, runs config check, then pins it.\n`,
  );
  return (await yesNo(io, yes, "Pin it now? [Y/n] ", true))
    ? pinNow(io, name, ref, how)
    : { ok: false, line: `plugin ${word}: not pinned`, fix: how };
}

async function pinNow(io: InitIo, name: string, ref: PluginRef, how: string): Promise<Check> {
  const word = refText(ref);
  const market = await cloneMarket(io, ref);
  if (market.kind === "failed") {
    return { ok: false, line: `plugin ${word}: ${market.reason}`, fix: how };
  }
  const code = await pinUpdate(io, name, word, undefined);
  return code === 0
    ? { ok: true, line: `plugin ${word} pinned`, fix: "" }
    : { ok: false, line: `plugin ${word}: plugin update failed (above)`, fix: how };
}

async function pinAll(io: InitIo, name: string, file: object, yes: boolean): Promise<readonly Check[]> {
  const refs = pluginListOf(projectPath(io.home, name), file);
  const each: Check[] = [];
  for (const ref of refs.kind === "ok" ? refs.value : []) {
    each.push(await pinOne(io, name, ref, yes));
  }
  return each;
}

async function configCheck(io: InitIo, name: string): Promise<Check> {
  const problems = await checkProblems(io, name);
  if (problems.kind === "failed") {
    return { ok: false, line: `config check: ${problems.reason}`, fix: `agent-factory config check ${name}` };
  }
  const errors = problems.value.filter((p) => p.level === "error");
  const warnings = problems.value.filter((p) => p.level === "warning").map((p) => `  warning: ${p.text}\n`);
  io.out(warnings.join(""));
  return errors.length === 0
    ? { ok: true, line: `config check ${name}: settings ok`, fix: "" }
    : {
        ok: false,
        line: `config check ${name}: ${errors.map((e) => e.text).join("; ")}`,
        fix: `agent-factory config show ${name}`,
      };
}

async function checksOf(io: InitIo, plan: Plan, runner: unknown): Promise<readonly Check[]> {
  const p = io.probes;
  const d = plan.detected;
  return [
    ...(runner === "srt" ? [await srtCheck(p)] : []),
    await claudeCheck(p),
    await nodeCheck(p),
    await tokenCheck(io.home, p.now),
    await gitHostCheck(p, { ...d, name: plan.name }),
    ...(await toolchainChecks(p, d.toolchain)),
    await wallCheck(p),
    await configCheck(io, plan.name),
  ];
}

// the variables the files now hold: an export of one in a shell profile can go
const MOVED = [
  { id: "gitHost", path: ["gitHost"] },
  { id: "gitHostProject", path: ["gitHostProject"] },
  { id: "clone", path: ["clone"] },
] as const;

function exportLines(io: InitIo, file: object, user: object): string {
  const same = [
    ...MOVED.filter((m) => settingOf(io.env, m.id) === at(file, m.path)).map((m) => settingName(m.id)),
    ...(settingOf(io.env, "runner") === at(user, ["runner"]) ? [settingName("runner")] : []),
  ];
  return same.length === 0
    ? ""
    : `\nThe files now hold ${same.join(", ")}: you can remove their exports from your shell profile.\n`;
}

async function nextLines(io: InitIo, name: string, checks: readonly Check[], clone: string): Promise<string> {
  const fixes = [...new Set(checks.filter((c) => !c.ok).map((c) => c.fix))];
  const known = await readKnowledge(io.home, name);
  const steps = [
    ...fixes,
    `open claude once in ${clone} and accept its trust prompt`,
    ...(known.kind === "accepted"
      ? []
      : [
          `agent-factory onboard ${name}`,
          `agent-factory onboard accept ${name} <brief hash> <glossary hash>   (the hashes onboard printed, after you read both files)`,
        ]),
    `agent-factory spec --template <ticket>   (write the ticket's spec into ${join(io.home, "specs", name, "<ticket>", "spec.md")})`,
    `agent-factory start ${name} <ticket>`,
    `agent-factory coordinator ${name}   (talk with the coordinator; it reads this project file, so it needs no exports)`,
  ];
  return `\nNext, in this order (you run these; init runs none of them):\n${steps.map((s, i) => `  ${i + 1}. ${s}\n`).join("")}`;
}

type Held = { readonly name: string; readonly project: Json; readonly user: Json };

// heldFiles : the project's name and the two files init may write, as they are now
async function heldFiles(io: InitIo, args: InitArgs, d: Detected): Promise<Result<Held>> {
  const name = args.project ?? d.name;
  if (!plainName(name)) {
    return {
      kind: "failed",
      reason: `${JSON.stringify(name)} is not a plain project name; name it: agent-factory init <project>`,
    };
  }
  const project = await readJson(projectPath(io.home, name));
  if (project.kind === "failed") {
    return project;
  }
  const user = await readJson(userPath(io.home));
  return user.kind === "ok" ? { kind: "ok", value: { name, project: project.value, user: user.value } } : user;
}

async function planned(io: InitIo, args: InitArgs, d: Detected): Promise<Result<Plan>> {
  const files = await heldFiles(io, args, d);
  if (files.kind === "failed") {
    return files;
  }
  const held = { project: heldOf(files.value.project), user: heldOf(files.value.user), env: io.env };
  const questions = questionsFor(d, held);
  const picks = await picked(io, questions, args.yes);
  if (picks.kind === "failed") {
    return picks;
  }
  return valueOf(questions, picks.value, "gitHostProject") === "stop"
    ? { kind: "failed", reason: "stopped as you asked; nothing was written" }
    : { kind: "ok", value: planOf(d, files.value, held, { questions, picks: picks.value }) };
}

function planOf(
  d: Detected,
  files: Held,
  held: { readonly project: object; readonly user: object },
  round: { readonly questions: readonly Question[]; readonly picks: readonly number[] },
): Plan {
  const runner = valueOf(round.questions, round.picks, "runner") ?? at(held.user, ["runner"]);
  return {
    name: files.name,
    detected: d,
    project: files.project,
    user: files.user,
    projectChanges: projectEntries(d, { ...round, project: held.project }).map((e) => changeOf(held.project, e)),
    userChanges: [changeOf(held.user, { path: ["runner"], value: runner })],
  };
}

// initCommand : the guided setup
export async function initCommand(args: InitArgs, io: InitIo): Promise<number> {
  const d = await detect(args.dir, io.env);
  if (d.kind === "failed") {
    return fail(io, d.reason);
  }
  io.out(foundLines(d.value));
  const plan = await planned(io, args, d.value);
  if (plan.kind === "failed") {
    return fail(io, plan.reason);
  }
  io.out(
    `\n${plannedLines(userPath(io.home), plan.value.userChanges)}${plannedLines(projectPath(io.home, plan.value.name), plan.value.projectChanges)}`,
  );
  const written = await writeAll(io, plan.value, await replaceOk(io, plan.value, args.yes));
  if (written.kind === "failed") {
    return fail(io, written.reason);
  }
  return finish(io, plan.value, written.value, args.yes);
}

async function finish(io: InitIo, plan: Plan, written: Written, yes: boolean): Promise<number> {
  const pins = await pinAll(io, plan.name, written.projectFile, yes);
  const user = applied(heldOf(plan.user), plan.userChanges, !written.kept);
  const checks = [...pins, ...(await checksOf(io, plan, at(user, ["runner"])))];
  io.out(`\nChecks:\n${checkLines(checks)}`);
  io.out(exportLines(io, written.projectFile, user));
  io.out(await nextLines(io, plan.name, checks, plan.detected.clone));
  if (written.kept) {
    return 3;
  }
  return checks.every((c) => c.ok) ? 0 : 1;
}
