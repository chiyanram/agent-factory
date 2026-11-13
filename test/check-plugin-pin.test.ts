// check-plugin-pin (#580): the sessions' plugins and the engine's rules-pack pin name the same repo and release tag
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pinProblems } from "../scripts/check-plugin-pin.js";

const ROOT = join(import.meta.dirname, "..");

const settings = (ref: string, enabled = true) => ({
  extraKnownMarketplaces: { chiyanram: { source: { source: "github", repo: "chiyanram/skills", ref } } },
  enabledPlugins: { "rulebook@chiyanram": enabled, "toolbox@chiyanram": true },
});
const pin = (tag: string, repo = "https://github.com/chiyanram/skills") => ({ repo, commit: "a".repeat(40), tag });

describe("pinProblems", () => {
  it("passes when both name the same repo and tag, with both plugins enabled", () => {
    expect(pinProblems(settings("rulebook--v2.0.0"), pin("rulebook--v2.0.0"))).toEqual([]);
  });

  it("fails a tag that differs, and names both", () => {
    expect(pinProblems(settings("rulebook--v2.1.0"), pin("rulebook--v2.0.0"))).toEqual([
      ".claude/settings.json pins rulebook--v2.1.0; .github/rules-pack.json pins rulebook--v2.0.0",
    ]);
  });

  it("fails a different repo, a pin with no tag, a missing marketplace, and a plugin left off", () => {
    expect(pinProblems(settings("t"), pin("t", "https://github.com/other/skills"))).toHaveLength(1);
    expect(pinProblems(settings(""), pin(""))).toEqual([
      ".github/rules-pack.json: tag must name the release tag its commit is",
    ]);
    expect(pinProblems({}, pin("t")).length).toBeGreaterThan(1);
    expect(pinProblems(settings("t", false), pin("t"))).toEqual([
      ".claude/settings.json: enabledPlugins.rulebook@chiyanram must be true",
    ]);
  });

  it("passes this repository", () => {
    const json = (p: string): unknown => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
    expect(pinProblems(json(".claude/settings.json"), json(".github/rules-pack.json"))).toEqual([]);
  });
});
