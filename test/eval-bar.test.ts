// bar (ADR-0021, P11): the noise read from a baseline's own repeat runs, and the two-part bar a change must pass, on the
// recorded baseline and on planted ones.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aimProblems, baselineOf, field, holdProblems, noiseOf, type Baseline } from "../src/core/eval/bar.js";

const recorded: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "evals/reviewer/baseline.json"), "utf8"),
);

// a baseline of one case with `seeds` seeds, each run matching the given count at the given cost
function planted(matched: readonly number[], usd: readonly number[], seeds = 5): Record<string, unknown> {
  const runs = matched.map((m, i) => ({
    run: i + 1,
    cost_usd: usd[i],
    seeds: Array.from({ length: seeds }, (_, k) => ({ seed: k, matched: k < m })),
  }));
  const found = matched.reduce((a, b) => a + b, 0);
  return {
    cost_usd: usd.reduce((a, b) => a + b, 0),
    recall_at_act_on: { overall: { found, of: seeds * matched.length, recall: found / (seeds * matched.length) } },
    per_case: [
      { case: "c", seeds, runs },
      { case: "clean", seeds: 0, runs: [{ run: 1, cost_usd: 0, seeds: [] }] },
    ],
  };
}

const listed = field(field(recorded, "cases"), "ran");
const RAN: readonly string[] = Array.isArray(listed) ? listed.map(String) : [];

// a results document cut to what the bar reads, over the recorded baseline's cases
const result = (found: number, of: number, aim: unknown = "quality", usd = 30, ran: readonly string[] = RAN) => ({
  aim,
  cost_usd: usd,
  cases: { ran: ran.toReversed() },
  recall_at_act_on: { overall: { found, of } },
});

function base(): Baseline {
  const b = baselineOf(recorded);
  if (typeof b === "string") throw new Error(b);
  return b;
}

describe("the noise (ADR-0021)", () => {
  it("is one seed of 24, and $3.0222 a pass, on the recorded baseline: runs of 17, 16 and 17 of 24", () => {
    expect(noiseOf(recorded)).toEqual({ seeds: 24, runs: 3, spread: 1, usd: 3.0222 });
    expect(base()).toMatchObject({ recall: { found: 50, of: 72 }, usd: 41.2381 });
  });

  it("is the most seeds one run matched less the fewest, never under one seed; cost is its spread times the runs", () => {
    expect(noiseOf(planted([1, 4, 2], [3, 3.5, 4]))).toEqual({ seeds: 5, runs: 3, spread: 3, usd: 3 });
    expect(noiseOf(planted([3, 3], [2, 2]))).toEqual({ seeds: 5, runs: 2, spread: 1, usd: 0 });
  });

  it("cannot be measured from fewer than two runs with seeds, and a baseline without it is named", () => {
    expect(noiseOf(planted([3], [2]))).toBeUndefined();
    expect(noiseOf({})).toBeUndefined();
    expect(baselineOf(planted([3], [2]))).toBe(
      "has no per_case of two or more runs, each holding the same seeds, to measure the noise by (ADR-0021)",
    );
    expect(baselineOf({})).toBe("has no recall_at_act_on.overall found and of");
    const over = planted([3, 3], [2, 2]);
    expect(baselineOf({ ...over, recall_at_act_on: { overall: { found: 11, of: 10 } } })).toBe(
      "has no recall_at_act_on.overall found and of",
    );
    // runs that hold different numbers of seeds cannot be compared by their matched counts
    const sized = (n: number, seeds: number) => ({
      run: n,
      cost_usd: 2,
      seeds: Array.from({ length: seeds }, () => ({ matched: true })),
    });
    expect(noiseOf({ per_case: [{ case: "c", seeds: 5, runs: [sized(1, 5), sized(2, 4)] }] })).toBeUndefined();
    expect(noiseOf({ per_case: [{ case: "c", seeds: 5, runs: [sized(1, 5), sized(2, 5)] }] })).toMatchObject({
      spread: 1,
    });
    // runs with no seed at all, as in a set of clean cases only, have nothing to measure by
    expect(noiseOf({ per_case: [{ case: "clean", seeds: 0, runs: [sized(1, 0), sized(2, 0)] }] })).toBeUndefined();
    // a clean case's second run holds no seed, so it is no second run to measure by
    const clean = { case: "clean", seeds: 0, runs: [1, 2].map((run) => ({ run, cost_usd: 1, seeds: [] })) };
    expect(
      noiseOf({
        per_case: [{ case: "c", seeds: 5, runs: [{ run: 1, cost_usd: 2, seeds: [{ matched: true }] }] }, clean],
      }),
    ).toBeUndefined();
    expect(baselineOf({ ...planted([3, 3], [2, 2]), cost_usd: "x" })).toBe("has no cost_usd");
  });
});

describe("the bar (ADR-0021)", () => {
  it("holds a pass down to the baseline's recall less the noise: 47 of 72 holds, 46 does not", () => {
    expect(holdProblems(result(47, 72), base())).toEqual([]);
    expect(holdProblems(result(46, 72), base())).toEqual([
      "recall@act_on 46/72 is below the baseline's 50/72 by more than the noise 1/24 (ADR-0021)",
    ]);
  });

  it("keeps a quality change only above the baseline's recall plus the noise: 53 of 72 is on the line, 54 beats it", () => {
    expect(aimProblems(result(53, 72), base())).toEqual([
      "it aims at quality, and recall@act_on 53/72 is not above the baseline's 50/72 plus the noise 1/24 (ADR-0021)",
    ]);
    expect(aimProblems(result(54, 72), base())).toEqual([]);
  });

  it("compares in counts when a lesson adds cases: 60 of 81 beats 53/72, 59 of 81 does not", () => {
    expect(aimProblems(result(60, 81), base())).toEqual([]);
    expect(aimProblems(result(59, 81), base())).toHaveLength(1);
  });

  it("keeps a cost change only under the baseline's cost less the noise, $38.2159 today, over the same cases", () => {
    expect(aimProblems(result(50, 72, "cost", 38.2158), base())).toEqual([]);
    // on the line, which a float subtraction (41.2381 - 3.0222 = 38.215900000000005) would let through
    expect(aimProblems(result(50, 72, "cost", 38.2159), base())).toHaveLength(1);
    expect(aimProblems(result(40, 60, "cost", 30, RAN.slice(1)), base())).toEqual([
      "it aims at cost, and it ran other cases than the baseline: compare cost over the baseline's cases (ADR-0021)",
    ]);
    expect(aimProblems(result(50, 72, "cost", 38.22), base())).toEqual([
      "it aims at cost, and $38.22 is not below the baseline's $41.2381 less the noise $3.0222 (ADR-0021)",
    ]);
  });

  it("refuses a pass that says no aim", () => {
    for (const said of [{}, { aim: null }, { aim: "speed" }]) {
      expect(aimProblems({ ...result(60, 72), aim: undefined, ...said }, base())).toEqual([
        "it says no aim: run agent-factory eval reviewer with --aim quality or --aim cost (ADR-0021)",
      ]);
    }
  });
});
