// verdicts — what the find pass found and how the verify pass sorted it (#22 Q1, Q2). Model output is data: every
// field is checked, ids are renumbered F1…Fn (so a verdict can never match two findings), and a "code/" path prefix is
// dropped (so a thread anchors). A finding the verify pass gives no verdict is kept as Consider, never dropped.
// Nothing here posts: the post template (#126) makes every field inert. Each finding carries a category, what it is
// (the Martian categories, ADR-0015 R2), and keeps its severity, how much it matters (decided on #218, 2026-11-09).
// A Spec finding names the acceptance criterion it fails as its rule, AC<n>; the round quotes that line from the
// approved spec, never from the model (#219).
// The finding contract is docs/DESIGN.md's (decided on #237, 2026-11-09): the finder gives its grade, cited, walked or
// ran, and the evidence behind it; the engine adds the lens, the one the finder run was for, never the model's word.
// The finding is ADR-0017's shared record (finding.ts): the core every finding has, and the review's own part here.
// The verify pass's verdict and its schema are shared with the design review, and live there too.

import { CATEGORIES, type Category } from "../eval/golden.js";
import {
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

export {
  GRADES,
  readVerdicts,
  VERIFY_SCHEMA,
  type Bucket,
  type Grade,
  type Severity,
  type Verdict,
} from "../finding.js";

export type Axis = "standards" | "spec";
export type Kind = "rule" | "logic";
export type { Category };

// a finder's finding: the shared core, and what the review adds: which lens found it (the engine's word), its axis,
// kind and category, and the evidence behind its grade
export type Finding = FindingCore & {
  readonly source: "review";
  readonly lens: string;
  readonly axis: Axis;
  readonly kind: Kind;
  readonly category: Category;
  readonly evidence: string;
};

export type Sorted = Finding & { readonly bucket: Bucket; readonly why: string };

const FINDING_SCHEMA = {
  type: "object",
  required: [...CORE_REQUIRED, "axis", "kind", "category", "evidence"],
  properties: {
    ...CORE_PROPERTIES,
    axis: { enum: ["standards", "spec"] },
    kind: { enum: ["rule", "logic"] },
    category: { enum: CATEGORIES },
    evidence: { type: "string" },
  },
};

export const FIND_SCHEMA = JSON.stringify({
  type: "object",
  required: ["findings"],
  properties: { findings: { type: "array", items: FINDING_SCHEMA } },
});

type Own = Pick<Finding, "axis" | "kind" | "category" | "evidence">;

// ownOf : the review's own part of one finding, or undefined when a field is missing or not what it should be. Pure.
function ownOf(raw: unknown): Own | undefined {
  const axis = oneOf(get(raw, "axis"), ["standards", "spec"] as const);
  const kind = oneOf(get(raw, "kind"), ["rule", "logic"] as const);
  const category = oneOf(get(raw, "category"), CATEGORIES);
  const evidence = get(raw, "evidence");
  return axis === undefined || kind === undefined || category === undefined || typeof evidence !== "string"
    ? undefined
    : { axis, kind, category, evidence };
}

function findingOf(raw: unknown, i: number, lens: string): Finding | undefined {
  const core = coreOf(raw, `F${i + 1}`, (t) => t);
  const own = ownOf(raw);
  return core === undefined || own === undefined ? undefined : { ...core, source: "review", lens, ...own };
}

// categoryNote : the first category no finding may have, named, so it is never read as another (#484). Pure.
function categoryNote(list: unknown): string {
  const all: readonly unknown[] = Array.isArray(list) ? list : [];
  const bad = all.map((raw) => get(raw, "category")).find((c) => c !== undefined && oneOf(c, CATEGORIES) === undefined);
  return bad === undefined ? "" : `: the category ${JSON.stringify(bad)} is not one of ${CATEGORIES.join(", ")}`;
}

// readFindings : one finder run's output, renumbered, each finding stamped with the lens the run was for; one malformed
// finding fails the run
export function readFindings(output: unknown, lens: string): Result<readonly Finding[]> {
  const list = get(output, "findings");
  const found = Array.isArray(list) ? list.map((raw, i) => findingOf(raw, i, lens)) : [undefined];
  const good = found.filter((f): f is Finding => f !== undefined);
  return good.length === found.length
    ? { kind: "ok", value: good }
    : { kind: "failed", reason: `the find pass gave a finding that is not well formed${categoryNote(list)}` };
}

// sortFindings : every finding in exactly one bucket, settled by its verdict (finding.ts settle)
export function sortFindings<F extends Finding>(
  findings: readonly F[],
  verdicts: readonly Verdict[],
): readonly (F & { readonly bucket: Bucket; readonly why: string })[] {
  return findings.map((f) =>
    settle(
      f,
      verdicts.find((x) => x.id === f.id),
    ),
  );
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
