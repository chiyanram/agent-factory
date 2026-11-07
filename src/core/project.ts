// project — the project file on this machine (ADR-0014 P3): <FACTORY_HOME>/projects/<project>.json. Never a repo
// file, so a branch cannot choose its own gate or the programs its evidence may run (ADR-0012 S12; #91). This reader
// takes only what the ready check, the local verifier and the box's egress need; the plugin fields come with #134, and
// fields it does not know are left alone.
//
//   {
//     "gate": "forge-ci" | "local",          where the gate's result comes from
//     "verify": ["make", "verify"],          the local verifier's one command, run with no shell (gate local only)
//     "ready": {
//       "programs": ["make", "./gradlew"],   the programs an evidence row may start with
//       "timeoutMinutes": 30                 per command (default 30, at most 240)
//     },
//     "egress": {
//       "allow": ["api.anthropic.com"]       the hosts this project's boxes may reach (#130; egress/allowlist.ts);
//     }                                      none means no box runs for the project
//   }

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "./forge/api.js";
import { codeOf, prop } from "./dispatch/records.js";
import { plainName } from "./spec.js";
import { parseAllowlist } from "./egress/allowlist.js";

// a command with no shell: argv[0] is the program
export type Argv = readonly [string, ...string[]];

// a read: the file, none at all (the project uses no ready check or verifier yet), or one that is there but refused
export type ProjectRead =
  | { readonly kind: "ok"; readonly value: ProjectFile }
  | { readonly kind: "missing"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

export type ProjectFile = {
  readonly gate: { readonly kind: "forge-ci" } | { readonly kind: "local"; readonly verify: Argv };
  readonly ready: { readonly programs: readonly string[]; readonly timeoutSeconds: number };
  // the hosts the project's boxes may reach, checked; empty when the file names none
  readonly egress: { readonly allow: readonly string[] };
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

function allowOf(egress: unknown): readonly string[] | "bad" {
  const allow = prop(egress, "allow");
  return Array.isArray(allow) && allow.every(word) ? allow.filter(word) : "bad";
}

function egressOf(path: string, raw: unknown): Result<ProjectFile["egress"]> {
  const egress = prop(raw, "egress");
  if (egress === undefined) {
    return { kind: "ok", value: { allow: [] } };
  }
  const allow = allowOf(egress);
  if (allow === "bad") {
    return failed(path, `"egress.allow" must list host names, such as ["api.anthropic.com"]`);
  }
  const list = parseAllowlist(allow);
  return list.kind === "ok"
    ? { kind: "ok", value: { allow: list.hosts } }
    : failed(path, `"egress.allow": ${list.reason}`);
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function fileText(path: string): Promise<Result<string> | Extract<ProjectRead, { kind: "missing" }>> {
  try {
    return { kind: "ok", value: await readFile(path, "utf8") };
  } catch (error) {
    return codeOf(error) === "ENOENT"
      ? {
          kind: "missing",
          reason: `${path}: no project file; write one (gate, verify, ready.programs) before the ready check or the verifier runs`,
        }
      : failed(path, "cannot read the project file");
  }
}

function fields(path: string, raw: object): Result<ProjectFile> {
  const gate = gateOf(path, raw);
  if (gate.kind === "failed") {
    return gate;
  }
  const ready = readyOf(path, raw);
  if (ready.kind === "failed") {
    return ready;
  }
  const egress = egressOf(path, raw);
  return egress.kind === "ok"
    ? { kind: "ok", value: { gate: gate.value, ready: ready.value, egress: egress.value } }
    : egress;
}

// fromRaw : the project's file, each field checked; a field that is there but not valid is refused
function fromRaw(path: string, raw: unknown): Result<ProjectFile> {
  return typeof raw === "object" && raw !== null ? fields(path, raw) : failed(path, "is not a JSON object");
}

export async function readProjectFile(input: {
  readonly home: string;
  readonly project: string;
}): Promise<ProjectRead> {
  if (!plainName(input.project)) {
    return { kind: "failed", reason: `${JSON.stringify(input.project)} is not a plain project name` };
  }
  const path = join(input.home, "projects", `${input.project}.json`);
  const read = await fileText(path);
  return read.kind === "ok" ? fromRaw(path, parsed(read.value)) : read;
}
