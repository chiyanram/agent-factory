// command — an evidence row's command as argv, for a run with no shell (#91; ADR-0011 D12). The writer wrote it as one
// line, so this reads it the way a shell would read a plain command: words split on blanks, quotes group a word. Any
// character a shell would act on (a pipe, &&, a redirect, $, a glob, a backslash) is refused rather than passed as text,
// since the row would then mean something else than what the writer ran. The program must be on the project file's
// list.

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

// commandArgv : the row's command as argv, when it runs one program from the list with no shell
export function commandArgv(command: string, programs: readonly string[]): Result<Argv> {
  const split = commandWords(command);
  if (split.kind === "failed") {
    return split;
  }
  const [program, ...rest] = split.value;
  if (program === undefined) {
    return { kind: "failed", reason: "it is empty" };
  }
  return programs.includes(program)
    ? { kind: "ok", value: [program, ...rest] }
    : {
        kind: "failed",
        reason: `${JSON.stringify(program)} is not a program the project file lets a ready check run (${programs.join(", ")})`,
      };
}
