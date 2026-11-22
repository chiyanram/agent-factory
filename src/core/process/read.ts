// read — the process a project runs on (#232; docs/DESIGN.md section 5 "The process plugin"): the lanes and the
// review baseline, read from the one plugin that holds a process, or the engine's built-in process when none does.
// The engine runs alone: with no plugin, or with plugins that hold no process, every value is the built-in one. A
// project whose plugins hold two processes is refused, naming each plugin, never run on the first one (#426).
//
//   <plugin>/skills/<skill>/process/lanes.json    {"lanes": [{"lane": "tiny", "approval": false, "lenses": "1", …}, …]}
//   <plugin>/skills/<skill>/process/review.json   {"baseline": [{"skill": "crq", "reference": "review-process"}, …]}
//
// The plugin's "lane" is the engine's lane name. Every lanes value comes through lanesOf (lane.ts), which refuses one
// that drops the approval floor, so a bad lanes file stops the run rather than loosening it. Before that, the lanes
// file is checked against the rules pack's own lanes schema, when the pack ships one (pack-schema.ts, #484). A process with no
// review.json keeps the built-in baseline.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../forge/api.js";
import { DEFAULT_LANES, lanesOf, type LaneProps } from "../lane.js";
import { BASELINE, type Pointer } from "../review/rules.js";
import { packProblem, readPackSchemas } from "./pack-schema.js";
import { prop } from "../field.js";

export type Process = {
  readonly from: string;
  readonly dir: string;
  readonly lanes: readonly LaneProps[];
  readonly baseline: readonly Pointer[];
};

export const BUILT_IN: Process = { from: "the built-in process", dir: "", lanes: DEFAULT_LANES, baseline: BASELINE };

export type PluginDir = { readonly label: string; readonly dir: string };

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

const NAME = /^[A-Za-z0-9_-]+$/;

export async function referencesDir(dirs: readonly string[]): Promise<string> {
  const held = await Promise.all(dirs.map(holdsReferences));
  return dirs[held.indexOf(true)] ?? "";
}

async function holdsReferences(dir: string): Promise<boolean> {
  const skills = dir === "" ? [] : await readdir(join(dir, "skills")).catch((): string[] => []);
  const held = await Promise.all(
    skills.map((s) =>
      stat(join(dir, "skills", s, "references")).then(
        (st) => st.isDirectory(),
        () => false,
      ),
    ),
  );
  return held.includes(true);
}

export async function processDir(dir: string): Promise<string> {
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

function engineLanes(raw: unknown): unknown {
  const lanes = prop(raw, "lanes");
  return Array.isArray(lanes)
    ? lanes.map((l: unknown) => ({
        name: prop(l, "lane"),
        approval: prop(l, "approval"),
        lenses: prop(l, "lenses"),
        designReview: prop(l, "design_review"),
        testFirst: prop(l, "test_first"),
      }))
    : undefined;
}

async function lanesAt(dir: string): Promise<Result<readonly LaneProps[]>> {
  const path = join(dir, "lanes.json");
  const raw = await jsonAt(path);
  if (raw.kind !== "ok") {
    return raw.kind === "none" ? failed(`${path}: cannot be read`) : raw;
  }
  const schemas = await readPackSchemas(dir);
  const problem = schemas.kind === "ok" ? packProblem(schemas.value, "lanes", raw.value, path) : schemas.reason;
  return problem === "" ? lanesOf(engineLanes(raw.value), path) : failed(problem);
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

export type Holder = { readonly plugin: PluginDir; readonly dir: string };

export type Found = Result<Holder> | { readonly kind: "none" };

export function oneHolder(holders: readonly Holder[]): Found {
  const [first, second] = holders;
  if (first === undefined) {
    return { kind: "none" };
  }
  return second === undefined
    ? { kind: "ok", value: first }
    : failed(
        `${holders.map((h) => h.plugin.label).join(" and ")} each hold a process (${holders.map((h) => h.dir).join(", ")}); a project runs on one process plugin, so list only one plugin with a skills/<skill>/process folder`,
      );
}

export async function findProcess(plugins: readonly PluginDir[]): Promise<Found> {
  const dirs = await Promise.all(plugins.map(async (plugin) => ({ plugin, dir: await processDir(plugin.dir) })));
  return oneHolder(dirs.filter((h) => h.dir !== ""));
}

export async function readProcess(plugins: readonly PluginDir[]): Promise<Result<Process>> {
  const found = await findProcess(plugins);
  if (found.kind !== "ok") {
    return found.kind === "none" ? { kind: "ok", value: BUILT_IN } : found;
  }
  return processAt(found.value.plugin.label, found.value.plugin.dir, found.value.dir);
}
