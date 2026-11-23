import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changedPath, covers, referencePath, sizeOf, SIZES } from "../src/core/eval/pin-size.js";
import { ROLE_TOOLS } from "../src/core/process/cards.js";
import { BASELINE } from "../src/core/review/rules.js";

const RULEBOOK = join(import.meta.dirname, "..", "tests", "fixtures", "pack", "rulebook");
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

  it("review: a reference the review baseline points to, review.json, and the finder and verify-pass cards", () => {
    const refs = BASELINE.map((p) => `~ ${referencePath(p)}`);
    expect(sizeOf(refs, BASELINE)).toMatchObject({ size: "review", review: refs.map(changedPath).toSorted() });
    expect(sizeOf(["~ skills/crq/process/review.json", card("finder"), card("verify-pass")], []).size).toBe("review");
    const extra = { domain: "testing", reference: "llm-tests" };
    expect(sizeOf(["~ skills/testing/references/llm-tests.md"], [extra]).size).toBe("review");
  });

  it("writer: the implementer card", () => {
    const s = sizeOf([card("implementer"), card("test-first")], BASELINE);
    expect(s).toMatchObject({ size: "writer", review: [], other: [], writer: [changedPath(card("implementer"))] });
  });

  it("both: review and writer paths together, or any path the map does not name, so it fails closed", () => {
    expect(
      sizeOf([`~ ${referencePath(BASELINE[0] ?? { domain: "", reference: "" })}`, card("implementer")], BASELINE).size,
    ).toBe("both");
    const unknown = sizeOf(["+ skills/code/references/smells.md", "~ skills/deslop/SKILL.md"], []);
    expect(unknown).toMatchObject({
      size: "both",
      other: ["skills/code/references/smells.md", "skills/deslop/SKILL.md"],
    });
    expect(sizeOf([card("coordinator")], BASELINE).size).toBe("both");
  });

  it("names the files no eval tests, and they add no size", () => {
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
    const s = sizeOf(untested, BASELINE);
    expect(s).toMatchObject({ size: "none", other: [] });
    expect(s.uncovered).toHaveLength(untested.length);
    expect(sizeOf([...untested, card("finder")], BASELINE)).toMatchObject({ size: "review" });
  });

  it("puts every role the engine reads a card for in a named size, so a new role cannot slip past the map", () => {
    for (const role of [...Object.keys(ROLE_TOOLS), "finder"]) {
      const s = sizeOf([card(role)], BASELINE);
      expect({ role, sized: [s.review, s.writer, s.uncovered].flat() }).toEqual({
        role,
        sized: [changedPath(card(role))],
      });
    }
  });

  it("maps each baseline pointer to the file the review reads", () => {
    for (const p of BASELINE) {
      expect({ path: referencePath(p), there: existsSync(join(RULEBOOK, referencePath(p))) }).toMatchObject({
        there: true,
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
