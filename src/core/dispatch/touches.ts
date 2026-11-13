// touches — what a ticket asked of people, and what it cost, from its run records (#487 AC-2; need 6). A touch is a
// person's act the ticket waited on: an approval, an answer to the writer's questions, a rescue from a hand-over, a
// merge. Its wait is the time from the record line that put the ticket on a person to the line that took it off. These
// are touches and waits, counted from the records, not effort: a person may have spent a minute of a day's wait.
// Rework rounds are the writer's runs sent back by a failed ready check or the review's Act on (mode rework).
//
// The touches and when each wait starts (#487 Q4):
//   approve   from the later of the ticket's START and its design verify pass's end, to the approval
//   answer    from the writer run that asked, to the answers line; the answers name no one, so it has no by
//   rescue    from a hand-over (a blocked line) to the next START or approval; an approval that ends a hand-over is
//             one touch, a rescue
// START and approval lines carry their records' own times and are written when a pass first reads them, so they are
// read in time order, not file order.
//
// **Today:** the merge touch follows in #487's slice 3c (the merged line).

import type { Event } from "./records.js";
import type { Total } from "./usage.js";
import { shownAt, shownFor, type Zone } from "../zone.js";

export type TouchKind = "approve" | "answer" | "rescue" | "merge";
// by: who acted, when the records say; none when they do not
export type Touch = { readonly kind: TouchKind; readonly at: string; readonly waitedMs: number; readonly by?: string };

export type TicketTally = {
  readonly project: string;
  readonly ticket: string;
  // the time of the ticket's newest record line
  readonly last: string;
  readonly touches: readonly Touch[];
  readonly waitingMs: number;
  readonly reworkRounds: number;
  readonly cost: Total;
};

// Asking : the answer touches so far, and the time of the ask still open, if any
type Asking = { readonly touches: readonly Touch[]; readonly asked?: string };

// answerStep : one more line: a writer run that asked opens an ask; an answers line closes the open one as a touch.
// Pure.
function answerStep(state: Asking, e: Event): Asking {
  if (e.kind === "writer-ended" && e.outcome === "asked") {
    return { touches: state.touches, asked: e.at };
  }
  if (e.kind !== "answered" || state.asked === undefined) {
    return state;
  }
  const waitedMs = Math.max(0, Date.parse(e.at) - Date.parse(state.asked));
  return { touches: [...state.touches, { kind: "answer", at: e.at, waitedMs }] };
}

// answerTouches : each answered round, from the writer run that asked it. Pure.
function answerTouches(events: readonly Event[]): readonly Touch[] {
  return events.reduce<Asking>(answerStep, { touches: [] }).touches;
}

// Heard : the human touches so far, the open hand-over, and when the newest START and design verify pass were; "" for
// none
type Heard = {
  readonly touches: readonly Touch[];
  readonly blocked: string;
  readonly begun: string;
  readonly verified: string;
};

const NOTHING_HEARD: Heard = { touches: [], blocked: "", begun: "", verified: "" };

// waited : the ms from a time, or "" for none, to another. Pure.
function waited(from: string, to: string): number {
  return from === "" ? 0 : Math.max(0, Date.parse(to) - Date.parse(from));
}

// actedOn : a START or approval: a rescue when a hand-over is open, else an approval's own touch; a START with none
// open is no touch. Pure.
function actedOn(state: Heard, e: Extract<Event, { kind: "begun" | "approved" }>): Heard {
  const next = { ...state, begun: e.kind === "begun" ? e.at : state.begun, blocked: "" };
  if (state.blocked !== "") {
    const rescue: Touch = { kind: "rescue", at: e.at, by: e.by, waitedMs: waited(state.blocked, e.at) };
    return { ...next, touches: [...state.touches, rescue] };
  }
  if (e.kind === "begun") {
    return next;
  }
  const from = state.begun > state.verified ? state.begun : state.verified;
  return {
    ...next,
    touches: [...state.touches, { kind: "approve", at: e.at, by: e.by, waitedMs: waited(from, e.at) }],
  };
}

// marked : the open hand-over or design verify a line sets, as a field to spread; nothing on another line. Pure.
function marked(state: Heard, e: Event): Partial<Heard> {
  if (e.kind === "blocked") {
    return { blocked: state.blocked || e.at };
  }
  return e.kind === "design-ended" && e.step === "verify" ? { verified: e.at } : {};
}

// heardStep : one more line, in time order. Pure.
function heardStep(state: Heard, e: Event): Heard {
  return e.kind === "begun" || e.kind === "approved" ? actedOn(state, e) : { ...state, ...marked(state, e) };
}

// heardTouches : each approval and rescue, from the lines in time order. Pure.
function heardTouches(events: readonly Event[]): readonly Touch[] {
  return events.toSorted((a, b) => a.at.localeCompare(b.at)).reduce<Heard>(heardStep, NOTHING_HEARD).touches;
}

// touchesOf : every touch of a ticket, oldest first. Pure.
export function touchesOf(events: readonly Event[]): readonly Touch[] {
  return [...answerTouches(events), ...heardTouches(events)].toSorted((a, b) => a.at.localeCompare(b.at));
}

// reworkRounds : the writer runs sent back to rework. Pure.
function reworkRounds(events: readonly Event[]): number {
  return events.filter((e) => e.kind === "writer-ended" && e.mode === "rework").length;
}

// tallyOf : a ticket's touches, waits and rework rounds from its events, with its cost. Pure.
export function tallyOf(
  where: { readonly project: string; readonly ticket: string },
  events: readonly Event[],
  cost: Total,
): TicketTally {
  const touches = touchesOf(events);
  return {
    ...where,
    last: events.at(-1)?.at ?? "",
    touches,
    waitingMs: touches.reduce((sum, t) => sum + t.waitedMs, 0),
    reworkRounds: reworkRounds(events),
    cost,
  };
}

function costText(t: Total): string {
  return `$${t.spend.usd.toFixed(2)} ${t.spend.tokens} tok${t.unmeasured === 0 ? "" : ` +${t.unmeasured}?`}`;
}

// touchLine : one touch as a person reads it, its time in the reader's zone. Pure.
function touchLine(t: Touch, zone: Zone): string {
  return `    ${t.kind}${t.by === undefined ? "" : ` by ${t.by}`} at ${shownAt(t.at, zone)}, waited ${shownFor(t.waitedMs)}`;
}

// blockLine : a ticket's first line: its cost, rework rounds, touches and waiting. Pure.
function blockLine(t: TicketTally): string {
  const counts = `rework rounds ${t.reworkRounds} · touches ${t.touches.length} · waiting ${shownFor(t.waitingMs)}`;
  return `  ${t.project} ${t.ticket}: cost ${costText(t.cost)} · ${counts}`;
}

// ticketLines : one block per ticket with a record line since from (ms): its cost, rework rounds, touches and waiting,
// then each touch. Pure.
export function ticketLines(input: {
  readonly tallies: readonly TicketTally[];
  readonly from: number;
  readonly zone: Zone;
}): readonly string[] {
  const shown = input.tallies.filter((t) => Date.parse(t.last) >= input.from);
  if (shown.length === 0) {
    return [];
  }
  return [
    "tickets this month: touches are a person's acts the ticket waited on (approve, answer, rescue, merge), counted from the records; waiting is how long they waited, not effort",
    ...shown.flatMap((t) => [blockLine(t)].concat(t.touches.map((touch) => touchLine(touch, input.zone)))),
  ];
}
