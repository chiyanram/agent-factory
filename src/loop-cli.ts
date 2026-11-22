// loop-cli — the coordinator's note commands and the run hooks on the command line: status, ask and grill
// (core/loop.ts), lint-edit (core/lint-edit.ts), the coordinator's edit-scope hook (core/edit-scope.ts) and the
// test-first run's writer-scope hook (core/writer/scope.ts). Each prints one line per action;
// with FACTORY_DRY_RUN=1 the seam prints each write on stderr instead, and the line ends in "(dry run)".
//
// Each forge command may name its project first: `status ledger 12 <sha> "<line>"`. Its words are checked before the project's
// settings are read (core/which-project.ts), so a wrong word prints the usage and nothing else.
//
// grill reads its questions file only under <home>/specs, through one handle opened with O_NOFOLLOW, and refuses a
// hard link or a swapped path, so it reads no other file.

import { homedir } from "node:os";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { open, realpath, stat, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { headed } from "./core/dispatch/last-poll.js";
import type { Result } from "./core/forge/api.js";
import { openProject } from "./core/forge/index.js";
import type { Forge } from "./core/forge/types.js";
import { deny, editScope } from "./core/edit-scope.js";
import { scopesArg, writerScope } from "./core/writer/scope.js";
import { lintEdit } from "./core/lint-edit.js";
import { ask, grill, status, type AtHead } from "./core/loop.js";
import { questionsIn } from "./core/report.js";
import { checkedRound, type CheckedRound } from "./core/finish.js";
import { DEFAULT_CLAIM_LABEL } from "./core/poll.js";
import { runInFolder } from "./core/agent/folder.js";
import { settingOf } from "./core/settings/machine.js";

export type LoopIo = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly readStdin: () => Promise<string>;
};

type Parsed = ((io: LoopIo) => Promise<number> | number) | "usage";

type Act = (forge: Forge, label: string) => Promise<Result<string | readonly string[]>>;

const USAGE: Readonly<Record<string, string>> = {
  status: 'status [<project>] <number> <sha> "<line>"',
  ask: 'ask [<project>] <number> <sha> "<question>"',
  grill: "grill [<project>] <number> <sha> <questions file>",
  "lint-edit": "lint-edit '<lint command>'",
  "edit-scope": "edit-scope <specs folder>",
  "writer-scope": "writer-scope '<JSON list of glob lists>'",
};

export function loopUsage(name: string, io: { readonly err: (text: string) => void }): number {
  io.err(`usage: agent-factory ${USAGE[name] ?? name}\n`);
  return 64;
}

export function projectForm(name: string): string {
  return `agent-factory ${(USAGE[name] ?? name).replace("[<project>]", "<project>")}`;
}

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

async function forgeOf(io: LoopIo): Promise<Result<{ readonly forge: Forge; readonly label: string }>> {
  const label = settingOf(io.env, "claimLabel") ?? DEFAULT_CLAIM_LABEL;
  if (label.trim() === "") {
    return { kind: "failed", reason: "FACTORY_CLAIM_LABEL is set but empty" };
  }
  const opened = await openProject({ env: io.env, log: (line) => io.err(`${line}\n`) });
  return opened.kind === "ok" ? { kind: "ok", value: { ...opened.value, label } } : opened;
}

async function onForge(name: string, io: LoopIo, act: Act): Promise<number> {
  const opened = await forgeOf(io);
  const done = opened.kind === "ok" ? await act(opened.value.forge, opened.value.label) : opened;
  if (done.kind === "failed") {
    io.err(`agent-factory ${name}: ${done.reason}\n`);
    return 1;
  }
  io.out(lines(done.value, settingOf(io.env, "dryRun") === "1" ? " (dry run)" : ""));
  return 0;
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

function grillParsed(positionals: readonly string[]): Parsed {
  const number = numberOf(positionals[0]);
  if (number === "bad" || positionals.length !== 3) {
    return "usage";
  }
  const [sha, file] = [word(positionals, 1), word(positionals, 2)];
  return async (io) => {
    const round = await questionsFrom(io.env, file);
    if (round.kind === "failed") {
      io.err(`agent-factory grill: ${round.reason}\n`);
      return 2;
    }
    return onForge("grill", io, (forge) => grill({ forge, number, sha, round: round.value }));
  };
}

export async function questionsFrom(env: NodeJS.ProcessEnv, file: string): Promise<Result<CheckedRound>> {
  const home = homeOf(env);
  if (home.kind === "failed") {
    return home;
  }
  const specs = join(home.value, "specs");
  const read = await readUnder(resolve(file), specs);
  return read.kind === "ok" ? questionsOfText(read.value) : read;
}

export const MOST_QUESTIONS_BYTES = 64 * 1024;

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

async function fileShape(handle: FileHandle, path: string, root: string): Promise<string> {
  const st = await handle.stat();
  if (!plainSmallFile(st)) {
    return `the questions file must be a regular file with one link and at most ${MOST_QUESTIONS_BYTES} bytes, got ${JSON.stringify(path)}`;
  }
  return (await sameFileUnder(st, path, root))
    ? ""
    : `the questions file must be a file under ${root}, got ${JSON.stringify(path)}`;
}

function plainSmallFile(st: Stats): boolean {
  return st.isFile() && st.nlink === 1 && st.size <= MOST_QUESTIONS_BYTES;
}

async function sameFileUnder(st: Stats, path: string, root: string): Promise<boolean> {
  const [real, base] = await Promise.all([realpath(path).catch(() => ""), realpath(root).catch(() => "")]);
  if (!under(real, base)) {
    return false;
  }
  const at = await stat(real).catch(() => undefined);
  return at !== undefined && at.ino === st.ino && at.dev === st.dev;
}

function under(real: string, base: string): boolean {
  return real !== "" && base !== "" && real.startsWith(`${base}${sep}`);
}

function questionsOfText(text: string): Result<CheckedRound> {
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
  return checkedRound(read.value);
}

function homeOf(env: NodeJS.ProcessEnv): Result<string> {
  const home = env.FACTORY_HOME ?? join(homedir(), ".factory");
  return isAbsolute(home)
    ? { kind: "ok", value: home }
    : { kind: "failed", reason: `FACTORY_HOME must be an absolute path, got ${JSON.stringify(home)}` };
}

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

export async function lintEditCommand(positionals: readonly string[], io: LoopIo): Promise<number> {
  const [command] = positionals;
  if (command === undefined || positionals.length !== 1) {
    return loopUsage("lint-edit", io);
  }
  const root = hookRoot(io.env);
  const hooked = await lintEdit({ command, stdin: await io.readStdin(), root, env: io.env, run: runInFolder });
  io.err(hooked.err);
  return hooked.code;
}

export async function editScopeCommand(positionals: readonly string[], io: LoopIo): Promise<number> {
  const [specs] = positionals;
  if (specs === undefined || positionals.length !== 1) {
    return loopUsage("edit-scope", io);
  }
  const hooked = await editScope(await io.readStdin(), specs);
  io.out(hooked.out);
  io.err(hooked.err);
  return hooked.code;
}

function hookRoot(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_PROJECT_DIR ?? env.PWD ?? "";
}

// Every refusal, a bad argument too, exits 2: a Claude Code hook blocks the edit only on exit 2.
// https://code.claude.com/docs/en/hooks
export async function writerScopeCommand(positionals: readonly string[], io: LoopIo): Promise<number> {
  const scopes = positionals.length === 1 ? scopesArg(positionals[0] ?? "") : "bad";
  if (scopes === "bad") {
    loopUsage("writer-scope", io);
    return 2;
  }
  const hooked = await io
    .readStdin()
    .then((stdin) => writerScope(stdin, hookRoot(io.env), scopes))
    .catch((error: unknown) => deny(`cannot check this edit, so it is refused: ${String(error)}`));
  io.out(hooked.out);
  io.err(hooked.err);
  return hooked.code;
}

export const LOOP_COMMANDS: Readonly<Record<string, (positionals: readonly string[]) => Parsed>> = {
  status: (p) => atHead("status", p),
  ask: (p) => atHead("ask", p),
  grill: grillParsed,
};

export const LOOP_HELP = `  status [<project>] <number> <sha> "<line>"
                               post one [coordinator] note; each of these commands acts on the project it names, else
                               on the one project in <home>/projects (#382); with FACTORY_PROJECT exported and none
                               named, on the variables; refused when the head is no longer <sha>; its line starts
                               with when the orchestrator last ran, LATE after 3 poll intervals while a change is claimed
                               and a loop is meant to be running; with no loop, that none runs
  ask [<project>] <number> <sha> "<question>"
                               post one [writer] OPEN: note, an open ask until a person answers; the same head rule
  grill [<project>] <number> <sha> <questions file>
                               post the coordinator's round: one [coordinator] OPEN: N questions note with an item per
                               question, open until a member answers each (#517); the file, under <home>/specs, is a JSON
                               list of {question, choices (2 to 4), recommended (the index)}, 1 to 20; the same head rule
  lint-edit '<lint command>'   the writer's PostToolUse hook: lint the file an Edit or Write changed, no shell
  edit-scope <specs folder>    the coordinator's PreToolUse hook: refuse an Edit or Write outside the spec drafts
  writer-scope '<glob lists>'  the test-first run's PreToolUse hook: refuse an Edit or Write outside the test files
`;
