// layers — the settings files, read on the host before every run (#229; docs/DESIGN.md section 5 "Settings"). All
// live in the factory home, outside the product repo, so a branch never chooses its own settings (ADR-0012 S12), and
// no run's agent is ever handed them:
//
//   <home>/teams/<team>/team.json      the team layer: a git clone, read at the commit the project pins
//   <home>/projects/<project>.json     the project layer; "team": "<team>@<commit>" pins the team
//   <home>/user.json                   the user layer
//   FACTORY_* variables                the machine layer (keys.ts names each one)
//
// FACTORY_HOME picks the home, so a work home and a personal home never share a layer.
// The team file holds settings in the project file's shape, plus "modes": {"<key>": "locked" | "default" | "open"}.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { codeOf, prop } from "../dispatch/records.js";
import { hostGit } from "../git.js";
import { POLICY_POINTS } from "../plugin/policy.js";
import { keyById, PROJECT_META, TEAM_META } from "./keys.js";
import { keyLines } from "./lines.js";
import { resolve, TEAM_MODES, type FileLayer, type Problem, type Resolution, type TeamMode } from "./resolve.js";

export type Pin = { readonly team: string; readonly commit: string };

const TEAM_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function error(text: string): Problem {
  return { level: "error", text };
}

function failed(text: string): Read {
  return { kind: "failed", text };
}

function pinParts(value: unknown): readonly string[] {
  return typeof value === "string" ? value.split("@") : [];
}

function goodPin(team: string, commit: string, rest: readonly string[]): boolean {
  return TEAM_NAME.test(team) && !team.includes("..") && COMMIT.test(commit) && rest.length === 0;
}

// pinOf : the project's team pin, none, or why it is not one
export function pinOf(value: unknown): Pin | "none" | "bad" {
  if (value === undefined) {
    return "none";
  }
  const [team = "", commit = "", ...rest] = pinParts(value);
  return goodPin(team, commit, rest) ? { team, commit } : "bad";
}

export function teamDir(home: string, team: string): string {
  return join(home, "teams", team);
}

export function userPath(home: string): string {
  return join(home, "user.json");
}

export type Read =
  | { readonly kind: "ok"; readonly layer: FileLayer }
  | { readonly kind: "none" }
  | { readonly kind: "failed"; readonly text: string };

function parsedLayer(name: FileLayer["name"], file: string, text: string): Read {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return failed(`${file}: is not a JSON object`);
  }
  return isObject(value)
    ? { kind: "ok", layer: { name, file, value, lines: keyLines(text) } }
    : failed(`${file}: is not a JSON object`);
}

async function readUser(home: string): Promise<Read> {
  const file = userPath(home);
  try {
    return parsedLayer("user", file, await readFile(file, "utf8"));
  } catch (e) {
    return codeOf(e) === "ENOENT" ? { kind: "none" } : failed(`${file}: cannot be read`);
  }
}

// readTeamAt : the team file as it is at one commit of the team's clone, read through hostGit (#87)
export async function readTeamAt(home: string, pin: Pin, env: NodeJS.ProcessEnv): Promise<Read> {
  const dir = teamDir(home, pin.team);
  const got = await hostGit({
    args: ["cat-file", "blob", `${pin.commit}:team.json`],
    repo: { kind: "repo", path: dir },
    env,
    stdin: { kind: "none" },
  });
  const file = `${join(dir, "team.json")}@${pin.commit.slice(0, 12)}`;
  return got.kind === "ok"
    ? parsedLayer("team", file, got.stdout)
    : failed(
        `${file}: cannot be read from the team's clone; run git fetch there, or fix the pin (${got.kind === "refused" ? got.reason : got.stderr.trim()})`,
      );
}

type ModeRead = { readonly kind: "mode"; readonly mode: TeamMode } | { readonly kind: "bad"; readonly why: string };

function canOpen(keyClass: string): boolean {
  return keyClass === "allow-list" || keyClass === "preference";
}

function modeFor(id: string, keyClass: string, mode: unknown): ModeRead {
  const known = TEAM_MODES.find((m) => m === mode);
  if (known === undefined) {
    return { kind: "bad", why: `"${id}" must be "locked", "default" or "open"` };
  }
  return known === "open" && !canOpen(keyClass)
    ? { kind: "bad", why: `"${id}" is a ${keyClass} key: only an allow-list or a preference can be open` }
    : { kind: "mode", mode: known };
}

function modeOf(id: string, mode: unknown): ModeRead {
  const key = keyById(id);
  return key === undefined
    ? { kind: "bad", why: `names ${JSON.stringify(id)}, which is not a settings key` }
    : modeFor(id, key.class, mode);
}

type Modes = { readonly modes: Map<string, TeamMode>; readonly problems: readonly Problem[] };

function modeEntry(file: string, [id, mode]: readonly [string, unknown]): Modes {
  const read = modeOf(id, mode);
  return read.kind === "bad"
    ? { modes: new Map(), problems: [error(`${file}: "${TEAM_META}" ${read.why}`)] }
    : { modes: new Map([[id, read.mode]]), problems: [] };
}

// modesOf : the team's mode per key; a mode that is not one is an error
export function modesOf(team: FileLayer | undefined): Modes {
  if (team === undefined || !Object.hasOwn(team.value, TEAM_META)) {
    return { modes: new Map(), problems: [] };
  }
  const raw = prop(team.value, TEAM_META);
  if (!isObject(raw)) {
    return { modes: new Map(), problems: [error(`${team.file}: "${TEAM_META}" must map keys to modes`)] };
  }
  const each = Object.entries(raw).map((e) => modeEntry(team.file, e));
  return {
    modes: new Map(each.flatMap((m) => [...m.modes])),
    problems: each.flatMap((m) => m.problems),
  };
}

// halves : a team or user file that sets one policy point sets both its mode and its cap, as the project file must
function halves(layer: FileLayer): readonly Problem[] {
  const policy = prop(layer.value, "policy");
  return POLICY_POINTS.flatMap((point) => {
    const rule: unknown = isObject(policy) ? policy[point] : undefined;
    const both = !isObject(rule) || (Object.hasOwn(rule, "mode") && Object.hasOwn(rule, "cap"));
    return both ? [] : [error(`${layer.file}: policy.${point} must set both "mode" and "cap"`)];
  });
}

export type Layered = Resolution & { readonly pin: Pin | "none" };

type Project = { readonly path: string; readonly text: string; readonly value: object };

async function teamLayer(
  home: string,
  value: object,
  env: NodeJS.ProcessEnv,
): Promise<{ readonly pin: Pin | "none"; readonly read: Read }> {
  const pin = pinOf(prop(value, PROJECT_META));
  if (pin === "bad") {
    return {
      pin: "none",
      read: failed(`"${PROJECT_META}" must be "<team>@<commit>", the team's name and a full commit id`),
    };
  }
  return { pin, read: pin === "none" ? { kind: "none" } : await readTeamAt(home, pin, env) };
}

function layerOf(read: Read): readonly FileLayer[] {
  return read.kind === "ok" ? [read.layer] : [];
}

function problemOf(read: Read, file: string): readonly Problem[] {
  return read.kind === "failed" ? [error(read.text.startsWith('"') ? `${file}: ${read.text}` : read.text)] : [];
}

// layered : every layer of one project, resolved. `team` replaces the pinned team file (team update reads the new pin)
export async function layered(input: {
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  readonly project: Project;
  readonly team?: Read;
}): Promise<Layered> {
  const lines = keyLines(input.project.text);
  const project: FileLayer = { name: "project", file: input.project.path, value: input.project.value, lines };
  const team = await teamLayer(input.home, input.project.value, input.env);
  const teamRead = input.team ?? team.read;
  const user = await readUser(input.home);
  const files = [...layerOf(teamRead), project, ...layerOf(user)];
  const modes = modesOf(files.find((l) => l.name === "team"));
  const read = [...problemOf(teamRead, input.project.path), ...problemOf(user, userPath(input.home))];
  const pairs = files.filter((l) => l.name !== "project").flatMap(halves);
  const resolution = resolve({
    layers: files,
    modes: modes.modes,
    env: input.env,
    problems: [...read, ...modes.problems, ...pairs],
  });
  return { ...resolution, pin: team.pin };
}

// refusals : the errors, as one reason a run is refused with; "" when there are none
export function refusals(resolution: Resolution): string {
  return resolution.problems
    .filter((p) => p.level === "error")
    .map((p) => p.text)
    .join("; ");
}
