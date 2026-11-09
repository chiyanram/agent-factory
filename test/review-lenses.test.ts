import { describe, expect, it } from "vitest";
import { TEST_FILES } from "../src/core/ready/floor.js";
import {
  editsTest,
  type Lens,
  mergeFindings,
  pickLenses,
  TEST_INTEGRITY,
  type Touched,
  uniqueByLens,
} from "../src/core/review/lenses.js";

const lens = (name: string, over: Partial<Lens> = {}): Lens => ({
  name,
  rubric: { kind: "file", path: `docs/review/${name}.md` },
  paths: [],
  lanes: [],
  ...over,
});

const LENSES: readonly Lens[] = [
  lens("standards"),
  lens("correctness"),
  lens("security", { paths: ["src/auth/**"] }),
  lens("api"),
  lens("migrations", { lanes: ["one-way door"] }),
  lens(TEST_INTEGRITY, { rubric: { kind: "skill", plugin: "rulebook@chiyanram", skill: "test-integrity" } }),
];

const code: readonly Touched[] = [{ path: "src/a.ts", existed: true }];

const pick = (lane: string, count: number | "all", touched: readonly Touched[] = code, oneWayDoor: string[] = []) =>
  pickLenses({ lenses: LENSES, lane, count, touched, oneWayDoor: ["db/**", ...oneWayDoor], testFiles: TEST_FILES });

const names = (p: { readonly lenses: readonly Lens[] }) => p.lenses.map((l) => l.name);

describe("pickLenses: the blast radius (#237)", () => {
  it("runs one lens on a tiny change, on the lane's model", () => {
    expect(pick("tiny", 1)).toEqual({ lenses: [LENSES[0]], strongest: false });
  });

  it("runs about three on a bug or feature, in the settings' order, skipping lenses that do not apply", () => {
    expect(names(pick("feature", 3))).toEqual(["standards", "correctness", "api"]);
    expect(names(pick("bug", 3, [{ path: "src/auth/login.ts", existed: true }]))).toEqual([
      "standards",
      "correctness",
      "security",
    ]);
  });

  it("runs every applicable lens on the strongest model in the one-way-door lane", () => {
    expect(pick("one-way door", "all")).toEqual({
      lenses: LENSES.filter((l) => ["standards", "correctness", "api", "migrations"].includes(l.name)),
      strongest: true,
    });
  });

  it("runs every applicable lens on the strongest model when a file is under a one-way-door path, whatever the lane", () => {
    const p = pick("tiny", 1, [{ path: "db/V2__drop.sql", existed: false }]);
    expect(names(p)).toEqual(["standards", "correctness", "api"]);
    expect(p.strongest).toBe(true);
  });

  it("adds the test-integrity lens whenever an existing test file changed, on top of the count", () => {
    const touched = [...code, { path: "test/a.test.ts", existed: true }];
    expect(names(pick("tiny", 1, touched))).toEqual(["standards", TEST_INTEGRITY]);
    expect(names(pick("one-way door", "all", touched))).toContain(TEST_INTEGRITY);
  });

  it("leaves the test-integrity lens out for a new test file, or no test at all", () => {
    expect(names(pick("tiny", 1, [...code, { path: "test/new.test.ts", existed: false }]))).toEqual(["standards"]);
    expect(names(pick("one-way door", "all"))).not.toContain(TEST_INTEGRITY);
  });

  it("runs at least one lens, even on a count below one", () => {
    expect(names(pick("tiny", 0))).toEqual(["standards"]);
  });

  it("names an existing test file by the ready check's globs", () => {
    expect(editsTest([{ path: "svc/src/test/java/ATest.java", existed: true }], TEST_FILES)).toBe(true);
    expect(editsTest([{ path: "svc/src/main/java/A.java", existed: true }], TEST_FILES)).toBe(false);
  });
});

const f = (id: string, file: string, line: number, rule: string) => ({ id, file, line, rule, finding: id });

describe("mergeFindings and uniqueByLens (#237)", () => {
  it("posts one finding when two lenses report the same file:line and rule, naming both lenses", () => {
    const merged = mergeFindings([
      { lens: "standards", findings: [f("F1", "src/a.ts", 3, "ERR1"), f("F2", "src/a.ts", 9, "ERR1")] },
      { lens: "correctness", findings: [f("F1", "src/a.ts", 3, "ERR1"), f("F2", "src/a.ts", 3, "correctness")] },
    ]);
    expect(merged).toEqual([
      { id: "F1", file: "src/a.ts", line: 3, rule: "ERR1", finding: "F1", lenses: ["standards", "correctness"] },
      { id: "F2", file: "src/a.ts", line: 9, rule: "ERR1", finding: "F2", lenses: ["standards"] },
      { id: "F3", file: "src/a.ts", line: 3, rule: "correctness", finding: "F2", lenses: ["correctness"] },
    ]);
  });

  it("keeps one lens's own duplicate once", () => {
    const merged = mergeFindings([{ lens: "api", findings: [f("F1", "a", 1, "r"), f("F2", "a", 1, "r")] }]);
    expect(merged.map((m) => m.lenses)).toEqual([["api"]]);
  });

  it("counts per lens the verified findings no other lens reported, with 0 for a lens that added none", () => {
    const sorted = [
      { lenses: ["standards", "correctness"], bucket: "act_on" },
      { lenses: ["standards"], bucket: "consider" },
      { lenses: ["standards"], bucket: "noted" },
      { lenses: ["correctness"], bucket: "dismissed" },
    ];
    expect(uniqueByLens(["standards", "correctness", "api"], sorted)).toEqual({
      standards: 2,
      correctness: 0,
      api: 0,
    });
  });
});
