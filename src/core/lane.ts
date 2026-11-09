// lane — how much process a change gets, set by code (#230; docs/DESIGN.md section 3 "Lane", section 5 "The approval
// floor"; rulebook crq LN1, LN2). The coordinator proposes the lane in the spec's "## Lane"; the engine checks it twice
// and can only raise it, never lower it:
//
//   before the build   the spec's "## Planned files": a file under the project's one-way-door paths needs the
//                      one-way door (plannedRaise, here)
//   the ready check    the real diff: only docs, comments or config values may stay tiny; any code change needs at
//                      least bug; a one-way-door path needs the one-way door (ready/lane.ts)
//
// A raise that lands above the lane a human approved or STARTed stops: the ticket waits before the build, and goes to
// needs-human after the ready check. The way on is the same either way: the coordinator raises the spec's lane, which
// makes any approval stale, and a human approves the raised spec.
//
// The engine acts on a lane's properties, never on its name (section 3). Today one property, approval, is read from
// the project's process: its process plugin's lanes, or the default lanes below (process/read.ts, #232). The approval floor: every lane above the lowest needs a human's approval, and no settings
// layer or process plugin can turn that off. In the settings the floor is "approval.floor", a locked key fixed to tiny
// (#229; settings/keys.ts). lanesOf is the one door a lanes value from a process plugin comes through; it refuses any
// value that drops the floor.
//
// The one-way-door paths are a project setting, the deny-list key "lanes.oneWayDoor" (#229; settings/keys.ts): every
// settings layer may add to it, and none may remove from it. oneWayDoorPathsOf reads it, resolved through the layers.

import type { Result } from "./forge/api.js";
import { globRegex } from "./ci-files.js";
import { prop } from "./dispatch/records.js";
import { readProjectRaw } from "./project.js";
import { LANES, type Lane, type Spec } from "./spec.js";

// one lane's properties, in the lanes' order from the lightest
export type LaneProps = { readonly name: Lane; readonly approval: boolean };

// the default lanes: tiny needs a START only; bug, feature and one-way door need an approval as well
export const DEFAULT_LANES: readonly LaneProps[] = [
  { name: "tiny", approval: false },
  { name: "bug", approval: true },
  { name: "feature", approval: true },
  { name: "one-way door", approval: true },
];

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function propsOf(value: unknown): LaneProps | "bad" {
  const name = prop(value, "name");
  const approval = prop(value, "approval");
  const lane = LANES.find((l) => l === name);
  return lane !== undefined && typeof approval === "boolean" ? { name: lane, approval } : "bad";
}

// namedLanes : every lane's properties, or "bad" when the value is not a list of them. Pure.
function namedLanes(value: unknown): readonly LaneProps[] | "bad" {
  const lanes = Array.isArray(value) ? value.map(propsOf) : [];
  const named = lanes.flatMap((l) => (l === "bad" ? [] : [l]));
  return named.length === lanes.length && named.length > 0 ? named : "bad";
}

// floorBreaks : each lane above the lowest that would run with no approval. Pure.
function floorBreaks(lanes: readonly LaneProps[]): readonly string[] {
  return lanes.slice(1).flatMap((l) => (l.approval ? [] : [l.name]));
}

// lanesOf : a lanes value as a process plugin or a settings layer gives it, every lane in order from the lightest with
// its properties; refused when it is not one, or when it drops the approval floor. `from` names the plugin or layer.
// Pure.
export function lanesOf(value: unknown, from: string): Result<readonly LaneProps[]> {
  const named = namedLanes(value);
  if (named === "bad") {
    return failed(`${from}: the lanes must be a list of {"name", "approval"}, with a name one of ${LANES.join(", ")}`);
  }
  const breaks = floorBreaks(named);
  return breaks.length === 0
    ? { kind: "ok", value: named }
    : failed(
        `${from}: every lane above ${named[0]?.name ?? "the lightest"} needs a human's approval (the approval floor); ${breaks.join(", ")} would run without one`,
      );
}

// needsApproval : whether a lane's build waits for a human's approval as well as a START, by the project's lanes; a
// lane they leave out needs one. The lanes came through lanesOf, so the approval floor holds. Pure.
export function needsApproval(lane: Lane, lanes: readonly LaneProps[] = DEFAULT_LANES): boolean {
  return lanes.find((l) => l.name === lane)?.approval ?? true;
}

function rank(lane: Lane): number {
  return LANES.indexOf(lane);
}

// above : whether lane a needs more process than lane b. Pure.
export function above(a: Lane, b: Lane): boolean {
  return rank(a) > rank(b);
}

// heavier : the heavier of two lanes: a check only ever raises. Pure.
export function heavier(a: Lane, b: Lane): Lane {
  return above(b, a) ? b : a;
}

// matches : whether a path is one a glob names, from the repo's root. Pure.
export function matches(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globRegex(g).test(path) || globRegex(g).test(`/${path}`));
}

// what a check found: the lane stays, or it is raised, and why
export type Raise =
  | { readonly kind: "kept" }
  | { readonly kind: "raised"; readonly from: Lane; readonly to: Lane; readonly why: string };

// plannedRaise : the spec's lane against its planned files. Pure.
export function plannedRaise(spec: Spec, oneWayDoor: readonly string[]): Raise {
  const door = spec.planned.find((path) => matches(path, oneWayDoor));
  return door !== undefined && above("one-way door", spec.lane)
    ? { kind: "raised", from: spec.lane, to: "one-way door", why: `${door} is under a one-way-door path` }
    : { kind: "kept" };
}

// raisedWhy : what a person reads about a raise that stops the ticket. Pure.
export function raisedWhy(raise: { readonly from: Lane; readonly to: Lane; readonly why: string }): string {
  return `the lane is raised from ${raise.from} to ${raise.to} (${raise.why}): the coordinator raises the spec's lane, and a human approves it`;
}

const ONE_WAY_DOOR_KEY = "lanes.oneWayDoor";

function globsOf(value: unknown): readonly string[] | "bad" {
  if (value === undefined) {
    return [];
  }
  const ok = Array.isArray(value) && value.every((g) => typeof g === "string" && g.trim() !== "");
  return ok ? value.filter((g): g is string => typeof g === "string") : "bad";
}

// oneWayDoorPathsOf : the project's one-way-door paths, with the team and user layers resolved in: none when the
// project has no file or no key; refused when the key is there but not a list of globs, so a typo never drops them
export async function oneWayDoorPathsOf(input: {
  readonly home: string;
  readonly project: string;
}): Promise<Result<readonly string[]>> {
  const raw = await readProjectRaw(input, `no ${ONE_WAY_DOOR_KEY}`);
  if (raw.kind !== "ok") {
    return raw.kind === "missing" ? { kind: "ok", value: [] } : raw;
  }
  const globs = globsOf(prop(prop(raw.value, "lanes"), "oneWayDoor"));
  return globs === "bad"
    ? failed(
        `${raw.path}: "${ONE_WAY_DOOR_KEY}" must list globs, such as {"lanes": {"oneWayDoor": ["db/migrations/**"]}}`,
      )
    : { kind: "ok", value: globs };
}

// plannedCheck : the spec's lane against its planned files and the project's one-way-door paths
export async function plannedCheck(where: {
  readonly home: string;
  readonly project: string;
  readonly spec: Spec;
}): Promise<Result<Raise>> {
  const globs = await oneWayDoorPathsOf(where);
  return globs.kind === "ok" ? { kind: "ok", value: plannedRaise(where.spec, globs.value) } : globs;
}
