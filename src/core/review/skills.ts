// skills — the skills a review reads, found by name and copied into each run folder
// (docs/adr/0026-the-engine-owns-its-process.md): the baseline, each skill an AGENTS.md points at, and a lens's skill.
// A read-only run gets no --plugin-dir, so no plugin hook, server or command runs in a review; it reads the copy at
// ./skills/<name>/ instead. The engine names the skill, never a file inside it.
//
//   findSkills   each name's folder in the first listed plugin that holds skills/<name>/SKILL.md; a name no plugin
//                holds is missing: the round records a missing baseline skill and goes on (round.ts), and the pack
//                stops on a missing pointed skill (pack.ts). A symlinked folder or SKILL.md does not count, since
//                copySkills would drop it
//   skillBlock   a skill's SKILL.md, fenced, and the line that its links resolve in the copy: in 49 eval review runs
//                no run opened a skill file the pack only named
//   copySkills   the whole skills/<name>/ folder of each skill, once, less every symlink and rule file (code.ts
//                ruleOrLink), since the agent CLI loads a CLAUDE.md from any folder it reads

import { cp, lstat, mkdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Result } from "../forge/api.js";
import type { PluginDir } from "../process/read.js";
import { ruleOrLink } from "./code.js";
import { fence } from "./fence.js";
import { attempt } from "./safe.js";

export type Skill = { readonly name: string; readonly dir: string };

export type Skills = { readonly present: readonly Skill[]; readonly missing: readonly string[] };

const NAME = /^[A-Za-z0-9_-]+$/;

async function plain(path: string, kind: "file" | "dir"): Promise<boolean> {
  return lstat(path).then(
    (s) => (kind === "file" ? s.isFile() : s.isDirectory()),
    () => false,
  );
}

async function holds(dir: string): Promise<boolean> {
  return (await plain(dir, "dir")) && plain(join(dir, "SKILL.md"), "file");
}

async function folderOf(plugins: readonly PluginDir[], name: string): Promise<string> {
  if (!NAME.test(name)) {
    return "";
  }
  const dirs = plugins.map((p) => join(p.dir, "skills", name));
  const held = await Promise.all(dirs.map(holds));
  return dirs[held.indexOf(true)] ?? "";
}

export async function findSkills(plugins: readonly PluginDir[], names: readonly string[]): Promise<Skills> {
  const dirs = await Promise.all(names.map((name) => folderOf(plugins, name)));
  return {
    present: names.flatMap((name, i) => (dirs[i] === "" ? [] : [{ name, dir: dirs[i] ?? "" }])),
    missing: names.filter((_, i) => dirs[i] === ""),
  };
}

async function kept(path: string): Promise<boolean> {
  return !ruleOrLink(basename(path), await lstat(path));
}

export async function skillBlock(s: Skill): Promise<Result<string>> {
  const path = join(s.dir, "SKILL.md");
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) {
    return { kind: "failed", reason: `cannot read the skill ${path}` };
  }
  const where = `The whole \`${s.name}\` skill is in \`./skills/${s.name}/\`: its links resolve there. Open each linked file that applies to this change.`;
  return { kind: "ok", value: `${fence({ title: `skill ${s.name}`, text, info: "markdown" })}\n${where}\n` };
}

export async function copySkills(skills: readonly Skill[], folder: string): Promise<Result<void>> {
  const once = [...new Map(skills.map((s) => [s.name, s])).values()];
  return attempt(async () => {
    await mkdir(join(folder, "skills"), { recursive: true });
    for (const s of once) {
      await cp(s.dir, join(folder, "skills", s.name), { recursive: true, filter: kept });
    }
  }, `cannot copy the review skills into ${folder}`);
}
