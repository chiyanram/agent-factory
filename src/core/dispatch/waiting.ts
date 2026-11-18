// waiting — the ticket sessions that wait for the operator's word (#712). A Claude session working on a ticket puts the
// waiting:operator label on the ticket's issue when it stops for the operator (an approval, grill answers), and takes
// it off once it has the answer. The label is a session's claim, not a human record: the board shows it, a pass or
// `agent-factory waiting` pings for it (waiting-pass.ts), and nothing decides on it (P11). board.ts makes each waiting
// ticket an ordinary needs-you line, so every door (the board, the chat, the UI) reads one list.
//
// The ping goes once per label: the pass records the label's time in a "waiting" line first, then pings. A label taken
// off and put on again has a newer time, so it pings again; no pass has to see the label go. A ticket whose own turn is
// already needs you was pinged by that turn (turn-ping.ts), so the line is recorded with no second ping. Pure.

import type { Ping } from "../notify.js";
import type { Waiting } from "../forge/types.js";
import type { Lane } from "./next-step.js";
import type { Event } from "./records.js";

export const WAITING_LABEL = "waiting:operator";

// the step a waiting ticket's line shows, and whom it waits on
export const SESSION_WAITS = "session waits";
export const OPERATOR = "the operator";

// sessionWait : what the operator does for a waiting ticket, naming the label it comes from, since the label is a
// session's claim. Pure.
export function sessionWait(w: Waiting): string {
  return `answers the ticket's session, which waits for their word (${WAITING_LABEL}: ${w.title})`;
}

// recordedSince : the label time of the ticket's newest "waiting" line, or none before its first. Pure.
export function recordedSince(events: readonly Event[]): string {
  const lines = events.flatMap((e) => (e.kind === "waiting" ? [e] : []));
  return lines.toSorted((a, b) => a.at.localeCompare(b.at)).at(-1)?.since ?? "none";
}

// waitingStep : whether the pass records the label's time, and whether it pings: once per label time, and no ping when
// the ticket's own turn is already needs you ("none": the ticket is not in flight). Pure.
export function waitingStep(input: {
  readonly recorded: string;
  readonly since: string;
  readonly lane: Lane | "none";
}): { readonly record: boolean; readonly ping: boolean } {
  const record = input.recorded === "none" || input.since > input.recorded;
  return { record, ping: record && input.lane !== "needs-you" };
}

// waitingPing : the ping that a ticket's session waits for the operator. Pure.
export function waitingPing(w: Waiting, change: number | "none"): Ping {
  return {
    kind: "needs-you",
    ticket: String(w.number),
    change,
    why: `its ticket session waits for your word (${w.title})`,
    next: "answers in the ticket's session, or tells the coordinator in their own words",
  };
}
