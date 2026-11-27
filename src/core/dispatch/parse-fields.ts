// parse-fields — the field readers that more than one kind of record line uses (event-parse.ts): a required string or
// value from a closed list, the end reason, the runs, spend and split, the traces, nextTry and the lane. Each returns
// BAD for a value of the wrong shape and leaves an absent optional field out, so an old line reads as the old
// behaviour.

import { LANES, type Lane } from "../spec.js";
import type { CopilotRuns, RoundSpend, Spend } from "./spend.js";
import type { Lane as TurnLane } from "./next-step.js";
import { prop } from "../field.js";
import { isEndReason, type EndReason } from "../end-reason.js";
import { runsField, runsOf, type RunNamed } from "../agent/ran.js";
import type { NextTry, Event } from "./event.js";

export const BAD: unique symbol = Symbol("bad");
export type Bad = typeof BAD;

export function str(value: unknown, name: string): string | Bad {
  const v = prop(value, name);
  return typeof v === "string" ? v : BAD;
}

export function oneOf<T extends string>(value: unknown, name: string, allowed: readonly T[]): T | Bad {
  const v = prop(value, name);
  return allowed.find((a) => a === v) ?? BAD;
}

const TURN_LANE_KEYS: Readonly<Record<TurnLane, TurnLane>> = {
  "needs-you": "needs-you",
  "ready-to-merge": "ready-to-merge",
  factory: "factory",
};
export const TURN_LANES: readonly TurnLane[] = Object.values(TURN_LANE_KEYS);
export const PHASES = ["writer", "ready", "review", "verify", "design-review", "design-verify", "onboard"] as const;
export const MODES = ["test-first", "fix", "rework", "ci", "rebase", "cleanup"] as const;
export const OUTCOMES = ["done", "asked", "blocked"] as const;
const RETRIED = ["ready", "review", "verify"] as const;

export type Parse = (raw: unknown, at: string) => Event | Bad;
export function runsIn(raw: unknown): { readonly runs?: readonly RunNamed[] } {
  return runsField(runsOf(prop(raw, "runs")));
}

export function reasonOr(raw: unknown, old: EndReason): EndReason | Bad {
  const reason = prop(raw, "reason");
  if (reason === undefined) {
    return old;
  }
  return isEndReason(reason) ? reason : BAD;
}

export function onlyReason<R extends EndReason>(raw: unknown, only: R): { readonly reason: R } | Bad {
  return reasonOr(raw, only) === only ? { reason: only } : BAD;
}

function amount(value: unknown): number | Bad {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : BAD;
}

export function spendField(raw: unknown): { readonly spend?: Spend; readonly copilot?: CopilotRuns } | Bad {
  const copilot = copilotField(raw);
  const spend = prop(raw, "spend");
  if (spend === undefined || copilot === BAD) {
    return copilot;
  }
  const usd = amount(prop(spend, "usd"));
  const tokens = amount(prop(spend, "tokens"));
  return usd === BAD || tokens === BAD ? BAD : { spend: { usd, tokens }, ...copilot };
}

export function copilotField(raw: unknown): { readonly copilot?: CopilotRuns } | Bad {
  const copilot = prop(raw, "copilot");
  if (copilot === undefined) {
    return {};
  }
  const runs = prop(copilot, "runs");
  const seconds = prop(copilot, "seconds");
  return isCount(runs) && isCount(seconds) ? { copilot: { runs: Number(runs), seconds: Number(seconds) } } : BAD;
}

export function spendIn(value: unknown): Spend | Bad {
  const usd = amount(prop(value, "usd"));
  const tokens = amount(prop(value, "tokens"));
  return usd === BAD || tokens === BAD ? BAD : { usd, tokens };
}

function findersIn(raw: unknown): Readonly<Record<string, Spend>> | Bad {
  return recordOf(raw, spendIn);
}

export function splitField(line: unknown): { readonly split?: RoundSpend } | Bad {
  const split = prop(line, "split");
  if (split === undefined) {
    return {};
  }
  const verify = spendIn(prop(split, "verify"));
  const finders = findersIn(prop(split, "finders"));
  return verify === BAD || finders === BAD ? BAD : { split: { finders, verify } };
}

export function tracesField(raw: unknown): { readonly traces?: readonly string[] } | Bad {
  const traces = prop(raw, "traces");
  if (traces === undefined) {
    return {};
  }
  return Array.isArray(traces) && traces.every((t) => typeof t === "string") ? { traces } : BAD;
}

export function textsOf(raw: unknown, name: string): readonly string[] | undefined | Bad {
  const texts = prop(raw, name);
  return texts === undefined || (Array.isArray(texts) && texts.every((d) => typeof d === "string")) ? texts : BAD;
}

export function textOf(raw: unknown, name: string): string | undefined | Bad {
  const value = prop(raw, name);
  return value === undefined || typeof value === "string" ? value : BAD;
}

export function nextTryField(raw: unknown): { readonly nextTry?: NextTry } | Bad {
  const next = prop(raw, "nextTry");
  if (next === undefined) {
    return {};
  }
  const retried = oneOf(next, "step", RETRIED);
  const at = str(next, "at");
  return retried === BAD || at === BAD || Number.isNaN(Date.parse(at)) ? BAD : { nextTry: { step: retried, at } };
}

export function whyOf(raw: unknown): string | Bad {
  return prop(raw, "why") === undefined ? "" : str(raw, "why");
}

export function laneField(raw: unknown): { readonly lane?: Lane } | Bad {
  const lane = prop(raw, "lane");
  if (lane === undefined) {
    return {};
  }
  const known = LANES.find((l) => l === lane);
  return known === undefined ? BAD : { lane: known };
}

export function entriesOf(value: unknown): readonly [string, unknown][] {
  return typeof value === "object" && value !== null ? Object.entries(value) : [];
}

export function isCount(n: unknown): boolean {
  return Number.isSafeInteger(n) && Number(n) >= 0;
}

export function recordOf<T>(value: unknown, read: (v: unknown) => T | Bad): Readonly<Record<string, T>> | Bad {
  if (!isPlain(value)) {
    return BAD;
  }
  const out: Record<string, T> = {};
  for (const [k, v] of entriesOf(value)) {
    const got = read(v);
    if (got === BAD) {
      return BAD;
    }
    out[k] = got;
  }
  return out;
}

export function isPlain(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function optionalText(
  raw: unknown,
  name: "asked" | "chosen" | "design",
): { readonly [k: string]: string } | "bad" {
  const v = prop(raw, name);
  if (v === undefined) {
    return {};
  }
  return typeof v === "string" ? { [name]: v } : "bad";
}
