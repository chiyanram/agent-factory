// machine — the one adapter between the FACTORY_* variables and the settings (#254). The variables are the machine
// layer, the lowest one; a module reads a machine key only through settingOf, never its variable, so a team or user
// file value reaches it the same way (test/settings-read.test.ts fails on a direct read).
//
// A run resolves the layers once on the host (project.ts runSettings) and hands its modules runEnv's result: the same
// variables, with each machine key a file layer set put in its variable. The agent CLI never gets them: claudeEnv
// passes no FACTORY_* variable (ADR-0012 S2).

import type { Resolution } from "./resolve.js";
import { MACHINE_KEYS, type MachineId } from "./variables.js";

function variableOf(id: MachineId): string {
  const key = MACHINE_KEYS.find((k) => k.id === id);
  if (key === undefined) {
    throw new Error(`${id} is not a machine key`);
  }
  return key.env;
}

// settingOf : a machine key's resolved value as text, or undefined when no layer sets it
export function settingOf(env: NodeJS.ProcessEnv, id: MachineId): string | undefined {
  return env[variableOf(id)];
}

// settingName : the variable a machine key is read from, for a message that names it
export function settingName(id: MachineId): string {
  return variableOf(id);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

// runEnv : the env a run's modules read, with every machine key a team, project or user file set in its variable
export function runEnv(env: NodeJS.ProcessEnv, resolution: Resolution): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const r of resolution.values) {
    const fromFile = r.sources.some((s) => s.layer === "team" || s.layer === "project" || s.layer === "user");
    if (r.key.where === "machine" && r.set && fromFile) {
      out[r.key.env] = asText(r.value);
    }
  }
  return out;
}
