// table — the orchestrator's one decision table (#103; ADR-0012 S3). Pure: it reads one ticket's state (what a human
// said: its START and its approval; its change on the git host as poll reports it; and the run records) and gives one
// action. Every row that can repeat has a stop, after which a person decides.
//
// Nothing starts unless a human starts it (P8, #227). A ticket's build may begin only after a human's word:
//   tiny                          its START
//   bug, feature, one-way door    its START and its approval, bound to the spec's and the design's hashes (the
//                                 approval floor); an approval with no START waits, since nothing runs without one
// A START in a lane that needs an approval, or a START whose spec the coordinator has not written yet, waits. So does a
// spec whose planned files need a heavier lane than its own (#230; lane.ts): the engine only ever raises a lane.
//
//   the change is merged and still claimed                     reconcile (remove the claim)
//   more than one change on factory/<ticket>                   needs-human (forks are never the ticket's change)
//   needs-human on the change                                  wait: a person decides
//   a run started and never ended (the dispatcher died)        needs-human: check what that run pushed
//   no START, no approval above tiny, an approval with no       release a claim, else wait
//   START, or a stale approval
//   a maintainer's /stop newer than that START or approval     wait; a new START (tiny) or approval lifts it
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
//   the change conflicts with its target (poll's conflict)     implementer merges the default branch in
//                                                              1 failure → needs-human (still conflicting after the
//                                                              merge run); nothing rebases or force-pushes
//   writer done, no ready check at this head                   ready check
//   the ready check read a diff that needs a heavier lane       needs-human: raise the spec's lane, approve it (#230);
//   than the one a human approved or STARTed                   a test check's stop at the same check is named too
//   ready check stopped by a test check (#231)                 needs-human, the hits listed; a human's waiver at
//                                                              this head, newer than that check, runs it again
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
// A writer run that retries a failed check (the ready check, a review's Act on findings, the local verifier) waits
// until the nextTry that check recorded (#228; records.ts): 10 s after its first failure, doubling, at most 5 minutes.
// The caps above still hold: a step out of tries goes to a person, whatever its next try.
//
// Two rules hold over every row. A wait on a claimed change that has been quiet (no record, no comment) for
// FACTORY_QUIET_MINUTES releases the claim, so a stuck change goes back to the queue. A stop the dispatcher already
// handed to a person is not handed over again: removing needs-human does not lift it. The way back from needs-human
// (#227, #151 gap 1): a person removes the label and STARTs again (tiny) or approves the spec again (the other lanes);
// the newer record starts every count afresh, and the next pass picks the ticket up.
//
// The ticket's cap (#131; caps.ts) holds over every run: a ticket whose runs since the approval spent its cap goes to
// needs-human, with the spend shown, instead of starting another.

import { above, raisedWhy } from "../lane.js";
import type { Lane } from "../spec.js";
import type { OpenLine, MergedLine } from "../poll.js";
import type { Retried, Summary, Task } from "./records.js";
import { ticketCapped, type Caps } from "./caps.js";

// what a human said that lets the build begin (#227): a START and an approval, or a START alone in the tiny lane; at
// is the newer of the two records, and the run records count from then
export type ApprovalView =
  | { readonly kind: "approved"; readonly at: string; readonly lane: Lane }
  // a START alone, in a lane that needs no approval
  | { readonly kind: "started"; readonly at: string; readonly lane: Lane }
  | { readonly kind: "stale" }
  | { readonly kind: "missing" }
  // a START, and a spec whose lane needs an approval the ticket does not have
  | { readonly kind: "unapproved"; readonly lane: Lane }
  // a START, and no spec ready yet: the coordinator writes it
  | { readonly kind: "unwritten" }
  // an approval, and no START: nothing runs without one
  | { readonly kind: "unstarted" }
  // a START (and an approval), and the spec's planned files need a heavier lane than the spec's (#230)
  | { readonly kind: "raised"; readonly from: Lane; readonly to: Lane; readonly why: string };

// a human's waiver of the test checks (#231; waiver.ts): the head it was given at, and when
export type WaiverView =
  | { readonly kind: "none" }
  | { readonly kind: "waived"; readonly head: string; readonly at: string };

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
  readonly waiver: WaiverView;
  readonly change: ChangeView;
  readonly runs: Summary;
  // milliseconds since the epoch
  readonly now: number;
  readonly quietMinutes: number;
  // the ticket's cap (#131)
  readonly caps: Caps;
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
// merge runs for a conflict at one head: the first that leaves the change still conflicting goes to a person
export const MAX_CONFLICT_RUNS = 1;

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

// goAt : when a human's START or approval let the build begin, or "" while nothing does
export function goAt(view: ApprovalView): string {
  return view.kind === "approved" || view.kind === "started" ? view.at : "";
}

type Held = Exclude<ApprovalView, { kind: "approved" } | { kind: "started" }>;
type HeldMap = { readonly [V in Held as V["kind"]]: V };

const HELD: { readonly [K in keyof HeldMap]: (view: HeldMap[K]) => string } = {
  stale: () => "the spec or its design changed after its approval",
  missing: () => "the ticket has no START and no approval",
  unapproved: (v) => `the ${v.lane} lane needs a human's approval; the ticket has a START only`,
  unwritten: () => "the ticket has a START; its spec is not written yet",
  unstarted: () => "approved, no START: a human STARTs the ticket first",
  raised: (v) => raisedWhy(v),
};

function heldAs<K extends keyof HeldMap>(kind: K, view: HeldMap[K]): string {
  return HELD[kind](view);
}

// heldWhy : why nothing a human said lets the build begin, or "" when something does
function heldWhy(view: ApprovalView): string {
  return view.kind === "approved" || view.kind === "started" ? "" : heldAs(view.kind, view);
}

const approval: Rule = (s) => {
  const why = heldWhy(s.approval);
  if (why === "") {
    return "next";
  }
  const line = open(s);
  return line !== "none" && line.claimed ? { kind: "release", why } : { kind: "wait", why };
};

// newerStop : a /stop that is newer than the START or approval; an undated one counts as newer
function newerStop(line: OpenLine, at: string): boolean {
  return line.stop.kind === "stopped" ? Date.parse(line.stop.at) > Date.parse(at) : line.stop.kind === "undated";
}

const stopped: Rule = (s) => {
  const line = open(s);
  const at = goAt(s.approval);
  const held = line !== "none" && at !== "" && newerStop(line, at);
  return held
    ? {
        kind: "wait",
        why: "a maintainer's /stop is newer than the START or approval; START (tiny) or approve again to go on",
      }
    : "next";
};

// quiet : nothing on the change since the newest of our record, its last comment and the START or approval
function quiet(s: TicketState, line: OpenLine): boolean {
  const times = [s.runs.lastAt, line.lastNoteAt, goAt(s.approval)].map(Date.parse).filter(Number.isFinite);
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
  const said = s.approval.kind === "started" ? "started" : "approved";
  return w.kind === "none" ? { kind: "writer", task: nextTask(s), why: `${said}; no run yet` } : after(s, w);
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

// conflict : a change that does not merge into its target sends the implementer to merge the default branch in. The
// head is the writer's (headMoved stands off otherwise), so a conflict right after a merge run is that run's failure.
const conflict: Rule = (s) => {
  const line = open(s);
  if (line === "none" || line.mergeable !== "conflict") {
    return "next";
  }
  const w = s.runs.lastWriter;
  return w.kind === "ended" && w.mode === "rebase"
    ? {
        kind: "needs-human",
        why: `the change still conflicts with its target after ${MAX_CONFLICT_RUNS} merge run; a person merges the default branch in`,
      }
    : {
        kind: "writer",
        task: { kind: "conflict", head: line.head },
        why: "the change conflicts with its target: merge the default branch in",
      };
};

// saidLane : the lane a human said yes to: approved, or STARTed in a lane that needs no approval
function saidLane(view: ApprovalView): Lane | "none" {
  return view.kind === "approved" || view.kind === "started" ? view.lane : "none";
}

// raisedLaneWhy : why the ready check's diff stops the change, when it needs a heavier lane than the one a human said
// yes to (#230); "" when it does not. A raise stops for a person, never for the writer: only a raised spec and a new
// approval let it go on, and a waiver does not.
function raisedLaneWhy(s: TicketState, lane: Lane | undefined): string {
  const said = saidLane(s.approval);
  return lane !== undefined && said !== "none" && above(lane, said)
    ? raisedWhy({ from: said, to: lane, why: "the ready check read the real diff" })
    : "";
}

type LastReady = Extract<Summary["lastReady"], { kind: "ended" }>;

// alsoStopped : the test checks' own stop at the same check, when they stopped it too and no waiver lifted it (#231)
function alsoStopped(s: TicketState, head: string, r: LastReady): string {
  const tests = r.human && !r.passed ? testChecksStopped(s, head, r) : { kind: "ready" as const, head };
  return tests.kind === "needs-human" ? `; and ${tests.why}` : "";
}

// laneRaised : a lane raise goes to a person, naming the test checks' stop as well when both hit
const laneRaised: Rule = (s) => {
  const r = s.runs.lastReady;
  const head = writerHead(s);
  const why = r.kind === "ended" && r.head === head ? raisedLaneWhy(s, r.lane) : "";
  return why === "" || r.kind !== "ended" ? "next" : { kind: "needs-human", why: `${why}${alsoStopped(s, head, r)}` };
};

// waivedSince : a waiver given at this head after the ready check that stopped it
function waivedSince(waiver: WaiverView, head: string, checkedAt: string): boolean {
  return waiver.kind === "waived" && waiver.head === head && Date.parse(waiver.at) > Date.parse(checkedAt);
}

const ready: Rule = (s) => {
  const head = writerHead(s);
  const r = s.runs.lastReady;
  if (r.kind === "none" || r.head !== head) {
    return { kind: "ready", head };
  }
  if (r.passed) {
    return "next";
  }
  return r.human ? testChecksStopped(s, head, r) : readyFailed(s, head, r.why);
};

// testChecksStopped : a test check hit is a person's to decide, until their waiver at this head runs the check again
function testChecksStopped(s: TicketState, head: string, r: { readonly at: string; readonly why: string }): Action {
  return waivedSince(s.waiver, head, r.at)
    ? { kind: "ready", head }
    : { kind: "needs-human", why: `the test checks stopped the change at ${head.slice(0, 8)}: ${r.why}` };
}

function readyFailed(s: TicketState, head: string, why: string): Action {
  return s.runs.readyFailures >= MAX_READY_FAILURES
    ? { kind: "needs-human", why: `the ready check failed ${s.runs.readyFailures} times` }
    : {
        kind: "writer",
        task: { kind: "ready-failed", head },
        why: `the ready check failed at this head: ${why}`,
      };
}

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
  conflict,
  laneRaised,
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

// the check whose failure each retrying task answers
const RETRIES: Readonly<Partial<Record<Task["kind"], Retried>>> = {
  "ready-failed": "ready",
  "act-on": "review",
  "verify-failed": "verify",
};

const STEP_NAMES: Readonly<Record<Retried, string>> = {
  ready: "ready check",
  review: "review",
  verify: "local verifier",
};

// backedOff : a writer run that retries a failed check waits until that check's next try (#228)
function backedOff(state: TicketState, action: Action): Action {
  const next = state.runs.nextTry;
  const retries = action.kind === "writer" ? RETRIES[action.task.kind] : undefined;
  const early = next.kind === "set" && next.step === retries && state.now < Date.parse(next.at);
  return early ? { kind: "wait", why: `the ${STEP_NAMES[next.step]} failed; the next try is at ${next.at}` } : action;
}

// once : a stop already handed to a person waits; removing needs-human does not lift it
function once(state: TicketState, action: Action): Action {
  return action.kind === "needs-human" && state.runs.blocked.includes(action.why)
    ? {
        kind: "wait",
        why: `handed to a person earlier: ${action.why}; START again (tiny) or approve again to go on`,
      }
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

const RUNS: ReadonlySet<Action["kind"]> = new Set(["writer", "ready", "review", "verify"]);

// capped : a run of a ticket at its cap goes to a person instead, with what the ticket spent (#131)
function capped(state: TicketState, action: Action): Action {
  const why = RUNS.has(action.kind) ? ticketCapped(state.runs.spent, state.caps) : "";
  return why === "" ? action : { kind: "needs-human", why };
}

// decide : the one action for this ticket now, with the rules that hold over every row.
export function decide(state: TicketState): Action {
  return released(state, once(state, capped(state, backedOff(state, first(state)))));
}
