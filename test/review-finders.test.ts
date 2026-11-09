import { describe, expect, it } from "vitest";
import { checkLenses, lensListOf } from "../src/core/review/lens-list.js";
import {
  BASELINE,
  BUILT_IN_TEST_INTEGRITY,
  lensPack,
  roundLenses,
  rubricText,
  touchedOf,
} from "../src/core/review/finders.js";
import { TEST_INTEGRITY, type Lens } from "../src/core/review/lenses.js";

const api: Lens = { name: "api", rubric: { kind: "file", path: "docs/review/api.md" }, paths: [], lanes: [] };

describe("review.lenses: the project's lenses (#237)", () => {
  it("reads a skill rubric, with or without a reference, and a repo file, with optional paths and lanes", () => {
    expect(
      lensListOf([
        { name: "errors", rubric: { plugin: "rulebook", skill: "code", reference: "errors" }, paths: ["src/**"] },
        { name: "code", rubric: { plugin: "rulebook@chiyanram", skill: "code" }, lanes: ["one-way door"] },
        { name: "api", rubric: { file: "docs/review/api.md" } },
      ]),
    ).toEqual([
      {
        name: "errors",
        rubric: { kind: "skill", plugin: "rulebook", skill: "code", reference: "errors" },
        paths: ["src/**"],
        lanes: [],
      },
      {
        name: "code",
        rubric: { kind: "skill", plugin: "rulebook@chiyanram", skill: "code" },
        paths: [],
        lanes: ["one-way door"],
      },
      api,
    ]);
    expect(lensListOf([])).toEqual([]);
  });

  it("refuses a name twice, a path out of the repo, a skill name with a slash, or a lane the engine has not", () => {
    const bad = [
      [api, api],
      [{ name: "x", rubric: { file: "../secret.md" } }],
      [{ name: "x", rubric: { file: "/etc/passwd" } }],
      [{ name: "x", rubric: { plugin: "rulebook", skill: "../code" } }],
      [{ name: "x", rubric: { plugin: "rulebook", skill: "code" }, lanes: ["chore"] }],
      [{ name: "a b", rubric: { file: "a.md" } }],
      { name: "x" },
    ];
    for (const value of bad) {
      expect(lensListOf(value)).toBe("bad");
      expect(checkLenses(value)).toContain("a list of lenses");
    }
    expect(checkLenses([])).toBe("");
  });
});

describe("the lenses a round picks from (#237)", () => {
  it("runs the baseline lens when the project names none, and always the test-integrity lens unless named", () => {
    expect(roundLenses([])).toEqual([BASELINE, BUILT_IN_TEST_INTEGRITY]);
    expect(roundLenses([api])).toEqual([api, BUILT_IN_TEST_INTEGRITY]);
    const own: Lens = { ...api, name: TEST_INTEGRITY };
    expect(roundLenses([own])).toEqual([own]);
  });

  it("reads which touched files existed before from git's name-status", () => {
    expect(touchedOf("M\u0000src/a.ts\u0000A\u0000src/new.ts\u0000D\u0000old.ts\u0000")).toEqual([
      { path: "src/a.ts", existed: true },
      { path: "src/new.ts", existed: false },
      { path: "old.ts", existed: true },
    ]);
  });

  it("gives a lens's rubric as section 8 of its pack, fenced, and the baseline lens the pack itself", () => {
    expect(lensPack("PACK", BASELINE, "")).toBe("PACK");
    const text = lensPack("PACK", api, "API-RUBRIC\n```\n");
    expect(text.startsWith("PACK\n## 8 · This finder's lens: api")).toBe(true);
    expect(text).toContain("API-RUBRIC");
  });

  it("refuses a rubric from a plugin that is not enabled, naming the lens", async () => {
    const lens: Lens = { ...api, rubric: { kind: "skill", plugin: "other", skill: "code" } };
    const read = await rubricText(lens, { references: "", plugins: [], repo: "", env: {}, master: "" });
    expect(read).toEqual({
      kind: "failed",
      reason: "the rubric of the lens api: no enabled plugin is named other",
    });
  });
});
