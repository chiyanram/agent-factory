// loop-cli — the coordinator's forge commands and the writer's lint hook on the command line (#138): claim, release,
// status, ask, block, reconcile (core/loop.ts) and lint-edit (core/lint-edit.ts). Each prints one line per action;
// with FACTORY_DRY_RUN=1 the seam prints each write on stderr instead, and the line ends in "(dry run)".
//
// Each forge command may name its project first (#382): `claim ledger 12`. Its words are checked before the project's
// settings are read (core/which-project.ts), so a wrong word prints the usage and nothing else.

import { homedir } from "node:os";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { open, realpath, stat, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { headed } from "./core/dispatch/last-poll.js";
import type { Result } from "./core/forge/api.js";
import { forgeHost, openProject } from "./core/forge/index.js";
import type { Identity } from "./core/identity.js";
import { hostPush } from "./core/push.js";
import type { PushTarget } from "./core/writer/step.js";
import type { Forge } from "./core/forge/types.js";
import { lintEdit } from "./core/lint-edit.js";
import { ask, block, claim, grill, reconcile, release, status, type AtHead } from "./core/loop.js";
import { questionsIn, type Question } from "./core/report.js";
import { questionRound, readsBackAs } from "./core/finish.js";
import { DEFAULT_CLAIM_LABEL } from "./core/poll.js";
import { claudeSessions } from "./core/review/live.js";
import { runInFolder } from "./core/review/model.js";
import { claudeEnv } from "./core/review/settings.js";
import { settingOf } from "./core/settings/machine.js";

export type LoopIo = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly readStdin: () => Promise<string>;
};

// a command's words, checked: what it runs once the project's settings are resolved, or "usage"
type Parsed = ((io: LoopIo) => Promise<number> | number) | "usage";

type Act = (forge: Forge, label: string, identity: Identity) => Promise<Result<string | readonly string[]>>;

const USAGE: Readonly<Record<string, string>> = {
  claim: "claim [<project>] <number>",
  release: "release [<project>] <number>",
  status: 'status [<project>] <number> <sha> "<line>"',
  ask: 'ask [<project>] <number> <sha> "<question>"',
  grill: "grill [<project>] <number> <sha> <questions file>",
  block: 'block [<project>] <number> "<reason>" [<log>]',
  reconcile: "reconcile [<project>]",
  "lint-edit": "lint-edit '<lint command>'",
};

// loopUsage : the command's usage on stderr, exit 64
export function loopUsage(name: string, io: { readonly err: (text: string) => void }): number {
  io.err(`usage: agent-factory ${USAGE[name] ?? name}\n`);
  return 64;
}

// the form with a project, for the message that asks to name one
export function projectForm(name: string): string {
  return `agent-factory ${(USAGE[name] ?? name).replace("[<project>]", "<project>")}`;
}

// projectWord : the project a forge command names before its own words, if any: any first word that is not a change
// number. poll and reconcile take no other word, so their one word is the project.
export function projectWord(
  name: string,
  positionals: readonly string[],
): { readonly project: string | undefined; readonly rest: readonly string[] } {
  const [first, ...rest] = positionals;
  const named = first !== undefined && (name === "poll" || name === "reconcile" || numberOf(first) === "bad");
  return named ? { project: first, rest } : { project: undefined, rest: positionals };
}

function word(positionals: readonly string[], i: number): string {
  return positionals[i] ?? "";
}

function numberOf(value: string | undefined): number | "bad" {
  return value !== undefined && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : "bad";
}

function lines(value: string | readonly string[], dry: string): string {
  return (typeof value === "string" ? [value] : value).map((l) => `${l}${dry}\n`).join("");
}

// forgeOf : the project's forge and its claim label
async function forgeOf(
  io: LoopIo,
): Promise<Result<{ readonly forge: Forge; readonly label: string; readonly identity: Identity }>> {
  const label = settingOf(io.env, "claimLabel") ?? DEFAULT_CLAIM_LABEL;
  if (label.trim() === "") {
    return { kind: "failed", reason: "FACTORY_CLAIM_LABEL is set but empty" };
  }
  const opened = await openProject({ env: io.env, log: (line) => io.err(`${line}\n`) });
  return opened.kind === "ok" ? { kind: "ok", value: { ...opened.value, label } } : opened;
}

// onForge : the action on the project's forge; its lines on stdout, or why it failed on stderr
async function onForge(name: string, io: LoopIo, act: Act): Promise<number> {
  const opened = await forgeOf(io);
  const done = opened.kind === "ok" ? await act(opened.value.forge, opened.value.label, opened.value.identity) : opened;
  if (done.kind === "failed") {
    io.err(`agent-factory ${name}: ${done.reason}\n`);
    return 1;
  }
  io.out(lines(done.value, settingOf(io.env, "dryRun") === "1" ? " (dry run)" : ""));
  return 0;
}

function claimed(name: "claim" | "release", positionals: readonly string[]): Parsed {
  const number = numberOf(positionals[0]);
  if (number === "bad" || positionals.length !== 1) {
    return "usage";
  }
  const act = name === "claim" ? claim : release;
  return (io) => onForge(name, io, (forge, label) => act({ forge, number, label }));
}

function atHead(name: "status" | "ask", positionals: readonly string[]): Parsed {
  const number = numberOf(positionals[0]);
  if (number === "bad" || positionals.length !== 3) {
    return "usage";
  }
  const [sha, text] = [word(positionals, 1), word(positionals, 2)];
  return name === "status"
    ? (io) => onForge(name, io, (forge, label) => withLiveness(io, forge, label, status({ forge, number, sha, text })))
    : (io) => onForge(name, io, (forge) => ask({ forge, number, sha, text } satisfies AtHead));
}

// grillParsed : grill's words: the change, its head, and the questions file
function grillParsed(positionals: readonly string[]): Parsed {
  const number = numberOf(positionals[0]);
  if (number === "bad" || positionals.length !== 3) {
    return "usage";
  }
  const [sha, file] = [word(positionals, 1), word(positionals, 2)];
  return async (io) => {
    const questions = await questionsFrom(io.env, file);
    if (questions.kind === "failed") {
      io.err(`agent-factory grill: ${questions.reason}\n`);
      return 2;
    }
    return onForge("grill", io, (forge) => grill({ forge, number, sha, questions: questions.value }));
  };
}

// questionsFrom : the round's questions, from a file under <home>/specs, the one folder the coordinator writes; a file
// anywhere else is refused, so grill reads no other file (#517)
export async function questionsFrom(env: NodeJS.ProcessEnv, file: string): Promise<Result<readonly Question[]>> {
  const home = homeOf(env);
  if (home.kind === "failed") {
    return home;
  }
  const specs = join(home.value, "specs");
  const read = await readUnder(resolve(file), specs);
  return read.kind === "ok" ? questionsOfText(read.value) : read;
}

// the most bytes a questions file may hold: 20 questions with their choices fit in far less
export const MOST_QUESTIONS_BYTES = 64 * 1024;

// readUnder : a file's text, opened once: never through a link at its end (O_NOFOLLOW), a regular file with one link
// (a hard link to a file elsewhere is refused) and at most MOST_QUESTIONS_BYTES, whose real path is under `root` and
// is the very file opened; read from that handle, so nothing can be swapped in between
async function readUnder(path: string, root: string): Promise<Result<string>> {
  const refused = {
    kind: "failed",
    reason: `the questions file must be a file under ${root}, got ${JSON.stringify(path)}`,
  } as const;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => undefined);
  if (handle === undefined) {
    return refused;
  }
  try {
    const shape = await fileShape(handle, path, root);
    return shape === "" ? { kind: "ok", value: await handle.readFile("utf8") } : { kind: "failed", reason: shape };
  } finally {
    await handle.close();
  }
}

// fileShape : "" when the opened file is a regular file with one link, small enough, at a real path under `root`;
// else why it is refused
async function fileShape(handle: FileHandle, path: string, root: string): Promise<string> {
  const st = await handle.stat();
  if (!plainSmallFile(st)) {
    return `the questions file must be a regular file with one link and at most ${MOST_QUESTIONS_BYTES} bytes, got ${JSON.stringify(path)}`;
  }
  return (await sameFileUnder(st, path, root))
    ? ""
    : `the questions file must be a file under ${root}, got ${JSON.stringify(path)}`;
}

// plainSmallFile : a regular file with one link (no hard link to a file elsewhere) and at most MOST_QUESTIONS_BYTES
function plainSmallFile(st: Stats): boolean {
  return st.isFile() && st.nlink === 1 && st.size <= MOST_QUESTIONS_BYTES;
}

// sameFileUnder : whether the path's real path is under the root's and is the very file the handle opened, so nothing
// was swapped in between
async function sameFileUnder(st: Stats, path: string, root: string): Promise<boolean> {
  const [real, base] = await Promise.all([realpath(path).catch(() => ""), realpath(root).catch(() => "")]);
  if (!under(real, base)) {
    return false;
  }
  const at = await stat(real).catch(() => undefined);
  return at !== undefined && at.ino === st.ino && at.dev === st.dev;
}

// under : whether a real path is inside a real folder; neither may be "" (a path that did not resolve). Pure.
function under(real: string, base: string): boolean {
  return real !== "" && base !== "" && real.startsWith(`${base}${sep}`);
}

// questionsOfText : the questions a file's JSON holds, checked as a report's are. Pure.
function questionsOfText(text: string): Result<readonly Question[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "failed", reason: "the questions file is not JSON" };
  }
  const read = questionsIn(parsed);
  if (read.kind === "bad") {
    return { kind: "failed", reason: read.problem };
  }
  // a question that checks can still post damaged: refuse the file rather than post a round no reply can close (#517)
  const round = questionRound(read.value);
  const note = { seat: "coordinator", title: round.title, fields: [round.answer], items: round.items } as const;
  const back = readsBackAs(note, read.value);
  return back === "" ? { kind: "ok", value: read.value } : { kind: "failed", reason: back };
}

// homeOf : the factory's home, as dispatch reads it; a relative FACTORY_HOME is refused
function homeOf(env: NodeJS.ProcessEnv): Result<string> {
  const home = env.FACTORY_HOME ?? join(homedir(), ".factory");
  return isAbsolute(home)
    ? { kind: "ok", value: home }
    : { kind: "failed", reason: `FACTORY_HOME must be an absolute path, got ${JSON.stringify(home)}` };
}

// withLiveness : status's line, headed by when the orchestrator last ran and whether its loop runs (#103, #305)
async function withLiveness(
  io: LoopIo,
  forge: Forge,
  label: string,
  posted: Promise<Result<string>>,
): Promise<Result<string>> {
  const done = await posted;
  return done.kind === "ok"
    ? {
        kind: "ok",
        value: await headed({
          home: homeOf(io.env),
          forge,
          label,
          repo: settingOf(io.env, "gitHostProject") ?? "",
          now: Date.now(),
          line: done.value,
        }),
      }
    : done;
}

function blocked(positionals: readonly string[]): Parsed {
  const [n, reason, log] = positionals;
  const number = numberOf(n);
  if (number === "bad" || reason === undefined || positionals.length > 3) {
    return "usage";
  }
  return (io) => onForge("block", io, (forge, label) => block({ forge, number, label, reason, log: log ?? "" }));
}

function reconcileParsed(positionals: readonly string[]): Parsed {
  return positionals.length === 0 ? reconciled : "usage";
}

function reconciled(io: LoopIo): Promise<number> | number {
  const repo = settingOf(io.env, "clone") ?? "";
  if (!isAbsolute(repo)) {
    io.err(
      `agent-factory reconcile: the project's clone (clone in the project file, or FACTORY_REPO) must be an absolute path, got ${JSON.stringify(repo)}\n`,
    );
    return 1;
  }
  const sessions = claudeSessions({ bin: io.env.FACTORY_CLAUDE ?? "claude", env: claudeEnv(io.env) });
  return onForge("reconcile", io, (forge, label, identity) =>
    reconcile({
      forge,
      label,
      repo,
      env: io.env,
      sessions,
      dryRun: settingOf(io.env, "dryRun") === "1",
      landing: { target: landingTarget(io.env, forge, identity), pusher: hostPush },
    }),
  );
}

// landingTarget : where a dead writer's unlanded commits go: the project on its forge's host, as its identity
function landingTarget(env: NodeJS.ProcessEnv, forge: Forge, identity: Identity): Result<PushTarget> {
  const host = forgeHost(env, forge.name);
  const project = settingOf(env, "gitHostProject") ?? "";
  if (host.kind === "failed") {
    return host;
  }
  return project === ""
    ? {
        kind: "failed",
        reason: "the project on the git host is not set (gitHostProject in the project file, or FACTORY_PROJECT)",
      }
    : { kind: "ok", value: { forge: forge.name, host: host.value, project, identity, env } };
}

// lintEditCommand : the writer's lint hook; it reads no setting and names no project
export async function lintEditCommand(positionals: readonly string[], io: LoopIo): Promise<number> {
  const [command] = positionals;
  if (command === undefined || positionals.length !== 1) {
    return loopUsage("lint-edit", io);
  }
  const root = io.env.CLAUDE_PROJECT_DIR ?? io.env.PWD ?? "";
  const hooked = await lintEdit({ command, stdin: await io.readStdin(), root, env: io.env, run: runInFolder });
  io.err(hooked.err);
  return hooked.code;
}

// the forge commands: each checks its words (with the project word taken off), then runs on the resolved settings
export const LOOP_COMMANDS: Readonly<Record<string, (positionals: readonly string[]) => Parsed>> = {
  claim: (p) => claimed("claim", p),
  release: (p) => claimed("release", p),
  status: (p) => atHead("status", p),
  ask: (p) => atHead("ask", p),
  grill: grillParsed,
  block: blocked,
  reconcile: reconcileParsed,
};

export const LOOP_HELP = `  claim [<project>] <number>   add the claim label to an open change that has none: one run at a time; each of
                               these commands acts on the project it names, else on the one project in
                               <home>/projects (#382); with FACTORY_PROJECT exported and none named, on the variables
  release [<project>] <number> remove the claim label; a change with no claim is not an error
  status [<project>] <number> <sha> "<line>"
                               post one [coordinator] note; refused when the head is no longer <sha>; its line starts
                               with when the orchestrator last ran, LATE after 3 poll intervals while a change is claimed
                               and a loop is meant to be running; with no loop, that none runs
  ask [<project>] <number> <sha> "<question>"
                               post one [writer] OPEN: note, an open ask until a person answers; the same head rule
  grill [<project>] <number> <sha> <questions file>
                               post the coordinator's round: one [coordinator] OPEN: N questions note with an item per
                               question, open until a member answers each (#517); the file, under <home>/specs, is a JSON
                               list of {question, choices (2 to 4), recommended (the index)}, 1 to 20; the same head rule
  block [<project>] <number> "<reason>" [<log>]
                               label needs-human, post one [coordinator] blocked: note, then release the claim
  reconcile [<project>]        release each claim with no live run or on a merged change; remove each run's worktree
                               with no live run (the project's clone), but keep a writer's that holds unlanded work: push its
                               commits on top of the change's branch and label the change needs-human
  lint-edit '<lint command>'   the writer's PostToolUse hook: lint the file an Edit or Write changed, no shell
`;
