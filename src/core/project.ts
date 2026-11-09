// project — the project file on this machine (ADR-0014 P3): <FACTORY_HOME>/projects/<project>.json. Never a repo
// file, so a branch cannot choose its own gate or the programs its evidence may run (ADR-0012 S12; #91). This reader
// takes only what the ready check, the local verifier and the box's egress need; the plugin fields, "plugins" and
// "policy", are read by plugin/config.ts (#134), and fields it does not know are left alone.
//
//   {
//     "gate": "forge-ci" | "local",          where the gate's result comes from
//     "verify": ["make", "verify"],          the local verifier's one command, run with no shell (gate local only)
//     "ready": {
//       "programs": ["make", "./gradlew"],   the programs an evidence row may start with
//       "timeoutMinutes": 30,                per command (default 30, at most 240)
//       "testFiles": ["src/test/**"],        the floor guard's test files (default: ready/floor.ts TEST_FILES)
//       "judgeFiles": ["ci/**"]              more judge files (#231), added to ready/judge.ts's, never in their place
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
import { TEST_FILES } from "./ready/floor.js";

// a command with no shell: argv[0] is the program
export type Argv = readonly [string, ...string[]];

// a read: the file, none at all (the project uses no ready check or verifier yet), or one that is there but refused
export type ProjectRead =
  | { readonly kind: "ok"; readonly value: ProjectFile }
  | { readonly kind: "missing"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

export type ProjectFile = {
  readonly gate: { readonly kind: "forge-ci" } | { readonly kind: "local"; readonly verify: Argv };
  readonly ready: {
    readonly programs: readonly string[];
    readonly timeoutSeconds: number;
    // the globs the floor guard reads as test files (#190)
    readonly testFiles: readonly string[];
    // the judge files this project adds to the built-in ones (#231; ready/judge.ts judgeFiles); none is []
    readonly judgeFiles: readonly string[];
  };
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

function programsOf(value: unknown): readonly string[] | "bad" {
  return Array.isArray(value) && value.length > 0 && value.every(word) ? value.filter(word) : "bad";
}

function readyOf(path: string, raw: unknown): Result<ProjectFile["ready"]> {
  const ready = prop(raw, "ready");
  const programs = programsOf(prop(ready, "programs"));
  if (programs === "bad") {
    return failed(path, `"ready.programs" must list the programs an evidence row may start with, such as ["make"]`);
  }
  const minutes = minutesOf(prop(ready, "timeoutMinutes"));
  const testFiles = testFilesOf(prop(ready, "testFiles"));
  if (testFiles === "bad") {
    return failed(path, `"ready.testFiles" must list globs, such as ["src/test/**", "**/*Spec.groovy"]`);
  }
  const judgeFiles = judgeFilesOf(prop(ready, "judgeFiles"));
  if (judgeFiles === "bad") {
    return failed(path, `"ready.judgeFiles" must list globs, such as ["ci/**"]`);
  }
  return minutes === "bad"
    ? failed(path, `"ready.timeoutMinutes" must be a whole number from 1 to ${MAX_MINUTES}`)
    : { kind: "ok", value: { programs, timeoutSeconds: minutes * 60, testFiles, judgeFiles } };
}

// judgeFilesOf : the project's added judge files; a deny-list key, so none adds nothing and an empty list is fine
function judgeFilesOf(value: unknown): readonly string[] | "bad" {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) && value.every(word) ? value.filter(word) : "bad";
}

function testFilesOf(value: unknown): readonly string[] | "bad" {
  if (value === undefined) {
    return TEST_FILES;
  }
  return Array.isArray(value) && value.length > 0 && value.every(word) ? value.filter(word) : "bad";
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

type Missing = { readonly kind: "missing"; readonly reason: string };

async function fileText(path: string, missing: string): Promise<Result<string> | Missing> {
  try {
    return { kind: "ok", value: await readFile(path, "utf8") };
  } catch (error) {
    return codeOf(error) === "ENOENT"
      ? { kind: "missing", reason: `${path}: no project file; ${missing}` }
      : failed(path, "cannot read the project file");
  }
}

export function projectPath(home: string, project: string): string {
  return join(home, "projects", `${project}.json`);
}

// a read of the file as JSON, not yet checked: its path and its value, none at all, or one that is refused
export type RawRead =
  | { readonly kind: "ok"; readonly path: string; readonly value: object }
  | Missing
  | { readonly kind: "failed"; readonly reason: string };

// readProjectRaw : the project's file as one JSON object; `missing` says what the caller needs it for
export async function readProjectRaw(
  input: { readonly home: string; readonly project: string },
  missing: string,
): Promise<RawRead> {
  if (!plainName(input.project)) {
    return { kind: "failed", reason: `${JSON.stringify(input.project)} is not a plain project name` };
  }
  const path = projectPath(input.home, input.project);
  const read = await fileText(path, missing);
  if (read.kind !== "ok") {
    return read;
  }
  const raw = parsed(read.value);
  return isObject(raw) ? { kind: "ok", path, value: raw } : failed(path, "is not a JSON object");
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export async function readProjectFile(input: {
  readonly home: string;
  readonly project: string;
}): Promise<ProjectRead> {
  const raw = await readProjectRaw(input, NO_GATE);
  return raw.kind === "ok" ? readyFieldsOf(raw.path, raw.value) : raw;
}

const NO_GATE = "write gate, verify and ready.programs before the ready check or the verifier runs";
const READY_KEYS = ["gate", "verify", "ready", "egress"];

// readyFieldsOf : the ready check's fields of one project file's JSON. A file with none of them, such as one that
// `project init` wrote for the plugin fields alone, reads as no ready settings, the same as no file; once any is there,
// each is checked, so a typo never turns a local gate into forge CI.
export function readyFieldsOf(path: string, raw: object): ProjectRead {
  return READY_KEYS.some((k) => Object.hasOwn(raw, k))
    ? fields(path, raw)
    : { kind: "missing", reason: `${path}: no gate yet; ${NO_GATE}` };
}
