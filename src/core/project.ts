// project — the project file on this machine (ADR-0014 P3): <FACTORY_HOME>/projects/<project>.json. Never a repo
// file, so a branch cannot choose its own gate or the programs its evidence may run (ADR-0012 S12; #91). This reader
// takes only what the ready check and the local verifier need; the plugin fields come with #134, and fields it does
// not know are left alone.
//
//   {
//     "gate": "forge-ci" | "local",          where the gate's result comes from
//     "verify": ["make", "verify"],          the local verifier's one command, run with no shell (gate local only)
//     "ready": {
//       "programs": ["make", "./gradlew"],   the programs an evidence row may start with
//       "timeoutMinutes": 30                 per command (default 30, at most 240)
//     }
//   }

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "./forge/api.js";
import { codeOf, prop } from "./dispatch/records.js";
import { plainName } from "./spec.js";

// a command with no shell: argv[0] is the program
export type Argv = readonly [string, ...string[]];

export type ProjectFile = {
  readonly gate: { readonly kind: "forge-ci" } | { readonly kind: "local"; readonly verify: Argv };
  readonly ready: { readonly programs: readonly string[]; readonly timeoutSeconds: number };
};

const DEFAULT_MINUTES = 30;
const MAX_MINUTES = 240;

function failed(path: string, why: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason: `${path}: ${why}` };
}

function word(value: unknown): value is string {
  return typeof value === "string" && value !== "" && !value.includes("\u0000");
}

// argvOf : a non-empty list of non-empty strings, or "bad"
export function argvOf(value: unknown): Argv | "bad" {
  if (!Array.isArray(value) || !value.every(word)) {
    return "bad";
  }
  const [program, ...rest] = value.filter(word);
  return program === undefined ? "bad" : [program, ...rest];
}

function gateOf(path: string, raw: unknown): Result<ProjectFile["gate"]> {
  const gate = prop(raw, "gate");
  if (gate === "forge-ci") {
    return { kind: "ok", value: { kind: "forge-ci" } };
  }
  if (gate !== "local") {
    return failed(path, `"gate" must be "forge-ci" or "local", got ${JSON.stringify(gate)}`);
  }
  const verify = argvOf(prop(raw, "verify"));
  return verify === "bad"
    ? failed(path, `"verify" must be the verifier's command as a list of words, such as ["make", "verify"]`)
    : { kind: "ok", value: { kind: "local", verify } };
}

function minutesOf(value: unknown): number | "bad" {
  if (value === undefined) {
    return DEFAULT_MINUTES;
  }
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= MAX_MINUTES ? Number(value) : "bad";
}

function readyOf(path: string, raw: unknown): Result<ProjectFile["ready"]> {
  const ready = prop(raw, "ready");
  const programs = prop(ready, "programs");
  if (!Array.isArray(programs) || programs.length === 0 || !programs.every(word)) {
    return failed(path, `"ready.programs" must list the programs an evidence row may start with, such as ["make"]`);
  }
  const minutes = minutesOf(prop(ready, "timeoutMinutes"));
  return minutes === "bad"
    ? failed(path, `"ready.timeoutMinutes" must be a whole number from 1 to ${MAX_MINUTES}`)
    : { kind: "ok", value: { programs: programs.filter(word), timeoutSeconds: minutes * 60 } };
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function fileText(path: string): Promise<Result<string>> {
  try {
    return { kind: "ok", value: await readFile(path, "utf8") };
  } catch (error) {
    return failed(
      path,
      codeOf(error) === "ENOENT"
        ? "no project file; write one (gate, verify, ready.programs) before the ready check or the verifier runs"
        : "cannot read the project file",
    );
  }
}

// readProjectFile : the project's file, each field checked; a field that is there but not valid is refused
function fromRaw(path: string, raw: unknown): Result<ProjectFile> {
  const gate = typeof raw === "object" && raw !== null ? gateOf(path, raw) : failed(path, "is not a JSON object");
  if (gate.kind === "failed") {
    return gate;
  }
  const ready = readyOf(path, raw);
  return ready.kind === "ok" ? { kind: "ok", value: { gate: gate.value, ready: ready.value } } : ready;
}

export async function readProjectFile(input: {
  readonly home: string;
  readonly project: string;
}): Promise<Result<ProjectFile>> {
  if (!plainName(input.project)) {
    return { kind: "failed", reason: `${JSON.stringify(input.project)} is not a plain project name` };
  }
  const path = join(input.home, "projects", `${input.project}.json`);
  const read = await fileText(path);
  return read.kind === "ok" ? fromRaw(path, parsed(read.value)) : read;
}
