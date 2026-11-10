// command — an evidence row's command as argv, for a run with no shell (#91; ADR-0011 D12). The writer wrote it as one
// line, so this reads it the way a shell would read a plain command: words split on blanks, quotes group a word. Any
// character a shell would act on (a pipe, &&, a redirect, $, a glob, a backslash) is refused rather than passed as text,
// since the row would then mean something else than what the writer ran. The program must be one the ready check
// always allows (READ_ONLY_PROGRAMS, #444: git only with a read subcommand) or one on the project file's list.

import type { Result } from "../forge/api.js";
import type { Argv } from "../project.js";

// what a shell acts on outside quotes, and inside double quotes
const SHELL = new Set("|&;<>()$`*?[]{}~\\!#");
const IN_DOUBLE = new Set("$`\\!");
const QUOTES = new Map<string, Quote>([
  ["'", "single"],
  ['"', "double"],
]);
const BLANK = /^[ \t]$/;

type Quote = "none" | "single" | "double";
type Lex = { readonly words: string[]; word: string; started: boolean; quote: Quote; bad: string };

function end(l: Lex): void {
  if (l.started) {
    l.words.push(l.word);
  }
  l.word = "";
  l.started = false;
}

function add(l: Lex, c: string): void {
  l.word += c;
  l.started = true;
}

function open(l: Lex, quote: Quote): void {
  l.quote = quote;
  l.started = true;
}

function bare(l: Lex, c: string): void {
  const quote = QUOTES.get(c);
  if (BLANK.test(c)) {
    end(l);
  } else if (quote !== undefined) {
    open(l, quote);
  } else {
    plain(l, c);
  }
}

function plain(l: Lex, c: string): void {
  if (SHELL.has(c)) {
    l.bad = c;
  } else {
    add(l, c);
  }
}

function single(l: Lex, c: string): void {
  if (c === "'") {
    l.quote = "none";
  } else {
    add(l, c);
  }
}

function double(l: Lex, c: string): void {
  if (c === '"') {
    l.quote = "none";
  } else if (IN_DOUBLE.has(c)) {
    l.bad = c;
  } else {
    add(l, c);
  }
}

const BY_QUOTE: Readonly<Record<Quote, (l: Lex, c: string) => void>> = { none: bare, single, double };

// commandWords : the command's words, or what stops it
export function commandWords(command: string): Result<readonly string[]> {
  if (/\p{Cc}/u.test(command.replaceAll("\t", " "))) {
    return { kind: "failed", reason: "it holds a control character" };
  }
  const l: Lex = { words: [], word: "", started: false, quote: "none", bad: "" };
  for (const c of command) {
    BY_QUOTE[l.quote](l, c);
    if (l.bad !== "") {
      return { kind: "failed", reason: `it uses ${JSON.stringify(l.bad)}, which needs a shell` };
    }
  }
  end(l);
  return l.quote === "none" ? { kind: "ok", value: l.words } : { kind: "failed", reason: "a quote is not closed" };
}

// the programs every ready check allows, besides the project file's ready.programs (#444): they read the tree and
// print what they find, so a criterion about a file's content can be shown without the build. Each still runs with
// no shell, in a fresh runner.
// an evidence row's git: run in the box on its own copy of the branch (boxrun.ts), never on the host's clone
export const GIT_PROGRAM = "git";
export const READ_ONLY_PROGRAMS: readonly string[] = ["grep", "test", "wc", "ls", "cat", "head", "tail", GIT_PROGRAM];

// git's read subcommands: the only ones the default set allows; a project that lists "git" itself allows any
export const GIT_READS: readonly string[] = ["diff", "log", "show", "status", "ls-files", "rev-parse"];

// evidencePrograms : every program an evidence row may start with: the read-only set, then the project's own. Pure.
export function evidencePrograms(listed: readonly string[]): readonly string[] {
  return [...new Set([...READ_ONLY_PROGRAMS, ...listed])];
}

// programsLine : the programs as the writer and a reason read them, git's limit named. Pure.
export function programsLine(listed: readonly string[]): string {
  const git = listed.includes(GIT_PROGRAM) ? GIT_PROGRAM : `${GIT_PROGRAM} (only ${GIT_READS.join(", ")})`;
  return evidencePrograms(listed)
    .map((p) => (p === GIT_PROGRAM ? git : p))
    .join(", ");
}

// gitRead : why a git row of the default set is refused, or "" when it is a read. Pure.
function gitRead(rest: readonly string[], listed: readonly string[]): string {
  const sub = rest[0] ?? "";
  return listed.includes(GIT_PROGRAM) || GIT_READS.includes(sub)
    ? ""
    : `"${GIT_PROGRAM} ${sub}" is not a read: the ready check runs ${GIT_PROGRAM} only with ${GIT_READS.join(", ")}, unless the project file lists it in ready.programs`;
}

// commandArgv : the row's command as argv, when it runs one allowed program with no shell; `listed` is the project
// file's ready.programs
export function commandArgv(command: string, listed: readonly string[]): Result<Argv> {
  const split = commandWords(command);
  if (split.kind === "failed") {
    return split;
  }
  const [program, ...rest] = split.value;
  if (program === undefined) {
    return { kind: "failed", reason: "it is empty" };
  }
  const why = refusedProgram(program, rest, listed);
  return why === "" ? { kind: "ok", value: [program, ...rest] } : { kind: "failed", reason: why };
}

// refusedProgram : why a row may not start with this program and these words, or "" when it may. Pure.
function refusedProgram(program: string, rest: readonly string[], listed: readonly string[]): string {
  if (!evidencePrograms(listed).includes(program)) {
    return `${JSON.stringify(program)} is not a program a ready check may run (${programsLine(listed)})`;
  }
  return program === GIT_PROGRAM ? gitRead(rest, listed) : "";
}
