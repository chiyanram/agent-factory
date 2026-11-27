// lane — how much process a change gets, set by code (docs/explanation/architecture.md section 3 "Lane", section 5 "The approval
// floor"; rulebook crq LN1, LN2). The coordinator proposes the lane in the spec's "## Lane"; the engine checks it twice
// and can only raise it, never lower it:
//
//   before the build   the spec's "## Planned files": a file under the project's one-way-door paths needs the
//                      one-way door (plannedRaise, here)
//   the ready check    the real diff, file by file (ready/lane.ts)
//
// Both read the lane conditions in the engine's own lanes below (ADR-0026): each lane lists the conditions that ask for
// it and the why a person is told. Each changed file gets the heaviest lane its conditions ask for, or bug when none
// asks (NO_CONDITION), and the change gets the heaviest lane of its files:
//
//   one-way door   one-way-door-path   the file, or the path it moved from, is under a one-way-door path
//   tiny           doc                 a doc (Markdown, reStructuredText, AsciiDoc, plain text, README, LICENSE ...)
//                  comments-only       every changed line is a comment
//                  config-values       a config file (JSON, YAML, TOML, INI, properties) whose changed lines only change
//                                      the values of keys that stay
//
// A raise that lands above the lane a human approved or STARTed stops: the ticket waits before the build, and goes to
// needs-human after the ready check. The way on is the same either way: the coordinator raises the spec's lane, which
// makes any approval stale, and a human approves the raised spec.
//
// The engine acts on a lane's properties, never on its name (section 3), with one exception: the approval floor goes
// by the lane's name, so only tiny may skip the approval, whatever lanes a caller passes (needsApproval). The lanes
// also say how many lenses the automated review runs (review/lenses.ts pickLenses), whether the spec and design get a
// design review before the human's approval (designReview: a design-reviewer run, then a verify pass), and whether the
// build starts with a failing test (testFirst). In the settings the floor is "approval.floor", a locked key fixed to
// tiny (settings/keys.ts).
//
// The one-way-door paths are a project setting, the deny-list key "lanes.oneWayDoor" (#229; settings/keys.ts): every
// settings layer may add to it, and none may remove from it. oneWayDoorPathsOf reads it, resolved through the layers.

import type { Result } from "./forge/api.js";
import { globRegex } from "./ci-files.js";
import { readProjectRaw } from "./project.js";
import { above, type Lane } from "./lane-order.js";
import type { Spec } from "./spec.js";
import { prop } from "./field.js";

export { above, heavier, raisedWhy } from "./lane-order.js";

export type LensCount = number | "all";

export type LaneCondition = "one-way-door-path" | "doc" | "comments-only" | "config-values";

export type LaneAsks = { readonly conditions: readonly LaneCondition[]; readonly why: string };

export type LaneProps = {
  readonly name: Lane;
  readonly approval: boolean;
  readonly lenses: LensCount;
  readonly designReview?: boolean;
  readonly testFirst?: boolean;
  readonly asks?: LaneAsks;
};

export const DEFAULT_LANES: readonly LaneProps[] = [
  {
    name: "tiny",
    approval: false,
    lenses: 1,
    designReview: false,
    testFirst: false,
    asks: {
      conditions: ["doc", "comments-only", "config-values"],
      why: "changes only docs, comments or config values",
    },
  },
  { name: "bug", approval: true, lenses: 3, designReview: true, testFirst: true },
  { name: "feature", approval: true, lenses: 3, designReview: true, testFirst: false },
  {
    name: "one-way door",
    approval: true,
    lenses: "all",
    designReview: true,
    testFirst: false,
    asks: { conditions: ["one-way-door-path"], why: "is under a one-way-door path" },
  },
];

export const NO_CONDITION: { readonly lane: Lane; readonly why: string } = { lane: "bug", why: "changes code" };

export type Asking = { readonly lane: Lane; readonly asks: LaneAsks };

export function askingLanes(lanes: readonly LaneProps[] = DEFAULT_LANES): readonly Asking[] {
  return lanes
    .flatMap((l) => (l.asks === undefined ? [] : [{ lane: l.name, asks: l.asks }]))
    .toSorted((a, b) => Number(above(b.lane, a.lane)) - Number(above(a.lane, b.lane)));
}

function defaultDesignReview(lane: Lane): boolean {
  return DEFAULT_LANES.find((l) => l.name === lane)?.designReview ?? true;
}

function defaultTestFirst(lane: Lane): boolean {
  return DEFAULT_LANES.find((l) => l.name === lane)?.testFirst ?? false;
}

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

const FLOOR: Lane = "tiny";

export function needsApproval(lane: Lane, lanes: readonly LaneProps[] = DEFAULT_LANES): boolean {
  return lane !== FLOOR || (lanes.find((l) => l.name === lane)?.approval ?? true);
}

export function needsDesignReview(lane: Lane, lanes: readonly LaneProps[] = DEFAULT_LANES): boolean {
  return lanes.find((l) => l.name === lane)?.designReview ?? defaultDesignReview(lane);
}

export function needsTestFirst(lane: Lane, lanes: readonly LaneProps[] = DEFAULT_LANES): boolean {
  return lanes.find((l) => l.name === lane)?.testFirst ?? defaultTestFirst(lane);
}

export function matches(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globRegex(g).test(path) || globRegex(g).test(`/${path}`));
}

export type Raise =
  | { readonly kind: "kept" }
  | { readonly kind: "raised"; readonly from: Lane; readonly to: Lane; readonly why: string };

function pathRaise(spec: Spec, oneWayDoor: readonly string[], asking: Asking): Raise {
  const door = spec.planned.find((path) => matches(path, oneWayDoor));
  return door !== undefined && above(asking.lane, spec.lane)
    ? { kind: "raised", from: spec.lane, to: asking.lane, why: `${door} ${asking.asks.why}` }
    : { kind: "kept" };
}

export function plannedRaise(spec: Spec, oneWayDoor: readonly string[]): Raise {
  const byPath = askingLanes().find((a) => a.asks.conditions.includes("one-way-door-path"));
  return byPath === undefined ? { kind: "kept" } : pathRaise(spec, oneWayDoor, byPath);
}

const ONE_WAY_DOOR_KEY = "lanes.oneWayDoor";

function globsOf(value: unknown): readonly string[] | "bad" {
  if (value === undefined) {
    return [];
  }
  const ok = Array.isArray(value) && value.every((g) => typeof g === "string" && g.trim() !== "");
  return ok ? value.filter((g): g is string => typeof g === "string") : "bad";
}

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

export async function plannedCheck(where: {
  readonly home: string;
  readonly project: string;
  readonly spec: Spec;
}): Promise<Result<Raise>> {
  const globs = await oneWayDoorPathsOf(where);
  return globs.kind === "ok" ? { kind: "ok", value: plannedRaise(where.spec, globs.value) } : globs;
}
