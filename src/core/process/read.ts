// read — the engine's own process (docs/adr/0026-the-engine-owns-its-process.md): its lanes and its review baseline.
// No plugin replaces them. A plugin gives skills only, and the engine finds a plugin's skill by its name, never by a
// folder inside the skill, so a change to a skill's files cannot stop a run.
//
//   <plugin>/skills/<skill>/            a skill, found by skillDir in the order the project lists its plugins

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_LANES, type LaneProps } from "../lane.js";
import { BASELINE } from "../review/rules.js";

export type Process = {
  readonly lanes: readonly LaneProps[];
  readonly baseline: readonly string[];
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

export async function skillDir(plugins: readonly PluginDir[], skill: string): Promise<string> {
  if (!NAME.test(skill)) {
    return "";
  }
  const dirs = plugins.map((p) => join(p.dir, "skills", skill));
  const held = await Promise.all(dirs.map(isDir));
  return dirs[held.indexOf(true)] ?? "";
}
