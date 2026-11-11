import { describe, expect, it } from "vitest";
import type { Case } from "../src/core/eval/cases.js";
import { recall, type CaseRecord } from "../src/core/eval/results.js";

const seed = { file: "a.ts", line: 1, issue: "x", severity: "blocker", category: "bug" } as const;

function record(name: string, kind: string, matched: boolean): CaseRecord {
  const c: Case = { name, kind, status: "approved", base: "0".repeat(40), patch: "", golden: [seed], pr: "" };
  const run = {
    run: 1,
    outcome: "posted",
    error: "",
    cost_usd: 0,
    act_on: [],
    seeds: [{ seed: 0, matched, by: matched ? "F1" : "", confidence: matched ? 0.9 : 0, error: "" }],
  };
  return { case: c, error: "", runs: [run] };
}

describe("recall", () => {
  it("reports the overall without found-by-eval cases too, since those were picked because the reviewer found them", () => {
    const r = recall([record("seeded-a", "seeded", false), record("found-b", "found-by-eval", true)]);
    expect(r.overall).toEqual({ found: 1, of: 2, recall: 0.5 });
    expect(r.overall_without_found_by_eval).toEqual({ found: 0, of: 1, recall: 0 });
  });
});
