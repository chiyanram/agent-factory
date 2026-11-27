// finding — the one Finding record of ADR-0017, and the verify pass's verdict on it. Two roles return a finding: the
// finder in the automated review (review/verdicts.ts) and the design-reviewer before the approval (design/findings.ts).
// Both share the core below and add their own part; `source` tells the two apart, and the engine sets it, never the
// model. The verify pass answers each finding with a bucket and a why, and it may lower the finding's severity or grade,
// never raise them (settle; rulebook crq RV7): a run does not grade its own proof. Model output is data: every field is
// checked. A finding may carry `quote`, the cited line's exact text, so code can find the line again; a quote that is no
// text is dropped, never the finding. **Today:** neither schema asks for it, and nothing reads it yet (#870).

import type { Result } from "./forge/api.js";
import { prop } from "./field.js";
import { SEVERITIES } from "./eval/golden.js";

export type Severity = (typeof SEVERITIES)[number];
export const GRADES = ["cited", "walked", "ran"] as const;
export type Grade = (typeof GRADES)[number];
export const BUCKETS = ["act_on", "consider", "noted", "dismissed"] as const;
export type Bucket = (typeof BUCKETS)[number];

export type FindingCore = {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly severity: Severity;
  readonly grade: Grade;
  readonly finding: string;
  readonly fix: string;
  readonly lineEnd?: number;
  readonly quote?: string;
};

export const CORE_REQUIRED = ["id", "file", "line", "rule", "severity", "grade", "finding", "fix"] as const;
export const CORE_PROPERTIES = {
  id: { type: "string" },
  file: { type: "string" },
  line: { anyOf: [{ type: "integer" }, { type: "string", pattern: "^[0-9]+(-[0-9]+)?$" }] },
  rule: { type: "string" },
  severity: { enum: SEVERITIES },
  grade: { enum: GRADES },
  finding: { type: "string" },
  fix: { type: "string" },
};

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((a) => a === value);
}

function textOf(value: unknown, clean: (text: string) => string): string | undefined {
  return typeof value === "string" ? clean(value) : undefined;
}

function lineOf(raw: unknown): number | undefined {
  const n = firstLine(prop(raw, "line"));
  return Number.isSafeInteger(n) && Number(n) >= 0 ? Number(n) : undefined;
}

function lineEndOf(raw: unknown): number | undefined {
  const line = prop(raw, "line");
  const end = typeof line === "string" ? /^(\d+)-(\d+)$/.exec(line) : null;
  const [from, to] = end === null ? [0, 0] : [Number(end[1]), Number(end[2])];
  return to === from ? undefined : to;
}

function firstLine(line: unknown): unknown {
  const text = typeof line === "string" ? /^(\d+)(-\d+)?$/.exec(line)?.[1] : undefined;
  return text === undefined ? line : Number(text);
}

function quoteOf(raw: unknown, clean: (text: string) => string): Pick<FindingCore, "quote"> {
  const quote = textOf(prop(raw, "quote"), clean)?.trim();
  return quote === undefined || quote === "" ? {} : { quote };
}

function ruleOf(raw: unknown): unknown {
  const rule = prop(raw, "rule");
  return rule === null ? "" : rule;
}

type Texts = Pick<FindingCore, "file" | "rule" | "finding" | "fix">;

function textsOf(raw: unknown, clean: (text: string) => string): Texts | undefined {
  const file = textOf(prop(raw, "file"), clean);
  const rule = textOf(ruleOf(raw), clean);
  const finding = textOf(prop(raw, "finding"), clean);
  const fix = textOf(prop(raw, "fix"), clean);
  return file === undefined || rule === undefined || finding === undefined || fix === undefined
    ? undefined
    : { file: file.replace(/^(\.\/)?code\//, ""), rule, finding, fix };
}

function weightOf(raw: unknown): Pick<FindingCore, "severity" | "grade"> | undefined {
  const severity = oneOf(prop(raw, "severity"), SEVERITIES);
  const grade = oneOf(prop(raw, "grade"), GRADES);
  return severity === undefined || grade === undefined ? undefined : { severity, grade };
}

export function coreOf(raw: unknown, id: string, clean: (text: string) => string): FindingCore | undefined {
  const texts = textsOf(raw, clean);
  const line = lineOf(raw);
  const weight = weightOf(raw);
  const end = lineEndOf(raw);
  return texts === undefined || line === undefined || weight === undefined
    ? undefined
    : { id, ...texts, line, ...(end === undefined ? {} : { lineEnd: end }), ...weight, ...quoteOf(raw, clean) };
}

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

function optional<T extends string>(raw: unknown, name: string, allowed: readonly T[]): T | undefined | "bad" {
  const value = prop(raw, name);
  return value === undefined ? undefined : (oneOf(value, allowed) ?? "bad");
}

type Lowered = Pick<Verdict, "severity" | "grade">;

function loweredOf(raw: unknown): Lowered | "bad" {
  const severity = optional(raw, "severity", SEVERITIES);
  const grade = optional(raw, "grade", GRADES);
  if (severity === "bad" || grade === "bad") {
    return "bad";
  }
  return { ...(severity === undefined ? {} : { severity }), ...(grade === undefined ? {} : { grade }) };
}

function verdictOf(raw: unknown): Verdict | undefined {
  const id = prop(raw, "id");
  const bucket = oneOf(prop(raw, "bucket"), BUCKETS);
  const why = prop(raw, "why");
  const lowered = loweredOf(raw);
  const named = typeof id === "string" && bucket !== undefined && typeof why === "string";
  return named && lowered !== "bad" ? { id, bucket, why, ...lowered } : undefined;
}

export function readVerdicts(output: unknown): Result<readonly Verdict[]> {
  const list = prop(output, "verdicts");
  const read = Array.isArray(list) ? list.map(verdictOf) : [undefined];
  const good = read.filter((v): v is Verdict => v !== undefined);
  return good.length === read.length
    ? { kind: "ok", value: good }
    : { kind: "failed", reason: "the verify pass gave a verdict that is not well formed" };
}

function raises(f: FindingCore, v: Verdict): string {
  const severity = v.severity !== undefined && SEVERITIES.indexOf(v.severity) < SEVERITIES.indexOf(f.severity);
  const grade = v.grade !== undefined && GRADES.indexOf(v.grade) > GRADES.indexOf(f.grade);
  const raised = [severity ? `the severity to ${v.severity}` : "", grade ? `the grade to ${v.grade}` : ""];
  return raised.filter((r) => r !== "").join(" and ");
}

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

function proven<F extends FindingCore & { readonly bucket: Bucket; readonly why: string }>(f: F): F {
  return f.bucket === "act_on" && f.grade === "cited"
    ? { ...f, bucket: "consider", why: `${f.why} (Consider, not Act on: the finding only cites the line)` }
    : f;
}
