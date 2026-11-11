// results — one eval pass as evals/reviewer/results/<date>-<sha>.json (ADR-0015 E2, E10, E11; #215): recall of the
// seeds in Act on, overall, per category and per severity; the clean-floor hits (any Act on finding on a case whose
// golden.json is []); what the pass spent; and the inputs it ran with, by SHA, so a CI check can match them with a PR's
// head. A partial pass (stopped at the cap, or a run that failed) and a pass with draft cases are never proof.

import { createHash } from "node:crypto";
import type { ActOn } from "../review/act-on.js";
import type { Case } from "./cases.js";
import { CATEGORIES, SEVERITIES, type Row } from "./golden.js";
import type { SeedResult } from "./judge.js";

export type RunRecord = {
  readonly run: number;
  // posted, or what the round did instead, or failed
  readonly outcome: string;
  readonly error: string;
  readonly cost_usd: number;
  readonly act_on: readonly ActOn[];
  readonly seeds: readonly SeedResult[];
};

export type CaseRecord = { readonly case: Case; readonly error: string; readonly runs: readonly RunRecord[] };

export type Tally = { readonly found: number; readonly of: number; readonly recall: number | null };

export type Inputs = {
  // the commit of this repository the pass ran at
  readonly head: string;
  readonly models: Readonly<Record<"find" | "rule" | "logic" | "judge", string>>;
  // git blob SHAs of the instructions each run read, as `git rev-parse <commit>:<path>` prints them
  readonly prompts: Readonly<Record<"find" | "verify" | "judge", string>>;
  // the rulebook checkout's commit, or "unknown"
  readonly rulebook: string;
};

export type Pass = {
  readonly date: string;
  readonly inputs: Inputs;
  readonly runs: number;
  readonly cap: number;
  readonly spent: number;
  readonly stopped: string;
  readonly drafts: boolean;
  readonly skipped: readonly Row[];
  readonly cases: readonly CaseRecord[];
};

// blobSha : the SHA git gives a file's content (git hash-object). Pure.
export function blobSha(content: Buffer): string {
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${content.length}\0`), content]))
    .digest("hex");
}

type Hit = { readonly found: boolean; readonly category: string; readonly severity: string };

// hits : one entry per seed per run that ran. Pure.
function hits(cases: readonly CaseRecord[]): readonly Hit[] {
  return cases.flatMap((c) =>
    c.runs.flatMap((r) =>
      c.case.golden.map((g, i) => ({
        found: r.seeds.some((s) => s.seed === i && s.matched),
        category: g.category,
        severity: g.severity,
      })),
    ),
  );
}

function tally(list: readonly Hit[]): Tally {
  const found = list.filter((h) => h.found).length;
  return { found, of: list.length, recall: list.length === 0 ? null : found / list.length };
}

function by(list: readonly Hit[], names: readonly string[], key: "category" | "severity"): Record<string, Tally> {
  return Object.fromEntries(
    names.filter((n) => list.some((h) => h[key] === n)).map((n) => [n, tally(list.filter((h) => h[key] === n))]),
  );
}

// recall : recall@act_on, overall, per category and per severity (#218: a finding carries both). A found-by-eval case
// was chosen because this reviewer found its bug, so the overall is also given without those cases (P11: cases it was
// not tuned on). Pure.
export function recall(cases: readonly CaseRecord[]): {
  readonly overall: Tally;
  readonly overall_without_found_by_eval: Tally;
  readonly by_category: Record<string, Tally>;
  readonly by_severity: Record<string, Tally>;
} {
  const list = hits(cases);
  return {
    overall: tally(list),
    overall_without_found_by_eval: tally(hits(cases.filter((c) => c.case.kind !== "found-by-eval"))),
    by_category: by(list, CATEGORIES, "category"),
    by_severity: by(list, SEVERITIES, "severity"),
  };
}

// cleanFloor : every Act on finding on a clean case; the floor is 0 (ADR-0015 E2). Pure.
export function cleanFloor(cases: readonly CaseRecord[]): {
  readonly hits: number;
  readonly findings: readonly (ActOn & { readonly case: string; readonly run: number })[];
} {
  const findings = cases
    .filter((c) => c.case.golden.length === 0)
    .flatMap((c) => c.runs.flatMap((r) => r.act_on.map((f) => ({ case: c.case.name, run: r.run, ...f }))));
  return { hits: findings.length, findings };
}

// partialWhy : why a pass is partial: the cap, a case that could not be set up, a run that failed. Pure.
export function partialWhy(p: Pass): readonly string[] {
  const failed = p.cases.flatMap((c) => [
    ...(c.error === "" ? [] : [`${c.case.name}: ${c.error}`]),
    ...c.runs.filter((r) => r.error !== "").map((r) => `${c.case.name} run ${r.run}: ${r.error}`),
  ]);
  const short = p.cases.filter((c) => c.error === "" && c.runs.length < p.runs).length;
  const missing =
    p.stopped === "" ? [] : [p.stopped, ...(short > 0 ? [`${short} case(s) ran fewer than ${p.runs} runs`] : [])];
  return [...missing, ...failed];
}

function caseEntry(c: CaseRecord): Record<string, unknown> {
  return {
    case: c.case.name,
    kind: c.case.kind,
    status: c.case.status,
    seeds: c.case.golden.length,
    error: c.error,
    runs: c.runs,
  };
}

// document : the results file's JSON. Pure.
export function document(p: Pass): Record<string, unknown> {
  const why = partialWhy(p);
  const ran = p.cases.map((c) => c.case.name);
  return {
    version: 1,
    date: p.date,
    head: p.inputs.head,
    partial: why.length > 0,
    partial_why: why,
    drafts_included: p.drafts && p.cases.some((c) => c.case.status === "draft"),
    proof: why.length === 0 && !p.cases.some((c) => c.case.status === "draft"),
    cap_usd: p.cap,
    cost_usd: Math.round(p.spent * 10_000) / 10_000,
    runs_per_case: p.runs,
    inputs: p.inputs,
    cases: { ran, skipped: p.skipped.map((r) => ({ case: r.name, status: r.status })) },
    recall_at_act_on: recall(p.cases),
    clean_floor: cleanFloor(p.cases),
    per_case: p.cases.map(caseEntry),
  };
}
