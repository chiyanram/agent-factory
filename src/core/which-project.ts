// which-project — the project a command acts on when it may name none (#382): poll, status, ask and grill, and
// the coordinator's session. Each reads the project's git host, its project there and its
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
import { projectOfFile, projectPath } from "./project.js";
import { settingOf } from "./settings/machine.js";
import { plainName } from "./spec.js";

export const DEFAULT_PROJECT = "FACTORY_DEFAULT_PROJECT";

export async function projectNames(home: string): Promise<readonly string[]> {
  const entries = await readdir(join(home, "projects"), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile())
    .map((e) => projectOfFile(e.name))
    .filter((project) => project !== undefined)
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
  readonly project: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly usage: string;
};

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
