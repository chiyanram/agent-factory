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
// The engine acts on a lane's properties, never on its name (section 3), with one exception: the approval floor goes
// by the lane's name, so only tiny may skip the approval, wherever it is listed (#483). Two are read from the project's process: its
// process plugin's lanes, or the default lanes below (process/read.ts, #232): approval, and how many lenses the
// automated review runs (#237; review/lenses.ts pickLenses). A lanes file writes the lens count as a person reads it,
// "1", "~3" or "all, on the strongest model"; a lane that leaves it out keeps the default lane's count. Each lane also
// says whether its spec and design get a design review before the human's approval (designReview, #236): a
// design-reviewer run, then a verify pass. The approval floor: every lane above tiny needs a human's approval, and no settings
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

// how many lenses a lane's review runs: a count, or every lens on the strongest model
export type LensCount = number | "all";

// one lane's properties, in the lanes' order from the lightest
// designReview: whether the lane's spec and design get a design review (#236); testFirst: whether a failing test is
// committed before the fix (ADR-0007, #417). A lane that does not say keeps the default lane's
export type LaneProps = {
  readonly name: Lane;
  readonly approval: boolean;
  readonly lenses: LensCount;
  readonly designReview?: boolean;
  readonly testFirst?: boolean;
};

// the default lanes: tiny needs a START only; bug, feature and one-way door need an approval as well. Tiny runs one
// lens, bug and feature about 3, and the one-way door all; every lane but tiny gets a design review (docs/DESIGN.md
// section 3); only bug starts with a failing test (ADR-0007)
const DEFAULT_COUNTS: Readonly<Record<Lane, LensCount>> = { tiny: 1, bug: 3, feature: 3, "one-way door": "all" };

export const DEFAULT_LANES: readonly LaneProps[] = [
  { name: "tiny", approval: false, lenses: DEFAULT_COUNTS.tiny, designReview: false, testFirst: false },
  { name: "bug", approval: true, lenses: DEFAULT_COUNTS.bug, designReview: true, testFirst: true },
  { name: "feature", approval: true, lenses: DEFAULT_COUNTS.feature, designReview: true, testFirst: false },
  {
    name: "one-way door",
    approval: true,
    lenses: DEFAULT_COUNTS["one-way door"],
    designReview: true,
    testFirst: false,
  },
];

// countText : a lens count as a person writes it: "all…" for every lens, else its first whole number ("~3" is 3)
function countText(value: string): LensCount | "bad" {
  if (/^\s*all\b/i.test(value)) {
    return "all";
  }
  const n = Number(/^\s*~?\s*(\d+)\b/.exec(value)?.[1] ?? 0);
  return n >= 1 ? n : "bad";
}

function wholeCount(value: number): LensCount | "bad" {
  return Number.isSafeInteger(value) && value >= 1 ? value : "bad";
}

// lensCountOf : a lanes file's lens count, "1", "~3", "all, on the strongest model" or a whole number; the default
// lane's count when it is left out; "bad" for anything else. Pure.
function lensCountOf(value: unknown, lane: Lane): LensCount | "bad" {
  if (value === undefined) {
    return DEFAULT_COUNTS[lane];
  }
  if (typeof value === "number") {
    return wholeCount(value);
  }
  return typeof value === "string" ? countText(value) : "bad";
}

// defaultDesignReview : the default lanes' designReview for a lane, for a lanes value that does not say. Pure.
function defaultDesignReview(lane: Lane): boolean {
  return DEFAULT_LANES.find((l) => l.name === lane)?.designReview ?? true;
}

// defaultTestFirst : the default lanes' testFirst for a lane, for a lanes value that does not say. Pure.
function defaultTestFirst(lane: Lane): boolean {
  return DEFAULT_LANES.find((l) => l.name === lane)?.testFirst ?? false;
}

// flagOf : a lane's true-or-false property, the fallback when it is left out, or "bad" when it is neither. Pure.
function flagOf(value: unknown, key: "designReview" | "testFirst", fallback: boolean): boolean | "bad" {
  const given = prop(value, key);
  if (given === undefined) {
    return fallback;
  }
  return typeof given === "boolean" ? given : "bad";
}

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function propsOf(value: unknown): LaneProps | "bad" {
  const name = prop(value, "name");
  const approval = prop(value, "approval");
  const lane = LANES.find((l) => l === name);
  return lane === undefined || typeof approval !== "boolean" ? "bad" : laneOf(value, lane, approval);
}

// laneOf : a named lane's counted and flagged properties, or "bad" when one of them is. Pure.
function laneOf(value: unknown, lane: Lane, approval: boolean): LaneProps | "bad" {
  const lenses = lensCountOf(prop(value, "lenses"), lane);
  const designReview = flagOf(value, "designReview", defaultDesignReview(lane));
  const testFirst = flagOf(value, "testFirst", defaultTestFirst(lane));
  return lenses === "bad" || designReview === "bad" || testFirst === "bad"
    ? "bad"
    : { name: lane, approval, lenses, designReview, testFirst };
}

// namedLanes : every lane's properties, or "bad" when the value is not a list of them. Pure.
function namedLanes(value: unknown): readonly LaneProps[] | "bad" {
  const lanes = Array.isArray(value) ? value.map(propsOf) : [];
  const named = lanes.flatMap((l) => (l === "bad" ? [] : [l]));
  return named.length === lanes.length && named.length > 0 ? named : "bad";
}

// the one lane that may run on a START alone; the floor goes by this name, never by where a lane sits in the list
// (#483), so a lanes file that lists bug first, or leaves tiny out, still cannot drop an approval
const FLOOR: Lane = "tiny";

// floorBreaks : each lane other than tiny that would run with no approval, wherever it is listed. Pure.
function floorBreaks(lanes: readonly LaneProps[]): readonly string[] {
  return lanes.flatMap((l) => (l.approval || l.name === FLOOR ? [] : [l.name]));
}

// lanesOf : a lanes value as a process plugin or a settings layer gives it, every lane in order from the lightest with
// its properties; refused when it is not one, or when it drops the approval floor. `from` names the plugin or layer.
// Pure.
export function lanesOf(value: unknown, from: string): Result<readonly LaneProps[]> {
  const named = namedLanes(value);
  if (named === "bad") {
    return failed(
      `${from}: the lanes must be a list of {"name", "approval", "lenses"} (and an optional "designReview" and "testFirst"), with a name one of ${LANES.join(", ")} and lenses a count or "all"`,
    );
  }
  const breaks = floorBreaks(named);
  return breaks.length === 0
    ? { kind: "ok", value: named }
    : failed(
        `${from}: every lane above ${FLOOR} needs a human's approval (the approval floor); ${breaks.join(", ")} would run without one`,
      );
}

// needsApproval : whether a lane's build waits for a human's approval as well as a START, by the project's lanes; a
// lane they leave out needs one. The lanes came through lanesOf, so the approval floor holds. Pure.
export function needsApproval(lane: Lane, lanes: readonly LaneProps[] = DEFAULT_LANES): boolean {
  return lanes.find((l) => l.name === lane)?.approval ?? true;
}

// needsDesignReview : whether a lane's spec and design get a design review before the human's approval (#236). Pure.
export function needsDesignReview(lane: Lane, lanes: readonly LaneProps[] = DEFAULT_LANES): boolean {
  return lanes.find((l) => l.name === lane)?.designReview ?? defaultDesignReview(lane);
}

// needsTestFirst : whether a lane's build starts with a failing test, from the lane's properties, never its name
// (ADR-0007, #417). Pure.
export function needsTestFirst(lane: Lane, lanes: readonly LaneProps[] = DEFAULT_LANES): boolean {
  return lanes.find((l) => l.name === lane)?.testFirst ?? defaultTestFirst(lane);
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
