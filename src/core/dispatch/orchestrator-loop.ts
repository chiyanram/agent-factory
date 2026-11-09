// orchestrator-loop — the orchestrator loop (#305; design correction B on #30): a human's command starts it, and it
// ends by itself. No cron and no launchd job; nothing runs when nothing is in flight.
//
// `agent-factory dispatch <project>` (no --once) runs one locked pass (tick.ts), then decides every ticket again, from
// the same records and the same table the pass uses, and asks the table whether any ticket is in flight (inFlight in
// table.ts). None is: the loop ends. One is: it waits the poll interval (poll.minutes) and runs the next pass. So a
// loop with no ticket in flight ends after its first pass, with no wait, and one whose last ticket asked a person,
// stopped at needs-human, was merged or closed, or waits on a human's approval ends right after the pass that saw it.
// The loop never opens a ticket (P8): the ticket list is a human's START and approval records and the factory/<ticket>
// PRs, as in every pass. Caps, run hours and runs at once hold in each pass, as they do in a pass by hand.
//
// The loop holds <home>/runs/<project>/loop.pid while it runs (a lock, as a pass's): a second loop for the project is
// refused, and `status` reads the file to tell whether a loop is meant to be running. The loop removes it when it
// ends; a loop that died (a crash, a reboot) leaves it, so status flags the stopped loop as LATE, and the next
// `dispatch` takes it over. A laptop that sleeps stops the loop with it; it carries on from the records when it wakes.
//
// A pass that fails (the git host is down, a pass by hand holds the pass lock) is printed, and the loop tries again
// after the poll interval; MAX_FAILED_PASSES failures in a row end it, so it never spins on a broken setup (P7).

import { join } from "node:path";
import type { Result } from "../forge/api.js";
import { plainName } from "../spec.js";
import { LOOP_PID_FILE } from "./last-poll.js";
import { inFlight } from "./table.js";
import { decideAll, holder, lock, tick, type Decided, type Guard, type Ran, type TickSetup } from "./tick.js";

export const LOOP_GUARD: Guard = { file: LOOP_PID_FILE, what: "orchestrator loop" };
export const MAX_FAILED_PASSES = 3;

export type LoopSetup = {
  readonly home: string;
  readonly project: string;
  // how long to wait between passes (poll.minutes)
  readonly pollMinutes: number;
  // the settings of one pass, read again before each pass, so a token or a project file that changed is seen
  readonly setup: () => Promise<Result<TickSetup>>;
  // the wait between passes: a timer, or a test's fake clock
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
};

// how the loop ended: the passes it ran, and whether any action in them failed
export type LoopEnd = { readonly passes: number; readonly failedActions: boolean };

// loopFile : where a project's loop keeps its pid while it runs
export function loopFile(home: string, project: string): string {
  return join(home, "runs", project, LOOP_GUARD.file);
}

// loopRunning : the pid of the project's live loop, or "none" (no file, or the loop that wrote it is dead)
export async function loopRunning(input: {
  readonly home: string;
  readonly project: string;
}): Promise<number | "none"> {
  const found = await holder(loopFile(input.home, input.project), Date.now());
  return found.kind === "alive" ? found.pid : "none";
}

// flying : the tickets still in flight, by the table. A ticket that cannot be read is a person's to fix, not in flight.
export function flying(decided: readonly Decided[]): readonly string[] {
  return decided.flatMap((d) => ("kind" in d || !inFlight(d.state) ? [] : [d.state.ticket]));
}

type Step = { readonly kind: "pass"; readonly ran: readonly Ran[]; readonly flying: readonly string[] };

// passAndLook : one locked pass, then the tickets still in flight
async function passAndLook(loop: LoopSetup): Promise<Result<Step>> {
  const setup = await loop.setup();
  if (setup.kind === "failed") {
    return setup;
  }
  const ran = await tick(setup.value);
  if (ran.kind === "failed") {
    return ran;
  }
  const decided = await decideAll(setup.value);
  return decided.kind === "failed"
    ? decided
    : { kind: "ok", value: { kind: "pass", ran: ran.value, flying: flying(decided.value) } };
}

type Count = { passes: number; failedInRow: number; failedActions: boolean };

// next : after one pass, "end" when nothing is in flight or too many passes failed in a row, else "wait"
function next(loop: LoopSetup, count: Count, step: Result<Step>): "end" | "wait" | "failed" {
  count.passes += 1;
  if (step.kind === "failed") {
    count.failedInRow += 1;
    loop.log(`pass ${count.passes} failed: ${step.reason}`);
    return count.failedInRow >= MAX_FAILED_PASSES ? "failed" : "wait";
  }
  count.failedInRow = 0;
  count.failedActions ||= step.value.ran.some((r) => r.result.kind === "failed");
  if (step.value.flying.length === 0) {
    loop.log("no ticket is in flight; the orchestrator loop ends");
    return "end";
  }
  loop.log(`in flight: ${step.value.flying.join(", ")}; next pass in ${loop.pollMinutes} min`);
  return "wait";
}

async function passes(loop: LoopSetup): Promise<Result<LoopEnd>> {
  const count: Count = { passes: 0, failedInRow: 0, failedActions: false };
  for (;;) {
    const after = next(loop, count, await passAndLook(loop));
    if (after === "failed") {
      return { kind: "failed", reason: `${MAX_FAILED_PASSES} passes in a row failed; the orchestrator loop ends` };
    }
    if (after === "end") {
      return { kind: "ok", value: { passes: count.passes, failedActions: count.failedActions } };
    }
    await loop.sleep(loop.pollMinutes * 60_000);
  }
}

// orchestratorLoop : passes until no ticket is in flight, holding the project's loop file; a second loop is refused
export async function orchestratorLoop(loop: LoopSetup): Promise<Result<LoopEnd>> {
  if (!plainName(loop.project)) {
    return { kind: "failed", reason: `the project must be a plain name, got ${JSON.stringify(loop.project)}` };
  }
  const held = await lock({ home: loop.home, project: loop.project, guard: LOOP_GUARD });
  if (held.kind === "busy") {
    return { kind: "failed", reason: held.reason };
  }
  try {
    return await passes(loop);
  } finally {
    await held.release();
  }
}
