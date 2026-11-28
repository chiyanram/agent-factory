import { describe, expect, it } from "vitest";
import { changedPath, covers, sizeOf, SIZES } from "../src/core/eval/pin-size.js";
import { ROLE_TOOLS } from "../src/core/process/cards.js";
import { BASELINE } from "../src/core/review/rules.js";

const card = (role: string) => `~ skills/crq/process/roles/${role}.md`;

describe("sizeOf: the eval a pin move needs", () => {
  it("none: only files no run reads", () => {
    const s = sizeOf(
      ["~ README.md", "+ CHANGELOG.md", "~ LICENSE", "+ docs/a.md", "~ evals/x/p.md", "- tests/t.md"],
      [],
    );
    expect(s).toMatchObject({ size: "none", review: [], writer: [], other: [], uncovered: [] });
    expect(s.none).toHaveLength(6);
    expect(sizeOf([], BASELINE).size).toBe("none");
  });

  it("review: every file of a baseline skill, review.json, and the finder and verify-pass cards", () => {
    const files = [
      "~ skills/crq/SKILL.md",
      "+ skills/code/references/errors.md",
      "- skills/code/references/smells.md",
      "~ skills/crq/process/lanes.json",
    ];
    expect(sizeOf(files, BASELINE)).toMatchObject({ size: "review", review: files.map(changedPath).toSorted() });
    expect(sizeOf(["~ skills/crq/process/review.json", card("finder"), card("verify-pass")], []).size).toBe("review");
    expect(sizeOf(["~ skills/testing/references/llm-tests.md"], ["testing"]).size).toBe("review");
    expect(sizeOf(["~ skills/crqx/SKILL.md"], BASELINE).size).toBe("both");
  });

  it("writer: the implementer card outside a baseline skill", () => {
    const s = sizeOf([card("implementer"), card("test-first")], []);
    expect(s).toMatchObject({ size: "writer", review: [], other: [], writer: [changedPath(card("implementer"))] });
  });

  it("both: the implementer card inside a baseline skill, review and writer paths together, or any path the map does not name", () => {
    expect(sizeOf([card("implementer")], BASELINE)).toMatchObject({
      size: "both",
      review: [changedPath(card("implementer"))],
      writer: [changedPath(card("implementer"))],
    });
    expect(sizeOf(["~ skills/code/SKILL.md", card("implementer")], []).size).toBe("both");
    const unknown = sizeOf(["+ skills/code/references/smells.md", "~ skills/deslop/SKILL.md"], []);
    expect(unknown).toMatchObject({
      size: "both",
      other: ["skills/code/references/smells.md", "skills/deslop/SKILL.md"],
    });
    expect(sizeOf([card("coordinator")], []).size).toBe("both");
  });

  it("names the files no eval tests, which add no size outside a baseline skill and the review size inside one", () => {
    const untested = [
      card("test-first"),
      card("cleanup"),
      card("design-reviewer"),
      card("onboarder"),
      card("retro"),
      "~ .claude-plugin/plugin.json",
      "~ skills/crq/process/lanes.json",
      "+ skills/crq/process/lanes-v2.json",
      "~ skills/crq/process/glossary.md",
      "~ skills/crq/process/schema/card-v1.schema.json",
    ];
    const s = sizeOf(untested, []);
    expect(s).toMatchObject({ size: "none", other: [] });
    expect(s.uncovered).toHaveLength(untested.length);
    expect(sizeOf([...untested, card("finder")], [])).toMatchObject({ size: "review" });
    const inCrq = sizeOf(untested, BASELINE);
    expect(inCrq).toMatchObject({ size: "review", other: [] });
    expect(inCrq.uncovered).toHaveLength(untested.length);
    expect(inCrq.review).toEqual(
      untested
        .filter((p) => p.includes("skills/crq/"))
        .map(changedPath)
        .toSorted(),
    );
  });

  it("puts every role the engine reads a card for in a named size, so a new role cannot slip past the map", () => {
    for (const role of [...Object.keys(ROLE_TOOLS), "finder"]) {
      const s = sizeOf([card(role)], []);
      expect({ role, sized: [s.review, s.writer, s.uncovered].flat() }).toEqual({
        role,
        sized: [changedPath(card(role))],
      });
    }
  });

  it("covers: none needs nothing, both covers all, and a size covers only itself", () => {
    expect(SIZES.every((s) => covers(s, "none") && covers("both", s))).toBe(true);
    expect([covers("review", "review"), covers("writer", "writer")]).toEqual([true, true]);
    expect([covers("review", "writer"), covers("writer", "review"), covers("none", "review")]).toEqual([
      false,
      false,
      false,
    ]);
    expect([covers("review", "both"), covers("writer", "both")]).toEqual([false, false]);
  });
});
