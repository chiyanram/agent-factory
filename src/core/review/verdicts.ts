// verdicts — what the find pass found and how the verify pass sorted it (#22 Q1, Q2). Model output is data: every
// field is checked, ids are renumbered F1…Fn (so a verdict can never match two findings), and a "code/" path prefix is
// dropped (so a thread anchors). A finding the verify pass gives no verdict is kept as Consider, never dropped.
// Nothing here posts: the post template (#126) makes every field inert. Each finding carries a category, what it is
// (the Martian categories, ADR-0015 R2), and keeps its severity, how much it matters (decided on #218, 2026-11-09).
// A Spec finding names the acceptance criterion it fails as its rule, AC<n>; the round quotes that line from the
// approved spec, never from the model (#219).
// The finding contract is docs/DESIGN.md's (decided on #237, 2026-11-09): the finder gives its grade, cited, walked or
// ran, and the evidence behind it; the engine adds the lens, the one the finder run was for, never the model's word.

import { prop } from "../dispatch/records.js";
import { CATEGORIES, type Category } from "../eval/golden.js";
import type { Result } from "../forge/api.js";

export type Axis = "standards" | "spec";
export type Kind = "rule" | "logic";
export type Severity = "blocker" | "warning" | "nit";
export type Bucket = "act_on" | "consider" | "noted" | "dismissed";
// how far the finder went to show it: cited the line, walked the failure through, or ran it (rulebook crq RV7)
export const GRADES = ["cited", "walked", "ran"] as const;
export type Grade = (typeof GRADES)[number];
export type { Category };

export type Finding = {
  readonly id: string;
  readonly lens: string;
  readonly axis: Axis;
  readonly kind: Kind;
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly category: Category;
  readonly severity: Severity;
  readonly grade: Grade;
  readonly evidence: string;
  readonly finding: string;
  readonly fix: string;
};

export type Sorted = Finding & { readonly bucket: Bucket; readonly why: string };

const FINDING_SCHEMA = {
  type: "object",
  required: [
    "id",
    "axis",
    "kind",
    "file",
    "line",
    "rule",
    "category",
    "severity",
    "grade",
    "evidence",
    "finding",
    "fix",
  ],
  properties: {
    id: { type: "string" },
    axis: { enum: ["standards", "spec"] },
    kind: { enum: ["rule", "logic"] },
    file: { type: "string" },
    line: { type: "integer" },
    rule: { type: "string" },
    category: { enum: CATEGORIES },
    severity: { enum: ["blocker", "warning", "nit"] },
    grade: { enum: GRADES },
    evidence: { type: "string" },
    finding: { type: "string" },
    fix: { type: "string" },
  },
};

export const FIND_SCHEMA = JSON.stringify({
  type: "object",
  required: ["findings"],
  properties: { findings: { type: "array", items: FINDING_SCHEMA } },
});

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
          bucket: { enum: ["act_on", "consider", "noted", "dismissed"] },
          why: { type: "string" },
        },
      },
    },
  },
});

// a field that is not there, or not what it should be
const BAD: unique symbol = Symbol("bad");
type Bad = typeof BAD;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | Bad {
  return allowed.find((a) => a === value) ?? BAD;
}

function text(value: unknown): string | Bad {
  return typeof value === "string" ? value : BAD;
}

type Fields = {
  readonly axis: Axis;
  readonly kind: Kind;
  readonly category: Category;
  readonly severity: Severity;
  readonly grade: Grade;
};

// how much it matters and how far the finder went to show it
function weight(raw: unknown): Pick<Fields, "severity" | "grade"> | Bad {
  const severity = oneOf(prop(raw, "severity"), ["blocker", "warning", "nit"] as const);
  const grade = oneOf(prop(raw, "grade"), GRADES);
  return severity === BAD || grade === BAD ? BAD : { severity, grade };
}

function enums(raw: unknown): Fields | Bad {
  const axis = oneOf(prop(raw, "axis"), ["standards", "spec"] as const);
  const kind = oneOf(prop(raw, "kind"), ["rule", "logic"] as const);
  const category = oneOf(prop(raw, "category"), CATEGORIES);
  const w = weight(raw);
  return axis === BAD || kind === BAD || category === BAD || w === BAD ? BAD : { axis, kind, category, ...w };
}

type Words = {
  readonly file: string;
  readonly rule: string;
  readonly evidence: string;
  readonly finding: string;
  readonly fix: string;
};

// the finding's words: what the finder saw, what is wrong, and the fix
function prose(raw: unknown): Pick<Words, "evidence" | "finding" | "fix"> | Bad {
  const evidence = text(prop(raw, "evidence"));
  const finding = text(prop(raw, "finding"));
  const fix = text(prop(raw, "fix"));
  return evidence === BAD || finding === BAD || fix === BAD ? BAD : { evidence, finding, fix };
}

function words(raw: unknown): Words | Bad {
  const file = text(prop(raw, "file"));
  const rule = text(prop(raw, "rule"));
  const said = prose(raw);
  return file === BAD || rule === BAD || said === BAD
    ? BAD
    : { file: file.replace(/^(\.\/)?code\//, ""), rule, ...said };
}

function findingOf(raw: unknown, i: number, lens: string): Finding | Bad {
  const e = enums(raw);
  const w = words(raw);
  const line = prop(raw, "line");
  if (e === BAD || w === BAD || !Number.isSafeInteger(line)) {
    return BAD;
  }
  return { id: `F${i + 1}`, lens, ...e, ...w, line: Number(line) };
}

function isFinding(f: Finding | Bad): f is Finding {
  return f !== BAD;
}

// readFindings : one finder run's output, renumbered, each finding stamped with the lens the run was for; one malformed
// finding fails the run
export function readFindings(output: unknown, lens: string): Result<readonly Finding[]> {
  const list = prop(output, "findings");
  const found: readonly (Finding | Bad)[] = Array.isArray(list) ? list.map((raw, i) => findingOf(raw, i, lens)) : [BAD];
  return found.every(isFinding)
    ? { kind: "ok", value: found.filter(isFinding) }
    : { kind: "failed", reason: "the find pass gave a finding that is not well formed" };
}

export type Verdict = { readonly id: string; readonly bucket: Bucket; readonly why: string };

function verdictOf(raw: unknown): Verdict | Bad {
  const id = text(prop(raw, "id"));
  const bucket = oneOf(prop(raw, "bucket"), ["act_on", "consider", "noted", "dismissed"] as const);
  const why = text(prop(raw, "why"));
  return id === BAD || bucket === BAD || why === BAD ? BAD : { id, bucket, why };
}

function isVerdict(v: Verdict | Bad): v is Verdict {
  return v !== BAD;
}

// readVerdicts : the verify pass's output
export function readVerdicts(output: unknown): Result<readonly Verdict[]> {
  const list = prop(output, "verdicts");
  const read: readonly (Verdict | Bad)[] = Array.isArray(list) ? list.map(verdictOf) : [BAD];
  return read.every(isVerdict)
    ? { kind: "ok", value: read.filter(isVerdict) }
    : { kind: "failed", reason: "the verify pass gave a verdict that is not well formed" };
}

// sortFindings : every finding in exactly one bucket; one the verify pass skipped is Consider
export function sortFindings<F extends Finding>(
  findings: readonly F[],
  verdicts: readonly Verdict[],
): readonly (F & { readonly bucket: Bucket; readonly why: string })[] {
  return findings.map((f) => {
    const v = verdicts.find((x) => x.id === f.id);
    return { ...f, bucket: v?.bucket ?? "consider", why: v?.why ?? "the verify pass gave no verdict" };
  });
}

export const BUCKET_NAMES: Readonly<Record<Bucket, string>> = {
  act_on: "Act on",
  consider: "Consider",
  noted: "Noted",
  dismissed: "Dismissed",
};

export type Counts = Readonly<Record<Bucket, number>>;

export function counts(sorted: readonly Sorted[]): Counts {
  const n = (b: Bucket) => sorted.filter((f) => f.bucket === b).length;
  return { act_on: n("act_on"), consider: n("consider"), noted: n("noted"), dismissed: n("dismissed") };
}

const CRITERION = /^AC(\d+)$/;

// criterionOf : the number of the criterion a Spec finding's rule names; 0 for none
function criterionOf(f: Finding): number {
  const n = CRITERION.exec(f.rule.trim())?.[1];
  return f.axis === "spec" && n !== undefined ? Number(n) : 0;
}

// quoteOf : the criterion line a Spec finding fails, quoted from the approved spec, or why there is none to quote;
// "" for a Standards finding or a rule that names no criterion. Pure.
export function quoteOf(f: Finding, criteria: readonly string[]): string {
  const n = criterionOf(f);
  if (n === 0) {
    return "";
  }
  const line = criteria[n - 1];
  return line === undefined ? `AC${n} is not in the approved spec` : `${n}. ${line}`;
}

export function countsLine(c: Counts): string {
  return `Act on ${c.act_on} · Consider ${c.consider} · Noted ${c.noted} · Dismissed ${c.dismissed}`;
}
