// board — one view of every ticket in flight (#487 AC-5; #456 decision 4): its change, its step, what it waits on and
// for how long. It is read-only: it reads the same decisions a pass makes (tick.ts decideAll), the run records and the
// next step (next-step.ts), and writes no record, label or note. A ticket in flight has a START, an approval or a
// factory/<ticket> change, PR or not, and is not merged. What a ticket waits on is
//   a person   named: who STARTed it, or for a merge who approved it (#487 Q9); "a person" when the records name none
//   the gate   CI, a backoff before a retry, the tickets its spec is blocked by, or a quiet claim given back
//   a run      a step the factory starts itself: a run, a ping or a note
// Since when is the ticket's newest record line, else its approval; times are UTC here, and the text view shows them in
// the reader's zone. Pure. `agent-factory board` prints it (board-cli.ts).

import { nextStep } from "./next-step.js";
import type { Event } from "./records.js";
import type { Decided } from "./tick.js";
import type { Action } from "./table.js";
import { shownAt, shownFor, type Zone } from "../zone.js";

export type WaitsOn =
  | { readonly kind: "person"; readonly who: string; readonly does: string }
  | { readonly kind: "gate"; readonly what: string }
  | { readonly kind: "run"; readonly what: string };

export type BoardLine = {
  readonly ticket: string;
  readonly change: number | "none";
  readonly step: string;
  readonly waitsOn: WaitsOn;
  // UTC; "" when the records hold no time
  readonly since: string;
  readonly forMs: number;
};

// what a person waits on for a merge: the approver reviews and merges it
const MERGE_STEP = /^reviews and merges/;
// the steps the factory starts itself: a run, a ping or a note; every other factory step waits on something outside it
// (CI, a backoff, the blockers, a quiet claim given back): the gate
const RUN_KINDS: ReadonlySet<Action["kind"]> = new Set([
  "writer",
  "ready",
  "review",
  "verify",
  "design",
  "ping",
  "design-note",
]);

// newestBy : the newest line of a kind that names a person, as its by. Pure.
function newestBy(events: readonly Event[], kind: "begun" | "approved"): string {
  const lines = events.flatMap((e) => (e.kind === kind ? [e] : []));
  return lines.toSorted((a, b) => b.at.localeCompare(a.at))[0]?.by ?? "";
}

// personFor : who a person's step waits on: the approver for a merge, else who STARTed the ticket (Q9). Pure.
function personFor(does: string, events: readonly Event[], approver: string): string {
  const who = MERGE_STEP.test(does) ? approver || newestBy(events, "approved") : newestBy(events, "begun");
  return who || "a person";
}

// NO_STEP : a person's step for a wait next-step.ts does not know (its generated-state test keeps this from happening)
const NO_STEP = "looks at the ticket: the factory names no next step for this wait";

// waitsOnOf : what a decided ticket waits on. Pure.
function waitsOnOf(action: Action, events: readonly Event[], approver: string, step: string): WaitsOn {
  const next = nextStep(action) ?? { who: "person", does: NO_STEP };
  if (next.who === "person") {
    return { kind: "person", who: personFor(next.does, events, approver), does: next.does };
  }
  return RUN_KINDS.has(action.kind) ? { kind: "run", what: next.does } : { kind: "gate", what: step };
}

// sinceOf : the ticket's newest record time, else its approval's, else "". Pure.
function sinceOf(events: readonly Event[], approvedAt: string): string {
  return events.reduce((max, e) => (e.at > max ? e.at : max), "") || approvedAt;
}

// brokenLine : a ticket whose spec, START, approval or records cannot be read. Pure.
function brokenLine(ticket: string, reason: string): BoardLine {
  const waitsOn: WaitsOn = { kind: "person", who: "a person", does: `reads why it cannot be read: ${reason}` };
  return { ticket, change: "none", step: "broken", waitsOn, since: "", forMs: 0 };
}

type Read = Exclude<Decided, { readonly kind: "broken" }>;

// flyingLine : a decided ticket still in flight as a board line. Pure.
function flyingLine(d: Read, events: readonly Event[], now: number, describe: (a: Action) => string): BoardLine {
  const change = d.state.change.kind === "open" ? d.state.change.line.number : "none";
  const approved = d.approved === "none" ? { by: "", at: "" } : d.approved;
  const step = describe(d.action);
  const since = sinceOf(events, approved.at);
  const forMs = since === "" ? 0 : Math.max(0, now - Date.parse(since));
  return {
    ticket: d.state.ticket,
    change,
    step,
    waitsOn: waitsOnOf(d.action, events, approved.by, step),
    since,
    forMs,
  };
}

// lineOf : one decided ticket as a board line; none for a merged one, which is no longer in flight. Pure.
function lineOf(
  d: Decided,
  events: readonly Event[],
  now: number,
  describe: (a: Action) => string,
): readonly BoardLine[] {
  if ("kind" in d) {
    return [brokenLine(d.ticket, d.reason)];
  }
  return d.action.kind === "reconcile" ? [] : [flyingLine(d, events, now, describe)];
}

// boardOf : every ticket in flight, in the decisions' order. Pure.
export function boardOf(input: {
  readonly decided: readonly Decided[];
  readonly events: ReadonlyMap<string, readonly Event[]>;
  readonly now: number;
  readonly describe: (a: Action) => string;
}): readonly BoardLine[] {
  return input.decided.flatMap((d) => {
    const ticket = "kind" in d ? d.ticket : d.state.ticket;
    return lineOf(d, input.events.get(ticket) ?? [], input.now, input.describe);
  });
}

// waitText : what a line waits on, in words. Pure.
function waitText(w: WaitsOn): string {
  return w.kind === "person" ? `${w.who}, who ${w.does}` : `the ${w.kind}: ${w.what}`;
}

// boardText : the board as a person reads it, times in the reader's zone. Pure.
export function boardText(input: {
  readonly lines: readonly BoardLine[];
  readonly zone: Zone;
  readonly mark: string;
}): readonly string[] {
  if (input.lines.length === 0) {
    return ["no ticket in flight"];
  }
  return [
    `tickets in flight (times in ${input.zone.name}):`,
    ...input.lines.flatMap((l) => [
      `  ${l.ticket}  ${l.change === "none" ? "no PR" : `${input.mark}${l.change}`}  ${l.step}`,
      `    waits on ${waitText(l.waitsOn)}${l.since === "" ? "" : `, for ${shownFor(l.forMs)} since ${shownAt(l.since, input.zone)}`}`,
    ]),
  ];
}

// boardJson : the board as JSON for a program (#233, #120): the same fields, times in UTC, no PR as null. Pure.
export function boardJson(lines: readonly BoardLine[]): string {
  return JSON.stringify(
    lines.map((l) => ({ ...l, change: l.change === "none" ? null : l.change, since: l.since || null })),
  );
}
