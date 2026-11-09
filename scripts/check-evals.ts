// check-evals — fails when a case of the automated review's golden set is not well-formed (#214; ADR-0015 E5). A case
// is a folder under ROOT/evals/reviewer/ (evals/reviewer/README.md says what each file holds):
//   base.sha       a 40-hex commit that is in this repository's history
//   change.patch   applies to that commit (git apply --check, into a scratch index; the checkout is never touched)
//   golden.json    [{file, line, issue, severity, category}], [] for a clean case; each file is one the patch changes,
//                  and each line is inside that file once the patch is applied
//   pr.md          optional: the PR's title and body
// and every case has one row in evals/reviewer/cases.md, as every row has a case: its kind (a clean case's golden is [],
// a seeded one's is not) and its status (draft until the operator approves it).
//
//   node scripts/check-evals.ts [ROOT]     (make lint; the history must be there, so CI checks out with fetch-depth 0)
//
// git reads this repository's own history, not a project's, so it runs plain git, as check-links does. Runs on Node's
// type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SEVERITIES = ["blocker", "warning", "nit"] as const;
// the Martian categories (ADR-0015 R2), with a severity as well (decided on #218, 2026-11-09)
export const CATEGORIES = [
  "bug",
  "security",
  "concurrency",
  "data",
  "api",
  "perf",
  "test_gap",
  "doc_defect",
  "style",
  "speculative",
] as const;
export const KINDS = ["seeded", "clean", "rulebook-copy"] as const;
export const STATUSES = ["draft", "approved"] as const;

export type Severity = (typeof SEVERITIES)[number];
export type Category = (typeof CATEGORIES)[number];
export type Finding = {
  readonly file: string;
  readonly line: number;
  readonly issue: string;
  readonly severity: Severity;
  readonly category: Category;
};
export type Row = { readonly name: string; readonly kind: string; readonly status: string };
export type Result<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "failed"; readonly reason: string };

const CASES = join("evals", "reviewer");
const REQUIRED = ["base.sha", "change.patch", "golden.json"] as const;
const OPTIONAL = ["pr.md"] as const;
// folders under evals/reviewer/ that are not cases: the harness's results (ADR-0015)
const NOT_CASES = ["results"] as const;
const KEYS = ["file", "line", "issue", "severity", "category"] as const;
const SHA = /^[0-9a-f]{40}$/;

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return list.some((item) => item === value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

// shaProblem : why base.sha's text is not one full commit hash, or "". Pure.
export function shaProblem(raw: string): string {
  return SHA.test(raw.trim()) ? "" : "base.sha must hold one 40-hex commit hash";
}

function keyProblems(item: Readonly<Record<string, unknown>>): readonly string[] {
  const missing = KEYS.filter((k) => !Object.hasOwn(item, k)).map((k) => `no ${k}`);
  const extra = Object.keys(item)
    .filter((k) => !oneOf(KEYS, k))
    .map((k) => `an unknown key ${k}`);
  return [...missing, ...extra];
}

function valueProblems(item: Readonly<Record<string, unknown>>): readonly string[] {
  const checks: readonly (readonly [boolean, string])[] = [
    [text(item.file), "file is not a path"],
    [Number.isInteger(item.line) && Number(item.line) >= 1, "line is not a whole number from 1"],
    [text(item.issue), "issue is empty"],
    [oneOf(SEVERITIES, item.severity), `severity is not one of ${SEVERITIES.join(", ")}`],
    [oneOf(CATEGORIES, item.category), `category is not one of ${CATEGORIES.join(", ")}`],
  ];
  return checks.filter(([ok]) => !ok).map(([, why]) => why);
}

// findingProblems : what is wrong with one entry of golden.json, as "finding N: …". Pure.
export function findingProblems(item: unknown, index: number): readonly string[] {
  const why = isRecord(item) ? [...keyProblems(item), ...valueProblems(item)] : ["is not an object"];
  return why.map((w) => `finding ${index + 1}: ${w}`);
}

function parsed(raw: string): Result<unknown> {
  try {
    return { kind: "ok", value: JSON.parse(raw) };
  } catch (error) {
    return { kind: "failed", reason: `golden.json is not JSON: ${error instanceof Error ? error.message : "?"}` };
  }
}

function asFinding(item: Readonly<Record<string, unknown>>): Finding {
  return {
    file: String(item.file),
    line: Number(item.line),
    issue: String(item.issue),
    severity: oneOf(SEVERITIES, item.severity) ? item.severity : "nit",
    category: oneOf(CATEGORIES, item.category) ? item.category : "speculative",
  };
}

// readGolden : golden.json's findings, or every reason it is not well-formed. Pure.
export function readGolden(raw: string): Result<readonly Finding[]> {
  const json = parsed(raw);
  if (json.kind === "failed") {
    return json;
  }
  if (!Array.isArray(json.value)) {
    return { kind: "failed", reason: "golden.json must be an array of findings ([] for a clean case)" };
  }
  const list: readonly unknown[] = json.value;
  const wrong = list.flatMap(findingProblems);
  return wrong.length > 0
    ? { kind: "failed", reason: wrong.join("; ") }
    : { kind: "ok", value: list.filter(isRecord).map(asFinding) };
}

// fileProblems : the required files a case folder lacks and the files it should not hold. Pure.
export function fileProblems(names: readonly string[]): readonly string[] {
  const missing = REQUIRED.filter((f) => !names.includes(f)).map((f) => `no ${f}`);
  const extra = names.filter((n) => !oneOf(REQUIRED, n) && !oneOf(OPTIONAL, n)).map((n) => `an unknown file ${n}`);
  return [...missing, ...extra];
}

function cells(line: string): readonly string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
}

function rowOf(line: string): Row {
  const [name = "", kind = "", , , status = ""] = cells(line);
  return { name: name.replaceAll("`", ""), kind, status };
}

// tableRows : the case rows of cases.md: each table line whose first cell is a `name` in backticks. Pure.
export function tableRows(markdown: string): readonly Row[] {
  return markdown
    .split("\n")
    .filter((l) => /^\|\s*`[^`]+`\s*\|/.test(l))
    .map(rowOf);
}

function rowProblems(row: Row): readonly string[] {
  const kind = oneOf(KINDS, row.kind) ? [] : [`kind ${row.kind || "(empty)"} is not one of ${KINDS.join(", ")}`];
  const status = oneOf(STATUSES, row.status)
    ? []
    : [`status ${row.status || "(empty)"} is not ${STATUSES.join(" or ")}`];
  return [...kind, ...status].map((w) => `${row.name}: cases.md: ${w}`);
}

// tableProblems : the cases with no row, the rows with no case or with a bad kind or status, and the repeats. Pure.
export function tableProblems(folders: readonly string[], rows: readonly Row[]): readonly string[] {
  const names = rows.map((r) => r.name);
  const noRow = folders.filter((f) => !names.includes(f)).map((f) => `${f}: no row in cases.md`);
  const noCase = names.filter((n) => !folders.includes(n)).map((n) => `${n}: a row in cases.md but no folder`);
  const twice = names.filter((n, i) => names.indexOf(n) !== i).map((n) => `${n}: two rows in cases.md`);
  return [...noRow, ...noCase, ...twice, ...rows.flatMap(rowProblems)];
}

// kindProblem : a clean case expects no finding and a seeded one at least one; a rulebook copy may be either. Pure.
export function kindProblem(kind: string, findings: readonly Finding[]): string {
  if (kind === "clean" && findings.length > 0) {
    return "a clean case's golden.json must be []";
  }
  return kind === "seeded" && findings.length === 0 ? "a seeded case's golden.json must name its seed" : "";
}

type Git = { readonly code: number; readonly out: string; readonly err: string };

function firstLine(stderr: string): string {
  return stderr.trim().split("\n")[0] ?? "";
}

function git(root: string, args: readonly string[], index: string): Git {
  const env = index === "" ? process.env : { ...process.env, GIT_INDEX_FILE: index };
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? -1, out: r.stdout, err: firstLine(r.stderr) };
}

function lineTotal(content: string): number {
  return content === "" ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

// Applied : the files the patch changes, each with its line count once the patch is applied
type Applied = ReadonlyMap<string, number>;

function changedFiles(root: string, sha: string, index: string): Applied {
  const names = git(root, ["diff", "--cached", "--name-only", "--no-renames", "-z", sha], index)
    .out.split("\0")
    .filter((n) => n !== "");
  return new Map(names.map((n) => [n, lineTotal(git(root, ["show", `:${n}`], index).out)]));
}

function inScratchIndex(root: string, sha: string, patch: string, index: string): Result<Applied> {
  const steps: readonly (readonly [readonly string[], string])[] = [
    [["read-tree", sha], `cannot read the tree of ${sha}`],
    [["apply", "--cached", "--check", patch], "change.patch does not apply to base.sha"],
    [["apply", "--cached", patch], "change.patch does not apply to base.sha"],
  ];
  for (const [args, why] of steps) {
    const r = git(root, args, index);
    if (r.code !== 0) {
      return { kind: "failed", reason: `${why}: ${r.err}` };
    }
  }
  return { kind: "ok", value: changedFiles(root, sha, index) };
}

// applied : the patch applied to the commit in a scratch index, so the checkout and the real index are never touched
export function applied(root: string, sha: string, patch: string): Result<Applied> {
  if (git(root, ["cat-file", "-e", `${sha}^{commit}`], "").code !== 0) {
    return { kind: "failed", reason: `base.sha ${sha} is not a commit in this history (a shallow clone?)` };
  }
  const dir = mkdtempSync(join(tmpdir(), "factory-evals-"));
  const result = inScratchIndex(root, sha, patch, join(dir, "index"));
  rmSync(dir, { recursive: true, force: true });
  return result;
}

// placeProblems : each finding must sit in a file the patch changes, on a line that file has after it. Pure.
export function placeProblems(findings: readonly Finding[], files: Applied): readonly string[] {
  return findings.flatMap((f, i) => {
    const lines = files.get(f.file);
    if (lines === undefined) {
      return [`finding ${i + 1}: ${f.file} is not a file the patch changes`];
    }
    return f.line <= lines ? [] : [`finding ${i + 1}: ${f.file} has ${lines} lines, not ${f.line}`];
  });
}

function read(dir: string, name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

function goldenOf(dir: string, sha: string, root: string): readonly string[] {
  const golden = readGolden(read(dir, "golden.json"));
  if (golden.kind === "failed") {
    return [golden.reason];
  }
  const files = applied(root, sha, join(dir, "change.patch"));
  return files.kind === "failed" ? [files.reason] : placeProblems(golden.value, files.value);
}

// complete : what is wrong with a case that has all its files: its hash, its golden.json and patch, and its kind
function complete(root: string, dir: string, kind: string): readonly string[] {
  const sha = read(dir, "base.sha").trim();
  const shaWhy = shaProblem(sha);
  const deep = shaWhy === "" ? goldenOf(dir, sha, root) : [];
  const golden = readGolden(read(dir, "golden.json"));
  const kindWhy = golden.kind === "ok" ? kindProblem(kind, golden.value) : "";
  return [shaWhy, ...deep, kindWhy].filter((w) => w !== "");
}

// caseProblems : what is wrong with one case folder, each line prefixed with its name
export function caseProblems(root: string, name: string, kind: string): readonly string[] {
  const dir = join(root, CASES, name);
  const missing = fileProblems(readdirSync(dir));
  const found = missing.length === 0 ? complete(root, dir, kind) : missing;
  return found.map((w) => `${name}: ${w}`);
}

function caseFolders(root: string): readonly string[] {
  const dir = join(root, CASES);
  return readdirSync(dir)
    .filter((n) => statSync(join(dir, n)).isDirectory() && !oneOf(NOT_CASES, n))
    .toSorted();
}

// problems : every problem in ROOT's golden set, as "evals/reviewer/<case>: …"; none when there is no golden set
export function problems(root: string): readonly string[] {
  if (!existsSync(join(root, CASES))) {
    return [];
  }
  const folders = caseFolders(root);
  const table = join(root, CASES, "cases.md");
  const rows = existsSync(table) ? tableRows(readFileSync(table, "utf8")) : [];
  const kindOf = new Map(rows.map((r) => [r.name, r.kind]));
  const found = [
    ...tableProblems(folders, rows),
    ...folders.flatMap((f) => caseProblems(root, f, kindOf.get(f) ?? "")),
  ];
  return found.map((p) => `${CASES}/${p}`);
}

if (process.argv[1] === import.meta.filename) {
  const found = problems(process.argv[2] ?? ".");
  for (const p of found) {
    console.log(p);
  }
  if (found.length > 0) {
    console.log(`check-evals: ${found.length} problem(s) in the golden set`);
    process.exit(1);
  }
}
