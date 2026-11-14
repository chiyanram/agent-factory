// timeline — one line per merge, written by the engine with no model (#488 AC-1; P12; rulebook RT1): the review
// rounds, the findings per rule ID and bucket, acted-on per rule ID, tokens and dollars per run kind, and each rescue.
// It is read from the ticket's own run records when the pass reconciles the merge (tick.ts mergedLine, the same hook
// as the merged line, #487), and written once. The retro reads it (#488). Pure.
//
// What each part counts:
//   rounds     the review rounds that ran: a review-ended line with its findings or its lenses; a reused round, or one
//              a restart found already posted, writes a line too, and is not a round
//   found      every finding of each round, per rule ID and bucket (review-ended found); a round written before #488
//              has none
//   acted      each round's rating of the round before: of its Act on and Consider findings, how many a later commit
//              acted on, per rule ID (review-ended acted, #220); a row kept before #488 has no rule ID: "unrecorded"
//   spend      what each run kind spent (usage.ts); a run that was not measured is counted in unmeasured
//   rescues    each hand-over a person took back with a START or an approval (touches.ts), and the hand-over's why
//
// **Today:** a rescue is a hand-over only: a waiver or a person's own push to the branch is not in the run records yet,
// so it is not counted (#488).

import type { FoundByRule } from "../review/acted-on.js";
import { BUCKETS, type Bucket } from "../finding.js";
import type { Event } from "./records.js";
import { RUN_KINDS, type RunKind, type Spend } from "./spend.js";
import { touchesOf, type Touch } from "./touches.js";
import { runsOf, totalOf } from "./usage.js";

// a row kept before rows carried their rule ID
export const UNRECORDED = "unrecorded";

export type Rescue = { readonly at: string; readonly waitedMs: number; readonly why: string; readonly by?: string };

export type Timeline = Extract<Event, { kind: "timeline" }>;

type Counts = Readonly<Partial<Record<Bucket, number>>>;

// added : two rules' counts per bucket, added. Pure.
function added(a: Counts, b: Counts): Counts {
  return Object.fromEntries(
    BUCKETS.flatMap((bucket) => {
      const n = (a[bucket] ?? 0) + (b[bucket] ?? 0);
      return n === 0 ? [] : [[bucket, n]];
    }),
  );
}

// foundSum : every round's findings per rule ID and bucket, added up. Pure.
function foundSum(events: readonly Event[]): FoundByRule {
  const rounds = events.flatMap((e) => (e.kind === "review-ended" ? Object.entries(e.found ?? {}) : []));
  const out: Record<string, Counts> = {};
  for (const [rule, per] of rounds) {
    out[rule] = added(out[rule] ?? {}, per);
  }
  return out;
}

// actedSum : every round's acted-on rows, per rule ID: how many were acted on, of how many. Pure.
function actedSum(events: readonly Event[]): Timeline["acted"] {
  const out: Record<string, { readonly acted: number; readonly of: number }> = {};
  for (const row of events.flatMap((e) => (e.kind === "review-ended" ? (e.acted?.rows ?? []) : []))) {
    const rule = row.rule ?? UNRECORDED;
    const was = out[rule] ?? { acted: 0, of: 0 };
    out[rule] = { acted: was.acted + (row.acted ? 1 : 0), of: was.of + 1 };
  }
  return out;
}

// spendSum : what each run kind spent, and how many runs were not measured (usage.ts totalOf). Pure.
function spendSum(events: readonly Event[]): Pick<Timeline, "spend" | "unmeasured"> {
  const runs = runsOf(events, { project: "", ticket: "" });
  const spend: Partial<Record<RunKind, Spend>> = {};
  for (const kind of RUN_KINDS) {
    const measured = runs.filter((r) => r.kind === kind && r.spend !== "unmeasured");
    if (measured.length > 0) {
      spend[kind] = totalOf(measured, Number.NEGATIVE_INFINITY).spend;
    }
  }
  return { spend, unmeasured: totalOf(runs, Number.NEGATIVE_INFINITY).unmeasured };
}

// rescueFrom : one rescue touch, with its hand-over's why (touches.ts). Pure.
function rescueFrom(t: Touch): Rescue {
  const rescue = { at: t.at, waitedMs: t.waitedMs, why: t.why ?? "" };
  return t.by === undefined ? rescue : { ...rescue, by: t.by };
}

// rescuesOf : each hand-over a person took back, with its why. Pure.
function rescuesOf(events: readonly Event[]): readonly Rescue[] {
  return touchesOf(events)
    .filter((t) => t.kind === "rescue")
    .map(rescueFrom);
}

// ran : a review-ended line of a round that ran: one with its findings, or its lenses before #488. Pure.
function ran(e: Event): boolean {
  return e.kind === "review-ended" && (e.found !== undefined || e.lenses !== undefined);
}

// timelineOf : a merged ticket's timeline line, from its run records. Pure.
export function timelineOf(
  events: readonly Event[],
  merged: { readonly number: number; readonly at: string },
): Timeline {
  return {
    at: merged.at,
    kind: "timeline",
    number: merged.number,
    rounds: events.filter(ran).length,
    found: foundSum(events),
    acted: actedSum(events),
    ...spendSum(events),
    rescues: rescuesOf(events),
  };
}
