// golden — the automated review's golden set as data (#214; ADR-0015 E5): one case's golden.json and the rows of
// evals/reviewer/cases.md. scripts/check-evals.ts checks a case against these shapes in `make lint`, and the eval
// harness (harness.ts, #215) reads them, so both read the same words. Pure, and no relative import, so a script can
// load this file on Node's type stripping; it uses only erasable TypeScript.

export const SEVERITIES = ["blocker", "warning", "nit"] as const;
export const CATEGORIES = [
  "bug",
  "security",
  "concurrency",
  "data",
  "api",
  "perf",
  "observability",
  "maintainability",
  "test_gap",
  "doc_defect",
  "style",
  "speculative",
] as const;
export const KINDS = ["seeded", "found-by-eval", "clean", "rulebook-copy"] as const;
export const STATUSES = ["draft", "approved"] as const;

export type Severity = (typeof SEVERITIES)[number];
export type Category = (typeof CATEGORIES)[number];
export type GoldenFinding = {
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

const KEYS = ["file", "line", "issue", "severity", "category"] as const;

export function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return list.some((item) => item === value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
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
    [
      oneOf(CATEGORIES, item.category),
      `category ${JSON.stringify(item.category)} is not one of ${CATEGORIES.join(", ")}`,
    ],
  ];
  return checks.filter(([ok]) => !ok).map(([, why]) => why);
}

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

function asFinding(item: Readonly<Record<string, unknown>>): readonly GoldenFinding[] {
  const { severity, category } = item;
  return oneOf(SEVERITIES, severity) && oneOf(CATEGORIES, category)
    ? [{ file: String(item.file), line: Number(item.line), issue: String(item.issue), severity, category }]
    : [];
}

export function readGolden(raw: string): Result<readonly GoldenFinding[]> {
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
    : { kind: "ok", value: list.filter(isRecord).flatMap(asFinding) };
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

export function tableRows(markdown: string): readonly Row[] {
  return markdown
    .split("\n")
    .filter((l) => /^\|\s*`[^`]+`\s*\|/.test(l))
    .map(rowOf);
}
