import { describe, expect, it } from "vitest";
import { type FileNumbers, fromSnapshot, render, type Row, type Side, worse } from "../src/core/garden/numbers.js";

const LIMIT = 800;

const source = (lines: number, more: Partial<FileNumbers> = {}): Side => ({
  kind: "measured",
  numbers: { test: false, lines, typeEscapes: 0, suppressions: 0, mockModules: 0, callAssertions: 0, ...more },
});
const test = (lines: number, more: Partial<FileNumbers> = {}): Side => ({
  kind: "measured",
  numbers: { test: true, lines, typeEscapes: 0, suppressions: 0, mockModules: 0, callAssertions: 0, ...more },
});
const ABSENT: Side = { kind: "absent" };
const row = (path: string, before: Side, after: Side): Row => ({ path, before, after });

// the shape gardener 0.1.2 prints for `snapshot --json`, with a config whose code list is one file
type Over = { source: number; test: number; lines: number; escapes: number; mocks: number };
const DEFAULTS: Over = { source: 1, test: 0, lines: 10, escapes: 0, mocks: 0 };
const snapshot = (over: Partial<Over>) => {
  const o = { ...DEFAULTS, ...over };
  return {
    commit: "0".repeat(40),
    time: 0,
    files: { source: o.source, test: o.test, generatedSkipped: 0 },
    lines: { source: o.test === 0 ? o.lines : 0, test: o.test === 0 ? 0 : o.lines },
    largeFiles: { threshold: 800, count: 0, lines: 0, top: [] },
    typeEscapes: { source: {}, test: {}, totalSource: o.escapes, totalTest: 0 },
    suppressions: { source: {}, test: {}, total: 1 },
    tests: { cases: 3, mockModules: o.mocks, callAssertions: 2, assertions: 5 },
    sql: null,
    // a history number gardener may add: never read here
    fixes: 9,
  };
};

describe("worse: W1, a source file over the size limit that grew", () => {
  it("finds a new file of 801 lines", () => {
    expect(worse([row("a.ts", ABSENT, source(801))], LIMIT)).toEqual([
      { rule: "W1", what: "lines, over the limit of 800", paths: ["a.ts"], before: 0, after: 801 },
    ]);
  });

  it("finds a file that grows from 900 to 950 lines", () => {
    expect(worse([row("a.ts", source(900), source(950))], LIMIT).map((w) => w.rule)).toEqual(["W1"]);
  });

  it("finds a file that crosses the limit", () => {
    expect(worse([row("a.ts", source(790), source(810))], LIMIT).map((w) => w.rule)).toEqual(["W1"]);
  });

  it("leaves growth under the limit alone: 700 to 790", () => {
    expect(worse([row("a.ts", source(700), source(790))], LIMIT)).toEqual([]);
  });

  it("leaves a big file that shrank alone: 900 to 850", () => {
    expect(worse([row("a.ts", source(900), source(850))], LIMIT)).toEqual([]);
  });

  it("leaves a file of exactly the limit alone", () => {
    expect(worse([row("a.ts", ABSENT, source(800))], LIMIT)).toEqual([]);
  });

  it("does not hold a test file to the source size limit", () => {
    expect(worse([row("a.test.ts", test(900), test(1000))], LIMIT)).toEqual([]);
  });

  it("uses the limit it is given", () => {
    expect(worse([row("a.ts", source(500), source(600))], 550).map((w) => w.rule)).toEqual(["W1"]);
  });
});

describe("worse: W2 and W3, escapes and suppressions summed over the touched files", () => {
  it("finds an added type escape", () => {
    expect(worse([row("a.ts", source(10), source(11, { typeEscapes: 1 }))], LIMIT)).toEqual([
      { rule: "W2", what: "type escapes in the touched files", paths: ["a.ts"], before: 0, after: 1 },
    ]);
  });

  it("leaves a type escape that moved from a.ts to b.ts alone", () => {
    const rows = [
      row("a.ts", source(10, { typeEscapes: 1 }), source(9)),
      row("b.ts", source(10), source(11, { typeEscapes: 1 })),
    ];
    expect(worse(rows, LIMIT)).toEqual([]);
  });

  it("finds an added suppression, and names only the files where it rose", () => {
    const rows = [
      row("a.ts", source(10, { suppressions: 1 }), source(10, { suppressions: 1 })),
      row("b.ts", ABSENT, source(5, { suppressions: 1 })),
    ];
    expect(worse(rows, LIMIT)).toEqual([
      { rule: "W3", what: "lint suppressions in the touched files", paths: ["b.ts"], before: 1, after: 2 },
    ]);
  });

  it("leaves a deleted file alone, whatever it held", () => {
    expect(worse([row("a.ts", source(2000, { typeEscapes: 3, suppressions: 2 }), ABSENT)], LIMIT)).toEqual([]);
  });
});

describe("worse: W4, mocks in a touched test file", () => {
  it("finds a mocked module or a call assertion added to a test file", () => {
    const found = worse([row("a.test.ts", test(10), test(20, { mockModules: 1, callAssertions: 2 }))], LIMIT);
    expect(found).toEqual([
      { rule: "W4", what: "mocked modules", paths: ["a.test.ts"], before: 0, after: 1 },
      { rule: "W4", what: "call assertions", paths: ["a.test.ts"], before: 0, after: 2 },
    ]);
  });

  it("leaves fewer mocks alone", () => {
    expect(worse([row("a.test.ts", test(10, { mockModules: 2 }), test(10, { mockModules: 1 }))], LIMIT)).toEqual([]);
  });
});

describe("worse: only the four rules", () => {
  it("reports nothing but W1 to W4, so no history number (fixes, hotspot score, fix share, rework) can be a finding", () => {
    const rows = [
      row("a.ts", ABSENT, source(900, { typeEscapes: 1, suppressions: 1 })),
      row("a.test.ts", ABSENT, test(10, { mockModules: 1, callAssertions: 1 })),
    ];
    expect([...new Set(worse(rows, LIMIT).map((w) => w.rule))]).toEqual(["W1", "W2", "W3", "W4"]);
  });
});

describe("fromSnapshot", () => {
  it("reads a source file's numbers", () => {
    expect(fromSnapshot(snapshot({ lines: 42, escapes: 2 }))).toEqual({
      kind: "ok",
      side: source(42, { typeEscapes: 2, suppressions: 1 }),
    });
  });

  it("reads a test file's numbers, with its mocks and call assertions", () => {
    expect(fromSnapshot(snapshot({ source: 0, test: 1, lines: 7, mocks: 3 }))).toEqual({
      kind: "ok",
      side: test(7, { suppressions: 1, mockModules: 3, callAssertions: 2 }),
    });
  });

  it("reads no file as absent", () => {
    expect(fromSnapshot(snapshot({ source: 0, test: 0 }))).toEqual({ kind: "ok", side: ABSENT });
  });

  it("refuses a snapshot of more than one file", () => {
    expect(fromSnapshot(snapshot({ source: 2 }))).toEqual({
      kind: "bad",
      reason: "gardener's snapshot counted 2 files, not one",
    });
  });

  it("refuses a snapshot with a count missing, naming where", () => {
    expect(fromSnapshot({ files: { source: 1, test: 0 } })).toMatchObject({
      kind: "bad",
      reason: expect.stringContaining("lines.source"),
    });
  });

  it("refuses a value that is not JSON of an object", () => {
    expect(fromSnapshot("nothing").kind).toBe("bad");
  });
});

describe("render", () => {
  it("prints each file before and after, then the worse list", () => {
    const rows = [row("a.ts", source(900), source(950, { typeEscapes: 1 })), row("b.test.ts", ABSENT, test(5))];
    expect(render(rows, worse(rows, LIMIT), LIMIT)).toBe(
      [
        "| file | lines | type escapes | suppressions | mocks / call assertions |",
        "|---|---|---|---|---|",
        "| `a.ts` before | 900 | 0 | 0 |  |",
        "| `a.ts` after | 950 | 1 | 0 |  |",
        "| `b.test.ts` before | – | – | – | – |",
        "| `b.test.ts` after | 5 | 0 | 0 | 0 / 0 |",
        "",
        "Worse (size limit 800 lines):",
        "- W1 lines, over the limit of 800: 900 → 950 (`a.ts`)",
        "- W2 type escapes in the touched files: 0 → 1 (`a.ts`)",
        "",
      ].join("\n"),
    );
  });

  it("says so when nothing got worse, or when no code file was touched", () => {
    expect(render([], [], LIMIT)).toBe("No touched code file.\n\nNo module number got worse (size limit 800 lines).\n");
  });
});
