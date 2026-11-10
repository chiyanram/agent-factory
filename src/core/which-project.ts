// which-project — the project a command acts on when it may name none (#382): poll, claim, release, status, ask,
// block and reconcile, and the coordinator's session. Each reads the project's git host, its project there and its
// clone from the project file through settingOf, so the coordinator needs no FACTORY_* export.
//
//   1. the <project> the command names
//   2. FACTORY_DEFAULT_PROJECT, which `agent-factory coordinator <project>` sets for its own session
//   3. none, when FACTORY_PROJECT is exported: the old form, read from the variables alone, as before #382
//   4. the one project in <home>/projects, when it holds exactly one
//
// Anything else is refused with what to name, never guessed.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "./forge/api.js";
import { projectPath } from "./project.js";
import { settingOf } from "./settings/machine.js";
import { plainName } from "./spec.js";

// the variable `agent-factory coordinator` sets in its session for the project it was started for
export const DEFAULT_PROJECT = "FACTORY_DEFAULT_PROJECT";

// projectNames : the projects in <home>/projects, one per <project>.json, sorted; none when the folder is missing
export async function projectNames(home: string): Promise<readonly string[]> {
  const entries = await readdir(join(home, "projects"), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name.slice(0, -".json".length))
    .filter(plainName)
    .toSorted();
}

async function named(home: string, project: string, from: string): Promise<Result<string>> {
  if (!plainName(project)) {
    return { kind: "failed", reason: `${JSON.stringify(project)}${from} is not a plain project name` };
  }
  const known = await projectNames(home);
  return known.includes(project)
    ? { kind: "ok", value: project }
    : {
        kind: "failed",
        reason: `no project file ${projectPath(home, project)}${from}; run agent-factory init in the project's clone${others(known)}`,
      };
}

function others(known: readonly string[]): string {
  return known.length === 0 ? "" : `, or name one of ${known.join(", ")}`;
}

export type Choice = {
  readonly home: string;
  // the <project> the command line names, if any
  readonly project: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  // the command's form with a project, for the message that asks to name one: "agent-factory poll <project>"
  readonly usage: string;
};

// chosenProject : the project the command acts on, or undefined for the old form (FACTORY_PROJECT exported, no
// project named); refused when none is named and the factory home holds no project or more than one
export async function chosenProject(c: Choice): Promise<Result<string | undefined>> {
  const fallback = c.env[DEFAULT_PROJECT] ?? "";
  if (c.project !== undefined) {
    return named(c.home, c.project, "");
  }
  return fallback === "" ? unnamed(c) : named(c.home, fallback, ` (${DEFAULT_PROJECT})`);
}

async function unnamed(c: Choice): Promise<Result<string | undefined>> {
  if (settingOf(c.env, "gitHostProject") !== undefined) {
    return { kind: "ok", value: undefined };
  }
  const known = await projectNames(c.home);
  return known.length === 1 ? { kind: "ok", value: known[0] } : { kind: "failed", reason: noneOrMany(c, known) };
}

function noneOrMany(c: Choice, known: readonly string[]): string {
  const folder = join(c.home, "projects");
  return known.length === 0
    ? `no project in ${folder}; run agent-factory init in the project's clone`
    : `${folder} holds ${known.length} projects (${known.join(", ")}); name one: ${c.usage}`;
}
