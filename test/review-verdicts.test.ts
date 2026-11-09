import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../src/core/eval/golden.js";
import { FIND_SCHEMA, readFindings } from "../src/core/review/verdicts.js";

const RAW = {
  id: "x",
  axis: "standards",
  kind: "logic",
  file: "code/src/a.ts",
  line: 3,
  rule: "correctness",
  category: "concurrency",
  severity: "warning",
  finding: "two writers race on the lock file",
  fix: "take the lock first",
};

describe("readFindings (#218: a category, and the severity kept)", () => {
  it("reads each finding's category and severity", () => {
    expect(readFindings({ findings: [RAW] })).toEqual({
      kind: "ok",
      value: [{ ...RAW, id: "F1", file: "src/a.ts" }],
    });
  });

  it("fails the pass on a finding with no category, or one that is not a Martian category", () => {
    const { category: _, ...none } = RAW;
    for (const bad of [none, { ...RAW, category: "logic" }]) {
      expect(readFindings({ findings: [bad] })).toEqual({
        kind: "failed",
        reason: "the find pass gave a finding that is not well formed",
      });
    }
  });

  it("still fails the pass on a finding with no severity", () => {
    const { severity: _, ...none } = RAW;
    expect(readFindings({ findings: [none] }).kind).toBe("failed");
  });

  it("asks the model for both, the category from the eval's own list", () => {
    const item = JSON.parse(FIND_SCHEMA).properties.findings.items;
    expect(item.required).toEqual(expect.arrayContaining(["category", "severity"]));
    expect(item.properties.category.enum).toEqual([...CATEGORIES]);
    expect(item.properties.severity.enum).toEqual(["blocker", "warning", "nit"]);
  });
});
