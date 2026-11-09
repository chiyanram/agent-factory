// findings — what a design review gives (#236; the design-reviewer and verify-pass role cards): one finding per
// decision in the spec and design, each with one verdict (aligned, conflict, open), and the verify pass's bucket for
// each conflict and open. Model output is data: every field is checked, ids are renumbered D1…Dn so a verdict can never
// match two findings, and every text is cut to a length the run record and a post can hold. Nothing here posts.

import type { Result } from "../forge/api.js";

export type DesignVerdict = "aligned" | "conflict" | "open";
export type Grade = "cited" | "walked" | "ran";
export type Bucket = "act_on" | "consider" | "noted" | "dismissed";

export type DesignFinding = {
  readonly id: string;
  readonly decision: string;
  readonly verdict: DesignVerdict;
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly severity: "blocker" | "warning" | "nit";
  readonly grade: Grade;
  readonly finding: string;
  readonly fix: string;
};

// a finding the verify pass kept, with its bucket and why
export type Kept = DesignFinding & { readonly bucket: Bucket; readonly why: string };

const VERDICTS = ["aligned", "conflict", "open"] as const;
const SEVERITIES = ["blocker", "warning", "nit"] as const;
const GRADES = ["cited", "walked", "ran"] as const;
const BUCKETS = ["act_on", "consider", "noted", "dismissed"] as const;
const TEXTS = ["decision", "file", "rule", "finding", "fix"] as const;

// the most findings one review keeps, and the most characters of each text
const MOST_FINDINGS = 60;
const MOST_CHARS = 600;

export const DESIGN_SCHEMA = JSON.stringify({
  type: "object",
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "decision", "verdict", "file", "line", "rule", "severity", "grade", "finding", "fix"],
        properties: {
          id: { type: "string" },
          decision: { type: "string" },
          verdict: { enum: VERDICTS },
          file: { type: "string" },
          line: { type: "integer" },
          rule: { type: "string" },
          severity: { enum: SEVERITIES },
          grade: { enum: GRADES },
          finding: { type: "string" },
          fix: { type: "string" },
        },
      },
    },
  },
});

function get(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? (Reflect.get(value, name) as unknown) : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((a) => a === value);
}

function cut(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, MOST_CHARS) : undefined;
}

type Texts = { readonly [K in (typeof TEXTS)[number]]: string };

function textsOf(raw: unknown): Texts | undefined {
  const read = TEXTS.map((name) => cut(get(raw, name)));
  const at = (i: number): string => read[i] ?? "";
  return read.includes(undefined)
    ? undefined
    : { decision: at(0), file: at(1), rule: at(2), finding: at(3), fix: at(4) };
}

function lineOf(raw: unknown): number | undefined {
  const line = get(raw, "line");
  return Number.isSafeInteger(line) && Number(line) >= 0 ? Number(line) : undefined;
}

type Enums = Pick<DesignFinding, "verdict" | "severity" | "grade">;

function enumsOf(raw: unknown): Enums | undefined {
  const verdict = oneOf(get(raw, "verdict"), VERDICTS);
  const severity = oneOf(get(raw, "severity"), SEVERITIES);
  const grade = oneOf(get(raw, "grade"), GRADES);
  return verdict === undefined || severity === undefined || grade === undefined
    ? undefined
    : { verdict, severity, grade };
}

// findingOf : one finding with the id given, or undefined
function findingOf(raw: unknown, id: string): DesignFinding | undefined {
  const texts = textsOf(raw);
  const line = lineOf(raw);
  const enums = enumsOf(raw);
  return texts === undefined || line === undefined || enums === undefined
    ? undefined
    : { id, ...texts, line, ...enums };
}

function listOf(output: unknown, name: string): readonly unknown[] | undefined {
  const list = get(output, name);
  return Array.isArray(list) && list.length <= MOST_FINDINGS ? list : undefined;
}

// readDesignFindings : the design-reviewer's answer, every field checked, renumbered D1…Dn
export function readDesignFindings(output: unknown): Result<readonly DesignFinding[]> {
  const list = listOf(output, "findings");
  const read = (list ?? []).map((raw, i) => findingOf(raw, `D${i + 1}`));
  const good = read.filter((f): f is DesignFinding => f !== undefined);
  return list !== undefined && good.length === read.length
    ? { kind: "ok", value: good }
    : { kind: "failed", reason: `the design-reviewer's answer is not a list of at most ${MOST_FINDINGS} findings` };
}

// keptOf : one kept finding as a record line holds it, or undefined
function keptOf(raw: unknown): Kept | undefined {
  const id = cut(get(raw, "id"));
  const finding = id === undefined ? undefined : findingOf(raw, id);
  const bucket = oneOf(get(raw, "bucket"), BUCKETS);
  const why = cut(get(raw, "why"));
  return finding === undefined || bucket === undefined || why === undefined ? undefined : { ...finding, bucket, why };
}

// recorded : a record line's list, each entry read by `one`; none when the line has none, undefined when one is bad
function recorded<T>(value: unknown, one: (raw: unknown) => T | undefined): readonly T[] | undefined {
  if (value === undefined) {
    return [];
  }
  const read = Array.isArray(value) ? value.map(one) : [undefined];
  return read.every((f) => f !== undefined) ? read.filter((f) => f !== undefined) : undefined;
}

function recordedFinding(raw: unknown): DesignFinding | undefined {
  const id = cut(get(raw, "id"));
  return id === undefined ? undefined : findingOf(raw, id);
}

// recordedFindings : a record line's findings, ids as written
export function recordedFindings(value: unknown): readonly DesignFinding[] | undefined {
  return recorded(value, recordedFinding);
}

// recordedKept : a record line's kept findings, ids as written
export function recordedKept(value: unknown): readonly Kept[] | undefined {
  return recorded(value, keptOf);
}

// toVerify : the findings a verify pass checks: every conflict and open (the design-reviewer card's next). Pure.
export function toVerify(findings: readonly DesignFinding[]): readonly DesignFinding[] {
  return findings.filter((f) => f.verdict !== "aligned");
}

// keep : each finding the verify pass did not dismiss, with its bucket; a finding it gave no verdict is kept as
// consider, never dropped. Pure.
export function keep(
  findings: readonly DesignFinding[],
  verdicts: readonly { readonly id: string; readonly bucket: Bucket; readonly why: string }[],
): readonly Kept[] {
  const kept = (f: DesignFinding): Kept => {
    const v = verdicts.find((x) => x.id === f.id) ?? { bucket: "consider", why: "the verify pass gave no verdict" };
    return { ...f, bucket: v.bucket, why: v.why.trim().slice(0, MOST_CHARS) };
  };
  return findings.map(kept).filter((k) => k.bucket !== "dismissed");
}

// keptLine : one kept finding as a person reads it in a post or a log line. Pure.
export function keptLine(k: Kept): string {
  const where = k.file === "" ? "" : ` ${k.file}:${k.line}`;
  return `${k.id} ${k.verdict} (${k.bucket.replace("_", " ")}, ${k.grade})${where}: ${k.finding}`;
}
