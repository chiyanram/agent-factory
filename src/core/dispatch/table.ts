// table — the dispatcher's one decision table (#103; ADR-0012 S3). Pure: it reads one ticket's state (its local
// approval, its change on the forge as poll reports it, and the run records) and gives one action. Every row that can
// repeat has a stop, after which a person decides.
//
//   the change is merged and still claimed                     reconcile (remove the claim)
//   more than one change on factory/<ticket>                   needs-human (forks are never the ticket's change)
//   needs-human on the change                                  wait: a person decides
//   a run started and never ended (the dispatcher died)        needs-human: check what that run pushed
//   no approval, or a stale one                                release a claim, else wait
//   a maintainer's /stop newer than the approval               wait; approving again lifts it
//   an open question                                           wait
//   a pipeline state the factory does not know                 needs-human
//   claimed, but this dispatcher never ran on it               wait: someone else holds it
//   a run ended and its change is gone (closed)                needs-human
//   approved, no writer run yet                                writer (a bug: the test-first writer first)
//   the test-first run is done                                 writer for the fix
//   the writer asked and a person answered                     writer again
//   the writer was blocked and a person removed needs-human    writer again
//   the head is not the writer's (a person pushed)             wait: stand off
//   the same patch twice, or a run that changed nothing        needs-human
//   writer done, no ready check at this head                   ready check
//   ready check failed                                         writer again        3 failures → needs-human
//   ready check passed, no review at this head                 reviewer            3 rounds → needs-human
//   Act on findings                                            writer again        3 rounds → needs-human
//   CI red                                                     writer again        2 CI rounds → needs-human
//   local gate (#91), no verifier run at this head             local verifier (it also posts a commit status)
//   local gate, the verifier failed, or a forge check is red   writer again        2 CI rounds → needs-human
//   local gate, the verifier passed                            ping the human once
//   CI running, none yet, or a manual job                      wait
//   gate green                                                 ping the human once; never undraft
//
// Two rules hold over every row. A wait on a claimed change that has been quiet (no record, no comment) for
// FACTORY_QUIET_MINUTES releases the claim, so a stuck change goes back to the queue. A stop the dispatcher already
// handed to a person is not handed over again: removing needs-human does not lift it; approving again does, and starts
// every count afresh.
//
// Today: a merge conflict has no row, since poll does not report mergeability yet; the writer is not sent to rebase.

import type { Lane } from "../spec.js";
import type { OpenLine, MergedLine } from "../poll.js";
import type { Summary, Task } from "./records.js";

export type ApprovalView =
  | { readonly kind: "approved"; readonly at: string; readonly lane: Lane }
  | { readonly kind: "stale" }
  | { readonly kind: "missing" };

export type ChangeView =
  | { readonly kind: "none" }
  | { readonly kind: "open"; readonly line: OpenLine }
  | { readonly kind: "merged"; readonly line: MergedLine }
  // more than one change of this repository on the ticket's branch: none of them can be trusted to be the one
  | { readonly kind: "many"; readonly numbers: readonly number[] };

// where the gate's result comes from: the forge's own CI, or the local verifier's commit status (#91; the project file)
export type Gate = "forge-ci" | "local";

export type TicketState = {
  readonly ticket: string;
  readonly gate: Gate;
  readonly approval: ApprovalView;
  readonly change: ChangeView;
  readonly runs: Summary;
  // milliseconds since the epoch
  readonly now: number;
  readonly quietMinutes: number;
};

export type Action =
  | { readonly kind: "wait"; readonly why: string }
  | { readonly kind: "writer"; readonly task: Task; readonly why: string }
  | { readonly kind: "ready"; readonly head: string }
  | { readonly kind: "review"; readonly head: string }
  | { readonly kind: "verify"; readonly head: string }
  | { readonly kind: "needs-human"; readonly why: string }
  | { readonly kind: "release"; readonly why: string }
  | { readonly kind: "ping"; readonly head: string }
  | { readonly kind: "reconcile" };

export const MAX_READY_FAILURES = 3;
export const MAX_REVIEW_ROUNDS = 3;
export const MAX_CI_ROUNDS = 2;

type Rule = (s: TicketState) => Action | "next";

function open(s: TicketState): OpenLine | "none" {
  return s.change.kind === "open" ? s.change.line : "none";
}

const merged: Rule = (s) => (s.change.kind === "merged" ? { kind: "reconcile" } : "next");

const many: Rule = (s) =>
  s.change.kind === "many"
    ? { kind: "needs-human", why: `${s.change.numbers.length} changes use factory/${s.ticket}` }
    : "next";

const needsHuman: Rule = (s) => {
  const line = open(s);
  return line !== "none" && line.needsHuman ? { kind: "wait", why: "needs-human: a person decides" } : "next";
};

const interrupted: Rule = (s) => {
  const i = s.runs.interrupted;
  return i.kind === "interrupted"
    ? { kind: "needs-human", why: `the ${i.phase} run started at ${i.at} never ended; check what it pushed` }
    : "next";
};

const approval: Rule = (s) => {
  if (s.approval.kind === "approved") {
    return "next";
  }
  const line = open(s);
  const why = s.approval.kind === "stale" ? "the spec changed after its approval" : "the ticket has no approval";
  return line !== "none" && line.claimed ? { kind: "release", why } : { kind: "wait", why };
};

// newerStop : a /stop that is newer than the approval; an undated one counts as newer
function newerStop(line: OpenLine, approvedAt: string): boolean {
  return line.stop.kind === "stopped"
    ? Date.parse(line.stop.at) > Date.parse(approvedAt)
    : line.stop.kind === "undated";
}

const stopped: Rule = (s) => {
  const line = open(s);
  const held = line !== "none" && s.approval.kind === "approved" && newerStop(line, s.approval.at);
  return held
    ? { kind: "wait", why: "a maintainer's /stop is newer than the approval; approve again to go on" }
    : "next";
};

// quiet : nothing on the change since the newest of our record, its last comment and the approval
function quiet(s: TicketState, line: OpenLine): boolean {
  const times = [s.runs.lastAt, line.lastNoteAt, s.approval.kind === "approved" ? s.approval.at : ""]
    .map(Date.parse)
    .filter(Number.isFinite);
  return times.length > 0 && s.now - Math.max(...times) > s.quietMinutes * 60_000;
}

const asks: Rule = (s) => {
  const line = open(s);
  return line === "none" || line.asks === 0 ? "next" : { kind: "wait", why: "an open question waits for a person" };
};

const unknownPipeline: Rule = (s) => {
  const line = open(s);
  return line !== "none" && line.pipeline.kind === "unknown"
    ? { kind: "needs-human", why: `the forge reports a pipeline state the factory does not know: ${line.pipeline.raw}` }
    : "next";
};

const claimedElsewhere: Rule = (s) => {
  const line = open(s);
  return line !== "none" && line.claimed && s.runs.lastAt === ""
    ? { kind: "wait", why: "claimed, but not by this dispatcher" }
    : "next";
};

const noChange: Rule = (s) =>
  s.change.kind === "none" && s.runs.lastWriter.kind === "ended"
    ? { kind: "needs-human", why: `a run ended, but no change is open on factory/${s.ticket} (closed?)` }
    : "next";

// a bug's fix waits for its failing test, however the test-first run ended
function nextTask(s: TicketState): Task {
  const bug = s.approval.kind === "approved" && s.approval.lane === "bug";
  return { kind: bug && !s.runs.testFirstDone ? "test-first" : "fix" };
}

const AGAIN: Readonly<Record<"asked" | "blocked", string>> = {
  asked: "the question was answered",
  blocked: "a person removed needs-human",
};

// after : the writer's next run once the last one ended; "next" when it finished its work
function after(s: TicketState, w: Extract<Summary["lastWriter"], { kind: "ended" }>): Action | "next" {
  if (w.outcome !== "done") {
    return { kind: "writer", task: nextTask(s), why: AGAIN[w.outcome] };
  }
  return w.mode === "test-first"
    ? { kind: "writer", task: { kind: "fix" }, why: "the failing test is in; now the fix" }
    : "next";
}

// the writer's next run, when the last one ended in a way that calls for one
const writerAgain: Rule = (s) => {
  const w = s.runs.lastWriter;
  return w.kind === "none" ? { kind: "writer", task: nextTask(s), why: "approved; no run yet" } : after(s, w);
};

function writerHead(s: TicketState): string {
  return s.runs.lastWriter.kind === "ended" ? s.runs.lastWriter.head : "";
}

const headMoved: Rule = (s) => {
  const line = open(s);
  return line !== "none" && line.head !== writerHead(s)
    ? { kind: "wait", why: "the head is not the writer's: a person pushed; stand off" }
    : "next";
};

const samePatch: Rule = (s) => {
  const w = s.runs.lastWriter;
  if (w.kind !== "ended") {
    return "next";
  }
  if (w.patch === "") {
    return { kind: "needs-human", why: "the writer's run changed nothing" };
  }
  return w.patch === s.runs.previousPatch
    ? { kind: "needs-human", why: "the writer made the same patch twice" }
    : "next";
};

const ready: Rule = (s) => {
  const head = writerHead(s);
  const r = s.runs.lastReady;
  if (r.kind === "none" || r.head !== head) {
    return { kind: "ready", head };
  }
  if (r.passed) {
    return "next";
  }
  return s.runs.readyFailures >= MAX_READY_FAILURES
    ? { kind: "needs-human", why: `the ready check failed ${s.runs.readyFailures} times` }
    : {
        kind: "writer",
        task: { kind: "ready-failed", why: r.why },
        why: `the ready check failed at this head: ${r.why}`,
      };
};

// the review at this head, or "none" when there is none yet
function reviewHere(s: TicketState): number | "none" {
  const r = s.runs.lastReview;
  return r.kind === "ended" && r.head === writerHead(s) ? r.actOn : "none";
}

const review: Rule = (s) => {
  const actOn = reviewHere(s);
  const spent = s.runs.reviewRounds >= MAX_REVIEW_ROUNDS;
  if (actOn === 0) {
    return "next";
  }
  if (spent) {
    return {
      kind: "needs-human",
      why:
        actOn === "none"
          ? `${s.runs.reviewRounds} review rounds and still not through`
          : `Act on findings after ${s.runs.reviewRounds} review rounds`,
    };
  }
  return actOn === "none"
    ? { kind: "review", head: writerHead(s) }
    : { kind: "writer", task: { kind: "act-on", head: writerHead(s) }, why: `${actOn} Act on finding(s)` };
};

const WAITS: Readonly<Record<string, string>> = {
  running: "CI is running at this head",
  none: "no CI result at this head yet",
  manual: "a manual CI job waits for a person",
  skipped: "CI skipped this head",
};

const RED = new Set(["failed", "canceled"]);

// red : the writer's CI run, for the check that failed, or a person after the last round
function red(s: TicketState, failed: "forge" | "verifier"): Action {
  const head = writerHead(s);
  if (s.runs.ciRounds >= MAX_CI_ROUNDS) {
    return { kind: "needs-human", why: `CI is still red after ${s.runs.ciRounds} CI rounds` };
  }
  return failed === "forge"
    ? { kind: "writer", task: { kind: "ci-red", head }, why: "CI is red at this head" }
    : { kind: "writer", task: { kind: "verify-failed", head }, why: "the local verifier failed at this head" };
}

function green(s: TicketState): Action {
  const head = writerHead(s);
  return s.runs.pingedAt === head
    ? { kind: "wait", why: "the gate is green; the human reviews and merges" }
    : { kind: "ping", head };
}

// verifiedHere : the local verifier's result at the writer's head, from the dispatcher's own record; never from the
// forge, where any other check or status (a bot, a preview) could read as green (#91)
function verifiedHere(s: TicketState): boolean | "none" {
  const v = s.runs.lastVerify;
  return v.kind === "ended" && v.head === writerHead(s) ? v.passed : "none";
}

// localGate : with a local gate the verifier's own run decides; a red forge check still sends the writer back
const localGate: Rule = (s) => {
  if (s.gate !== "local") {
    return "next";
  }
  const passed = verifiedHere(s);
  if (passed === "none") {
    return { kind: "verify", head: writerHead(s) };
  }
  if (!passed) {
    return red(s, "verifier");
  }
  return forgeRed(s) ? red(s, "forge") : green(s);
};

// forgeRed : a check on the forge is red at this head, whatever the gate
function forgeRed(s: TicketState): boolean {
  const line = open(s);
  return line !== "none" && RED.has(line.pipeline.kind);
}

const gate: Rule = (s) => {
  const line = open(s);
  const pipeline = line === "none" ? "none" : line.pipeline.kind;
  if (RED.has(pipeline)) {
    return red(s, "forge");
  }
  return pipeline === "success" ? green(s) : { kind: "wait", why: WAITS[pipeline] ?? "waiting for CI" };
};

const RULES: readonly Rule[] = [
  merged,
  many,
  needsHuman,
  interrupted,
  approval,
  stopped,
  asks,
  unknownPipeline,
  claimedElsewhere,
  noChange,
  writerAgain,
  headMoved,
  samePatch,
  ready,
  review,
  localGate,
  gate,
];

function first(state: TicketState): Action {
  for (const rule of RULES) {
    const action = rule(state);
    if (action !== "next") {
      return action;
    }
  }
  return { kind: "wait", why: "nothing to do" };
}

// once : a stop already handed to a person waits; removing needs-human does not lift it
function once(state: TicketState, action: Action): Action {
  return action.kind === "needs-human" && state.runs.blocked.includes(action.why)
    ? { kind: "wait", why: `handed to a person earlier: ${action.why}; approve again to go on` }
    : action;
}

// released : a wait on a claimed change that has gone quiet gives the claim back
function released(state: TicketState, action: Action): Action {
  const line = open(state);
  const quietClaim = line !== "none" && line.claimed && quiet(state, line);
  return action.kind === "wait" && quietClaim
    ? { kind: "release", why: `quiet for over ${state.quietMinutes} minutes: ${action.why}` }
    : action;
}

// decide : the one action for this ticket now, with the two rules that hold over every row.
export function decide(state: TicketState): Action {
  return released(state, once(state, first(state)));
}
