// table — the orchestrator's one decision table (#103; ADR-0012 S3). Pure: it reads one ticket's state (what a human
// said: its START and its approval; its change on the git host as poll reports it; and the run records) and gives one
// action. Every row that can repeat has a stop, after which a person decides.
//
// Nothing starts unless a human starts it (P8). A ticket's build may begin only after a human's word:
//   tiny                          its START
//   bug, feature, one-way door    its START and its approval, bound to the spec's and the design's hashes (the
//                                 approval floor); an approval with no START waits, since nothing runs without one
// In a lane with a design review (design.ts), the spec and its design get one before the human's approval: a
// design-reviewer run, then a verify pass, both read-only. What the verify pass kept goes to the front doors, and the
// build waits for an approval given after it.
// A START in a lane that needs an approval, or a START whose spec the coordinator has not written yet, waits. So does a
// spec whose planned files need a heavier lane than its own (lane.ts): the engine only ever raises a lane.
//
//   the change is merged                                       reconcile (record the merge, take the claim off)
//   more than one change on factory/<ticket>                   needs-human (forks are never the ticket's change)
//   needs-human on the change                                  wait: a person decides
//   a run started and never ended (the dispatcher died)        needs-human: a writer's folder's work pushed and named;
//                                                              else check what it pushed (a design run: tried again)
//   a design review due at the spec's and design's hashes      design-reviewer, then verify pass; a failed run is tried
//                                                              again after its backoff, 3 failures → wait for a person
//   approved before the design review's verify pass ended      wait: the human approves again, after the findings
//   no START, no approval above tiny, an approval with no       release a claim, else wait
//   START, or a stale approval
//   a maintainer's /stop newer than that START or approval     wait; a new START (tiny) or approval lifts it
//   an open question                                           wait
//   a pipeline state the factory does not know                 needs-human
//   claimed, but this dispatcher never ran on it               wait: someone else holds it
//   a run ended and its change is gone (closed)                needs-human
//   approved, no writer run yet                                writer (a test-first lane: the test-first writer first)
//   the test-first run is done                                 writer for the fix
//   the writer asked and a person answered                     writer again
//   the writer was blocked and a person removed needs-human    writer again
//   the provider's usage limit parked the writer's run         wait until the reset, then the same task again; an
//                                                              unknown reset, or a refusal again at a reset no later
//                                                              → needs-human
//   the head is not the writer's (a person pushed)             wait: stand off
//   the same patch twice, or a run that changed nothing        needs-human
//     (but see a rework at the same head, below)
//   the change conflicts with its target (poll's conflict)     implementer merges the default branch in
//                                                              1 failure → needs-human (still conflicting after the
//                                                              merge run); nothing rebases or force-pushes
//   writer done, no ready check at this head                   ready check
//   the ready check read a diff that needs a heavier lane       needs-human: raise the spec's lane, approve it;
//   than the one a human approved or STARTed                   a test check's stop at the same check is named too
//   ready check stopped by a test check                        needs-human, the hits listed; a human's waiver at
//                                                              this head, newer than that check, runs it again
//   ready check failed                                         writer again        3 failures → needs-human
//   ready check failed at this head, and what it ran is not     ready check again: the writer's rework changed
//   what it would run now: other evidence rows, or other        its rows, not its code, or the project file changed
//   allowed programs                                           the programs; each run counts towards the 3 failures
//   ready check passed, no review at this head                 reviewer            3 rounds → needs-human
//   Act on findings                                            writer again        3 rounds → needs-human
//   CI red                                                     writer again        2 CI rounds → needs-human
//   local gate, no verifier run at this head                   local verifier (it also posts a commit status)
//   local gate, the verifier failed, or a forge check is red   writer again        2 CI rounds → needs-human
//   local gate, the verifier passed                            ping the human once
//   CI running, none yet, or a manual job                      wait
//   gate green                                                 ping the human once; never undraft
//
// A writer run that retries a failed check (the ready check, a review's Act on findings, the local verifier) waits
// until the nextTry that check recorded (records.ts): 10 s after its first failure, doubling, at most 5 minutes.
// The caps above still hold: a step out of tries goes to a person, whatever its next try.
//
// Two rules hold over every row. A wait on a claimed change that has been quiet (no record, no comment) for
// FACTORY_QUIET_MINUTES releases the claim, so a stuck change goes back to the queue. A stop the dispatcher already
// handed to a person is not handed over again: removing needs-human does not lift it. The way back from needs-human:
// a person removes the label and STARTs again (tiny) or approves the spec again (the other lanes); the newer record
// starts every count afresh, and the next pass picks the ticket up. A hold whose reason no longer holds (the ready
// check would now run other rows or programs) needs only the label removed.
//
// The ticket's cap (caps.ts) holds over every run: a ticket whose runs since the approval spent its cap goes to
// needs-human, with the spend shown, instead of starting another.
//
// A local gate reads the verifier's result from the dispatcher's own record, never from the forge, where any other
// check or status (a bot, a preview) could read as green. A park keeps its claim when it goes quiet, since its wait is
// the factory's until a reset hours away.

import { above, raisedWhy, type Lane } from "../lane-order.js";
import type { OpenLine, MergedLine } from "../poll.js";
import type { Retried, RunFolder, Summary, Task, WriterMode } from "./records.js";
import type { Caps } from "./caps.js";
import { ticketCapped } from "./ticket-cap.js";
import { waitingWhy, type BlockersView } from "./blockers.js";
import type { DesignView } from "./design.js";
import type { DesignStep } from "./records.js";
import type { Answer } from "../answers.js";
import type { Evidence } from "../report.js";

export type ApprovalView =
  | { readonly kind: "approved"; readonly at: string; readonly lane: Lane; readonly testFirst: boolean }
  | { readonly kind: "started"; readonly at: string; readonly lane: Lane; readonly testFirst: boolean }
  | { readonly kind: "stale"; readonly started: boolean }
  | { readonly kind: "missing" }
  | { readonly kind: "unapproved"; readonly lane: Lane }
  | { readonly kind: "unwritten" }
  | { readonly kind: "unstarted" }
  | { readonly kind: "raised"; readonly from: Lane; readonly to: Lane; readonly why: string };

export type WaiverView =
  | { readonly kind: "none" }
  | { readonly kind: "waived"; readonly head: string; readonly at: string };

export type ChangeView =
  | { readonly kind: "none" }
  | { readonly kind: "open"; readonly line: OpenLine }
  | { readonly kind: "merged"; readonly line: MergedLine }
  | { readonly kind: "many"; readonly numbers: readonly number[] };

export type Gate = "forge-ci" | "local";

export type TicketState = {
  readonly ticket: string;
  readonly gate: Gate;
  readonly approval: ApprovalView;
  readonly waiver: WaiverView;
  readonly change: ChangeView;
  readonly runs: Summary;
  readonly now: number;
  readonly quietMinutes: number;
  readonly caps: Caps;
  readonly design: DesignView;
  readonly blockers?: BlockersView;
  readonly programs?: readonly string[];
};

export type Action =
  | { readonly kind: "wait"; readonly why: string }
  | { readonly kind: "writer"; readonly task: Task; readonly why: string }
  | { readonly kind: "ready"; readonly head: string }
  | { readonly kind: "review"; readonly head: string }
  | { readonly kind: "verify"; readonly head: string }
  | { readonly kind: "design"; readonly step: DesignStep; readonly spec: string; readonly design: string }
  | { readonly kind: "held"; readonly why: string; readonly ping: boolean }
  | { readonly kind: "blockers-unread"; readonly why: string }
  | { readonly kind: "design-note"; readonly spec: string; readonly design: string; readonly why: string }
  | { readonly kind: "needs-human"; readonly why: string; readonly run?: RunFolder }
  | { readonly kind: "release"; readonly why: string }
  | { readonly kind: "ping"; readonly head: string }
  | { readonly kind: "reconcile" };

export const MAX_READY_FAILURES = 3;
export const MAX_REVIEW_ROUNDS = 3;
export const MAX_CI_ROUNDS = 2;
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

export const LABEL_WAIT = "needs-human: a person decides";

const needsHuman: Rule = (s) => {
  const line = open(s);
  return line !== "none" && line.needsHuman ? { kind: "wait", why: LABEL_WAIT } : "next";
};

const DESIGN_PHASES: ReadonlySet<string> = new Set(["design-review", "design-verify"]);

const interrupted: Rule = (s) => {
  const i = s.runs.interrupted;
  if (i.kind !== "interrupted" || DESIGN_PHASES.has(i.phase)) {
    return "next";
  }
  const ended = `the ${i.phase} run started at ${i.at} never ended`;
  return i.run === undefined
    ? { kind: "needs-human", why: `${ended}; check what it pushed` }
    : { kind: "needs-human", why: `${ended}; its run folder is ${i.run.folder}`, run: i.run };
};

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

function heldWhy(view: ApprovalView): string {
  return view.kind === "approved" || view.kind === "started" ? "" : heldAs(view.kind, view);
}

const DESIGN_STEP: Readonly<Record<DesignStep, string>> = { review: "design review", verify: "design verify pass" };

type DesignMap = { readonly [V in DesignView as V["kind"]]: V };

const DESIGN: { readonly [K in keyof DesignMap]: (d: DesignMap[K]) => Action | "next" } = {
  off: () => "next",
  done: () => "next",
  run: (d) => ({ kind: "design", step: d.step, spec: d.spec, design: d.design }),
  note: (d) => ({ kind: "design-note", spec: d.spec, design: d.design, why: d.why }),
  held: (d) => ({ kind: "wait", why: d.why }),
  later: (d) => ({ kind: "wait", why: `the ${DESIGN_STEP[d.step]} failed; the next try is at ${d.at}` }),
  stopped: (d) => ({ kind: "wait", why: d.why }),
  early: (d) => ({
    kind: "wait",
    why: `approved before the design review's findings (posted at ${d.at}): read them, then approve again`,
  }),
};

function designAs<K extends keyof DesignMap>(kind: K, d: DesignMap[K]): Action | "next" {
  return DESIGN[kind](d);
}

const STARTED: ReadonlySet<ApprovalView["kind"]> = new Set(["approved", "started", "unapproved", "raised"]);

export function startedIn(view: ApprovalView): boolean {
  return view.kind === "stale" ? view.started : STARTED.has(view.kind);
}

const designReview: Rule = (s) =>
  s.design.kind === "run" && !startedIn(s.approval) ? "next" : designAs(s.design.kind, s.design);

const approval: Rule = (s) => {
  const why = heldWhy(s.approval);
  if (why === "") {
    return "next";
  }
  const line = open(s);
  return line !== "none" && line.claimed ? { kind: "release", why } : { kind: "wait", why };
};

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

function nextTask(s: TicketState): Task {
  const said = s.approval.kind === "approved" || s.approval.kind === "started";
  const testFirst = said && s.approval.testFirst;
  return { kind: testFirst && !s.runs.testFirstDone ? "test-first" : "fix" };
}

const AGAIN: Readonly<Record<"asked" | "blocked", string>> = {
  asked: "the question was answered",
  blocked: "a person removed needs-human",
};

function answered(s: TicketState, task: Task): Task {
  const answers = answersOn(s);
  return answers.length === 0 || (task.kind !== "fix" && task.kind !== "test-first") ? task : { ...task, answers };
}

function answersOn(s: TicketState): readonly Answer[] {
  const line = open(s);
  return line === "none" ? [] : (line.answers ?? []);
}

function after(s: TicketState, w: Extract<Summary["lastWriter"], { kind: "ended" }>): Action | "next" {
  if (w.outcome !== "done") {
    return { kind: "writer", task: answered(s, nextTask(s)), why: AGAIN[w.outcome] };
  }
  return w.mode === "test-first"
    ? { kind: "writer", task: answered(s, { kind: "fix" }), why: "the failing test is in; now the fix" }
    : "next";
}

const blocked: Rule = (s) => {
  const b = s.blockers ?? { kind: "none" };
  return begun(s) || b.kind === "none" ? "next" : blockedAs(b.kind, s, b);
};

export const MAX_UNREAD_PASSES = 3;

type BlockedMap = { readonly [V in Exclude<BlockersView, { kind: "none" }> as V["kind"]]: V };

const BLOCKED: { readonly [K in keyof BlockedMap]: (s: TicketState, b: BlockedMap[K]) => Action } = {
  broken: (_s, b) => ({ kind: "needs-human", why: b.why }),
  unread: (s, b) => unreadAs(s, b.why),
  waiting: (s, b) => holdAs(s, waitingWhy(b.on)),
};

function unreadAs(s: TicketState, why: string): Action {
  if (s.runs.unreadPasses + 1 < MAX_UNREAD_PASSES) {
    return { kind: "blockers-unread", why };
  }
  const since = s.runs.unreadSince === "" ? "" : ` since ${s.runs.unreadSince}`;
  const stop = `the git host did not answer for the ticket's blockers on ${MAX_UNREAD_PASSES} passes in a row${since}: ${s.runs.unreadFirst || why}`;
  return s.runs.blocked.includes(stop) ? { kind: "blockers-unread", why } : { kind: "needs-human", why: stop };
}

function blockedAs<K extends keyof BlockedMap>(kind: K, s: TicketState, b: BlockedMap[K]): Action {
  return BLOCKED[kind](s, b);
}

function holdAs(s: TicketState, why: string): Action {
  if (s.runs.heldWhy === why && s.runs.unreadPasses === 0) {
    return { kind: "wait", why };
  }
  return { kind: "held", why, ping: s.runs.heldWhy !== why };
}

function begun(s: TicketState): boolean {
  return s.runs.lastWriter.kind !== "none" || s.change.kind !== "none";
}

export const PARK_WAIT = "the provider's usage limit lasts until";

type ParkedRun = Extract<Summary["parked"], { kind: "parked" }>;

function parkHandedOver(p: ParkedRun): Action | undefined {
  if (p.until === "unknown") {
    return { kind: "needs-human", why: `the provider's usage limit; its reset time is unknown: ${p.said}` };
  }
  return p.repeated
    ? { kind: "needs-human", why: `the provider refused again after its usage limit reset at ${p.until}: ${p.said}` }
    : undefined;
}

const parked: Rule = (s) => {
  const p = s.runs.parked;
  if (p.kind !== "parked" || p.phase !== "writer" || p.task === undefined) {
    return "next";
  }
  return parkHandedOver(p) ?? afterReset(s, p, p.task);
};

function afterReset(s: TicketState, p: ParkedRun, task: Task): Action {
  return s.now < Date.parse(p.until)
    ? { kind: "wait", why: `${PARK_WAIT} ${p.until}` }
    : { kind: "writer", task: answered(s, task), why: `the provider's usage limit reset at ${p.until}` };
}

const writerAgain: Rule = (s) => {
  const w = s.runs.lastWriter;
  const said = s.approval.kind === "started" ? "started" : "approved";
  return w.kind === "none"
    ? { kind: "writer", task: answered(s, nextTask(s)), why: `${said}; no run yet` }
    : after(s, w);
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

type LastReadyEnded = Extract<Summary["lastReady"], { kind: "ended" }>;

function sameList<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): boolean {
  return a.length === b.length && a.every((x, i) => i in b && same(x, b[i] ?? x));
}

function sameRow(a: Evidence, b: Evidence): boolean {
  return a.criterion === b.criterion && a.command === b.command && a.result === b.result;
}

function readyInputsChanged(s: TicketState, r: LastReadyEnded): boolean {
  return rowsChanged(s, r) || programsChanged(s, r);
}

function rowsChanged(s: TicketState, r: LastReadyEnded): boolean {
  const w = s.runs.lastWriter;
  const rows = w.kind === "ended" ? w.evidence : [];
  return r.evidence !== undefined && !sameList(r.evidence, rows, sameRow);
}

function programsChanged(s: TicketState, r: LastReadyEnded): boolean {
  const then = r.programs ?? "unknown";
  const now = s.programs ?? "unknown";
  return then !== "unknown" && now !== "unknown" && !sameList(then, now, (a, b) => a === b);
}

function recheck(s: TicketState, head: string): boolean {
  const r = s.runs.lastReady;
  return r.kind === "ended" && r.head === head && !r.passed && !r.human && readyInputsChanged(s, r);
}

function checkedSince(s: TicketState, w: Extract<Summary["lastWriter"], { kind: "ended" }>): boolean {
  const r = s.runs.lastReady;
  const ended = Date.parse(w.at ?? "");
  return r.kind === "ended" && r.head === w.head && !(Date.parse(r.at) < ended);
}

function notCheckedAt(s: TicketState, head: string): boolean {
  const r = s.runs.lastReady;
  return r.kind !== "ended" || r.head !== head;
}

const EVIDENCE_MODES: ReadonlySet<WriterMode> = new Set(["rework", "fix"]);

function evidenceRework(s: TicketState, w: Extract<Summary["lastWriter"], { kind: "ended" }>): boolean {
  return rowsOnly(w) && judges(s, w);
}

function rowsOnly(w: Extract<Summary["lastWriter"], { kind: "ended" }>): boolean {
  return w.patch === "" && EVIDENCE_MODES.has(w.mode) && w.evidence.length > 0;
}

function judges(s: TicketState, w: Extract<Summary["lastWriter"], { kind: "ended" }>): boolean {
  return checkedSince(s, w) || recheck(s, w.head) || notCheckedAt(s, w.head);
}

function patchChecked(s: TicketState, w: Extract<Summary["lastWriter"], { kind: "ended" }>): boolean {
  return w.mode !== "cleanup" && !evidenceRework(s, w);
}

const samePatch: Rule = (s) => {
  const w = s.runs.lastWriter;
  if (w.kind !== "ended" || !patchChecked(s, w)) {
    return "next";
  }
  if (w.patch === "") {
    return { kind: "needs-human", why: "the writer's run changed nothing" };
  }
  return w.patch === s.runs.previousPatch
    ? { kind: "needs-human", why: "the writer made the same patch twice" }
    : "next";
};

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

function saidLane(view: ApprovalView): Lane | "none" {
  return view.kind === "approved" || view.kind === "started" ? view.lane : "none";
}

function raisedLaneWhy(s: TicketState, lane: Lane | undefined): string {
  const said = saidLane(s.approval);
  return lane !== undefined && said !== "none" && above(lane, said)
    ? raisedWhy({ from: said, to: lane, why: "the ready check read the real diff" })
    : "";
}

type LastReady = LastReadyEnded;

function alsoStopped(s: TicketState, head: string, r: LastReady): string {
  const tests = r.human && !r.passed ? testChecksStopped(s, head, r) : { kind: "ready" as const, head };
  return tests.kind === "needs-human" ? `; and ${tests.why}` : "";
}

const laneRaised: Rule = (s) => {
  const r = s.runs.lastReady;
  const head = writerHead(s);
  const why = r.kind === "ended" && r.head === head ? raisedLaneWhy(s, r.lane) : "";
  return why === "" || r.kind !== "ended" ? "next" : { kind: "needs-human", why: `${why}${alsoStopped(s, head, r)}` };
};

function waivedSince(waiver: WaiverView, head: string, checkedAt: string): boolean {
  return waiver.kind === "waived" && waiver.head === head && Date.parse(waiver.at) > Date.parse(checkedAt);
}

function due(s: TicketState, head: string): boolean {
  const r = s.runs.lastReady;
  return r.kind === "none" || r.head !== head || recheck(s, head);
}

const ready: Rule = (s) => {
  const head = writerHead(s);
  const r = s.runs.lastReady;
  if (r.kind === "none" || due(s, head)) {
    return { kind: "ready", head };
  }
  if (r.passed) {
    return "next";
  }
  return r.human ? testChecksStopped(s, head, r) : readyFailed(s, head, r.why);
};

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

function verifiedHere(s: TicketState): boolean | "none" {
  const v = s.runs.lastVerify;
  return v.kind === "ended" && v.head === writerHead(s) ? v.passed : "none";
}

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
  designReview,
  approval,
  stopped,
  asks,
  unknownPipeline,
  claimedElsewhere,
  noChange,
  blocked,
  parked,
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

function backedOff(state: TicketState, action: Action): Action {
  const next = state.runs.nextTry;
  const retries = action.kind === "writer" ? RETRIES[action.task.kind] : undefined;
  const early = next.kind === "set" && next.step === retries && state.now < Date.parse(next.at);
  return early ? { kind: "wait", why: `the ${STEP_NAMES[next.step]} failed; the next try is at ${next.at}` } : action;
}

function once(state: TicketState, action: Action): Action {
  return action.kind === "needs-human" && state.runs.blocked.includes(action.why)
    ? {
        kind: "wait",
        why: `handed to a person earlier: ${action.why}; START again (tiny) or approve again to go on`,
      }
    : action;
}

function releasable(action: Action): action is Extract<Action, { kind: "wait" }> {
  return action.kind === "wait" && !action.why.startsWith(PARK_WAIT);
}

function released(state: TicketState, action: Action): Action {
  const line = open(state);
  const quietClaim = line !== "none" && line.claimed && quiet(state, line);
  return quietClaim && releasable(action)
    ? { kind: "release", why: `quiet for over ${state.quietMinutes} minutes: ${action.why}` }
    : action;
}

export const RUNS: ReadonlySet<Action["kind"]> = new Set(["writer", "ready", "review", "verify", "design"]);

function capped(state: TicketState, action: Action): Action {
  const why = RUNS.has(action.kind) ? ticketCapped(state.runs.spent, state.caps) : "";
  return why === "" ? action : { kind: "needs-human", why };
}

export function decide(state: TicketState): Action {
  return released(state, once(state, capped(state, backedOff(state, first(state)))));
}

const MACHINE_WAITS: ReadonlySet<string | undefined> = new Set([WAITS.running, WAITS.none]);

export function inFlight(state: TicketState): boolean {
  const action = decide(state);
  return RUNS.has(action.kind) || TELLS.has(action.kind) || (HELD_KINDS.has(action.kind) && carried(first(state)));
}

const TELLS: ReadonlySet<Action["kind"]> = new Set(["ping", "design-note", "held", "blockers-unread"]);

const HELD_KINDS: ReadonlySet<Action["kind"]> = new Set(["wait", "release"]);

function designLater(why: string): boolean {
  return Object.values(DESIGN_STEP).some((step) => why.startsWith(`the ${step} failed; the next try is at`));
}

function carried(row: Action): boolean {
  return (
    RUNS.has(row.kind) ||
    (row.kind === "wait" && (MACHINE_WAITS.has(row.why) || designLater(row.why) || row.why.startsWith(PARK_WAIT)))
  );
}
