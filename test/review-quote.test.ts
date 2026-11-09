import { describe, expect, it } from "vitest";
import { quoteOf, type Finding } from "../src/core/review/verdicts.js";

const F: Finding = {
  id: "F1",
  axis: "spec",
  kind: "rule",
  file: "src/a.ts",
  line: 3,
  rule: "AC2",
  severity: "blocker",
  category: "bug",
  finding: "an empty order totals 1",
  fix: "return 0",
};
const CRITERIA = ["SPEC-AC1: total() returns the sum.", "SPEC-AC2: an empty order totals 0."];

describe("quoteOf: a Spec finding quotes its criterion from the approved spec (#219)", () => {
  it("quotes the line the rule AC<n> names, from the approved criteria and never from the model", () => {
    expect(quoteOf(F, CRITERIA)).toBe("2. SPEC-AC2: an empty order totals 0.");
    expect(quoteOf({ ...F, rule: " AC1 " }, CRITERIA)).toBe("1. SPEC-AC1: total() returns the sum.");
  });

  it("says so when the criterion is not in the approved spec, or there is no approved spec", () => {
    expect(quoteOf({ ...F, rule: "AC3" }, CRITERIA)).toBe("AC3 is not in the approved spec");
    expect(quoteOf(F, [])).toBe("AC2 is not in the approved spec");
  });

  it("quotes nothing for a Standards finding, or a rule that names no criterion", () => {
    expect(quoteOf({ ...F, axis: "standards" }, CRITERIA)).toBe("");
    for (const rule of ["approved-spec", "correctness", "AC", "AC0", "ACx", "AC2b"]) {
      expect(quoteOf({ ...F, rule }, CRITERIA)).toBe("");
    }
  });
});
