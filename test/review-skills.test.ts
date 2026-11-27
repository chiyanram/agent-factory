import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { baselineSkills, copySkills } from "../src/core/review/skills.js";
import { tempDir } from "./temp.js";

let root = "";
beforeEach(() => {
  root = tempDir("factory-skills-");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function plugin(
  name: string,
  files: Readonly<Record<string, string>>,
): { readonly label: string; readonly dir: string } {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return { label: `${name}@acme`, dir };
}

function tree(dir: string): readonly string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => !e.isDirectory())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .toSorted();
}

describe("baselineSkills: each baseline skill, found by name (#920)", () => {
  it("AC-4 takes the first listed plugin with skills/<name>/SKILL.md, and passes over a folder with none", async () => {
    const hollow = plugin("hollow", { "skills/crq/references/x.md": "x" });
    const team = plugin("team", { "skills/crq/SKILL.md": "TEAM" });
    const rulebook = plugin("rulebook", { "skills/crq/SKILL.md": "RB", "skills/code/SKILL.md": "RB" });
    expect(await baselineSkills([hollow, team, rulebook], ["crq", "code"])).toEqual({
      present: [
        { name: "crq", dir: join(team.dir, "skills", "crq") },
        { name: "code", dir: join(rulebook.dir, "skills", "code") },
      ],
      missing: [],
    });
  });

  it("AC-4 counts a name as missing when no plugin holds its SKILL.md", async () => {
    const hollow = plugin("hollow", { "skills/code/references/smells.md": "x", "skills/crq/SKILL.md": "x" });
    expect(await baselineSkills([hollow], ["crq", "code"])).toMatchObject({ missing: ["code"] });
    expect(await baselineSkills([], ["crq", "code"])).toEqual({ present: [], missing: ["crq", "code"] });
  });
});

describe("copySkills: the baseline skills in a run folder (#920)", () => {
  it("AC-1 copies each whole skill folder, file for file", async () => {
    const files = {
      "skills/crq/SKILL.md": "CRQ",
      "skills/crq/references/code-review.md": "CR",
      "skills/crq/process/roles/finder.md": "F",
      "skills/code/SKILL.md": "CODE",
    };
    const rulebook = plugin("rulebook", files);
    const skills = await baselineSkills([rulebook], ["crq", "code"]);
    const run = join(root, "run");
    expect(await copySkills(skills.present, run)).toEqual({ kind: "ok", value: undefined });
    expect(tree(join(run, "skills"))).toEqual(
      Object.keys(files)
        .map((f) => f.slice("skills/".length))
        .toSorted(),
    );
    expect(readFileSync(join(run, "skills", "crq", "references", "code-review.md"), "utf8")).toBe("CR");
  });

  it("AC-3 leaves out every symlink and every rule file or folder, in any case", async () => {
    const rulebook = plugin("rulebook", {
      "skills/crq/SKILL.md": "CRQ",
      "skills/crq/CLAUDE.md": "x",
      "skills/crq/references/claude.local.md": "x",
      "skills/crq/references/Agents.md": "x",
      "skills/crq/.claude/settings.json": "{}",
      "skills/crq/.agents/x.md": "x",
      "outside.md": "SECRET",
    });
    symlinkSync(join(rulebook.dir, "outside.md"), join(rulebook.dir, "skills", "crq", "link.md"));
    const run = join(root, "run");
    await copySkills((await baselineSkills([rulebook], ["crq"])).present, run);
    expect(tree(join(run, "skills"))).toEqual(["crq/SKILL.md"]);
    expect(existsSync(join(run, "skills", "crq", ".claude"))).toBe(false);
  });
});
