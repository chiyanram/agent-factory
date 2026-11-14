// repeated — the failures a retro lists (#488 AC-2, design Q8 A; P12): read from each merged ticket's timeline line
// (dispatch/timeline.ts) and its outcome (outcome.ts), with no model. A failure is listed when it is seen on REPEATS or
// more tickets:
//   rule      the same rule ID found in Act on and acted on by a later commit
//   rescue    the same rescue kind
// and an escaped defect is listed the first time it is seen (RT5's decided edge):
//   escaped   a fix or revert within OUTCOME_DAYS of the merge
// Each failure names its tickets and the record lines it cites. Pure.
//
// **Today:** a timeline's acted-on counts are per rule ID over Act on and Consider together, so a rule counts when it
// was found in Act on and some finding of that rule was acted on. A rescue is a hand-over only, so the one rescue kind
// is "hand-over" (#614).

import { OUTCOME_DAYS, type MergeOutcome } from "../outcome.js";
import { UNRECORDED, type Timeline } from "../dispatch/timeline.js";

// a mistake counts as repeated after two sightings (P12; the rules pack's retro table, RT6)
export const REPEATS = 2;

const DAY_MS = 86_400_000;

export type FailureKind = "rule" | "rescue" | "escaped";

export type Failure = {
  readonly kind: FailureKind;
  readonly key: string;
  readonly tickets: readonly string[];
  readonly cites: readonly string[];
};

// a merged ticket's merge time and what became of it
export type Merge = { readonly at: string; readonly outcome: MergeOutcome };

type Seen = { readonly kind: FailureKind; readonly key: string; readonly ticket: string; readonly cite: string };

// actedInActOn : how many findings of the rule a later commit acted on, when the rule was found in Act on; 0 for none
// or a row with no rule ID. Pure.
function actedInActOn(t: Timeline, rule: string): number {
  return rule !== UNRECORDED && actOnOf(t, rule) > 0 ? actedOf(t, rule) : 0;
}

const actOnOf = (t: Timeline, rule: string): number => t.found[rule]?.act_on ?? 0;
const actedOf = (t: Timeline, rule: string): number => t.acted[rule]?.acted ?? 0;

// rulesSeen : each rule ID the ticket's timeline found in Act on and saw acted on. Pure.
function rulesSeen(ticket: string, t: Timeline): readonly Seen[] {
  return Object.keys(t.found).flatMap((rule): readonly Seen[] => {
    const acted = actedInActOn(t, rule);
    return acted === 0
      ? []
      : [{ kind: "rule", key: rule, ticket, cite: `${ticket} timeline ${t.at}: ${rule} acted on ${acted}` }];
  });
}

// rescuesSeen : the ticket's rescues, one sighting of the one kind there is today. Pure.
function rescuesSeen(ticket: string, t: Timeline): readonly Seen[] {
  return t.rescues.length === 0
    ? []
    : [{ kind: "rescue", key: "hand-over", ticket, cite: `${ticket} timeline ${t.at}: ${t.rescues.length} rescue(s)` }];
}

// escapedSeen : a fix or revert within OUTCOME_DAYS of the merge, or none. Pure.
function escapedSeen(ticket: string, merge: Merge): readonly Seen[] {
  const o = merge.outcome;
  if (o.kind !== "fixed" && o.kind !== "reverted") {
    return [];
  }
  const days = (Date.parse(o.by.at) - Date.parse(merge.at)) / DAY_MS;
  return days > OUTCOME_DAYS
    ? []
    : [
        {
          kind: "escaped",
          key: `${ticket} ${o.kind}`,
          ticket,
          cite: `${ticket} merged ${merge.at}: ${o.kind} by ${o.by.sha.slice(0, 8)} ${o.by.subject} at ${o.by.at}`,
        },
      ];
}

// grouped : the sightings by kind and key, in the order first seen. Pure.
function grouped(seen: readonly Seen[]): readonly Failure[] {
  const out = new Map<string, { kind: FailureKind; key: string; tickets: string[]; cites: string[] }>();
  for (const s of seen) {
    const id = `${s.kind}\0${s.key}`;
    const f = out.get(id) ?? { kind: s.kind, key: s.key, tickets: [], cites: [] };
    if (!f.tickets.includes(s.ticket)) {
      f.tickets.push(s.ticket);
    }
    f.cites.push(s.cite);
    out.set(id, f);
  }
  return [...out.values()];
}

// repeatedOf : the failures seen on min or more tickets, and every escaped defect. Pure.
export function repeatedOf(input: {
  readonly timelines: ReadonlyMap<string, Timeline>;
  readonly merges: ReadonlyMap<string, Merge>;
  readonly min: number;
}): readonly Failure[] {
  const seen = [
    ...[...input.timelines].flatMap(([ticket, t]) => rulesSeen(ticket, t).concat(rescuesSeen(ticket, t))),
    ...[...input.merges].flatMap(([ticket, m]) => escapedSeen(ticket, m)),
  ];
  return grouped(seen).filter((f) => f.kind === "escaped" || f.tickets.length >= input.min);
}
