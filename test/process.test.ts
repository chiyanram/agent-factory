import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { referencesDir, skillDir } from "../src/core/process/read.js";
import { tempDir } from "./temp.js";

let root = "";
beforeEach(() => {
  root = tempDir("factory-process-");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function plugin(name: string, files: readonly string[]): { readonly label: string; readonly dir: string } {
  const dir = join(root, name);
  for (const path of files) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), "x\n");
  }
  mkdirSync(dir, { recursive: true });
  return { label: `${name}@acme`, dir };
}

describe("skillDir: a plugin's skill, found by its name (ADR-0026)", () => {
  it("takes the first plugin in the project's order that holds the skill, and passes over one that does not", async () => {
    const other = plugin("other", ["skills/code/SKILL.md"]);
    const rulebook = plugin("rulebook", ["skills/crq/SKILL.md"]);
    const team = plugin("team", ["skills/crq/SKILL.md"]);
    expect(await skillDir([other, rulebook, team], "crq")).toBe(join(rulebook.dir, "skills", "crq"));
  });

  it("finds a skill whether or not it still has a process folder, and is empty when no plugin holds it", async () => {
    const rulebook = plugin("rulebook", ["skills/crq/process/lanes.json"]);
    expect(await skillDir([rulebook], "crq")).toBe(join(rulebook.dir, "skills", "crq"));
    expect(await skillDir([rulebook], "retro")).toBe("");
    expect(await skillDir([], "crq")).toBe("");
  });

  it("takes only a plain name, so a name can never climb out of the plugin", async () => {
    const rulebook = plugin("rulebook", ["skills/crq/SKILL.md"]);
    expect(await skillDir([rulebook], "../rulebook/skills/crq")).toBe("");
    expect(await skillDir([rulebook], "")).toBe("");
  });
});

describe("referencesDir: the plugin that still holds review references", () => {
  it("takes the first folder with a skills/<skill>/references folder, and is empty with none", async () => {
    const bare = plugin("bare", ["skills/deslop/SKILL.md"]);
    const rulebook = plugin("rulebook", ["skills/crq/references/code-review.md"]);
    expect(await referencesDir(["", bare.dir, rulebook.dir])).toBe(rulebook.dir);
    expect(await referencesDir([bare.dir])).toBe("");
  });
});
