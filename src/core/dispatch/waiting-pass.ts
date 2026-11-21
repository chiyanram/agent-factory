// waiting-pass — the record and ping for each ticket session that waits for the operator (waiting.ts holds the rule).
// A pass runs it (tick.ts), and so does `agent-factory waiting <project>`, which the coordinator runs when a session
// tells it it waits, since no loop may be running then (orchestrator-loop.ts ends with nothing in flight). One function,
// so the label's time is recorded first and pinged once, whoever runs it.

import type { Result } from "../forge/api.js";
import type { Waiting } from "../forge/types.js";
import type { Notify } from "../notify.js";
import type { Lane } from "./next-step.js";
import { readRecords, record } from "./records.js";
import { recordedSince, WAITING_LABEL, waitingPing, waitingStep } from "./waiting.js";

export type WaitingSetup = {
  readonly home: string;
  readonly project: string;
  readonly now: () => number;
  readonly log: (line: string) => void;
  readonly notify: Notify;
  readonly waiting: () => Promise<Result<readonly Waiting[]>>;
};

export type Flight = { readonly lane: Lane | "none"; readonly change: number | "none" };

export const NO_FLIGHT: Flight = { lane: "none", change: "none" };

export type WaitingRan = {
  readonly ticket: string;
  readonly title: string;
  readonly outcome: "pinged" | "ping-failed" | "recorded" | "already" | "failed" | "dry-run";
};

export async function waitingLabels(setup: WaitingSetup): Promise<Result<readonly Waiting[]>> {
  const read = await setup.waiting();
  if (read.kind === "failed") {
    setup.log(`the ${WAITING_LABEL} label was not read, so no session's wait was pinged: ${read.reason}`);
    return { kind: "failed", reason: `the ${WAITING_LABEL} label was not read: ${read.reason}` };
  }
  return read;
}

export async function waitingPinged(
  setup: WaitingSetup,
  flightOf: (ticket: string) => Flight,
): Promise<Result<readonly WaitingRan[]>> {
  const read = await waitingLabels(setup);
  if (read.kind === "failed") {
    return read;
  }
  const out: WaitingRan[] = [];
  for (const w of read.value) {
    const ticket = String(w.number);
    out.push({ ticket, title: w.title, outcome: await sessionPinged(setup, w, flightOf(ticket)) });
  }
  return { kind: "ok", value: out };
}

async function sessionPinged(setup: WaitingSetup, w: Waiting, flight: Flight): Promise<WaitingRan["outcome"]> {
  const place = { home: setup.home, project: setup.project, ticket: String(w.number) };
  const step = await sessionStep(setup, place, w.since, flight.lane);
  if (step !== "record" && step !== "ping") {
    return step;
  }
  const at = new Date(setup.now()).toISOString();
  const kept = await record({ where: place, event: { at, kind: "waiting", since: w.since } });
  if (kept.kind === "failed") {
    setup.log(`${place.ticket}: the session's wait was not recorded, so no ping went out: ${kept.reason}`);
    return "failed";
  }
  return step === "ping" ? pinged(setup, w, flight.change) : "recorded";
}

async function pinged(setup: WaitingSetup, w: Waiting, change: number | "none"): Promise<"pinged" | "ping-failed"> {
  const sent = await setup.notify(waitingPing(w, change));
  if (sent.kind === "ok") {
    return "pinged";
  }
  setup.log(`${w.number}: the ping did not go out (the record is kept): ${sent.reason}`);
  return "ping-failed";
}

async function sessionStep(
  setup: WaitingSetup,
  place: { readonly home: string; readonly project: string; readonly ticket: string },
  since: string,
  lane: Lane | "none",
): Promise<"ping" | "record" | "already" | "failed"> {
  const events = await readRecords(place, { warn: setup.log });
  if (events.kind === "failed") {
    setup.log(
      `${place.ticket}: the records were not read, so no ping went out for the session's wait: ${events.reason}`,
    );
    return "failed";
  }
  const step = waitingStep({ recorded: recordedSince(events.value), since, lane });
  if (!step.record) {
    return "already";
  }
  return step.ping ? "ping" : "record";
}
