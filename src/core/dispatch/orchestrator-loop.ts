// orchestrator-loop — the orchestrator loop (#305; design correction B on #30): a human's command starts it, and it
// ends by itself. No cron and no launchd job; nothing runs when nothing is in flight.
//
// `agent-factory dispatch <project>` (no --once) runs one locked pass (tick.ts), then decides every ticket again, from
// the same records and the same table the pass uses, and asks the table whether any ticket is in flight (inFlight in
// table.ts). None is: the loop ends. One is: it runs the next pass at once after a pass that ran a step or wrote to the
// git host, and else waits the poll interval (poll.minutes) (#445). So a
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
// after the poll interval; MAX_FAILED_PASSES failures in a row end it, so it never spins on a broken setup (P7). A pass
// that failed on the git host's rate limit names the time the limit lasts until (api.ts), and the next pass waits for
// that time when it is later than the poll interval, so the loop never asks a rate-limited git host again early (#62).
//
// The loop sleeps only on what is outside the factory (#445): CI running, a person, a hold. After a pass that ran a
// step itself (a writer, ready check, review, local verifier or design run) or wrote to the git host (a label, a note, a
// ping), what it did may have made the next step due, so the next pass starts at once and reads the git host again.
// It still sleeps the poll interval when every step the pass ran failed the same way as in the pass before, so a
// broken step never spins, and until the git host's rate limit is over when an action met one. Caps and run hours
// hold in each pass as before, and a pass whose runs they all held ends the loop. The log says what the loop waits on:
// "in flight: 4 (waiting on CI); next pass in 5 min", or "in flight: 4; next pass now".
//
// A pass reads the git host's changes once to act and once more to look (decideAll after tick). When the pass did
// nothing (no forge action and no run started: every ticket waits or is held), nothing it did can have moved a
// ticket, so the look reuses the first read instead of asking the git host again; the factory's login is read once a
// pass (readOnce, #62).

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rateLimitedUntil, type Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
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

// waitingOn : what each ticket in flight waits on, by ticket, as the loop's log names it: CI, or the wait's why; a
// ticket with a run or a ping due waits on nothing. Pure.
export function waitingOn(decided: readonly Decided[]): ReadonlyMap<string, string> {
  return new Map(
    decided.flatMap((d) =>
      "kind" in d || d.action.kind !== "wait" || !inFlight(d.state)
        ? []
        : [[d.state.ticket, /\bCI\b/.test(d.action.why) ? "waiting on CI" : `waiting: ${d.action.why}`] as const],
    ),
  );
}

type Step = {
  readonly kind: "pass";
  readonly ran: readonly Ran[];
  readonly flying: readonly string[];
  readonly waits: ReadonlyMap<string, string>;
  readonly setup: TickSetup;
};

// how the loop goes on after a pass with a ticket in flight (#445): at once, after the poll interval, or when the git
// host's rate limit an action met is over; repeated names the tickets whose steps failed as in the pass before
export type Pace =
  | { readonly kind: "now" }
  | { readonly kind: "sleep"; readonly repeated: ReadonlySet<string> }
  | { readonly kind: "limited"; readonly until: number };

// failureOf : a failed action as the next pass compares it: its ticket, its kind and its reason; "none" for the rest
export function failureOf(r: Ran): string {
  return r.result.kind === "failed" ? `${r.ticket} ${r.action.kind}: ${r.result.reason}` : "none";
}

// pace : after a pass, whether the next pass runs at once: it does after an action the factory took itself, a step
// it ran or a git host write, unless each one that ended failed as in the pass before (`before`, from failureOf); a
// wait, a broken ticket and a run that did not start are not actions. A rate limit an action met wins (#62). Pure.
// the actions that only keep a line in the ticket's record and wait (#494): a pass that did only these waits the poll
// interval, so three passes the git host did not answer are a poll interval apart, never back to back
const RECORD_ONLY: ReadonlySet<Ran["action"]["kind"]> = new Set(["wait", "held", "blockers-unread"]);

export function pace(ran: readonly Ran[], before: ReadonlySet<string>): Pace {
  const limits = ran.flatMap((r) => {
    const until = r.result.kind === "failed" ? rateLimitedUntil(r.result.reason) : "none";
    return until === "none" ? [] : [until];
  });
  if (limits.length > 0) {
    return { kind: "limited", until: Math.max(...limits) };
  }
  const acted = ran.filter((r) => !RECORD_ONLY.has(r.action.kind) && r.result.kind !== "unavailable");
  const fresh = acted.some((r) => r.result.kind === "ok" || !before.has(failureOf(r)));
  return fresh
    ? { kind: "now" }
    : { kind: "sleep", repeated: new Set(acted.filter((r) => before.has(failureOf(r))).map((r) => r.ticket)) };
}

// readOnce : the forge, with its login read once for the pass, and its changes at most once until forget() or a
// write: what the look after an idle pass reuses (#62). A failed read is never kept.
export function readOnce(forge: Forge): { readonly forge: Forge; readonly forget: () => void } {
  let login: Awaited<ReturnType<Forge["me"]>> | "none" = "none";
  const me: Forge["me"] = async () => {
    if (login === "none") {
      const read = await forge.me();
      login = read.kind === "ok" ? read : "none";
      return read;
    }
    return login;
  };
  let kept: Awaited<ReturnType<Forge["changes"]>> | "none" = "none";
  const forget = (): void => {
    kept = "none";
  };
  const changes: Forge["changes"] = async (input) => {
    if (kept !== "none") {
      return kept;
    }
    const read = await forge.changes(input);
    kept = read.kind === "ok" ? read : "none";
    return read;
  };
  // a write: what was read may be out of date after it
  const wrote =
    <I, O>(write: (input: I) => Promise<O>) =>
    (input: I): Promise<O> => {
      forget();
      return write(input);
    };
  return {
    forge: {
      ...forge,
      me,
      changes,
      addLabel: wrote((i) => forge.addLabel(i)),
      removeLabel: wrote((i) => forge.removeLabel(i)),
      note: wrote((i) => forge.note(i)),
      setBody: wrote((i) => forge.setBody(i)),
      lineFinding: wrote((i) => forge.lineFinding(i)),
      status: wrote((i) => forge.status(i)),
      openChange: wrote((i) => forge.openChange(i)),
    },
    forget,
  };
}

// passAndLook : one locked pass, then the tickets still in flight; a pass that did nothing looks at what it read
async function passAndLook(loop: LoopSetup): Promise<Result<Step>> {
  const setup = await loop.setup();
  if (setup.kind === "failed") {
    return setup;
  }
  const once = readOnce(setup.value.forge);
  const pass = { ...setup.value, forge: once.forge };
  const ran = await tick(pass);
  if (ran.kind === "failed") {
    return ran;
  }
  if (ran.value.some((r) => r.result.kind !== "unavailable")) {
    once.forget();
  }
  const decided = await decideAll(pass);
  if (decided.kind === "failed") {
    return decided;
  }
  const value = { ran: ran.value, flying: flying(decided.value), waits: waitingOn(decided.value), setup: setup.value };
  return { kind: "ok", value: { kind: "pass", ...value } };
}

type Count = {
  passes: number;
  failedInRow: number;
  failedActions: boolean;
  held: readonly string[];
  // the actions that failed in the last pass, by failureOf (#445)
  failed: ReadonlySet<string>;
};

type After = "end" | "failed" | { readonly wait: number };

// next : after one pass, "end" when nothing is in flight, every run is held back, or too many passes failed in a row,
// else how long to wait: the poll interval, or until a rate limit the failed pass met is over
function next(loop: LoopSetup, count: Count, step: Result<Step>): After {
  count.passes += 1;
  if (step.kind === "failed") {
    return failedPass(loop, count, step.reason);
  }
  count.failedInRow = 0;
  count.failedActions ||= step.value.ran.some((r) => r.result.kind === "failed");
  const before = count.failed;
  count.failed = new Set(step.value.ran.map(failureOf).filter((f) => f !== "none"));
  return afterPass(loop, count, step.value) === "end" ? "end" : paced(loop, step.value, pace(step.value.ran, before));
}

// paced : how long the loop waits before the next pass, logged with what it waits on (#445)
function paced(loop: LoopSetup, step: Step, how: Pace): After {
  if (how.kind === "now") {
    loop.log(`in flight: ${step.flying.join(", ")}; next pass now`);
    return { wait: 0 };
  }
  const poll = loop.pollMinutes * 60_000;
  if (how.kind === "limited") {
    const wait = Math.max(poll, how.until - loop.now());
    const until = new Date(how.until).toISOString();
    loop.log(
      `in flight: ${step.flying.join(", ")}; the git host's rate limit lasts until ${until}; next pass in ${Math.ceil(wait / 60_000)} min, when the rate limit is over`,
    );
    return { wait };
  }
  const named = step.flying.map((t) => {
    const why = how.repeated.has(t) ? "its step failed the same way twice in a row" : (step.waits.get(t) ?? "");
    return why === "" ? t : `${t} (${why})`;
  });
  loop.log(`in flight: ${named.join(", ")}; next pass in ${loop.pollMinutes} min`);
  return { wait: poll };
}

// failedPass : a failed pass, printed; the loop ends after too many in a row, else waits the poll interval, or until
// the git host's rate limit is over when the pass met one and it lasts longer (#62)
function failedPass(loop: LoopSetup, count: Count, reason: string): After {
  count.failedInRow += 1;
  const until = rateLimitedUntil(reason);
  const poll = loop.pollMinutes * 60_000;
  if (until === "none") {
    loop.log(`pass ${count.passes} failed: ${reason}`);
    return count.failedInRow >= MAX_FAILED_PASSES ? "failed" : { wait: poll };
  }
  loop.log(
    `pass ${count.passes} failed: ${reason}; the git host's rate limit lasts until ${new Date(until).toISOString()}`,
  );
  if (count.failedInRow >= MAX_FAILED_PASSES) {
    return "failed";
  }
  const wait = Math.max(poll, until - loop.now());
  loop.log(`next pass in ${Math.ceil(wait / 60_000)} min, when the rate limit is over`);
  return { wait };
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
  return "wait";
}

async function passes(loop: LoopSetup): Promise<Result<LoopEnd>> {
  const count: Count = { passes: 0, failedInRow: 0, failedActions: false, held: [], failed: new Set() };
  for (;;) {
    const after = next(loop, count, await passAndLook(loop));
    if (after === "failed") {
      return { kind: "failed", reason: `${MAX_FAILED_PASSES} passes in a row failed; the orchestrator loop ends` };
    }
    if (after === "end") {
      return { kind: "ok", value: { passes: count.passes, failedActions: count.failedActions, held: count.held } };
    }
    if (after.wait > 0) {
      await loop.sleep(after.wait);
    }
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
