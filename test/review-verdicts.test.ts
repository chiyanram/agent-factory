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
  grade: "walked",
  evidence: "two runs both reach write() before either takes the lock",
  finding: "two writers race on the lock file",
  fix: "take the lock first",
};

describe("readFindings (#218: a category, and the severity kept)", () => {
  it("reads each finding's category and severity", () => {
    expect(readFindings({ findings: [RAW] }, "correctness")).toEqual({
      kind: "ok",
      value: [{ ...RAW, id: "F1", lens: "correctness", file: "src/a.ts" }],
    });
  });

  it("fails the pass on a finding with no category, or one that is not a Martian category", () => {
    const { category: _, ...none } = RAW;
    for (const bad of [none, { ...RAW, category: "logic" }]) {
      expect(readFindings({ findings: [bad] }, "correctness")).toEqual({
        kind: "failed",
        reason: "the find pass gave a finding that is not well formed",
      });
    }
  });

  it("still fails the pass on a finding with no severity", () => {
    const { severity: _, ...none } = RAW;
    expect(readFindings({ findings: [none] }, "correctness").kind).toBe("failed");
  });

  it("asks the model for both, the category from the eval's own list", () => {
    const item = JSON.parse(FIND_SCHEMA).properties.findings.items;
    expect(item.required).toEqual(expect.arrayContaining(["category", "severity"]));
    expect(item.properties.category.enum).toEqual([...CATEGORIES]);
    expect(item.properties.severity.enum).toEqual(["blocker", "warning", "nit"]);
  });
});

describe("readFindings: the design's finding contract (#237)", () => {
  it("stamps the lens of the finder run, never the model's word for it", () => {
    const read = readFindings({ findings: [{ ...RAW, lens: "security" }] }, "correctness");
    expect(read.kind === "ok" && read.value[0]?.lens).toBe("correctness");
  });

  it("fails the run on a finding with no grade, a grade that is not cited, walked or ran, or no evidence", () => {
    const { grade: _, ...noGrade } = RAW;
    const { evidence: __, ...noEvidence } = RAW;
    for (const bad of [noGrade, { ...RAW, grade: "guessed" }, noEvidence]) {
      expect(readFindings({ findings: [bad] }, "correctness").kind).toBe("failed");
    }
  });

  it("asks the model for the grade and the evidence, and not for the lens", () => {
    const item = JSON.parse(FIND_SCHEMA).properties.findings.items;
    expect(item.required).toEqual(expect.arrayContaining(["axis", "kind", "category", "grade", "evidence"]));
    expect(item.required).not.toContain("lens");
    expect(item.properties.grade.enum).toEqual(["cited", "walked", "ran"]);
  });
});
