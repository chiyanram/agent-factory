// results — one eval pass as evals/reviewer/results/<date>-<sha>.json (ADR-0015 E2, E10, E11; #215): recall of the
// seeds in Act on, overall, per category and per severity; the clean-floor hits (any Act on finding on a case whose
// golden.json is []); what the pass spent; and the inputs it ran with, by SHA, so a CI check can match them with a PR's
// head. A partial pass (stopped at the cap, or a run that failed) and a pass with draft cases are never proof.
//
// A found-by-eval case was chosen because this reviewer found its bug, so the overall recall is also given without
// those cases (P11).

import { createHash } from "node:crypto";
import type { ActOn } from "../review/act-on.js";
import type { Case } from "./cases.js";
import { CATEGORIES, SEVERITIES, type Row } from "./golden.js";
import type { SeedResult } from "./judge.js";
import { partialWhy, type Aim } from "./bar.js";

export type RunRecord = {
  readonly run: number;
  readonly outcome: string;
  readonly error: string;
  readonly cost_usd: number;
  readonly act_on: readonly ActOn[];
  readonly seeds: readonly SeedResult[];
};

export type CaseRecord = { readonly case: Case; readonly error: string; readonly runs: readonly RunRecord[] };

export type Tally = { readonly found: number; readonly of: number; readonly recall: number | null };

export type Inputs = {
  readonly head: string;
  readonly models: Readonly<Record<"find" | "rule" | "logic" | "judge", string>>;
  readonly prompts: Readonly<Record<"find" | "verify" | "judge", string>>;
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
  readonly aim: Aim | "none";
  readonly skipped: readonly Row[];
  readonly cases: readonly CaseRecord[];
};

export function blobSha(content: Buffer): string {
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${content.length}\0`), content]))
    .digest("hex");
}

type Hit = { readonly found: boolean; readonly category: string; readonly severity: string };

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

export function cleanFloor(cases: readonly CaseRecord[]): {
  readonly hits: number;
  readonly findings: readonly (ActOn & { readonly case: string; readonly run: number })[];
} {
  const findings = cases
    .filter((c) => c.case.golden.length === 0)
    .flatMap((c) => c.runs.flatMap((r) => r.act_on.map((f) => ({ case: c.case.name, run: r.run, ...f }))));
  return { hits: findings.length, findings };
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
    aim: p.aim === "none" ? null : p.aim,
    inputs: p.inputs,
    cases: { ran, skipped: p.skipped.map((r) => ({ case: r.name, status: r.status })) },
    recall_at_act_on: recall(p.cases),
    clean_floor: cleanFloor(p.cases),
    per_case: p.cases.map(caseEntry),
  };
}
