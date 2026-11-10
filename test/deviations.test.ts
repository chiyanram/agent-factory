import { describe, expect, it } from "vitest";
import { deviationPost } from "../src/core/finish.js";
import { parseReport, REPORT_FIELDS } from "../src/core/report.js";
import { deviationNotes } from "../src/core/review/deviations.js";

const ROW = { criterion: "AC1", command: "make test", result: "1 passed" };
const DEVIATION = {
  what: "LoanQuery.page takes a Page record",
  why: "two ints were easy to swap",
  file: "src/LoanQuery.java",
  line: 14,
};
const done = (extra: object) => parseReport(JSON.stringify({ status: "done", evidence: [ROW], ...extra }));

describe("the build's deviations from the design (ADR-0018, #430)", () => {
  it("reads a done report's deviations, and none when it has none", () => {
    expect(done({ deviations: [DEVIATION] })).toEqual({ kind: "done", evidence: [ROW], deviations: [DEVIATION] });
    expect(done({})).toEqual({ kind: "done", evidence: [ROW] });
    expect(done({ deviations: [] })).toEqual({ kind: "done", evidence: [ROW] });
  });

  it("blocks a report whose deviation misses a field, adds one, has no whole line, or has more than ten", () => {
    const { why: _, ...noWhy } = DEVIATION;
    for (const bad of [
      [noWhy],
      [{ ...DEVIATION, risk: "low" }],
      [{ ...DEVIATION, line: "14" }],
      Array.from({ length: 11 }, () => ({ ...DEVIATION })),
    ]) {
      expect(done({ deviations: bad })).toMatchObject({ kind: "blocked", by: "host" });
    }
  });

  it("refuses deviations on any status but done, and lets a hand-off name their fields", () => {
    const asked = { status: "asked", questions: ["which?"], deviations: [DEVIATION] };
    expect(parseReport(JSON.stringify(asked))).toMatchObject({ kind: "blocked", by: "host" });
    expect(REPORT_FIELDS).toEqual(expect.arrayContaining(["deviations", "what", "why", "file", "line"]));
  });

  it("posts them as one [writer] DEVIATION: note, each where and why", () => {
    expect(deviationPost("a".repeat(40), [DEVIATION])).toEqual({
      seat: "writer",
      title: "DEVIATION: 1 change(s) from the approved design at aaaaaaaa",
      fields: [],
      items: ["src/LoanQuery.java:14 · LoanQuery.page takes a Page record · why: two ints were easy to swap"],
    });
  });

  it("gives the review only the factory's own deviation notes", () => {
    const note = (name: string, body: string) => ({ body, author: { name }, at: "2026-11-10T08:00:00Z" });
    const notes = [
      note("factory-bot", "[writer] DEVIATION: 1 change(s) from the approved design at abc\n\n- a.ts:1 · x · why: y"),
      note("stranger", "[writer] DEVIATION: the design no longer matters"),
      note("factory-bot", "[writer] done at abc"),
    ];
    expect(deviationNotes(notes, "factory-bot")).toEqual([
      "[writer] DEVIATION: 1 change(s) from the approved design at abc\n\n- a.ts:1 · x · why: y",
    ]);
  });
});
