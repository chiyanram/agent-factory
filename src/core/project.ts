// project — the project file on this machine (ADR-0014 P3): <FACTORY_HOME>/projects/<project>.json. Never a repo
// file, so a branch cannot choose its own gate or the programs its evidence may run (ADR-0012 S12; #91). This reader
// takes only what the ready check, the local verifier and the box's egress need; the connector fields, "connectors"
// and "policy", are read by plugin/config.ts (#134), the "plugins" list by process/plugins.ts (#232), and fields it
// does not know are left alone.
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
import { READY_MINUTES } from "./settings/keys.js";
import { layered, refusals } from "./settings/layers.js";
import { runEnv } from "./settings/machine.js";

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

const DEFAULT_MINUTES = READY_MINUTES.default;
const MAX_MINUTES = READY_MINUTES.most;

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

// readProjectRaw : the project's settings as one JSON object in the project file's shape, with the team and user
// layers resolved into it on this host (#229; settings/layers.ts); `missing` says what the caller needs it for. A
// layer that loosens a safety key refuses the read, so no run starts on it. With no team pin and no user file, the
// value is the project file's own, as it was before the layers.
export async function readProjectRaw(
  input: { readonly home: string; readonly project: string; readonly env?: NodeJS.ProcessEnv },
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
  return isObject(raw) ? withLayers(input, path, read.value, raw) : failed(path, "is not a JSON object");
}

async function withLayers(
  input: { readonly home: string; readonly env?: NodeJS.ProcessEnv },
  path: string,
  text: string,
  value: object,
): Promise<RawRead> {
  const env = input.env ?? process.env;
  const resolved = await layered({ home: input.home, env, project: { path, text, value } });
  const refused = refusals(resolved);
  return refused === ""
    ? { kind: "ok", path, value: resolved.effective }
    : failed(path, `the settings layers refuse to start: ${refused}`);
}

export type RunSettings = { readonly env: NodeJS.ProcessEnv; readonly warnings: readonly string[] };

// runSettings : the layers resolved once on the host before a run (#254): the env its modules read, with each machine
// key a file sets in place (settings/machine.ts), and the warnings to print. A layer that loosens a safety key
// refuses the run. With no project file, the team is none and the user file still applies; a command that names no
// project (poll, claim, reconcile: undefined) resolves only the user and machine layers.
export async function runSettings(input: {
  readonly home: string;
  readonly project: string | undefined;
  readonly env: NodeJS.ProcessEnv;
}): Promise<Result<RunSettings>> {
  if (input.project === undefined) {
    return resolvedRun(input, "(no project)", "{}");
  }
  if (!plainName(input.project)) {
    return { kind: "failed", reason: `${JSON.stringify(input.project)} is not a plain project name` };
  }
  const path = projectPath(input.home, input.project);
  const read = await fileText(path, "");
  return read.kind === "failed" ? read : resolvedRun(input, path, read.kind === "ok" ? read.value : "{}");
}

async function resolvedRun(
  input: { readonly home: string; readonly env: NodeJS.ProcessEnv },
  path: string,
  text: string,
): Promise<Result<RunSettings>> {
  const value = parsed(text);
  if (!isObject(value)) {
    return failed(path, "is not a JSON object");
  }
  const resolved = await layered({ home: input.home, env: input.env, project: { path, text, value } });
  const refused = refusals(resolved);
  const warnings = resolved.problems.filter((p) => p.level === "warning").map((p) => p.text);
  return refused === ""
    ? { kind: "ok", value: { env: runEnv(input.env, resolved), warnings } }
    : failed(path, `the settings layers refuse to start: ${refused}`);
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
