// read — the process a project runs on (#232; docs/DESIGN.md section 5 "The process plugin"): the lanes and the
// review baseline, read from the first plugin that holds a process, or the engine's built-in process when none does.
// The engine runs alone: with no plugin, or with plugins that hold no process, every value is the built-in one.
//
//   <plugin>/skills/<skill>/process/lanes.json    {"lanes": [{"lane": "tiny", "approval": false, …}, …]}
//   <plugin>/skills/<skill>/process/review.json   {"baseline": [{"skill": "crq", "reference": "review-process"}, …]}
//
// The plugin's "lane" is the engine's lane name. Every lanes value comes through lanesOf (lane.ts), which refuses one
// that drops the approval floor, so a bad lanes file stops the run rather than loosening it. A process with no
// review.json keeps the built-in baseline.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../forge/api.js";
import { prop } from "../dispatch/records.js";
import { DEFAULT_LANES, lanesOf, type LaneProps } from "../lane.js";
import { BASELINE, type Pointer } from "../review/rules.js";

export type Process = {
  // where it came from, as a person reads it
  readonly from: string;
  // the folder of the plugin that holds it, where its references are; "" for the built-in process
  readonly dir: string;
  readonly lanes: readonly LaneProps[];
  readonly baseline: readonly Pointer[];
};

export const BUILT_IN: Process = { from: "the built-in process", dir: "", lanes: DEFAULT_LANES, baseline: BASELINE };

// one plugin on disk: what to call it, and its folder
export type PluginDir = { readonly label: string; readonly dir: string };

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

// a skill or reference name the pack can join into a path: no slash, no dot
const NAME = /^[A-Za-z0-9_-]+$/;

// processDir : the plugin's first skills/<skill>/process folder with a lanes file, by skill name; "" when none
async function processDir(dir: string): Promise<string> {
  const skills = await readdir(join(dir, "skills")).catch((): string[] => []);
  for (const skill of skills.toSorted()) {
    const lanes = join(dir, "skills", skill, "process", "lanes.json");
    if (
      NAME.test(skill) &&
      (await readFile(lanes, "utf8").then(
        () => true,
        () => false,
      ))
    ) {
      return join(dir, "skills", skill, "process");
    }
  }
  return "";
}

async function jsonAt(path: string): Promise<Result<unknown> | { readonly kind: "none" }> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) {
    return { kind: "none" };
  }
  try {
    return { kind: "ok", value: JSON.parse(text) as unknown };
  } catch {
    return failed(`${path}: is not JSON`);
  }
}

// the plugin's lane shape, {"lane", "approval", …}, as lanesOf reads it, {"name", "approval"}
function engineLanes(raw: unknown): unknown {
  const lanes = prop(raw, "lanes");
  return Array.isArray(lanes)
    ? lanes.map((l: unknown) => ({ name: prop(l, "lane"), approval: prop(l, "approval") }))
    : undefined;
}

async function lanesAt(dir: string): Promise<Result<readonly LaneProps[]>> {
  const path = join(dir, "lanes.json");
  const raw = await jsonAt(path);
  if (raw.kind !== "ok") {
    return raw.kind === "none" ? failed(`${path}: cannot be read`) : raw;
  }
  return lanesOf(engineLanes(raw.value), path);
}

function pointerOf(value: unknown): Pointer | undefined {
  const [skill, reference] = [prop(value, "skill"), prop(value, "reference")];
  return typeof skill === "string" && typeof reference === "string" && NAME.test(skill) && NAME.test(reference)
    ? { domain: skill, reference }
    : undefined;
}

function baselineOf(path: string, raw: unknown): Result<readonly Pointer[]> {
  const list = prop(raw, "baseline");
  const pointers = Array.isArray(list) ? list.map(pointerOf) : [];
  const good = pointers.filter((p): p is Pointer => p !== undefined);
  return good.length > 0 && good.length === pointers.length
    ? { kind: "ok", value: good }
    : failed(`${path}: "baseline" must list {"skill", "reference"}, each a plain name`);
}

async function baselineAt(dir: string): Promise<Result<readonly Pointer[]>> {
  const path = join(dir, "review.json");
  const raw = await jsonAt(path);
  if (raw.kind !== "ok") {
    return raw.kind === "none" ? { kind: "ok", value: BASELINE } : raw;
  }
  return baselineOf(path, raw.value);
}

async function processAt(label: string, plugin: string, dir: string): Promise<Result<Process>> {
  const lanes = await lanesAt(dir);
  if (lanes.kind === "failed") {
    return lanes;
  }
  const baseline = await baselineAt(dir);
  return baseline.kind === "ok"
    ? { kind: "ok", value: { from: `${label} (${dir})`, dir: plugin, lanes: lanes.value, baseline: baseline.value } }
    : baseline;
}

// readProcess : the process of the first plugin, in the project's order, that holds one; the built-in process when
// none does. A process that is there but does not read is refused, never skipped for the next plugin's.
export async function readProcess(plugins: readonly PluginDir[]): Promise<Result<Process>> {
  for (const plugin of plugins) {
    const dir = await processDir(plugin.dir);
    if (dir !== "") {
      return processAt(plugin.label, plugin.dir, dir);
    }
  }
  return { kind: "ok", value: BUILT_IN };
}
