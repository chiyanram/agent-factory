// findings — what a design review gives (#236; the design-reviewer and verify-pass role cards): one finding per
// decision in the spec and design, each with one verdict (aligned, conflict, open), and the verify pass's bucket for
// each conflict and open. Model output is data: every field is checked, ids are renumbered D1…Dn so a verdict can never
// match two findings, and every text is cut to a length the run record and a post can hold. Nothing here posts. The
// finding is ADR-0017's shared record (finding.ts), and so is the verify pass's verdict: it may lower a grade, never
// raise it.

import {
  BUCKETS,
  CORE_PROPERTIES,
  CORE_REQUIRED,
  coreOf,
  get,
  oneOf,
  settle,
  type Bucket,
  type FindingCore,
  type Verdict,
} from "../finding.js";
import type { Result } from "../forge/api.js";

export type { Bucket, Grade } from "../finding.js";

export type DesignVerdict = "aligned" | "conflict" | "open";

// a design-reviewer's finding: the shared core (ADR-0017, finding.ts), and the decision it is about with its verdict
export type DesignFinding = FindingCore & {
  readonly source: "design";
  readonly decision: string;
  readonly verdict: DesignVerdict;
};

// a finding the verify pass kept, with its bucket and why
export type Kept = DesignFinding & { readonly bucket: Bucket; readonly why: string };

const VERDICTS = ["aligned", "conflict", "open"] as const;

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
        required: [...CORE_REQUIRED, "decision", "verdict"],
        properties: { ...CORE_PROPERTIES, decision: { type: "string" }, verdict: { enum: VERDICTS } },
      },
    },
  },
});

function clip(text: string): string {
  return text.trim().slice(0, MOST_CHARS);
}

function cut(value: unknown): string | undefined {
  return typeof value === "string" ? clip(value) : undefined;
}

// findingOf : one finding with the id given, or undefined
function findingOf(raw: unknown, id: string): DesignFinding | undefined {
  const core = coreOf(raw, id, clip);
  const decision = cut(get(raw, "decision"));
  const verdict = oneOf(get(raw, "verdict"), VERDICTS);
  return core === undefined || decision === undefined || verdict === undefined
    ? undefined
    : { ...core, source: "design", decision, verdict };
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

// keep : each finding the verify pass did not dismiss, settled by its verdict (finding.ts settle): a finding it gave
// no verdict, or a verdict that raises the grade, is kept as consider, never dropped. Pure.
export function keep(findings: readonly DesignFinding[], verdicts: readonly Verdict[]): readonly Kept[] {
  const kept = (f: DesignFinding): Kept => {
    const settled = settle(
      f,
      verdicts.find((x) => x.id === f.id),
    );
    return { ...settled, why: clip(settled.why) };
  };
  return findings.map(kept).filter((k) => k.bucket !== "dismissed");
}

// keptLine : one kept finding as a person reads it in a post or a log line. Pure.
export function keptLine(k: Kept): string {
  const where = k.file === "" ? "" : ` ${k.file}:${k.line}`;
  return `${k.id} ${k.verdict} (${k.bucket.replace("_", " ")}, ${k.grade})${where}: ${k.finding}`;
}
