// turn-ping — the one rule for a person's ping (#672; ADR-0012 S3). A pass pings when a ticket enters a person's turn,
// needs you or ready to merge, as whoseTurn (next-step.ts) reads it from the decided action. The pass records the turn
// first, so the ping goes once; a change of step inside that lane pings nothing, as AO pings once on entering its
// needs-input family and Gerrit notifies on entering the attention set. Leaving to the factory's turn is recorded and
// re-arms the ping. There is no "resolved" ping: a webhook post cannot be taken back.
//
// A ticket whose records hold no "turn" line yet gets one on its next pass, with no ping for a turn its older lines say
// a person was already pinged for (records.ts seedTurn). Held-build and day-cap pings inform and ask nothing of a
// person, so they keep their own checks (tick.ts). `board` reads the same lane and never writes or pings. Pure.

import type { Ping } from "../notify.js";
import { whoseTurn, type Lane, type Turn } from "./next-step.js";
import type { Summary } from "./records.js";
import { LABEL_WAIT, type Action, type TicketState } from "./table.js";

// what a pass does about the ticket's turn: the lane to record ("none": nothing), and whether a person is pinged
export type TurnStep = { readonly record: Lane | "none"; readonly ping: boolean };

// turnStep : the turn to record and the ping to send, from the recorded turn and the lane the ticket is in now. Pure.
export function turnStep(runs: Pick<Summary, "turn" | "turnRead">, lane: Lane): TurnStep {
  const moved = runs.turn !== lane;
  return {
    record: moved || !runs.turnRead ? lane : "none",
    ping: moved && lane !== "factory",
  };
}

// turnDue : whether the ticket entered a person's turn that no pass has pinged yet, so the orchestrator loop runs one
// more pass to send it (GLOSSARY "in flight": a ping is due). Pure.
export function turnDue(state: TicketState, action: Action): boolean {
  return turnStep(state.runs, whoseTurn(action).lane).ping;
}

// whyOf : what the person reads: the action's why, or, for the needs-human label's wait, the newest hand-over's. A
// hand-over and the label's wait also say why the writer's run was blocked, which no other line says. Pure.
function whyOf(action: Action, runs: Pick<Summary, "blocked" | "blockedRun">, turn: Turn): string {
  const own = ownWhy(action, turn);
  if (action.kind === "wait" && own === LABEL_WAIT) {
    return withRun(runs.blocked.at(-1) ?? own, runs.blockedRun);
  }
  return action.kind === "needs-human" ? withRun(own, runs.blockedRun) : own;
}

// withRun : a hand-over's why, and the blocked run's when there is one it does not already say. Pure.
function withRun(why: string, blockedRun: string): string {
  return blockedRun === "" || why.includes(blockedRun) ? why : `${why}; ${blockedRun}`;
}

// ownWhy : the action's own why, a design note's named as the design review's; the step for an action with none. Pure.
function ownWhy(action: Action, turn: Turn): string {
  if (action.kind === "design-note") {
    return `design review: ${action.why}`;
  }
  return "why" in action ? action.why : turn.step.does;
}

// headOf : the head a ready-to-merge ping names: the ping action's, or the open change's
function headOf(state: TicketState, action: Action): string {
  if (action.kind === "ping") {
    return action.head;
  }
  return state.change.kind === "open" ? state.change.line.head : "";
}

// turnPing : the ping for a ticket that entered a person's turn. Pure.
export function turnPing(input: {
  readonly state: TicketState;
  readonly action: Action;
  readonly change: number | "none";
}): Ping {
  const { state, action, change } = input;
  const turn = whoseTurn(action);
  return turn.lane === "ready-to-merge"
    ? { kind: "ready", ticket: state.ticket, change, head: headOf(state, action) }
    : { kind: "needs-you", ticket: state.ticket, change, why: whyOf(action, state.runs, turn), next: turn.step.does };
}
