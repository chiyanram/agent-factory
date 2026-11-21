// check-comments — code says what it does; a comment is allowed only where code cannot say it. Kept:
//
//   header      a file's leading comment block: what the module is for and why, with its one pointer
//   Today:      a paragraph that holds a Today: note, where the code still differs from a decision
//   link        a paragraph that holds an http(s) link: a vendor's, platform's or protocol's rule we cannot change
//   directive   #!, biome-ignore, @ts-expect-error and the other tool directives (lint-ratchet judges disables)
//
// Every other comment line counts against scripts/comment-baseline.json, per file. A count above its baseline fails,
// so no file gains a comment. A count below it also fails until --shrink writes it, so a deleted comment never comes
// back. A file not in the baseline holds none. The /delete-comment skill sorts and deletes the rest.
//
// A small lexer steps over strings, templates and regex literals, so a // inside one is no comment. A paragraph is a
// run of own-line // comments on adjacent lines, one block comment, or one trailing comment; a blank // line ends it.
//
//   node scripts/check-comments.ts [ROOT]            check (make lint)
//   node scripts/check-comments.ts --shrink [ROOT]   write the lower counts; never raises one
//
// Runs on Node's type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Comment = { readonly first: number; readonly last: number; readonly text: string; readonly own: boolean };
export type Counts = Readonly<Record<string, number>>;

type State = {
  readonly src: string;
  readonly starts: readonly number[];
  readonly found: Comment[];
  readonly braces: number[];
  i: number;
  depth: number;
  prev: string;
};
type Step = readonly [(s: State) => boolean, (s: State) => void];

const CODE = /\.(?:ts|mts|cts|js|mjs|cjs)$/;
const SKIP = /^(?:tests\/fixtures\/|dist\/|plugins\/[^/]+\/lib\/)/;
const DIRECTIVE =
  /^(?:#!|\/\/\/\s*<reference|\/[/*]\s*(?:biome-ignore|@ts-(?:expect-error|ignore|nocheck)|oxlint-|eslint-))/;
const KEEP = /Today:|https?:\/\//;
const BASELINE = "scripts/comment-baseline.json";
const REGEX_AFTER = new Set([
  ..."(,=:[!&|?{};+-*%<>~^".split(""),
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
  "instanceof",
]);

const at = (s: State, ahead = 0): string => s.src[s.i + ahead] ?? "";
const range = (first: number, last: number): readonly number[] =>
  Array.from({ length: last - first + 1 }, (_, k) => first + k);

function lineStarts(src: string): readonly number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineAt(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    [lo, hi] = (starts[mid] ?? 0) <= offset ? [mid, hi] : [lo, mid - 1];
  }
  return lo + 1;
}

function record(s: State, to: number): void {
  const lineStart = s.starts[lineAt(s.starts, s.i) - 1] ?? 0;
  s.found.push({
    first: lineAt(s.starts, s.i),
    last: lineAt(s.starts, Math.max(s.i, to - 1)),
    text: s.src.slice(s.i, to),
    own: s.src.slice(lineStart, s.i).trim() === "",
  });
  s.i = to;
}

function lineComment(s: State): void {
  const end = s.src.indexOf("\n", s.i);
  record(s, end < 0 ? s.src.length : end);
}

function blockComment(s: State): void {
  const end = s.src.indexOf("*/", s.i + 2);
  record(s, end < 0 ? s.src.length : end + 2);
}

function quoted(s: State): void {
  const quote = at(s);
  s.i++;
  while (s.i < s.src.length && at(s) !== quote && at(s) !== "\n") {
    s.i += at(s) === "\\" ? 2 : 1;
  }
  s.i++;
  s.prev = quote;
}

function templateStop(s: State): boolean {
  if (at(s) === "`") {
    s.i++;
    s.prev = "`";
    return true;
  }
  if (at(s) === "$" && at(s, 1) === "{") {
    s.i += 2;
    s.braces.push(s.depth);
    s.depth++;
    s.prev = "{";
    return true;
  }
  return false;
}

function templateBody(s: State): void {
  while (s.i < s.src.length && !templateStop(s)) {
    s.i += at(s) === "\\" ? 2 : 1;
  }
}

function inRegex(s: State, inClass: boolean): boolean {
  const c = at(s);
  return c !== "" && c !== "\n" && (inClass || c !== "/");
}

function regexChar(s: State, inClass: boolean): boolean {
  const c = at(s);
  s.i += c === "\\" ? 2 : 1;
  return c === "[" || (c !== "]" && inClass);
}

function regex(s: State): void {
  s.i++;
  let inClass = false;
  while (inRegex(s, inClass)) {
    inClass = regexChar(s, inClass);
  }
  s.i++;
  while (/[a-z]/.test(at(s))) {
    s.i++;
  }
  s.prev = "/re";
}

function word(s: State): void {
  const from = s.i;
  while (/[\w$]/.test(at(s))) {
    s.i++;
  }
  s.prev = s.src.slice(from, s.i);
}

function template(s: State): void {
  s.i++;
  templateBody(s);
}

function closeBrace(s: State): void {
  s.depth--;
  if (s.braces.at(-1) === s.depth) {
    s.braces.pop();
    templateBody(s);
  }
}

function punct(s: State): void {
  const c = at(s);
  s.i++;
  s.prev = c;
  if (c === "{") {
    s.depth++;
  } else if (c === "}") {
    closeBrace(s);
  }
}

const STEPS: readonly Step[] = [
  [(s) => /\s/.test(at(s)), (s) => void s.i++],
  [(s) => at(s) === "/" && at(s, 1) === "/", lineComment],
  [(s) => at(s) === "/" && at(s, 1) === "*", blockComment],
  [(s) => at(s) === '"' || at(s) === "'", quoted],
  [(s) => at(s) === "`", template],
  [(s) => at(s) === "/" && (s.prev === "" || REGEX_AFTER.has(s.prev)), regex],
  [(s) => /[\w$]/.test(at(s)), word],
  [() => true, punct],
];

const startOf = (src: string): number => (src.startsWith("#!") ? src.indexOf("\n") + 1 || src.length : 0);

export function comments(src: string): readonly Comment[] {
  const s: State = { src, starts: lineStarts(src), found: [], braces: [], i: startOf(src), depth: 0, prev: "" };
  while (s.i < src.length) {
    STEPS.find(([test]) => test(s))?.[1](s);
  }
  return s.found;
}

const isLine = (c: Comment): boolean => c.own && c.text.startsWith("//");
const isBlank = (c: Comment): boolean => c.text.replace(/^\/\/+/, "").trim() === "";
const joins = (last: Comment | undefined, c: Comment): boolean =>
  last !== undefined && isLine(last) && isLine(c) && c.first === last.last + 1;

function paragraphs(found: readonly Comment[]): readonly (readonly Comment[])[] {
  const out: Comment[][] = [];
  let open = false;
  for (const c of found) {
    const run = out.at(-1);
    if (open && run !== undefined && joins(run.at(-1), c)) {
      run.push(c);
    } else {
      out.push([c]);
    }
    open = !isBlank(c);
  }
  return out;
}

function headerEnd(lines: readonly string[], found: readonly Comment[]): number {
  const own = new Set(found.filter((c) => c.own).flatMap((c) => range(c.first, c.last)));
  const end = lines.findIndex(
    (raw, index) => raw.trim() !== "" && !own.has(index + 1) && !(index === 0 && raw.startsWith("#!")),
  );
  return end < 0 ? lines.length : end;
}

const kept = (p: readonly Comment[], end: number): boolean =>
  p.every((c) => c.last <= end) || KEEP.test(p.map((c) => c.text).join("\n")) || p.every((c) => DIRECTIVE.test(c.text));

export function banned(src: string): readonly number[] {
  const found = comments(src);
  const end = headerEnd(src.split("\n"), found);
  const lines = paragraphs(found)
    .filter((p) => !kept(p, end))
    .flat()
    .filter((c) => !DIRECTIVE.test(c.text))
    .flatMap((c) => range(c.first, c.last));
  return [...new Set(lines)].toSorted((a, b) => a - b);
}

export function judged(file: string): boolean {
  return CODE.test(file) && !SKIP.test(file);
}

export type Verdict =
  | { readonly kind: "clean" }
  | { readonly kind: "over"; readonly files: readonly string[] }
  | { readonly kind: "shrinkable"; readonly files: readonly string[] };

export function verdict(counts: Counts, baseline: Counts): Verdict {
  const files = [...new Set([...Object.keys(counts), ...Object.keys(baseline)])].toSorted();
  const over = files.filter((f) => (counts[f] ?? 0) > (baseline[f] ?? 0));
  const under = files.filter((f) => (counts[f] ?? 0) < (baseline[f] ?? 0));
  if (over.length > 0) {
    return { kind: "over", files: over };
  }
  return under.length > 0 ? { kind: "shrinkable", files: under } : { kind: "clean" };
}

export function shrunk(counts: Counts, baseline: Counts): Counts {
  const lowered = Object.entries(baseline).map(([file, base]): [string, number] => [
    file,
    Math.min(base, counts[file] ?? 0),
  ]);
  return Object.fromEntries(lowered.filter(([, n]) => n > 0).toSorted(([a], [b]) => a.localeCompare(b)));
}

export function parsed(text: string): Counts {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter((e): e is [string, number] => typeof e[1] === "number"));
}

function readable(root: string, file: string): string | undefined {
  try {
    return readFileSync(join(root, file), "utf8");
  } catch {
    return undefined;
  }
}

function count(root: string): Counts {
  const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  const counted = listed.stdout
    .split("\n")
    .filter(judged)
    .map((file): [string, number] => [file, banned(readable(root, file) ?? "").length]);
  return Object.fromEntries(counted.filter(([, n]) => n > 0));
}

function overLine(root: string, file: string, baseline: Counts): string {
  const lines = banned(readable(root, file) ?? "");
  return `${file}: ${lines.length} comment lines, baseline ${baseline[file] ?? 0}; first at line ${lines[0]}`;
}

function report(root: string, baseline: Counts, v: Verdict): number {
  if (v.kind === "over") {
    console.error(v.files.map((f) => overLine(root, f, baseline)).join("\n"));
    console.error(
      "check-comments: say it in code (a name, a type, a test); keep a comment only for a header, a Today: note or an outside link",
    );
    return 1;
  }
  if (v.kind === "shrinkable") {
    console.error(`check-comments: ${v.files.join(", ")} hold fewer comments than the baseline; run --shrink`);
    return 1;
  }
  return 0;
}

function main(argv: readonly string[]): number {
  const root = argv.find((a) => !a.startsWith("--")) ?? ".";
  const path = join(root, BASELINE);
  const baseline = parsed(readFileSync(path, "utf8"));
  const counts = count(root);
  if (argv.includes("--shrink")) {
    writeFileSync(path, `${JSON.stringify(shrunk(counts, baseline), null, 2)}\n`);
    return 0;
  }
  return report(root, baseline, verdict(counts, baseline));
}

if (process.argv[1] === import.meta.filename) {
  process.exit(main(process.argv.slice(2)));
}
