import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Case } from "../src/core/eval/cases.js";
import type { GoldenFinding } from "../src/core/eval/golden.js";
import { estimateLines, floorOf, planSlice, sliceOf, sliceProblems } from "../src/core/eval/slice.js";

const ROOT = join(import.meta.dirname, "..");

function c(name: string, categories: readonly GoldenFinding["category"][]): Case {
  const golden = categories.map((category) => ({
    file: "a.ts",
    line: 1,
    issue: "x",
    severity: "blocker" as const,
    category,
  }));
  const kind = categories.length === 0 ? "clean" : "seeded";
  return { name, kind, status: "approved", base: "", patch: "", golden, pr: "" };
}

const run = (n: number, matched: readonly boolean[]) => ({
  run: n,
  error: "",
  cost_usd: 0.5,
  seeds: matched.map((m, seed) => ({ seed, matched: m })),
});

describe("the targeted review pass", () => {
  it("takes every clean case, then the first case of each category in order", () => {
    const all = [c("s1", ["bug"]), c("k1", []), c("s2", ["bug", "security"]), c("s3", ["security"]), c("s4", ["data"])];
    expect(sliceOf(all).map((x) => x.name)).toEqual(["k1", "s1", "s2", "s4"]);
  });

  it("holds it to the baseline's lowest single run over the same cases", () => {
    const baseline = {
      per_case: [
        { case: "s1", runs: [run(1, [true]), run(2, [false]), run(3, [true])] },
        { case: "s2", runs: [run(1, [true, true]), run(2, [true, true]), run(3, [false, true])] },
        { case: "other", runs: [run(1, [false]), run(2, [false]), run(3, [false])] },
      ],
    };
    expect(floorOf(baseline, [c("s1", ["bug"]), c("s2", ["bug", "security"]), c("k1", [])])).toEqual({
      kind: "ok",
      value: 2,
    });
    expect(floorOf(baseline, [c("new", ["bug"])])).toEqual({
      kind: "failed",
      reason: "the baseline has no runs of new",
    });
  });

  it("holds only: proof, no clean-floor hit, and not below the floor", () => {
    const pass = (found: number, hits: number, partial = false) => ({
      partial,
      partial_why: partial ? ["stopped at the cap"] : [],
      proof: !partial,
      recall_at_act_on: { overall: { found, of: 9 } },
      clean_floor: { hits },
    });
    expect(sliceProblems(pass(5, 0), 5)).toEqual([]);
    expect(sliceProblems(pass(4, 0), 5)).toEqual([
      "it found 4 seed(s), below the baseline's lowest single run on the same cases (5)",
    ]);
    expect(sliceProblems(pass(9, 1), 5)).toEqual(["it has 1 clean-floor hit(s); the floor is 0"]);
    expect(sliceProblems(pass(9, 0, true), 5)).toEqual([
      "it is partial, never proof: stopped at the cap",
      "it is not proof",
    ]);
  });

  it("plans the slice of this repository's golden set from its baseline, with the cost shown before it runs", async () => {
    const planned = await planSlice({ root: ROOT, runUsd: "2", judgeUsd: "0.50" });
    if (planned.kind === "failed") {
      throw new Error(planned.reason);
    }
    const p = planned.value;
    expect(p.slice.filter((x) => x.golden.length === 0).length).toBeGreaterThan(0);
    expect(p.estimate.runs).toBe(p.slice.length);
    expect(p.estimate.typical).toBeGreaterThan(0);
    expect(p.estimate.worst).toBeGreaterThan(p.estimate.typical);
    expect(p.floor).toBeGreaterThan(0);
    const lines = estimateLines(p.estimate);
    expect(lines[0]).toMatch(/^targeted review pass: \d+ case\(s\), 1 run each: /);
    expect(lines[1]).toMatch(/^cost: about \$\d+\.\d\d \(the baseline's mean per case-run × \d+ runs\); at most \$/);
  });

  it("refuses to plan with no baseline", async () => {
    const planned = await planSlice({ root: join(ROOT, "src"), runUsd: "2", judgeUsd: "0.50" });
    expect(planned).toMatchObject({ kind: "failed", reason: expect.stringContaining("baseline.json") });
  });
});
