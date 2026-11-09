// floor — the floor guard of the ready check (#190, #231; rulebook VB6, CR4). It reads the change's diff, from the merge
// base with the default branch to the head, on the host and through hostGit: it runs no branch code, so it needs no
// box. It reports only the moves that lower the bar; adding tests or removing a skip is silent. The test checks
// (GLOSSARY "Test checks", S1-S4):
//
//   deleted   S1: a test file deleted with no new path (git's rename detection follows a move), or moved out of the
//             test files
//   cases     S1: fewer test cases in a test file that stays: @Test and its kin, a Spock feature, it( and test(,
//             def test_, func Test; a renamed case is one removed and one added, so it is silent
//   skip      S2: a skip marker added in a test file: @Disabled, @Ignore, @IgnoreIf, @Requires(false),
//             @PendingFeature, .skip(, xit(, xdescribe(, pytest.mark.skip, t.Skip(
//   assert    S3: more assertion lines removed than added in a test file that stays: assert, expect(, assertThat,
//             verify(, and in a Spock spec every line of a then: or expect: block
//   judge     S4: a judge file added, changed, moved or deleted (judge.ts: build files, the verify command's files,
//             test config, and the project's own)
//
// and the code checks (CR4), which the writer can fix:
//
//   reason    a suppression added with no reason comment on the line above: @SuppressWarnings, NOSONAR,
//             noinspection, eslint-disable, oxlint-disable, biome-ignore, @ts-ignore, @ts-expect-error, noqa,
//             type: ignore, nolint
//   catch     an empty catch block added: catch (…) {} or a catch whose next line closes it, or except: pass
//
// A test check hit goes to a person (needs-human) with the hits listed; a code check hit sends the writer back. A
// person who agrees with a test check hit waives it at that head (waiver.ts). With a waiver, the test checks look only
// at the files the interdiff from the waiver's head to this head touches: a file the waiver cleared is flagged again
// only if it changes again. A waiver whose head git cannot diff against clears nothing. A guard that cannot read the
// diff fails, so the ready check is never passed on a diff no one read. Nothing here throws.

import type { Result } from "../forge/api.js";
import { globRegex } from "../ci-files.js";
import { hostGit, type GitResult } from "../git.js";

// check: "test" for a test check (S1-S4), which a person decides; "code" for a code check, which the writer fixes
export type Hit = {
  readonly file: string;
  readonly line: number;
  readonly what: string;
  readonly check: "test" | "code";
};

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
  // the globs that name judge files (judge.ts judgeFiles)
  readonly judgeFiles: readonly string[];
  // the head of the ticket's waiver (waiver.ts), or "none"
  readonly waived: string;
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
  "**/spec/**",
  "**/e2e/**",
  "**/src/integrationTest/**",
  "**/*_spec.rb",
  "**/*Tests.groovy",
  "**/*IT.groovy",
  "**/*Spec.kt",
  "**/*.cy.*",
];

// skip markers, and the focus markers that skip every other test: JUnit and Spock annotations, bare or qualified;
// Spock's @Requires({ false }); the .skip and .only of Jest, Vitest and Mocha in all their forms; xit, xtest,
// xdescribe, fit, fdescribe; pytest and unittest skips and xfail; Go's t.Skip
const SKIP =
  /@(?:[\w.]+\.)?(?:Disabled|Ignore)\w*|@PendingFeature\b|@Requires\s*\(\s*\{?\s*false|\.(?:skip|only)\w*\s*[.(]|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(|pytest\.mark\.(?:skip\w*|xfail)|\.skipTest\s*\(|unittest\.skip\w*|\bt\.Skip(?:Now|f)?\s*\(/;
// assertion calls: assert and every assertX( of JUnit, unittest and the like, assert_eq! and friends, expect(,
// assertThat, verify(, and Go's t.Error and t.Fatal
const ASSERT =
  /\bassert\b|\bassert\w*\s*[(!]|\bexpect\s*\(|\bassertThat\b|\bverify\s*\(|\b[tb]\.(?:Error|Fatal)f?\s*\(/;
const SUPPRESS =
  /@SuppressWarnings\b|NOSONAR|\bnoinspection\b|eslint-disable|oxlint-disable|biome-ignore|@ts-ignore|@ts-expect-error|#\s*noqa\b|#\s*type:\s*ignore|\bnolint\b/;
// a test case: JUnit's @Test and its kin, a Spock feature (a method named by a string), it( and test( (with .each),
// an RSpec it "…", pytest's def test_, Go's func Test
const CASE =
  /@(?:[\w.]+\.)?(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b|^\s*def\s+["']|(?<![.\w$])(?:it|test)(?:\.each\b.*)?\s*\(|^\s*it\s+["']|\bdef\s+test_\w*\s*\(|\bfunc\s+Test\w*\s*\(/;
const COMMENT = /^\s*(\/\/|#|\/\*|\*|--)\s*\S/;
// a reason: a comment with at least one word in it, so a bare "/**/" or "*/" is none
const REASON = /^\s*(?:\/\/|#|\/\*|\*|--).*[\p{L}\p{N}]/u;
const EMPTY_CATCH = /\bcatch\b[^{]*\{\s*\}/;
const OPEN_CATCH = /\bcatch\b[^{]*\{\s*$/;
const EXCEPT = /^\s*except\b[^:]*:\s*(pass)?\s*(#.*)?$/;
// a line with no code of its own: braces and punctuation only
const BRACES = /^[\s{}()[\];,]*$/;
// a method or feature boundary in a Spock spec: a Spock block never runs past one
const METHOD = /^\s*(?:def|void|public|protected|private|static)\b.*\(/;
const SPECIFICATION = /\bextends\s+(?:spock\.lang\.)?Specification\b/;
const SPOCK_LABEL = /^\s*(given|setup|when|then|expect|where|cleanup|and)\s*:/;

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function git(input: FloorInput, args: readonly string[]): Promise<GitResult> {
  return hostGit({
    args,
    repo: { kind: "repo", path: input.repo },
    // a path is a path, never a pattern that matches another file's lines
    env: { ...input.env, GIT_NO_REPLACE_OBJECTS: "1", GIT_LITERAL_PATHSPECS: "1" },
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

// Lines : the lines a file's diff removed (by their number in the old file) and added (in the new one), and where in
// the new file each hunk that only removed lines left its gap
type Lines = {
  readonly removed: readonly number[];
  readonly added: readonly number[];
  readonly gaps: readonly number[];
};

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
    // "+c,0": the lines went after line c of the new file
    gaps: hunks.flatMap((m) => (m[4] === "0" ? [Number(m[3]), Number(m[3]) + 1] : [])),
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
  return { file, line, what, check: "test" };
}

function codeHit(file: string, line: number, what: string): Hit {
  return { file, line, what, check: "code" };
}

// fresh : the added lines that are new, not a line the same diff removed and put back (moved or re-indented)
function fresh(f: File): readonly number[] {
  const removed = new Set(f.lines.removed.map((n) => at(f.before, n).trim()));
  return f.lines.added.filter((n) => !removed.has(at(f.after, n).trim()));
}

function skips(f: File): readonly Hit[] {
  return f.test
    ? fresh(f)
        .filter((n) => SKIP.test(at(f.after, n)))
        .map((n) => hit(f.change.path, n, "adds a skip marker"))
    : [];
}

function reasonless(f: File): readonly Hit[] {
  return fresh(f)
    .filter((n) => SUPPRESS.test(at(f.after, n)) && !reasoned(f.after, n))
    .map((n) => codeHit(f.change.path, n, "adds a suppression with no reason on the line above"));
}

// reasoned : the line above is a comment with a word in it, and is not itself a suppression
function reasoned(text: readonly string[], line: number): boolean {
  const above = at(text, line - 1);
  return REASON.test(above) && !SUPPRESS.test(above);
}

// emptyCatches : a catch or except the diff left empty: one it added, or one whose body it emptied, since a catch
// line next to a changed line or a removal's gap is checked too
function emptyCatches(f: File): readonly Hit[] {
  const added = fresh(f);
  const moved = new Set(f.lines.added.filter((n) => !added.includes(n)));
  const near = [...added, ...f.lines.gaps].flatMap((n) => [n - 1, n]).filter((n) => n >= 1 && !moved.has(n));
  return [...new Set(near)]
    .toSorted((a, b) => a - b)
    .filter((n) => emptyCatchAt(f.after, n))
    .map((n) => codeHit(f.change.path, n, "leaves an empty catch"));
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

// spockBlock : the Spock block a line sits in: the label above it, where "and:" keeps the block it continues; a
// method or feature line above ends the search, so a block never runs into the next method
function spockBlock(text: readonly string[], line: number): string {
  for (let n = line; n >= 1; n -= 1) {
    const label = labelAt(text, n);
    if (label !== "and" && label !== "") {
      return label;
    }
  }
  return "";
}

// labelAt : the Spock label on a line, "method" on a method line, "" on any other
function labelAt(text: readonly string[], n: number): string {
  const line = at(text, n);
  return METHOD.test(line) ? "method" : (SPOCK_LABEL.exec(line)?.[1] ?? "");
}

function isSpock(path: string, text: readonly string[]): boolean {
  return path.endsWith("Spec.groovy") || text.some((l) => SPECIFICATION.test(l));
}

// statement : a line of code, not a blank, a comment or a Spock label
function statement(code: string): boolean {
  return !BRACES.test(code) && !COMMENT.test(code) && !SPOCK_LABEL.test(code);
}

function inSpockCheck(text: readonly string[], line: number, path: string): boolean {
  return isSpock(path, text) && ["then", "expect"].includes(spockBlock(text, line));
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

// testCase : a line that opens a test case, not inside a comment
function testCase(text: readonly string[], line: number): boolean {
  const code = at(text, line);
  return !COMMENT.test(code) && CASE.test(code);
}

// cases : fewer test cases in a test file that stays (S1)
function cases(f: File): readonly Hit[] {
  if (!f.test || f.change.kind === "added") {
    return [];
  }
  const from = fromOf(f.change);
  const removed = f.lines.removed.filter((n) => testCase(f.before, n));
  const added = f.lines.added.filter((n) => testCase(f.after, n));
  return removed.length > added.length
    ? removed.map((n) =>
        hit(from, n, `removes a test case (${removed.length} removed, ${added.length} added in this file)`),
      )
    : [];
}

const CHECKS: readonly ((f: File) => readonly Hit[])[] = [skips, cases, assertions, reasonless, emptyCatches];

function textAt(input: FloorInput, commit: string, path: string): Promise<Result<readonly string[]>> {
  return git(input, ["cat-file", "blob", `${commit}:${path}`]).then((r) => {
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
      "--inter-hunk-context=0",
      "-M",
      "--text",
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

// movedOut : a test file moved to a path that is not a test file: as good as deleted
function movedOut(input: FloorInput, change: Change): readonly Hit[] {
  const leaves = change.kind === "renamed" && !isTestFile(change.path, input.testFiles);
  return leaves && isTestFile(change.from, input.testFiles)
    ? [hit(change.from, 0, `moves a test file out of the test files, to ${change.path}`)]
    : [];
}

const JUDGE_MOVES: Readonly<Record<Change["kind"], string>> = {
  added: "adds a judge file",
  modified: "changes a judge file",
  renamed: "moves a judge file",
  deleted: "deletes a judge file",
};

// judged : a change to a judge file (S4), at either of its paths
function judged(input: FloorInput, change: Change): readonly Hit[] {
  const paths = change.kind === "renamed" ? [change.from, change.path] : [change.path];
  return paths.some((p) => isTestFile(p, input.judgeFiles)) ? [hit(change.path, 0, JUDGE_MOVES[change.kind])] : [];
}

async function hitsIn(input: FloorInput, base: string, change: Change): Promise<Result<readonly Hit[]>> {
  if (change.kind === "deleted") {
    const deleted = isTestFile(change.path, input.testFiles) ? [hit(change.path, 0, "deletes a test file")] : [];
    return { kind: "ok", value: [...deleted, ...judged(input, change)] };
  }
  const file = await fileOf(input, base, change);
  return file.kind === "ok"
    ? {
        kind: "ok",
        value: [...judged(input, change), ...movedOut(input, change), ...CHECKS.flatMap((c) => c(file.value))],
      }
    : file;
}

// interdiff : the paths the change touched since the waiver's head, or "none" when there is no waiver or git cannot
// diff against its head (then the waiver clears nothing)
async function interdiff(input: FloorInput): Promise<ReadonlySet<string> | "none"> {
  if (input.waived === "none") {
    return "none";
  }
  const listed = out(
    await git(input, [
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      "--no-color",
      "--ignore-submodules=all",
      input.waived,
      input.head,
    ]),
    "list the files changed since the waiver",
  );
  return listed.kind === "ok" ? new Set(listed.value.split("\0").filter((w) => w !== "")) : "none";
}

// cleared : a change the waiver covers: none of its paths changed since the waiver's head
function cleared(since: ReadonlySet<string> | "none", change: Change): boolean {
  const paths = change.kind === "renamed" ? [change.from, change.path] : [change.path];
  return since !== "none" && !paths.some((p) => since.has(p));
}

// floorGuard : every move in the diff that lowers the bar, in file order; none is a pass
export async function floorGuard(input: FloorInput): Promise<Result<readonly Hit[]>> {
  const base = await mergeBase(input);
  if (base.kind === "failed") {
    return base;
  }
  const listed = out(
    await git(input, [
      "diff",
      "--name-status",
      "-M",
      "-z",
      "--no-color",
      "--ignore-submodules=all",
      base.value,
      input.head,
    ]),
    "list the files the change touches",
  );
  if (listed.kind === "failed") {
    return listed;
  }
  const since = await interdiff(input);
  const hits: Hit[] = [];
  for (const change of changesOf(listed.value)) {
    const found = await hitsIn(input, base.value, change);
    if (found.kind === "failed") {
      return found;
    }
    const waived = cleared(since, change);
    hits.push(...found.value.filter((h) => !(waived && h.check === "test")));
  }
  return { kind: "ok", value: hits };
}

const MAX_SHOWN = 10;

// hitsLine : the hits as one line for the run record, and for the person (a test check) or the writer's task
export function hitsLine(hits: readonly Hit[]): string {
  const shown = hits.slice(0, MAX_SHOWN).map((h) => `${h.file}${h.line > 0 ? `:${h.line}` : ""} ${h.what}`);
  const more = hits.length > MAX_SHOWN ? `; and ${hits.length - MAX_SHOWN} more` : "";
  const next = hits.some((h) => h.check === "test")
    ? "A person decides: a change that must stay is waived at this head with agent-factory waive"
    : "Fix the code (VB6)";
  return `the floor guard: ${shown.join("; ")}${more}. ${next}`;
}

// forHuman : whether the hits stop the change for a person: any test check hit does
export function forHuman(hits: readonly Hit[]): boolean {
  return hits.some((h) => h.check === "test");
}
