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
// A loop never waits on what only a person can change. A pass that starts no run because every run it could start is
// held back, by a step that is not set up (the writer's runner, the ready check's) or by a cap (the project's day, the
// window's share) or by the run hours (#299), ends the loop after that pass, with why and what to do: set the step up, or run `dispatch` again
// tomorrow, or once the window has room. The loop writes how it ended to <home>/runs/<project>/loop-end.json, and
// `status` shows a loop that ended that way.
//
// A pass that fails (the git host is down, a pass by hand holds the pass lock) is printed, and the loop tries again
// after the poll interval; MAX_FAILED_PASSES failures in a row end it, so it never spins on a broken setup (P7).

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../forge/api.js";
import { plainName } from "../spec.js";
import { LOOP_END_FILE, LOOP_PID_FILE, type LoopEnded } from "./last-poll.js";
import { inFlight } from "./table.js";
import {
  decideAll,
  holder,
  lock,
  RUN_KINDS,
  runHoursEnd,
  tick,
  type Decided,
  type Guard,
  type Ran,
  type TickSetup,
} from "./tick.js";

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
  // milliseconds since the epoch, for the loop's end record
  readonly now: () => number;
};

// how the loop ended: the passes it ran, whether any action in them failed, and why it stopped while a ticket was
// still in flight (none when nothing was)
export type LoopEnd = {
  readonly passes: number;
  readonly failedActions: boolean;
  readonly held: readonly string[];
};

// the step each run kind names when it is not set up
const STEP_NAMES: Readonly<Record<string, string>> = {
  writer: "the writer",
  ready: "the ready check",
  review: "the automated review",
  verify: "the local verifier",
};

// heldBack : why no run started in a pass that had runs to start, or none when one started or none was due: outside
// the run hours, when they are (runHoursEnd, #299); else each step not set up and each cap. Pure.
export function heldBack(setup: Pick<TickSetup, "project" | "caps">, ran: readonly Ran[]): readonly string[] {
  const runs = ran.filter((r) => RUN_KINDS.has(r.action.kind));
  if (runs.length === 0 || runs.some((r) => r.result.kind !== "unavailable")) {
    return [];
  }
  const closed = runHoursEnd(setup, ran);
  return closed === "none" ? heldWhy(runs, setup.project) : [closed];
}

function heldWhy(runs: readonly Ran[], project: string): readonly string[] {
  const again = `run \`agent-factory dispatch ${project}\` again`;
  const why = runs.map((r) => {
    const reason = r.result.kind === "unavailable" ? r.result.reason : "";
    const step = STEP_NAMES[r.action.kind] ?? r.action.kind;
    return r.held === true ? reason : `${step} is not set up: ${reason}; set it up, then ${again}`;
  });
  return [...new Set(why)];
}

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

type Step = {
  readonly kind: "pass";
  readonly ran: readonly Ran[];
  readonly flying: readonly string[];
  readonly setup: TickSetup;
};

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
    : { kind: "ok", value: { kind: "pass", ran: ran.value, flying: flying(decided.value), setup: setup.value } };
}

type Count = { passes: number; failedInRow: number; failedActions: boolean; held: readonly string[] };

// next : after one pass, "end" when nothing is in flight, every run is held back, or too many passes failed in a row,
// else "wait"
function next(loop: LoopSetup, count: Count, step: Result<Step>): "end" | "wait" | "failed" {
  count.passes += 1;
  if (step.kind === "failed") {
    count.failedInRow += 1;
    loop.log(`pass ${count.passes} failed: ${step.reason}`);
    return count.failedInRow >= MAX_FAILED_PASSES ? "failed" : "wait";
  }
  count.failedInRow = 0;
  count.failedActions ||= step.value.ran.some((r) => r.result.kind === "failed");
  return afterPass(loop, count, step.value);
}

// afterPass : a pass that ran: it ends the loop with nothing in flight, or with every run held back
function afterPass(loop: LoopSetup, count: Count, step: Step): "end" | "wait" {
  if (step.flying.length === 0) {
    loop.log("no ticket is in flight; the orchestrator loop ends");
    return "end";
  }
  count.held = heldBack(step.setup, step.ran);
  if (count.held.length > 0) {
    loop.log(`no run could start; the orchestrator loop ends: ${count.held.join("; and ")}`);
    return "end";
  }
  loop.log(`in flight: ${step.flying.join(", ")}; next pass in ${loop.pollMinutes} min`);
  return "wait";
}

async function passes(loop: LoopSetup): Promise<Result<LoopEnd>> {
  const count: Count = { passes: 0, failedInRow: 0, failedActions: false, held: [] };
  for (;;) {
    const after = next(loop, count, await passAndLook(loop));
    if (after === "failed") {
      return { kind: "failed", reason: `${MAX_FAILED_PASSES} passes in a row failed; the orchestrator loop ends` };
    }
    if (after === "end") {
      return { kind: "ok", value: { passes: count.passes, failedActions: count.failedActions, held: count.held } };
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
    const ended = await passes(loop);
    await endRecord(loop, ended);
    return ended;
  } finally {
    await held.release();
  }
}

// endedOf : the end record of a loop's result. Pure.
function endedOf(at: string, ended: Result<LoopEnd>): LoopEnded {
  if (ended.kind === "failed") {
    return { at, kind: "failed", why: ended.reason };
  }
  return ended.value.held.length > 0
    ? { at, kind: "held", why: ended.value.held.join("; and ") }
    : { at, kind: "done", why: "no ticket is in flight" };
}

// endRecord : how the loop ended, replaced in one rename; one that cannot be written is printed
async function endRecord(loop: LoopSetup, ended: Result<LoopEnd>): Promise<void> {
  const dir = join(loop.home, "runs", loop.project);
  const temp = join(dir, `.${LOOP_END_FILE}.${randomUUID()}`);
  const record = endedOf(new Date(loop.now()).toISOString(), ended);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(temp, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temp, join(dir, LOOP_END_FILE));
  } catch {
    loop.log(`how the loop ended was not written to ${join(dir, LOOP_END_FILE)}`);
  }
}
