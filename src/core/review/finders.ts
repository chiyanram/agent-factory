// finders — what each finder run of a review round is given: its lens, its rubric and its pack (docs/explanation/architecture.md
// sections 3 and 5). The round (round.ts) picks the lenses with pickLenses and runs one fresh finder per lens; this
// module reads the settings the pick needs, each lens's rubric, and writes the lens into the pack.
//
//   lensSetupOf   the project's lenses ("review.lenses"), one-way-door paths and test files, with the layers resolved;
//                 no project file is no lenses, no one-way door and the built-in test files
//   roundLenses   the lenses a round picks from: the project's, or with none the baseline lens alone, and always the
//                 test-integrity lens unless the project names its own: the `code` skill, held to the edits to
//                 existing tests
//   touchedOf     the files the change touches, and whether each was there before
//   rubricText    a lens's rubric: a skill in an enabled plugin, by name (docs/adr/0026-the-engine-owns-its-process.md),
//                 or a repo file at the default branch's commit the rules came from; never from the change, so a change
//                 cannot rewrite its rubric. A skill's SKILL.md is pasted and the skill is copied into the run folder
//                 (skills.ts); a baseline skill is already in section 4, so it is named, not pasted again. A reference
//                 the lens still names is dropped, and the rubric says so
//   lensPack      the pack with the lens's rubric as section 8; the baseline lens's pack is the pack itself

import { join } from "node:path";
import type { Result } from "../forge/api.js";
import { hostGit } from "../git.js";
import { oneWayDoorPathsOf } from "../lane.js";
import type { PluginDir } from "../process/read.js";
import { readProjectRaw } from "../project.js";
import { TEST_FILES } from "../ready/floor.js";
import { fence } from "./fence.js";
import { findSkills, skillBlock, type Skill } from "./skills.js";
import { BASELINE_LENS, TEST_INTEGRITY, type Lens, type Rubric, type Touched } from "./lenses.js";
import { LENSES_HINT, lensListOf } from "./lens-list.js";
import { prop } from "../field.js";

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

function lensesIn(path: string, value: object): Result<readonly Lens[]> {
  const listed = prop(prop(value, "review"), "lenses");
  const lenses = listed === undefined ? [] : lensListOf(listed);
  return lenses === "bad" ? failed(`${path}: "review.lenses" must be ${LENSES_HINT}`) : { kind: "ok", value: lenses };
}

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

export const BASELINE: Lens = { name: BASELINE_LENS, rubric: { kind: "baseline" }, paths: [], lanes: [] };

const TEST_INTEGRITY_FOCUS =
  "Check only the edits to existing tests: walk the diff of every existing test, snapshot and golden file, with the spec beside it, as the `code` skill says for edits to existing tests.";

export const BUILT_IN_TEST_INTEGRITY: Lens = {
  name: TEST_INTEGRITY,
  rubric: { kind: "skill", plugin: "", skill: "code", focus: TEST_INTEGRITY_FOCUS },
  paths: [],
  lanes: [],
};

export function roundLenses(configured: readonly Lens[]): readonly Lens[] {
  const own = configured.length === 0 ? [BASELINE] : configured;
  return own.some((l) => l.name === TEST_INTEGRITY) ? own : [...own, BUILT_IN_TEST_INTEGRITY];
}

export function touchedOf(nameStatus: string): readonly Touched[] {
  const parts = nameStatus.split("\u0000").filter((p) => p !== "");
  const touched: Touched[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    touched.push({ path: parts[i + 1] ?? "", existed: !(parts[i] ?? "").startsWith("A") });
  }
  return touched;
}

export type LensRubric = { readonly text: string; readonly skills: readonly Skill[] };

type SkillRubric = Extract<Rubric, { readonly kind: "skill" }>;

async function firstHolding(rubric: SkillRubric, plugins: readonly PluginDir[]): Promise<Result<string>> {
  const dir = (await findSkills(plugins, [rubric.skill])).present[0]?.dir;
  return dir === undefined ? failed(`no listed plugin has the ${rubric.skill} skill`) : { kind: "ok", value: dir };
}

async function skillFolder(rubric: SkillRubric, plugins: readonly PluginDir[]): Promise<Result<string>> {
  if (rubric.plugin === "") {
    return firstHolding(rubric, plugins);
  }
  const dir = plugins.find((p) => p.label === rubric.plugin || p.label.startsWith(`${rubric.plugin}@`))?.dir;
  return dir === undefined
    ? failed(`no enabled plugin is named ${rubric.plugin}`)
    : { kind: "ok", value: join(dir, "skills", rubric.skill) };
}

function rubricNotes(rubric: SkillRubric): readonly string[] {
  const dropped =
    rubric.reference === undefined
      ? []
      : [
          `The lens names the \`${rubric.reference}\` reference of the \`${rubric.skill}\` skill. The engine names skills only, so it was dropped: walk the whole skill.`,
        ];
  return [...(rubric.focus === undefined ? [] : [rubric.focus]), ...dropped];
}

async function skillRubric(
  rubric: SkillRubric,
  plugins: readonly PluginDir[],
  baseline: readonly string[],
): Promise<Result<LensRubric>> {
  const folder = await skillFolder(rubric, plugins);
  if (folder.kind === "failed") {
    return folder;
  }
  if (rubric.plugin === "" && baseline.includes(rubric.skill)) {
    const named = `The rubric is the \`${rubric.skill}\` skill in section 4.`;
    return { kind: "ok", value: { text: [named, ...rubricNotes(rubric)].join("\n\n"), skills: [] } };
  }
  const skill = { name: rubric.skill, dir: folder.value };
  const block = await skillBlock(skill);
  return block.kind === "ok"
    ? { kind: "ok", value: { text: [block.value, ...rubricNotes(rubric)].join("\n"), skills: [skill] } }
    : block;
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

async function lensRubric(r: Rubric, from: Parameters<typeof rubricText>[1]): Promise<Result<LensRubric>> {
  if (r.kind === "baseline") {
    return { kind: "ok", value: { text: "", skills: [] } };
  }
  if (r.kind === "skill") {
    return skillRubric(r, from.plugins, from.baseline);
  }
  const text = await fileText(r.path, from);
  return text.kind === "ok" ? { kind: "ok", value: { text: text.value, skills: [] } } : text;
}

export async function rubricText(
  lens: Lens,
  from: {
    readonly plugins: readonly PluginDir[];
    readonly baseline: readonly string[];
    readonly repo: string;
    readonly env: NodeJS.ProcessEnv;
    readonly master: string;
  },
): Promise<Result<LensRubric>> {
  const read = await lensRubric(lens.rubric, from);
  return read.kind === "ok" ? read : failed(`the rubric of the lens ${lens.name}: ${read.reason}`);
}

export function lensPack(pack: string, lens: Lens, rubric: string): string {
  if (lens.rubric.kind === "baseline") {
    return pack;
  }
  return `${pack}\n## 8 · This finder's lens: ${lens.name}\n\nYou are the finder for this one lens. Walk every check of its rubric below, with the baseline review checks of section 4, and report each finding the rubric names as a Standards finding; other finders cover the other lenses.\n${fence({ title: `lens ${lens.name}`, text: rubric, info: "markdown" })}`;
}
