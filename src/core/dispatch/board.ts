// board — one view of every ticket in flight (#487 AC-5; #456 decision 4): its change, its step, what it waits on and
// for how long. It is read-only: it reads the same decisions a pass makes (tick.ts decideAll), the run records and the
// next step (next-step.ts), and writes no record, label or note. A ticket in flight has a START, an approval or a
// factory/<ticket> change, PR or not, and is not merged. What a ticket waits on is
//   a person   named: who STARTed it, or for a merge who approved it (#487 Q9); "a person" when the records name none
//   the gate   CI, a backoff before a retry, the tickets its spec is blocked by, or a quiet claim given back
//   a run      a run the factory starts itself
// Each line sits in one lane, whoseTurn's (next-step.ts): needs you, ready to merge, then factory, in the decisions'
// order inside a lane; a ticket that cannot be read needs you. Since when is the ticket's newest record line, else its
// approval; times are UTC here, and the text view shows them in the reader's zone. A ticket whose session waits for
// the operator (waiting.ts) is in needs you, in flight or not, since its label went on; that label is shown, never
// decided on. Pure. `agent-factory board` prints the board (board-cli.ts).

import type { Result } from "../forge/api.js";
import type { Waiting } from "../forge/types.js";
import { LANES, whoseTurn, type Lane } from "./next-step.js";
import { isActivity, type Event } from "./records.js";
import type { Decided } from "./tick.js";
import { PARK_WAIT, type Action } from "./table.js";
import { OPERATOR, SESSION_WAITS, sessionWait, WAITING_LABEL } from "./waiting.js";
import { shownAt, shownFor, UTC, type Zone } from "../zone.js";

export type WaitsOn =
  | { readonly kind: "person"; readonly who: string; readonly does: string }
  | { readonly kind: "gate"; readonly what: string }
  | { readonly kind: "run"; readonly what: string };

export type BoardLine = {
  readonly ticket: string;
  readonly change: number | "none";
  readonly lane: Lane;
  readonly step: string;
  readonly waitsOn: WaitsOn;
  // UTC; "" when the records hold no time
  readonly since: string;
  readonly forMs: number;
};

// newestBy : the newest line of a kind that names a person, as its by. Pure.
function newestBy(events: readonly Event[], kind: "begun" | "approved"): string {
  const lines = events.flatMap((e) => (e.kind === kind ? [e] : []));
  return lines.toSorted((a, b) => b.at.localeCompare(a.at))[0]?.by ?? "";
}

// personFor : who a person's step waits on: the approver for a merge, else who STARTed the ticket (Q9). Pure.
function personFor(lane: Lane, events: readonly Event[], approver: string): string {
  const who = lane === "ready-to-merge" ? approver || newestBy(events, "approved") : newestBy(events, "begun");
  return who || "a person";
}

// placed : what a decided ticket waits on, and its lane. Pure.
function placed(
  action: Action,
  events: readonly Event[],
  approver: string,
  step: string,
): { readonly lane: Lane; readonly waitsOn: WaitsOn } {
  const turn = whoseTurn(action);
  if (turn.lane !== "factory") {
    const who = personFor(turn.lane, events, approver);
    return { lane: turn.lane, waitsOn: { kind: "person", who, does: turn.step.does } };
  }
  const waitsOn: WaitsOn = turn.on === "run" ? { kind: "run", what: turn.step.does } : { kind: "gate", what: step };
  return { lane: "factory", waitsOn };
}

// sinceOf : the ticket's newest activity time (records.ts isActivity), else its approval's, else "". Pure.
function sinceOf(events: readonly Event[], approvedAt: string): string {
  return events.filter(isActivity).reduce((max, e) => (e.at > max ? e.at : max), "") || approvedAt;
}

// brokenLine : a ticket whose spec, START, approval or records cannot be read, or the waiting label that cannot be. Pure.
function brokenLine(ticket: string, reason: string): BoardLine {
  const waitsOn: WaitsOn = { kind: "person", who: "a person", does: `reads why it cannot be read: ${reason}` };
  return { ticket, change: "none", lane: "needs-you", step: "broken", waitsOn, since: "", forMs: 0 };
}

type Read = Exclude<Decided, { readonly kind: "broken" }>;

// flyingLine : a decided ticket still in flight as a board line. Pure.
function flyingLine(d: Read, events: readonly Event[], now: number, describe: (a: Action) => string): BoardLine {
  const change = d.state.change.kind === "open" ? d.state.change.line.number : "none";
  const approved = d.approved === "none" ? { by: "", at: "" } : d.approved;
  const step = describe(d.action);
  const since = sinceOf(events, approved.at);
  const forMs = since === "" ? 0 : Math.max(0, now - Date.parse(since));
  return { ticket: d.state.ticket, change, ...placed(d.action, events, approved.by, step), step, since, forMs };
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

// waitingLines : each ticket whose session waits for the operator (waiting.ts) as an ordinary needs-you line, since its
// label went on; a read that failed is one broken line that says why, so a failure never reads as nothing waiting. Pure.
export function waitingLines(read: Result<readonly Waiting[]>, now: number): readonly BoardLine[] {
  if (read.kind === "failed") {
    return [brokenLine("waiting sessions", `the ${WAITING_LABEL} label: ${read.reason}`)];
  }
  return read.value.map((w) => ({
    ticket: String(w.number),
    change: "none",
    lane: "needs-you",
    step: SESSION_WAITS,
    waitsOn: { kind: "person", who: OPERATOR, does: sessionWait(w) },
    since: w.since,
    forMs: w.since === "" ? 0 : Math.max(0, now - Date.parse(w.since)),
  }));
}

// withWaiting : the ticket lines with each waiting session's line. When the project's tickets are its issues, a ticket
// in flight keeps its step and moves to needs you, waiting on the session, and a broken one keeps its own line, which
// says why it cannot be read; otherwise a ticket's name says nothing about an issue, so no line is merged. The waiting
// tickets come first in needs you, oldest wait first. Pure.
function withWaiting(
  lines: readonly BoardLine[],
  waiting: readonly BoardLine[],
  ticketsAreIssues: boolean,
): readonly BoardLine[] {
  if (!ticketsAreIssues) {
    return [...waiting, ...lines];
  }
  const byTicket = new Map(waiting.map((w) => [w.ticket, w]));
  const merged = waiting.map((w) => {
    const flying = lines.find((l) => l.ticket === w.ticket);
    if (flying === undefined) {
      return w;
    }
    return flying.step === "broken" ? flying : { ...w, change: flying.change, step: flying.step };
  });
  return [...merged, ...lines.filter((l) => !byTicket.has(l.ticket))];
}

// boardOf : every ticket in flight, by lane, in the decisions' order inside a lane, and every ticket whose session
// waits for the operator (none read: the board shows none); ticketsAreIssues: the project keeps its specs in issues, so
// ticket 12 is issue 12. Pure.
export function boardOf(input: {
  readonly decided: readonly Decided[];
  readonly events: ReadonlyMap<string, readonly Event[]>;
  readonly now: number;
  readonly describe: (a: Action) => string;
  readonly waiting?: Result<readonly Waiting[]>;
  readonly ticketsAreIssues?: boolean;
}): readonly BoardLine[] {
  const flying = input.decided.flatMap((d) => {
    const ticket = "kind" in d ? d.ticket : d.state.ticket;
    return lineOf(d, input.events.get(ticket) ?? [], input.now, input.describe);
  });
  const lines =
    input.waiting === undefined
      ? flying
      : withWaiting(flying, waitingLines(input.waiting, input.now), input.ticketsAreIssues === true);
  return LANES.flatMap((lane) => lines.filter((l) => l.lane === lane));
}

// the lanes' headers as a person reads them
const LANE_TEXT: Readonly<Record<Lane, string>> = {
  "needs-you": "needs you",
  "ready-to-merge": "ready to merge",
  factory: "factory",
};

// waitText : what a line waits on, in words. Pure.
function waitText(w: WaitsOn): string {
  return w.kind === "person" ? `${w.who}, who ${w.does}` : `the ${w.kind}: ${w.what}`;
}

// parkInZone : a park's reset as a person reads it: in the reader's zone, with UTC beside it, so a reset is
// never read in the wrong zone; any other text as it is. Pure.
function parkInZone(text: string, zone: Zone): string {
  return text.replace(
    new RegExp(`(${PARK_WAIT} )(\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ)`),
    (_m, words: string, iso: string) => {
      const utc = shownAt(iso, UTC);
      const local = shownAt(iso, zone);
      return `${words}${local === utc ? utc : `${local} (${utc})`}`;
    },
  );
}

// ticketText : one ticket of the board as a person reads it: its change and step, then what it waits on. Pure.
export function ticketText(l: BoardLine, zone: Zone, mark: string): readonly string[] {
  return [
    `  ${l.ticket}  ${l.change === "none" ? "no PR" : `${mark}${l.change}`}  ${parkInZone(l.step, zone)}`,
    `    waits on ${parkInZone(waitText(l.waitsOn), zone)}${l.since === "" ? "" : `, for ${shownFor(l.forMs)} since ${shownAt(l.since, zone)}`}`,
  ];
}

// laneHead : a lane's name and how many tickets are in it. Pure.
export function laneHead(lane: Lane, count: number): string {
  return `${LANE_TEXT[lane]} (${count})`;
}

// laneText : one lane of the board as a person reads it: its name and count, then each ticket, or "nothing". Pure.
export function laneText(input: {
  readonly lane: Lane;
  readonly lines: readonly BoardLine[];
  readonly zone: Zone;
  readonly mark: string;
}): readonly string[] {
  const inLane = input.lines.filter((l) => l.lane === input.lane);
  return [laneHead(input.lane, inLane.length)].concat(
    inLane.length === 0 ? ["  nothing"] : inLane.flatMap((l) => ticketText(l, input.zone, input.mark)),
  );
}

// boardText : the board as a person reads it, times in the reader's zone. Pure.
export function boardText(input: {
  readonly lines: readonly BoardLine[];
  readonly zone: Zone;
  readonly mark: string;
}): readonly string[] {
  return [
    input.lines.length === 0 ? "no ticket in flight:" : `tickets in flight (times in ${input.zone.name}):`,
    ...LANES.flatMap((lane) => laneText({ ...input, lane })),
  ];
}

// boardJson : the board as JSON for a program: the same fields with each line's lane, in lane order, times in UTC, no
// PR as null. Pure.
export function boardJson(lines: readonly BoardLine[]): string {
  return JSON.stringify(
    lines.map((l) => ({
      ticket: l.ticket,
      change: l.change === "none" ? null : l.change,
      lane: l.lane,
      step: l.step,
      waitsOn: l.waitsOn,
      since: l.since || null,
      forMs: l.forMs,
    })),
  );
}
