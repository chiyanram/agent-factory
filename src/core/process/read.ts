// read — the engine's own process (docs/adr/0026-the-engine-owns-its-process.md): its lanes and its review baseline.
// No plugin replaces them. A plugin gives skills only, and the engine finds a plugin's skill by its name, never by a
// folder inside the skill, so a change to a skill's files cannot stop a run.
//
//   <plugin>/skills/<skill>/            a skill, found by skillDir in the order the project lists its plugins
//   <plugin>/skills/<skill>/references/ **Today:** the review still fences the rulebook's references by file name
//                                       (referencesDir), not whole skills by name

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_LANES, type LaneProps } from "../lane.js";
import { BASELINE, type Pointer } from "../review/rules.js";

export type Process = {
  readonly lanes: readonly LaneProps[];
  readonly baseline: readonly Pointer[];
};

export const ENGINE_PROCESS: Process = { lanes: DEFAULT_LANES, baseline: BASELINE };

export type PluginDir = { readonly label: string; readonly dir: string };

const NAME = /^[A-Za-z0-9_-]+$/;

async function isDir(path: string): Promise<boolean> {
  return stat(path).then(
    (st) => st.isDirectory(),
    () => false,
  );
}

export async function referencesDir(dirs: readonly string[]): Promise<string> {
  const held = await Promise.all(dirs.map(holdsReferences));
  return dirs[held.indexOf(true)] ?? "";
}

async function holdsReferences(dir: string): Promise<boolean> {
  const skills = dir === "" ? [] : await readdir(join(dir, "skills")).catch((): string[] => []);
  const held = await Promise.all(skills.map((s) => isDir(join(dir, "skills", s, "references"))));
  return held.includes(true);
}

export async function skillDir(plugins: readonly PluginDir[], skill: string): Promise<string> {
  if (!NAME.test(skill)) {
    return "";
  }
  const dirs = plugins.map((p) => join(p.dir, "skills", skill));
  const held = await Promise.all(dirs.map(isDir));
  return dirs[held.indexOf(true)] ?? "";
}
