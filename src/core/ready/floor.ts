// floor — the floor guard of the ready check (#190; rulebook VB6, CR4). It reads the change's diff, from the merge base
// with the default branch to the head, on the host and through hostGit: it runs no branch code, so it needs no box. It
// reports only the moves that lower the bar; adding tests or removing a skip is silent:
//
//   skip      a skip marker added in a test file: @Disabled, @Ignore, @IgnoreIf, @Requires(false), @PendingFeature,
//             .skip(, xit(, xdescribe(, pytest.mark.skip, t.Skip(
//   deleted   a test file deleted with no new path (git's rename detection follows a move)
//   assert    more assertion lines removed than added in a test file that stays: assert, expect(, assertThat,
//             verify(, and in a Spock spec every line of a then: or expect: block
//   reason    a suppression added with no reason comment on the line above (CR4): @SuppressWarnings, NOSONAR,
//             noinspection, eslint-disable, oxlint-disable, biome-ignore, @ts-ignore, @ts-expect-error, noqa,
//             type: ignore, nolint
//   catch     an empty catch block added: catch (…) {} or a catch whose next line closes it, or except: pass
//
// To keep one of these on purpose the writer reports `asked` with why (VB6: "fix the code, or ask"). A guard that
// cannot read the diff fails, so the ready check is never passed on a diff no one read. Nothing here throws.

import type { Result } from "../forge/api.js";
import { globRegex } from "../ci-files.js";
import { hostGit, type GitResult } from "../git.js";

export type Hit = { readonly file: string; readonly line: number; readonly what: string };

export type FloorInput = {
  // the project's clone, read only through hostGit
  readonly repo: string;
  readonly env: NodeJS.ProcessEnv;
  // the default branch and the change's branch, both fetched from the forge
  readonly base: string;
  readonly branch: string;
  readonly head: string;
  // the globs that name test files
  readonly testFiles: readonly string[];
};

// the built-in test files, which a project file's ready.testFiles replaces
export const TEST_FILES: readonly string[] = [
  "**/src/test/**",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/*Test.java",
  "**/*Tests.java",
  "**/*IT.java",
  "**/*Spec.groovy",
  "**/*Test.groovy",
  "**/*Test.kt",
  "**/*.test.*",
  "**/*.spec.*",
  "**/test_*.py",
  "**/*_test.py",
  "**/*_test.go",
];

const SKIP =
  /@Disabled\b|@Ignore\b|@IgnoreIf\b|@Requires\s*\(\s*false|@PendingFeature\b|\.skip\s*\(|\bxit\s*\(|\bxdescribe\s*\(|pytest\.mark\.skip|\bt\.Skip\s*\(/;
const ASSERT = /\bassert\b|\bexpect\s*\(|\bassertThat\b|\bverify\s*\(/;
const SUPPRESS =
  /@SuppressWarnings\b|NOSONAR|\bnoinspection\b|eslint-disable|oxlint-disable|biome-ignore|@ts-ignore|@ts-expect-error|#\s*noqa\b|#\s*type:\s*ignore|\bnolint\b/;
const COMMENT = /^\s*(\/\/|#|\/\*|\*|--)\s*\S/;
const EMPTY_CATCH = /\bcatch\b[^{]*\{\s*\}/;
const OPEN_CATCH = /\bcatch\b[^{]*\{\s*$/;
const EXCEPT = /^\s*except\b[^:]*:\s*(pass)?\s*$/;
const SPOCK_LABEL = /^\s*(given|setup|when|then|expect|where|cleanup|and)\s*:/;

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function git(input: FloorInput, args: readonly string[]): Promise<GitResult> {
  return hostGit({
    args,
    repo: { kind: "repo", path: input.repo },
    env: { ...input.env, GIT_NO_REPLACE_OBJECTS: "1" },
    ownHelper: { kind: "none" },
    stdin: { kind: "none" },
  });
}

function out(result: GitResult, what: string): Result<string> {
  if (result.kind === "ok") {
    return { kind: "ok", value: result.stdout };
  }
  const why = result.kind === "refused" ? result.reason : (result.stderr.trim().split("\n").at(-1) ?? "");
  return failed(`the floor guard cannot ${what}: ${why || "git failed"}`);
}

const BASE_REF = "refs/factory/floor-base";
const HEAD_REF = "refs/factory/floor-head";

// mergeBase : the default branch and the change's branch fetched, the change's tip checked against the head, and the
// commit the change started from
async function mergeBase(input: FloorInput): Promise<Result<string>> {
  const fetched = out(
    await git(input, [
      "fetch",
      "-q",
      "origin",
      `+refs/heads/${input.base}:${BASE_REF}`,
      `+refs/heads/${input.branch}:${HEAD_REF}`,
    ]),
    `fetch ${input.base} and ${input.branch}`,
  );
  const tip = fetched.kind === "ok" ? out(await git(input, ["rev-parse", HEAD_REF]), "read the change's tip") : fetched;
  if (tip.kind === "failed") {
    return tip;
  }
  if (tip.value.trim() !== input.head) {
    return failed(
      `the tip of ${input.branch} is ${tip.value.trim().slice(0, 8)}, not ${input.head.slice(0, 8)}: the head moved`,
    );
  }
  const base = out(
    await git(input, ["merge-base", BASE_REF, input.head]),
    `find where ${input.branch} left ${input.base}`,
  );
  return base.kind === "ok" ? { kind: "ok", value: base.value.trim() } : base;
}

// Change : one file the diff touches, as git's rename detection pairs it
type Change =
  | { readonly kind: "added" | "modified"; readonly path: string }
  | { readonly kind: "deleted"; readonly path: string }
  | { readonly kind: "renamed"; readonly from: string; readonly path: string };

// changesOf : the -z name-status list: a status, then one path, or two for a rename or a copy
function changesOf(text: string): readonly Change[] {
  const words = text.split("\0").filter((w) => w !== "");
  const word = (i: number): string => words[i] ?? "";
  const found: Change[] = [];
  let i = 0;
  while (i < words.length) {
    found.push(changeOf(word(i), word(i + 1), word(i + 2)));
    i += /^[RC]/.test(word(i)) ? 3 : 2;
  }
  return found;
}

function changeOf(status: string, first: string, second: string): Change {
  if (status.startsWith("R")) {
    return { kind: "renamed", from: first, path: second };
  }
  if (status.startsWith("C")) {
    return { kind: "added", path: second };
  }
  return status === "D"
    ? { kind: "deleted", path: first }
    : { kind: status === "A" ? "added" : "modified", path: first };
}

// Lines : the lines a file's diff removed (by their number in the old file) and added (in the new one)
type Lines = { readonly removed: readonly number[]; readonly added: readonly number[] };

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function range(start: string | undefined, count: string | undefined): readonly number[] {
  const first = Number(start ?? "0");
  const n = count === undefined ? 1 : Number(count);
  return Array.from({ length: n }, (_, k) => first + k);
}

// linesOf : the hunk headers of a -U0 diff; each names the old and the new lines it changed
function linesOf(diff: string): Lines {
  const hunks = diff
    .split("\n")
    .map((l) => HUNK.exec(l))
    .filter((m): m is RegExpExecArray => m !== null);
  return {
    removed: hunks.flatMap((m) => range(m[1], m[2])),
    added: hunks.flatMap((m) => range(m[3], m[4])),
  };
}

export function isTestFile(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globRegex(g).test(path) || globRegex(g).test(`/${path}`));
}

type File = {
  readonly change: Change;
  readonly test: boolean;
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly lines: Lines;
};

function at(text: readonly string[], line: number): string {
  return text[line - 1] ?? "";
}

function hit(file: string, line: number, what: string): Hit {
  return { file, line, what };
}

function skips(f: File): readonly Hit[] {
  return f.test
    ? f.lines.added.filter((n) => SKIP.test(at(f.after, n))).map((n) => hit(f.change.path, n, "adds a skip marker"))
    : [];
}

function reasonless(f: File): readonly Hit[] {
  return f.lines.added
    .filter((n) => SUPPRESS.test(at(f.after, n)) && !reasoned(f.after, n))
    .map((n) => hit(f.change.path, n, "adds a suppression with no reason on the line above"));
}

// reasoned : the line above is a comment with words in it, and is not itself a suppression
function reasoned(text: readonly string[], line: number): boolean {
  const above = at(text, line - 1);
  return COMMENT.test(above) && !SUPPRESS.test(above);
}

function emptyCatches(f: File): readonly Hit[] {
  return f.lines.added.filter((n) => emptyCatchAt(f.after, n)).map((n) => hit(f.change.path, n, "adds an empty catch"));
}

function emptyCatchAt(text: readonly string[], line: number): boolean {
  const here = at(text, line);
  const next = at(text, line + 1).trim();
  return braceCatch(here, next) || exceptPass(here, next);
}

// braceCatch : catch (…) {} on one line, or a catch whose next line closes it
function braceCatch(here: string, next: string): boolean {
  return EMPTY_CATCH.test(here) || (OPEN_CATCH.test(here) && next.startsWith("}"));
}

// exceptPass : except …: pass, on one line or two
function exceptPass(here: string, next: string): boolean {
  return EXCEPT.test(here) && (here.trim().endsWith("pass") || next === "pass");
}

// spockBlock : the Spock block a line sits in: the label above it, where "and:" keeps the block it continues
function spockBlock(text: readonly string[], line: number): string {
  for (let n = line; n >= 1; n -= 1) {
    const label = SPOCK_LABEL.exec(at(text, n))?.[1];
    if (label !== undefined && label !== "and") {
      return label;
    }
  }
  return "";
}

function isSpock(path: string): boolean {
  return path.endsWith("Spec.groovy");
}

// statement : a line of code, not a blank, a comment or a Spock label
function statement(code: string): boolean {
  return code !== "" && !COMMENT.test(code) && !SPOCK_LABEL.test(code);
}

function inSpockCheck(text: readonly string[], line: number, path: string): boolean {
  return isSpock(path) && ["then", "expect"].includes(spockBlock(text, line));
}

// asserting : a line that asserts: an assertion call, or in a Spock spec any statement of a then: or expect: block
function asserting(text: readonly string[], line: number, path: string): boolean {
  const code = at(text, line).trim();
  return statement(code) && (ASSERT.test(code) || inSpockCheck(text, line, path));
}

function assertions(f: File): readonly Hit[] {
  if (!f.test || f.change.kind === "added") {
    return [];
  }
  const from = fromOf(f.change);
  const removed = f.lines.removed.filter((n) => asserting(f.before, n, from));
  const added = f.lines.added.filter((n) => asserting(f.after, n, f.change.path));
  return removed.length > added.length
    ? removed.map((n) =>
        hit(from, n, `removes an assertion (${removed.length} removed, ${added.length} added in this file)`),
      )
    : [];
}

const CHECKS: readonly ((f: File) => readonly Hit[])[] = [skips, assertions, reasonless, emptyCatches];

function textAt(input: FloorInput, commit: string, path: string): Promise<Result<readonly string[]>> {
  return git(input, ["show", `${commit}:${path}`]).then((r) => {
    const read = out(r, `read ${path}`);
    return read.kind === "ok" ? { kind: "ok", value: read.value.split("\n") } : read;
  });
}

function fromOf(change: Change): string {
  return change.kind === "renamed" ? change.from : change.path;
}

async function diffOf(input: FloorInput, base: string, change: Change): Promise<Result<Lines>> {
  const paths = change.kind === "renamed" ? [change.from, change.path] : [change.path];
  const diff = out(
    await git(input, [
      "diff",
      "-U0",
      "-M",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      base,
      input.head,
      "--",
      ...paths,
    ]),
    `read the diff of ${change.path}`,
  );
  return diff.kind === "ok" ? { kind: "ok", value: linesOf(diff.value) } : diff;
}

function beforeOf(input: FloorInput, base: string, change: Change): Promise<Result<readonly string[]>> {
  return change.kind === "added" ? Promise.resolve(okLines([])) : textAt(input, base, fromOf(change));
}

async function fileOf(input: FloorInput, base: string, change: Change): Promise<Result<File>> {
  const lines = await diffOf(input, base, change);
  if (lines.kind === "failed") {
    return lines;
  }
  const before = await beforeOf(input, base, change);
  if (before.kind === "failed") {
    return before;
  }
  const after = await textAt(input, input.head, change.path);
  if (after.kind === "failed") {
    return after;
  }
  const test = isTestFile(change.path, input.testFiles);
  return { kind: "ok", value: { change, test, before: before.value, after: after.value, lines: lines.value } };
}

function okLines(lines: readonly string[]): Result<readonly string[]> {
  return { kind: "ok", value: lines };
}

async function hitsIn(input: FloorInput, base: string, change: Change): Promise<Result<readonly Hit[]>> {
  if (change.kind === "deleted") {
    return {
      kind: "ok",
      value: isTestFile(change.path, input.testFiles) ? [hit(change.path, 0, "deletes a test file")] : [],
    };
  }
  const file = await fileOf(input, base, change);
  return file.kind === "ok" ? { kind: "ok", value: CHECKS.flatMap((c) => c(file.value)) } : file;
}

// floorGuard : every move in the diff that lowers the bar, in file order; none is a pass
export async function floorGuard(input: FloorInput): Promise<Result<readonly Hit[]>> {
  const base = await mergeBase(input);
  if (base.kind === "failed") {
    return base;
  }
  const listed = out(
    await git(input, ["diff", "--name-status", "-M", "-z", "--no-color", base.value, input.head]),
    "list the files the change touches",
  );
  if (listed.kind === "failed") {
    return listed;
  }
  const hits: Hit[] = [];
  for (const change of changesOf(listed.value)) {
    const found = await hitsIn(input, base.value, change);
    if (found.kind === "failed") {
      return found;
    }
    hits.push(...found.value);
  }
  return { kind: "ok", value: hits };
}

const MAX_SHOWN = 10;

// hitsLine : the hits as one line for the run record and the writer's task
export function hitsLine(hits: readonly Hit[]): string {
  const shown = hits.slice(0, MAX_SHOWN).map((h) => `${h.file}${h.line > 0 ? `:${h.line}` : ""} ${h.what}`);
  const more = hits.length > MAX_SHOWN ? `; and ${hits.length - MAX_SHOWN} more` : "";
  return `the floor guard: ${shown.join("; ")}${more}. Fix the code, or report asked with why the change must lower the bar (VB6)`;
}
