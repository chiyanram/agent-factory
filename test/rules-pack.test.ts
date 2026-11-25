// P18 (docs/CONSTITUTION.md): one contract with the rules pack. The engine names skills, and the pinned rules pack holds
// each skill the engine names, so a rulebook change that drops one fails CI before the pin moves.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prop } from "../src/core/field.js";
import { RETRO_SKILL } from "../src/core/retro/draft.js";
import { BASELINE } from "../src/core/review/rules.js";

const ROOT = join(import.meta.dirname, "..");
const PACK = process.env.FACTORY_RULES_PACK ?? "";
const IN_CI = (process.env.CI ?? "") !== "";
const PIN: unknown = JSON.parse(readFileSync(join(ROOT, ".github", "rules-pack.json"), "utf8"));
const NAMED = [...new Set([...BASELINE.map((p) => p.domain), RETRO_SKILL])].toSorted();

describe("P18: the pinned rules pack holds each skill the engine names", () => {
  it("pins the rules pack by a full commit", () => {
    expect(prop(PIN, "repo")).toBe("https://github.com/chiyanram/skills");
    expect(prop(PIN, "commit")).toMatch(/^[0-9a-f]{40}$/);
  });

  it.runIf(IN_CI && PACK === "")("CI names the pinned rules pack's checkout in FACTORY_RULES_PACK", () => {
    expect(PACK).not.toBe("");
  });

  it.runIf(PACK !== "")("the rulebook plugin at the pin has skills/<name>/SKILL.md for every name", () => {
    const missing = NAMED.filter((name) => !existsSync(join(PACK, "plugins", "rulebook", "skills", name, "SKILL.md")));
    expect(NAMED.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
