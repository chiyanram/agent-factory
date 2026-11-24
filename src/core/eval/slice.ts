// slice — the targeted review pass a pin move that touches the review needs (ADR-0020): a fixed slice of the golden
// set, one run each, held to the baseline on the same cases. The slice is every approved case with no seed (the clean
// floor), then, in cases.md order, each approved case with a seed of a category no earlier case in the slice has. The
// bar is hold only, with no aim: the seeds found are not fewer than the baseline's lowest single run over the same
// cases, and the clean floor has 0 hits. The typical cost is the baseline's mean cost per case-run times the runs; the
// worst case is every run at its cap (budget.ts). **Today:** no held-out slice runs with it; #599 adds one.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../forge/api.js";
import { field } from "./bar.js";
import { CAP_USD, dollars, worstCase } from "./budget.js";
import { CASES_DIR, choose, readCase, readRows, type Case } from "./cases.js";

export const SLICE_RUNS = 1;

export function sliceOf(approved: readonly Case[]): readonly Case[] {
  const clean = approved.filter((c) => c.golden.length === 0);
  const seen = new Set<string>();
  const seeded = approved.filter((c) => {
    const fresh = c.golden.some((g) => !seen.has(g.category));
    if (fresh) {
      for (const g of c.golden) {
        seen.add(g.category);
      }
    }
    return fresh;
  });
  return [...clean, ...seeded];
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function floorOf(baseline: unknown, slice: readonly Case[]): Result<number> {
  const perCase = list(field(baseline, "per_case"));
  const seeded = slice.filter((c) => c.golden.length > 0);
  const runsOf = (name: string): readonly unknown[] =>
    list(field(perCase.find((c) => field(c, "case") === name) ?? {}, "runs"));
  const missing = seeded.filter((c) => runsOf(c.name).length === 0).map((c) => c.name);
  if (missing.length > 0) {
    return { kind: "failed", reason: `the baseline has no runs of ${missing.join(", ")}` };
  }
  const numbers = [...new Set(seeded.flatMap((c) => runsOf(c.name).map((r) => field(r, "run"))))];
  const totals = numbers.map((n) =>
    seeded.reduce((sum, c) => {
      const run = runsOf(c.name).find((r) => field(r, "run") === n);
      return sum + list(field(run, "seeds")).filter((s) => field(s, "matched") === true).length;
    }, 0),
  );
  return { kind: "ok", value: totals.length === 0 ? 0 : Math.min(...totals) };
}

function partialProblems(pass: unknown): readonly string[] {
  const why = list(field(pass, "partial_why")).map(String);
  return [
    ...(field(pass, "partial") === false ? [] : [`it is partial, never proof: ${why.join("; ") || "no reason given"}`]),
    ...(field(pass, "proof") === true ? [] : ["it is not proof"]),
  ];
}

function holdProblems(pass: unknown, floor: number): readonly string[] {
  const found = field(field(field(pass, "recall_at_act_on"), "overall"), "found");
  const hits = field(field(pass, "clean_floor"), "hits");
  const below = typeof found !== "number" || found < floor;
  return [
    ...(hits === 0 ? [] : [`it has ${String(hits)} clean-floor hit(s); the floor is 0`]),
    ...(below
      ? [`it found ${String(found)} seed(s), below the baseline's lowest single run on the same cases (${floor})`]
      : []),
  ];
}

export function sliceProblems(pass: unknown, floor: number): readonly string[] {
  return [...partialProblems(pass), ...holdProblems(pass, floor)];
}

export type Estimate = {
  readonly cases: readonly string[];
  readonly runs: number;
  readonly typical: number;
  readonly worst: number;
};

export type Planned = { readonly slice: readonly Case[]; readonly floor: number; readonly estimate: Estimate };

function perRun(baseline: unknown): number {
  const usd = Number(field(baseline, "cost_usd"));
  const runs = list(field(baseline, "per_case")).flatMap((c) => list(field(c, "runs"))).length;
  return runs > 0 && Number.isFinite(usd) ? usd / runs : 0;
}

async function approvedCases(root: string): Promise<Result<readonly Case[]>> {
  const rows = await readRows(root);
  if (rows.kind === "failed") {
    return rows;
  }
  const out: Case[] = [];
  for (const row of choose(rows.value, false).run) {
    const c = await readCase(root, row);
    if (c.kind === "failed") {
      return c;
    }
    out.push(c.value);
  }
  return { kind: "ok", value: out };
}

export const BASELINE_FILE = join(CASES_DIR, "baseline.json");

async function readBaseline(root: string): Promise<unknown> {
  const text = await readFile(join(root, BASELINE_FILE), "utf8").catch(() => "");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function planSlice(input: {
  readonly root: string;
  readonly runUsd: string;
  readonly judgeUsd: string;
}): Promise<Result<Planned>> {
  const baseline = await readBaseline(input.root);
  if (baseline === undefined) {
    return { kind: "failed", reason: `no readable ${BASELINE_FILE} in ${input.root} to plan the pass by` };
  }
  const approved = await approvedCases(input.root);
  if (approved.kind === "failed") {
    return approved;
  }
  const slice = sliceOf(approved.value);
  const floor = floorOf(baseline, slice);
  if (floor.kind === "failed") {
    return floor;
  }
  const plan = {
    seeds: slice.map((c) => c.golden.length),
    runs: SLICE_RUNS,
    runUsd: dollars(input.runUsd),
    judgeUsd: dollars(input.judgeUsd),
  };
  const estimate = {
    cases: slice.map((c) => c.name),
    runs: slice.length * SLICE_RUNS,
    typical: Math.round(perRun(baseline) * slice.length * SLICE_RUNS * 100) / 100,
    worst: Math.round(worstCase(plan) * 100) / 100,
  };
  return { kind: "ok", value: { slice, floor: floor.value, estimate } };
}

export function estimateLines(e: Estimate): readonly string[] {
  const over = e.worst > CAP_USD ? `; over the $${CAP_USD} cap, so it may stop there, partial and never proof` : "";
  return [
    `targeted review pass: ${e.cases.length} case(s), ${SLICE_RUNS} run each: ${e.cases.join(", ")}`,
    `cost: about $${e.typical.toFixed(2)} (the baseline's mean per case-run × ${e.runs} runs); at most $${e.worst.toFixed(2)} (every run at its cap)${over}`,
  ];
}
