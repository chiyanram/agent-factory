// finders — what each finder run of a review round is given: its lens, its rubric and its pack (#237; docs/DESIGN.md
// sections 3 and 5). The round (round.ts) picks the lenses with pickLenses and runs one fresh finder per lens; this
// module reads the settings the pick needs, each lens's rubric, and writes the lens into the pack.
//
//   lensSetupOf   the project's lenses ("review.lenses"), one-way-door paths and test files, with the layers resolved;
//                 no project file is no lenses, no one-way door and the built-in test files
//   roundLenses   the lenses a round picks from: the project's, or with none the baseline lens alone, and always the
//                 test-integrity lens, the crq test-integrity reference, unless the project names its own
//   touchedOf     the files the change touches, and whether each was there before
//   rubricText    a lens's rubric: a skill's SKILL.md or reference in an enabled plugin, or a repo file at the default
//                 branch's commit the rules came from; never from the change, so a change cannot rewrite its rubric
//   lensPack      the pack with the lens's rubric as section 8; the baseline lens's pack is the pack itself

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prop } from "../dispatch/records.js";
import type { Result } from "../forge/api.js";
import { hostGit } from "../git.js";
import { oneWayDoorPathsOf } from "../lane.js";
import type { PluginDir } from "../process/read.js";
import { readProjectRaw } from "../project.js";
import { TEST_FILES } from "../ready/floor.js";
import { fence } from "./fence.js";
import { BASELINE_LENS, TEST_INTEGRITY, type Lens, type Rubric, type Touched } from "./lenses.js";
import { LENSES_HINT, lensListOf } from "./lens-list.js";

export type LensSetup = {
  readonly lenses: readonly Lens[];
  readonly oneWayDoor: readonly string[];
  readonly testFiles: readonly string[];
};

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function testFilesOf(value: unknown): readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every((g) => typeof g === "string" && g !== "")
    ? value.filter((g): g is string => typeof g === "string")
    : TEST_FILES;
}

// lensesIn : the "review.lenses" of a project's settings; none when it names none
function lensesIn(path: string, value: object): Result<readonly Lens[]> {
  const listed = prop(prop(value, "review"), "lenses");
  const lenses = listed === undefined ? [] : lensListOf(listed);
  return lenses === "bad" ? failed(`${path}: "review.lenses" must be ${LENSES_HINT}`) : { kind: "ok", value: lenses };
}

// lensSetupOf : what the lens pick reads from the project's settings; a lens list that is not one is refused
export async function lensSetupOf(where: {
  readonly home: string;
  readonly project: string;
}): Promise<Result<LensSetup>> {
  const raw = await readProjectRaw(where, "no project file");
  if (raw.kind === "failed") {
    return raw;
  }
  const read = raw.kind === "ok" ? raw : { path: where.project, value: {} };
  const lenses = lensesIn(read.path, read.value);
  if (lenses.kind === "failed") {
    return lenses;
  }
  const oneWayDoor = await oneWayDoorPathsOf(where);
  const testFiles = testFilesOf(prop(prop(read.value, "ready"), "testFiles"));
  return oneWayDoor.kind === "ok"
    ? { kind: "ok", value: { lenses: lenses.value, oneWayDoor: oneWayDoor.value, testFiles } }
    : oneWayDoor;
}

// the lens a project that names none runs: one finder on the baseline review checks
export const BASELINE: Lens = { name: BASELINE_LENS, rubric: { kind: "baseline" }, paths: [], lanes: [] };

// the built-in test-integrity lens: the crq test-integrity reference of the plugin the review references come from
// (plugin "" names that plugin; chiyanram/skills#235)
export const BUILT_IN_TEST_INTEGRITY: Lens = {
  name: TEST_INTEGRITY,
  rubric: { kind: "skill", plugin: "", skill: "crq", reference: "test-integrity" },
  paths: [],
  lanes: [],
};

// roundLenses : the lenses a round picks from. Pure.
export function roundLenses(configured: readonly Lens[]): readonly Lens[] {
  const own = configured.length === 0 ? [BASELINE] : configured;
  return own.some((l) => l.name === TEST_INTEGRITY) ? own : [...own, BUILT_IN_TEST_INTEGRITY];
}

// touchedOf : the change's files from `git diff --name-status -z`, a status then a path each; added ones did not
// exist before. Pure.
export function touchedOf(nameStatus: string): readonly Touched[] {
  const parts = nameStatus.split("\u0000").filter((p) => p !== "");
  const touched: Touched[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    touched.push({ path: parts[i + 1] ?? "", existed: !(parts[i] ?? "").startsWith("A") });
  }
  return touched;
}

// where a skill rubric's plugin is: "" is the plugin the review's references come from; a name matches a plugin's
// label, with or without its @marketplace
function pluginDir(plugin: string, references: string, plugins: readonly PluginDir[]): string | undefined {
  if (plugin === "") {
    return references;
  }
  return plugins.find((p) => p.label === plugin || p.label.startsWith(`${plugin}@`))?.dir;
}

async function skillText(
  rubric: Extract<Rubric, { readonly kind: "skill" }>,
  from: { readonly references: string; readonly plugins: readonly PluginDir[] },
): Promise<Result<string>> {
  const dir = pluginDir(rubric.plugin, from.references, from.plugins);
  if (dir === undefined) {
    return failed(`no enabled plugin is named ${rubric.plugin}`);
  }
  const skill = join(dir, "skills", rubric.skill);
  const path =
    rubric.reference === undefined ? join(skill, "SKILL.md") : join(skill, "references", `${rubric.reference}.md`);
  const text = await readFile(path, "utf8").catch(() => undefined);
  return text === undefined ? failed(`cannot read ${path}`) : { kind: "ok", value: text };
}

async function fileText(
  path: string,
  at: { readonly repo: string; readonly env: NodeJS.ProcessEnv; readonly master: string },
): Promise<Result<string>> {
  const shown = await hostGit({
    args: ["show", `${at.master}:${path}`],
    repo: { kind: "repo", path: at.repo },
    env: at.env,
    stdin: { kind: "none" },
  });
  return shown.kind === "ok"
    ? { kind: "ok", value: shown.stdout }
    : failed(`cannot read ${path} at ${at.master.slice(0, 8)} on the default branch`);
}

// rubricText : a lens's rubric; "" for the baseline lens, whose checks are in the pack already
export async function rubricText(
  lens: Lens,
  from: {
    readonly references: string;
    readonly plugins: readonly PluginDir[];
    readonly repo: string;
    readonly env: NodeJS.ProcessEnv;
    readonly master: string;
  },
): Promise<Result<string>> {
  const r = lens.rubric;
  const text =
    r.kind === "baseline"
      ? { kind: "ok" as const, value: "" }
      : r.kind === "file"
        ? await fileText(r.path, from)
        : await skillText(r, from);
  return text.kind === "ok" ? text : failed(`the rubric of the lens ${lens.name}: ${text.reason}`);
}

// lensPack : the finder's pack: the round's pack, then the lens's rubric as section 8, fenced as data. Pure.
export function lensPack(pack: string, lens: Lens, rubric: string): string {
  if (lens.rubric.kind === "baseline") {
    return pack;
  }
  return `${pack}\n## 8 · This finder's lens: ${lens.name}\n\nYou are the finder for this one lens. Walk every check of its rubric below, with the baseline review checks of section 4, and report each finding the rubric names as a Standards finding; other finders cover the other lenses.\n${fence({ title: `lens ${lens.name}`, text: rubric, info: "markdown" })}`;
}
