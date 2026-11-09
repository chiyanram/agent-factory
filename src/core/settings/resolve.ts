// resolve — the settings layers combined into one value per key, by each key's class (keys.ts), with where each value
// came from (#229). Pure: the files are read by layers.ts.
//
// Layers from the highest: the engine's fixed values, team, project, user, and the machine (env vars; a machine key's
// FACTORY_* variable is its lowest layer, #254). A lower layer
// may only make a safety key stricter. An attempt to loosen one is an error that names the key, the layer, the file
// and the team value, and the run does not start. A key no class knows is a warning with "did you mean", for one
// release, before it becomes an error (#229).

import { pathKey } from "./lines.js";
import { KEYS, PROJECT_META, TEAM_META, type Key, type KeyClass } from "./keys.js";

export type LayerName = "engine" | "team" | "project" | "user" | "machine" | "default";
export const TEAM_MODES = ["locked", "default", "open"] as const;
export type TeamMode = (typeof TEAM_MODES)[number];

// one settings file, read and parsed
export type FileLayer = {
  readonly name: "team" | "project" | "user";
  // the file as config show names it: its path, and for the team the commit it is pinned at
  readonly file: string;
  readonly value: object;
  readonly lines: ReadonlyMap<string, number>;
};

export type Source = { readonly layer: LayerName; readonly file: string; readonly line: number };

export type Resolved = {
  readonly key: Key;
  // absent when no layer sets it and it has no fallback
  readonly value: unknown;
  readonly set: boolean;
  readonly sources: readonly Source[];
  readonly mode: TeamMode;
};

export type Problem = { readonly level: "error" | "warning"; readonly text: string };

export type Resolution = {
  readonly values: readonly Resolved[];
  readonly problems: readonly Problem[];
  // the project file's object with every resolved file key in place, for the project file's readers
  readonly effective: object;
};

type Entry = { readonly value: unknown; readonly source: Source };
type State = { readonly value: unknown; readonly sources: readonly Source[] };
type Step = { readonly state: State; readonly problem: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function at(value: unknown, path: readonly string[]): { readonly found: boolean; readonly value: unknown } {
  let here: unknown = value;
  for (const part of path) {
    if (!isObject(here) || !Object.hasOwn(here, part)) {
      return { found: false, value: undefined };
    }
    here = here[part];
  }
  return { found: true, value: here };
}

// canonical : a value as text with its keys sorted, so two equal values compare equal
export function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value).toSorted();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function where(source: Source): string {
  return source.line > 0 ? `${source.file}:${source.line}` : source.file;
}

function strings(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? value : undefined;
}

function show(value: unknown): string {
  return JSON.stringify(value) ?? "none";
}

function rankStep(state: State, entry: Entry, was: number, now: number): Step {
  if (now < was) {
    return { state, problem: `${show(entry.value)} is looser than ${show(state.value)}` };
  }
  return now > was ? { state: { value: entry.value, sources: [entry.source] }, problem: "" } : { state, problem: "" };
}

// ladderStep : the strictest wins; a looser value is refused
function ladderStep(key: Key, state: State, entry: Entry): Step {
  const ladder = key.ladder ?? [];
  const [was, now] = [ladder.indexOf(String(state.value)), ladder.indexOf(String(entry.value))];
  return was < 0 || now < 0
    ? { state, problem: `cannot be compared: one of ${ladder.join(", ")}` }
    : rankStep(state, entry, was, now);
}

// capStep : the lowest wins; a higher value is refused
function capStep(state: State, entry: Entry): Step {
  const [was, now] = [state.value, entry.value];
  if (typeof was !== "number" || typeof now !== "number") {
    return { state, problem: "cannot be compared: a number" };
  }
  if (now > was) {
    return { state, problem: `${now} is higher than ${was}` };
  }
  return now < was ? { state: { value: now, sources: [entry.source] }, problem: "" } : { state, problem: "" };
}

function added(state: State, entry: Entry): { readonly extra: readonly string[]; readonly ok: boolean } {
  const [was, now] = [strings(state.value), strings(entry.value)];
  return was === undefined || now === undefined
    ? { extra: [], ok: false }
    : { extra: now.filter((v) => !was.includes(v)), ok: true };
}

function joined(state: State, entry: Entry, extra: readonly string[]): State {
  return extra.length === 0
    ? state
    : { value: [...(strings(state.value) ?? []), ...extra], sources: [...state.sources, entry.source] };
}

// allowStep : the entries above stay; a lower layer adds only where the team marks the key open
function allowStep(state: State, entry: Entry, mode: TeamMode): Step {
  const { extra, ok } = added(state, entry);
  if (!ok) {
    return { state, problem: "cannot be compared: a list of words" };
  }
  return extra.length > 0 && mode !== "open"
    ? { state, problem: `adds ${show(extra)}, and only the team can widen an allow-list (mark it "open")` }
    : { state: joined(state, entry, extra), problem: "" };
}

// denyStep : every layer adds
function denyStep(state: State, entry: Entry): Step {
  const { extra, ok } = added(state, entry);
  return ok
    ? { state: joined(state, entry, extra), problem: "" }
    : { state, problem: "cannot be compared: a list of words" };
}

function lockedStep(state: State, entry: Entry): Step {
  return canonical(state.value) === canonical(entry.value)
    ? { state, problem: "" }
    : { state, problem: `is locked at ${show(state.value)}` };
}

type ClassStep = (key: Key, state: State, entry: Entry, mode: TeamMode) => Step;

const STEPS: Readonly<Record<KeyClass, ClassStep>> = {
  ladder: (key, state, entry) => ladderStep(key, state, entry),
  cap: (_key, state, entry) => capStep(state, entry),
  "allow-list": (_key, state, entry, mode) => allowStep(state, entry, mode),
  "deny-list": (_key, state, entry) => denyStep(state, entry),
  locked: (_key, state, entry) => lockedStep(state, entry),
  preference: (_key, _state, entry) => ({ state: { value: entry.value, sources: [entry.source] }, problem: "" }),
};

// step : one lower layer's value against what the layers above resolved to
function step(key: Key, state: State, entry: Entry, mode: TeamMode): Step {
  const team = state.sources.find((s) => s.layer === "team");
  return mode === "locked" && team !== undefined ? lockedStep(state, entry) : STEPS[key.class](key, state, entry, mode);
}

type Context = {
  readonly layers: readonly FileLayer[];
  readonly modes: ReadonlyMap<string, TeamMode>;
  readonly env: NodeJS.ProcessEnv;
};

const NUMBER = /^\d+(\.\d+)?$/;

// machineEntry : a machine key's variable, the lowest layer; a cap's number is compared as a number, any other text
// is left as it is, for the module's own check
function machineEntry(key: Key, env: NodeJS.ProcessEnv): readonly Entry[] {
  const text = key.where === "machine" ? env[key.env] : undefined;
  return key.where === "machine" && text !== undefined
    ? [{ value: machineValue(key, text), source: { layer: "machine", file: `env ${key.env}`, line: 0 } }]
    : [];
}

function machineValue(key: Key, text: string): unknown {
  return key.class === "cap" && NUMBER.test(text) ? Number(text) : text;
}

function entriesOf(key: Key, context: Context): readonly Entry[] {
  const files = context.layers.flatMap((layer) => {
    const found = at(layer.value, key.path);
    const line = layer.lines.get(pathKey(key.path)) ?? 0;
    return found.found ? [{ value: found.value, source: { layer: layer.name, file: layer.file, line } }] : [];
  });
  return [...files, ...machineEntry(key, context.env)];
}

// checked : a team or user value that is not what the key holds is an error; a project value of a file key is left to
// the project file's readers, so their refusals read as they do today, unless the key has no reader there; a machine
// variable is left to its module's own check
function checked(key: Key, entry: Entry): string {
  const why = checkedHere(key, entry.source.layer) ? key.check(entry.value) : "";
  return why === "" ? "" : `${key.id} in ${where(entry.source)} must be ${why}`;
}

function checkedHere(key: Key, layer: LayerName): boolean {
  const readerChecks = key.where === "file" && key.checkProject !== true;
  return layer === "machine" ? false : layer !== "project" || !readerChecks;
}

function teamValueOf(entries: readonly Entry[]): string {
  const team = entries.find((e) => e.source.layer === "team");
  return team === undefined ? "the team sets none" : `the team value is ${show(team.value)}`;
}

function refusal(key: Key, entry: Entry, why: string, entries: readonly Entry[]): string {
  return `${key.id}: the ${entry.source.layer} layer (${where(entry.source)}) ${why}; a ${key.class} key only gets stricter in a lower layer, and ${teamValueOf(entries)}`;
}

function lockedByTeam(entry: Entry, mode: TeamMode, state: State | undefined): boolean {
  return mode === "locked" && entry.source.layer !== "team" && state === undefined;
}

function initial(key: Key): State | undefined {
  return key.fixed === undefined
    ? undefined
    : { value: key.fixed, sources: [{ layer: "engine", file: "the engine", line: 0 }] };
}

type Fold = { readonly state: State | undefined; readonly problems: readonly string[] };

function refusedEntry(key: Key, mode: TeamMode, entries: readonly Entry[], fold: Fold, entry: Entry): string {
  const bad = checked(key, entry);
  if (bad !== "") {
    return bad;
  }
  return lockedByTeam(entry, mode, fold.state) ? refusal(key, entry, "sets a key the team locked", entries) : "";
}

function foldEntry(key: Key, mode: TeamMode, entries: readonly Entry[], fold: Fold, entry: Entry): Fold {
  const refused = refusedEntry(key, mode, entries, fold, entry);
  if (refused !== "") {
    return { state: fold.state, problems: [...fold.problems, refused] };
  }
  if (fold.state === undefined) {
    return { state: { value: entry.value, sources: [entry.source] }, problems: fold.problems };
  }
  const next = step(key, fold.state, entry, mode);
  const problems = next.problem === "" ? fold.problems : [...fold.problems, refusal(key, entry, next.problem, entries)];
  return { state: next.state, problems };
}

function resolveKey(key: Key, context: Context): { readonly resolved: Resolved; readonly problems: string[] } {
  const mode = context.modes.get(key.id) ?? "default";
  const entries = entriesOf(key, context);
  const start: Fold = { state: initial(key), problems: [] };
  const fold = entries.reduce((f, e) => foldEntry(key, mode, entries, f, e), start);
  const state = fold.state ?? { value: key.fallback, sources: [{ layer: "default", file: "the default", line: 0 }] };
  const set = fold.state !== undefined;
  return { resolved: { key, value: state.value, set, sources: state.sources, mode }, problems: [...fold.problems] };
}

// setAt : puts a value at a path, making the objects on the way; a part that is there but not an object is left, so
// the project file's readers refuse it as they do today
function setAt(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  const [head, ...rest] = path;
  if (head === undefined) {
    return;
  }
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  const next = Object.hasOwn(target, head) ? target[head] : {};
  if (isObject(next)) {
    target[head] = next;
    setAt(next, rest, value);
  }
}

// a value only the project file set is left exactly as the file has it
function fromOthers(resolved: Resolved): boolean {
  return resolved.set && resolved.sources.some((s) => s.layer === "team" || s.layer === "user");
}

function effectiveOf(project: FileLayer | undefined, values: readonly Resolved[]): object {
  const out: Record<string, unknown> = structuredClone({ ...project?.value });
  for (const r of values) {
    if (r.key.where === "file" && fromOthers(r)) {
      setAt(out, r.key.path, structuredClone(r.value));
    }
  }
  return out;
}

export type Input = {
  readonly layers: readonly FileLayer[];
  readonly modes: ReadonlyMap<string, TeamMode>;
  readonly env: NodeJS.ProcessEnv;
  // problems found while reading the files (layers.ts)
  readonly problems: readonly Problem[];
};

// resolve : every key's value, the problems, and the project file's object with the layers in place
export function resolve(input: Input): Resolution {
  const context: Context = { layers: input.layers, modes: input.modes, env: input.env };
  const each = KEYS.map((k) => resolveKey(k, context));
  const values = each.map((f) => f.resolved);
  const errors = [...each.flatMap((f) => f.problems), ...atWork(values)].map(
    (text): Problem => ({ level: "error", text }),
  );
  const unknown = input.layers.flatMap(unknownKeys);
  const project = input.layers.find((l) => l.name === "project");
  return { values, problems: [...input.problems, ...errors, ...unknown], effective: effectiveOf(project, values) };
}

// atWork : P9, nothing is committed to a work project's product repo, so its opt-in is refused
function atWork(values: readonly Resolved[]): readonly string[] {
  const on = (id: string): Resolved | undefined => values.find((r) => r.key.id === id && r.value === true);
  const [work, commits] = [on("work"), on("repoCommits")];
  return work !== undefined && commits !== undefined
    ? [
        `repoCommits: ${commits.sources.map(where).join(", ")} opts in to commits to the product repo, and ${work.sources.map(where).join(", ")} marks the project as work, where nothing is ever committed (P9)`,
      ]
    : [];
}

// ---- unknown keys

const ALL_PATHS = KEYS.map((k) => k.path);

function isPrefix(path: readonly string[]): boolean {
  return ALL_PATHS.some((p) => p.length > path.length && path.every((part, i) => p[i] === part));
}

function isKey(path: readonly string[]): boolean {
  return ALL_PATHS.some((p) => pathKey(p) === pathKey(path));
}

function isMeta(layer: FileLayer, path: readonly string[]): boolean {
  const meta = layer.name === "project" ? PROJECT_META : layer.name === "team" ? TEAM_META : "";
  return path.length === 1 && path[0] === meta;
}

function cell(row: readonly number[], next: readonly number[], j: number, cost: number): number {
  return Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + cost);
}

function nextRow(a: string, i: number, b: string, row: readonly number[]): readonly number[] {
  const next = [i];
  for (let j = 1; j <= b.length; j += 1) {
    next.push(cell(row, next, j, a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
  }
  return next;
}

// distance : the edit distance between two words, for "did you mean"
export function distance(a: string, b: string): number {
  let row: readonly number[] = Array.from({ length: b.length + 1 }, (_v, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    row = nextRow(a, i, b, row);
  }
  return row[b.length] ?? 0;
}

// didYouMean : the nearest key name, when one is near
// every key name and each dotted part it starts with ("egress" for "egress.allow")
const NAMES = [...new Set(KEYS.flatMap((k) => k.id.split(".").map((_p, i, all) => all.slice(0, i + 1).join("."))))];

export function didYouMean(name: string): string {
  const near = NAMES.map((id) => ({ id, d: distance(name.toLowerCase(), id.toLowerCase()) }))
    .filter((n) => n.d <= Math.max(2, Math.floor(name.length / 3)))
    .toSorted((a, b) => a.d - b.d);
  return near[0] === undefined ? "" : `; did you mean ${near[0].id}?`;
}

function unknownAt(layer: FileLayer, path: readonly string[]): Problem {
  const name = path.join(".");
  const place = where({ layer: layer.name, file: layer.file, line: layer.lines.get(pathKey(path)) ?? 0 });
  return {
    level: "warning",
    text: `${place}: unknown key ${name}${didYouMean(name)} (a warning for one release, then an error)`,
  };
}

function walk(layer: FileLayer, value: unknown, path: readonly string[]): readonly Problem[] {
  if (!isObject(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([k, v]) => {
    const here = [...path, k];
    if (isKey(here) || isMeta(layer, here)) {
      return [];
    }
    return isPrefix(here) ? partOf(layer, v, here) : [unknownAt(layer, here)];
  });
}

// partOf : a part of a key's path; one that is not an object is left to the project file's readers, and refused in a
// team or user file
function partOf(layer: FileLayer, value: unknown, path: readonly string[]): readonly Problem[] {
  if (isObject(value)) {
    return walk(layer, value, path);
  }
  const place = where({ layer: layer.name, file: layer.file, line: layer.lines.get(pathKey(path)) ?? 0 });
  return layer.name === "project" ? [] : [{ level: "error", text: `${place}: ${path.join(".")} must be an object` }];
}

function unknownKeys(layer: FileLayer): readonly Problem[] {
  return walk(layer, layer.value, []);
}
