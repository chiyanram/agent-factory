// finding — the one Finding record of ADR-0017, and the verify pass's verdict on it. Two roles return a finding: the
// finder in the automated review (review/verdicts.ts) and the design-reviewer before the approval (design/findings.ts).
// Both share the core below and add their own part; `source` tells the two apart, and the engine sets it, never the
// model. The verify pass answers each finding with a bucket and a why, and it may lower the finding's severity or grade,
// never raise them (settle; rulebook crq RV7): a run does not grade its own proof. Model output is data: every field is
// checked.

import type { Result } from "./forge/api.js";

// how much a finding matters, the heaviest first
export const SEVERITIES = ["blocker", "warning", "nit"] as const;
export type Severity = (typeof SEVERITIES)[number];
// how far the finder went to show it, the weakest first: cited the line, walked the failure through, or ran it
export const GRADES = ["cited", "walked", "ran"] as const;
export type Grade = (typeof GRADES)[number];
export const BUCKETS = ["act_on", "consider", "noted", "dismissed"] as const;
export type Bucket = (typeof BUCKETS)[number];

// what every finding has, whichever role found it
export type FindingCore = {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly severity: Severity;
  readonly grade: Grade;
  readonly finding: string;
  readonly fix: string;
  // the last line of a cited range "N-M", when the finding gave one; the cite check reads it (#485)
  readonly lineEnd?: number;
};

// the core's part of a finder's JSON schema
export const CORE_REQUIRED = ["id", "file", "line", "rule", "severity", "grade", "finding", "fix"] as const;
export const CORE_PROPERTIES = {
  id: { type: "string" },
  file: { type: "string" },
  line: { type: "integer" },
  rule: { type: "string" },
  severity: { enum: SEVERITIES },
  grade: { enum: GRADES },
  finding: { type: "string" },
  fix: { type: "string" },
};

export function get(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? (Reflect.get(value, name) as unknown) : undefined;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((a) => a === value);
}

function textOf(value: unknown, clean: (text: string) => string): string | undefined {
  return typeof value === "string" ? clean(value) : undefined;
}

// lineOf : a finding's line: a whole number, or text "N" or "N-M" as the rules pack's finding schema allows; a range is
// read as its first line, where the thread anchors (#484). Pure.
function lineOf(raw: unknown): number | undefined {
  const n = firstLine(get(raw, "line"));
  return Number.isSafeInteger(n) && Number(n) >= 0 ? Number(n) : undefined;
}

// lineEndOf : the end of a cited range "N-M" when it is past N; undefined for a single line. Pure.
function lineEndOf(raw: unknown): number | undefined {
  const line = get(raw, "line");
  const end = typeof line === "string" ? /^(\d+)-(\d+)$/.exec(line) : null;
  const [from, to] = end === null ? [0, 0] : [Number(end[1]), Number(end[2])];
  return to > from ? to : undefined;
}

// firstLine : a line as given, or the first line of "N" or "N-M" text. Pure.
function firstLine(line: unknown): unknown {
  const text = typeof line === "string" ? /^(\d+)(-\d+)?$/.exec(line)?.[1] : undefined;
  return text === undefined ? line : Number(text);
}

// ruleOf : a finding's rule; a null rule (a logic finding with no rule) is "" (#484). Pure.
function ruleOf(raw: unknown): unknown {
  const rule = get(raw, "rule");
  return rule === null ? "" : rule;
}

type Texts = Pick<FindingCore, "file" | "rule" | "finding" | "fix">;

function textsOf(raw: unknown, clean: (text: string) => string): Texts | undefined {
  const file = textOf(get(raw, "file"), clean);
  const rule = textOf(ruleOf(raw), clean);
  const finding = textOf(get(raw, "finding"), clean);
  const fix = textOf(get(raw, "fix"), clean);
  return file === undefined || rule === undefined || finding === undefined || fix === undefined
    ? undefined
    : { file: file.replace(/^(\.\/)?code\//, ""), rule, finding, fix };
}

function weightOf(raw: unknown): Pick<FindingCore, "severity" | "grade"> | undefined {
  const severity = oneOf(get(raw, "severity"), SEVERITIES);
  const grade = oneOf(get(raw, "grade"), GRADES);
  return severity === undefined || grade === undefined ? undefined : { severity, grade };
}

// coreOf : one finding's core with the id the engine gives it, each text through `clean`, and a "code/" path prefix
// dropped (so a thread anchors); undefined when a field is missing or not what it should be. Pure.
export function coreOf(raw: unknown, id: string, clean: (text: string) => string): FindingCore | undefined {
  const texts = textsOf(raw, clean);
  const line = lineOf(raw);
  const weight = weightOf(raw);
  const end = lineEndOf(raw);
  return texts === undefined || line === undefined || weight === undefined
    ? undefined
    : { id, ...texts, line, ...(end === undefined ? {} : { lineEnd: end }), ...weight };
}

// ---- the verify pass

// one finding's verdict: its bucket and why, and the severity or grade the verify pass lowers it to, when it does
export type Verdict = {
  readonly id: string;
  readonly bucket: Bucket;
  readonly why: string;
  readonly severity?: Severity;
  readonly grade?: Grade;
};

export const VERIFY_SCHEMA = JSON.stringify({
  type: "object",
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "bucket", "why"],
        properties: {
          id: { type: "string" },
          bucket: { enum: BUCKETS },
          why: { type: "string" },
          severity: { enum: SEVERITIES },
          grade: { enum: GRADES },
        },
      },
    },
  },
});

// optional : an optional enum field: absent, one of the allowed values, or "bad". Pure.
function optional<T extends string>(raw: unknown, name: string, allowed: readonly T[]): T | undefined | "bad" {
  const value = get(raw, name);
  return value === undefined ? undefined : (oneOf(value, allowed) ?? "bad");
}

type Lowered = Pick<Verdict, "severity" | "grade">;

// loweredOf : the severity and grade a verdict sets, each only when it gives one; "bad" when one is not a severity or a
// grade. Pure.
function loweredOf(raw: unknown): Lowered | "bad" {
  const severity = optional(raw, "severity", SEVERITIES);
  const grade = optional(raw, "grade", GRADES);
  if (severity === "bad" || grade === "bad") {
    return "bad";
  }
  return { ...(severity === undefined ? {} : { severity }), ...(grade === undefined ? {} : { grade }) };
}

function verdictOf(raw: unknown): Verdict | undefined {
  const id = get(raw, "id");
  const bucket = oneOf(get(raw, "bucket"), BUCKETS);
  const why = get(raw, "why");
  const lowered = loweredOf(raw);
  const named = typeof id === "string" && bucket !== undefined && typeof why === "string";
  return named && lowered !== "bad" ? { id, bucket, why, ...lowered } : undefined;
}

// readVerdicts : the verify pass's output; one malformed verdict fails the pass
export function readVerdicts(output: unknown): Result<readonly Verdict[]> {
  const list = get(output, "verdicts");
  const read = Array.isArray(list) ? list.map(verdictOf) : [undefined];
  const good = read.filter((v): v is Verdict => v !== undefined);
  return good.length === read.length
    ? { kind: "ok", value: good }
    : { kind: "failed", reason: "the verify pass gave a verdict that is not well formed" };
}

// raises : what a verdict raises above the finder's own, as a person reads it; "" when it raises nothing. Pure.
function raises(f: FindingCore, v: Verdict): string {
  const severity = v.severity !== undefined && SEVERITIES.indexOf(v.severity) < SEVERITIES.indexOf(f.severity);
  const grade = v.grade !== undefined && GRADES.indexOf(v.grade) > GRADES.indexOf(f.grade);
  const raised = [severity ? `the severity to ${v.severity}` : "", grade ? `the grade to ${v.grade}` : ""];
  return raised.filter((r) => r !== "").join(" and ");
}

// settle : a finding with its verdict: the verify pass's bucket and why, and the severity and grade it lowered them to.
// A finding with no verdict is Consider, never dropped. A verdict that raises the severity or the grade is refused: the
// finding is Consider, with the finder's own severity and grade. An Act on finding whose grade is only `cited` settles
// as Consider: a blocking finding needs proof, a walk-through or a run (P15; rulebook RV7, #485). Pure.
export function settle<F extends FindingCore>(
  f: F,
  v: Verdict | undefined,
): F & { readonly bucket: Bucket; readonly why: string } {
  if (v === undefined) {
    return { ...f, bucket: "consider", why: "the verify pass gave no verdict" };
  }
  const raised = raises(f, v);
  return raised === ""
    ? proven({ ...f, severity: v.severity ?? f.severity, grade: v.grade ?? f.grade, bucket: v.bucket, why: v.why })
    : { ...f, bucket: "consider", why: `the verify pass raised ${raised}, which it may not; its verdict is refused` };
}

// proven : a settled finding, Consider rather than Act on when its grade is only cited (P15, RV7, #485). Pure.
function proven<F extends FindingCore & { readonly bucket: Bucket; readonly why: string }>(f: F): F {
  return f.bucket === "act_on" && f.grade === "cited"
    ? { ...f, bucket: "consider", why: `${f.why} (Consider, not Act on: the finding only cites the line)` }
    : f;
}
