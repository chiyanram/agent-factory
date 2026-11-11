import { describe, expect, it } from "vitest";
import { DESIGN_SCHEMA, keep, readDesignFindings, type DesignFinding } from "../src/core/design/findings.js";
import { readVerdicts, settle, VERIFY_SCHEMA, type FindingCore } from "../src/core/finding.js";
import { FIND_SCHEMA } from "../src/core/review/verdicts.js";

const CORE: FindingCore = {
  id: "F1",
  file: "src/a.ts",
  line: 3,
  rule: "correctness",
  severity: "warning",
  grade: "walked",
  finding: "two writers race on the lock file",
  fix: "take the lock first",
};

describe("one Finding record for the finder and the design-reviewer (ADR-0017, #425)", () => {
  it("asks both roles for the same core fields", () => {
    const core = ["id", "file", "line", "rule", "severity", "grade", "finding", "fix"];
    for (const schema of [FIND_SCHEMA, DESIGN_SCHEMA]) {
      const item = JSON.parse(schema).properties.findings.items;
      expect(item.required).toEqual(expect.arrayContaining(core));
    }
  });

  it("stamps the design-reviewer's findings with their source, never the model's word for it", () => {
    const raw = { ...CORE, source: "review", decision: "one table", verdict: "conflict" };
    const read = readDesignFindings({ findings: [raw] });
    expect(read.kind === "ok" && read.value[0]?.source).toBe("design");
  });
});

describe("the verify pass sets the final severity and grade, lower only (ADR-0017, #425)", () => {
  it("lowers the severity and the grade when the verdict says so", () => {
    const v = { id: "F1", bucket: "consider", why: "only cited", severity: "nit", grade: "cited" } as const;
    expect(settle(CORE, v)).toEqual({
      ...CORE,
      severity: "nit",
      grade: "cited",
      bucket: "consider",
      why: "only cited",
    });
  });

  it("keeps the finder's own when the verdict gives neither", () => {
    expect(settle(CORE, { id: "F1", bucket: "act_on", why: "it holds" })).toEqual({
      ...CORE,
      bucket: "act_on",
      why: "it holds",
    });
  });

  it("refuses a verdict that raises the severity or the grade: the finding is Consider, with the finder's own", () => {
    const raised = [
      { severity: "blocker", said: "the severity to blocker" },
      { grade: "ran", said: "the grade to ran" },
    ] as const;
    for (const { said, ...up } of raised) {
      expect(settle(CORE, { id: "F1", bucket: "act_on", why: "it holds", ...up })).toEqual({
        ...CORE,
        bucket: "consider",
        why: `the verify pass raised ${said}, which it may not; its verdict is refused`,
      });
    }
  });

  // AC-3 of #485 (P15: a blocking finding needs proof; rulebook RV7)
  it("settles an Act on finding graded only cited as Consider, whether the finder or the verify pass graded it", () => {
    const why = "it holds (Consider, not Act on: the finding only cites the line)";
    const cited = { ...CORE, grade: "cited" } as const;
    expect(settle(cited, { id: "F1", bucket: "act_on", why: "it holds" })).toEqual({
      ...cited,
      bucket: "consider",
      why,
    });
    expect(settle(CORE, { id: "F1", bucket: "act_on", why: "it holds", grade: "cited" })).toEqual({
      ...cited,
      bucket: "consider",
      why,
    });
  });

  it("keeps an Act on finding that was walked through or run, and a cited one in any other bucket", () => {
    expect(settle({ ...CORE, grade: "ran" }, { id: "F1", bucket: "act_on", why: "w" }).bucket).toBe("act_on");
    expect(settle(CORE, { id: "F1", bucket: "act_on", why: "w" }).bucket).toBe("act_on");
    expect(settle({ ...CORE, grade: "cited" }, { id: "F1", bucket: "noted", why: "w" }).bucket).toBe("noted");
  });

  it("refuses it in the design review too", () => {
    const f: DesignFinding = { ...CORE, id: "D1", source: "design", decision: "one table", verdict: "conflict" };
    const [kept] = keep([f], [{ id: "D1", bucket: "act_on", why: "it holds", grade: "ran" }]);
    expect(kept).toMatchObject({ bucket: "consider", grade: "walked" });
  });

  it("reads a verdict's severity and grade, and fails the pass on one that is not a severity or a grade", () => {
    const ok = readVerdicts({ verdicts: [{ id: "F1", bucket: "noted", why: "w", severity: "nit" }] });
    expect(ok).toEqual({ kind: "ok", value: [{ id: "F1", bucket: "noted", why: "w", severity: "nit" }] });
    expect(readVerdicts({ verdicts: [{ id: "F1", bucket: "noted", why: "w", grade: "guessed" }] }).kind).toBe("failed");
  });

  it("asks the verify pass for an optional severity and grade", () => {
    const item = JSON.parse(VERIFY_SCHEMA).properties.verdicts.items;
    expect(item.required).toEqual(["id", "bucket", "why"]);
    expect(Object.keys(item.properties)).toEqual(["id", "bucket", "why", "severity", "grade"]);
  });
});
