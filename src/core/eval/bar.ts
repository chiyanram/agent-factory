// bar — the bar a change to the factory must pass to be kept (ADR-0021, P11): no worse than the baseline on what it
// must hold, and better by more than the noise on what it aims at, quality or cost. The noise is the spread of the
// baseline's own repeat runs (per_case): the most seeds one run matched less the fewest, never under one seed; and for
// cost, the spread of a run's cost times the runs. Recall is compared in whole numbers by cross-multiplying, never as
// rounded floats, so a pass exactly on the line does not beat it. scripts/check-eval-proof.ts applies it; the harness
// records a pass's aim. Cost is compared in whole hundredths of a cent, for the same reason, and only between passes
// over the same cases. A leaf with no runtime imports, so the script loads it on Node's type stripping. Pure.

import type { Tally } from "./results.js";

// field : one property of a parsed JSON value, or undefined
export function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? (Reflect.get(value, name) as unknown) : undefined;
}

// what a change aims at (ADR-0021 N4)
export type Aim = "quality" | "cost";
export const AIMS: readonly Aim[] = ["quality", "cost"];

// a pass's recall@act_on as counts: the seed-runs it matched, of all its seed-runs (results.ts writes them)
export type Counts = Pick<Tally, "found" | "of">;

// the noise: `spread` seeds of the `seeds` one run holds; and the cost spread of a run times the `runs`
export type Noise = { readonly seeds: number; readonly runs: number; readonly spread: number; readonly usd: number };

// the baseline, as the bar reads it; cases are the names it ran, sorted
export type Baseline = {
  readonly recall: Counts;
  readonly usd: number;
  readonly noise: Noise;
  readonly cases: readonly string[];
};

function count(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
}

// countsOf : recall_at_act_on.overall's found and of, or undefined when they are not counts. Pure.
export function countsOf(value: unknown): Counts | undefined {
  const overall = field(field(value, "recall_at_act_on"), "overall");
  const found = count(field(overall, "found"));
  const of = count(field(overall, "of"));
  return found === undefined || of === undefined || of === 0 || found > of ? undefined : { found, of };
}

type RunTotal = { readonly matched: number; readonly seeds: number; readonly usd: number };

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

// runTotal : one run number's matched seeds, seeds and cost, summed over the cases. Pure.
function runTotal(perCase: readonly unknown[], n: unknown): RunTotal {
  const runs = perCase.flatMap((c) => list(field(c, "runs")).filter((r) => field(r, "run") === n));
  const seeds = runs.flatMap((r) => list(field(r, "seeds")));
  const usd = runs.reduce((sum: number, r) => sum + (Number(field(r, "cost_usd")) || 0), 0);
  return { matched: seeds.filter((x) => field(x, "matched") === true).length, seeds: seeds.length, usd };
}

// spreadOf : the largest less the smallest. Pure.
function spreadOf(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

// comparable : two or more runs, each holding the same number of seeds, and some. Pure.
function comparable(totals: readonly RunTotal[]): boolean {
  const seeds = new Set(totals.map((t) => t.seeds));
  return totals.length >= 2 && seeds.size === 1 && !seeds.has(0);
}

// noiseOf : the spread of a baseline's repeat runs (ADR-0021), or undefined when its per_case holds fewer than two
// runs with seeds, or runs that hold different numbers of seeds (a run that lost a seed's result; a proof pass has
// none), whose matched counts could not be compared. Pure.
export function noiseOf(baseline: unknown): Noise | undefined {
  const perCase = list(field(baseline, "per_case"));
  const numbers = new Set(perCase.flatMap((c) => list(field(c, "runs")).map((r) => field(r, "run"))));
  const totals = [...numbers].map((n) => runTotal(perCase, n));
  if (!comparable(totals)) {
    return undefined;
  }
  return {
    seeds: totals[0]?.seeds ?? 0,
    runs: totals.length,
    spread: Math.max(1, spreadOf(totals.map((t) => t.matched))),
    usd: Math.round(spreadOf(totals.map((t) => t.usd)) * totals.length * 10_000) / 10_000,
  };
}

// baselineOf : the baseline's recall, cost and noise, or what it lacks. Pure.
export function baselineOf(value: unknown): Baseline | string {
  const recall = countsOf(value);
  const noise = noiseOf(value);
  const usd = field(value, "cost_usd");
  if (recall === undefined) {
    return "has no recall_at_act_on.overall found and of";
  }
  if (noise === undefined) {
    return "has no per_case of two or more runs, each holding the same seeds, to measure the noise by (ADR-0021)";
  }
  return typeof usd === "number" ? { recall, usd, noise, cases: casesOf(value) } : "has no cost_usd";
}

// beats : whether found/of is past the baseline's recall moved by the noise, up (1) or down (-1), compared in whole
// numbers by cross-multiplying, so a pass exactly on the line is not past it. Pure.
function beats(c: Counts, b: Baseline, sign: 1 | -1): boolean {
  const mine = c.found * b.recall.of * b.noise.seeds;
  const line = (b.recall.found * b.noise.seeds + sign * b.noise.spread * b.recall.of) * c.of;
  return sign === 1 ? mine > line : mine >= line;
}

function shown(c: Counts): string {
  return `${c.found}/${c.of}`;
}

// holdProblems : why a pass does not hold the baseline: recall below it by more than the noise (ADR-0021). Pure.
export function holdProblems(value: unknown, b: Baseline): readonly string[] {
  const c = countsOf(value);
  return c === undefined || beats(c, b, -1)
    ? []
    : [
        `recall@act_on ${shown(c)} is below the baseline's ${shown(b.recall)} by more than the noise ${b.noise.spread}/${b.noise.seeds} (ADR-0021)`,
      ];
}

// qualityProblems : why a pass that aims at quality is not above the baseline's recall plus the noise. Pure.
function qualityProblems(value: unknown, b: Baseline): readonly string[] {
  const c = countsOf(value);
  return c === undefined || beats(c, b, 1)
    ? []
    : [
        `it aims at quality, and recall@act_on ${shown(c)} is not above the baseline's ${shown(b.recall)} plus the noise ${b.noise.spread}/${b.noise.seeds} (ADR-0021)`,
      ];
}

// casesOf : the names of the cases a pass ran, sorted. Pure.
function casesOf(value: unknown): readonly string[] {
  return list(field(field(value, "cases"), "ran"))
    .map(String)
    .toSorted();
}

// tenThousandths : dollars in whole hundredths of a cent, the results file's own rounding. Pure.
function tenThousandths(usd: number): number {
  return Math.round(usd * 10_000);
}

// costProblems : why a pass that aims at cost does not cost less than the baseline less the noise, over the same
// cases: a pass over fewer cases is cheaper without being better. Pure.
function costProblems(value: unknown, b: Baseline): readonly string[] {
  const usd = field(value, "cost_usd");
  if (casesOf(value).join("\n") !== b.cases.join("\n")) {
    return [
      "it aims at cost, and it ran other cases than the baseline: compare cost over the baseline's cases (ADR-0021)",
    ];
  }
  return typeof usd === "number" && tenThousandths(usd) < tenThousandths(b.usd) - tenThousandths(b.noise.usd)
    ? []
    : [
        `it aims at cost, and $${String(usd)} is not below the baseline's $${b.usd} less the noise $${b.noise.usd} (ADR-0021)`,
      ];
}

// aimProblems : why a pass does not beat the baseline by more than the noise on what it aims at (ADR-0021). Pure.
export function aimProblems(value: unknown, b: Baseline): readonly string[] {
  const aim = field(value, "aim");
  if (!AIMS.some((a) => a === aim)) {
    return ["it says no aim: run agent-factory eval reviewer with --aim quality or --aim cost (ADR-0021)"];
  }
  return aim === "quality" ? qualityProblems(value, b) : costProblems(value, b);
}
