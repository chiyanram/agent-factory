// table — the dispatcher's one decision table (#103; ADR-0012 S3). Pure: it reads one ticket's state (its local
// approval, its change on the forge as poll reports it, and the run records) and gives one action. Every row that can
// repeat has a stop, after which a person decides.
//
//   the change is merged and still claimed                     reconcile (remove the claim)
//   needs-human on the change                                  wait: a person decides
//   a run started and never ended (the dispatcher died)        needs-human: check what that run pushed
//   no approval, or a stale one                                release a claim, else wait
//   a maintainer's /stop newer than the approval               wait; approving again lifts it
//   an open question                                           wait; release when quiet FACTORY_QUIET_MINUTES
//   a pipeline state the factory does not know                 needs-human
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
//   CI running, none yet, or a manual job                      wait
//   gate green                                                 ping the human once; never undraft
//
// Today: a merge conflict has no row, since poll does not report mergeability yet; the writer is not sent to rebase.

import type { Lane } from "../spec.js";
import type { OpenLine, MergedLine } from "../poll.js";
import type { Summary, WriterMode } from "./records.js";

export type ApprovalView = { readonly kind: "approved"; readonly at: string; readonly lane: Lane } | { readonly kind: "stale" } | { readonly kind: "missing" };

export type ChangeView = { readonly kind: "none" } | { readonly kind: "open"; readonly line: OpenLine } | { readonly kind: "merged"; readonly line: MergedLine };

export type TicketState = {
  readonly ticket: string;
  readonly approval: ApprovalView;
  readonly change: ChangeView;
  readonly runs: Summary;
  // milliseconds since the epoch
  readonly now: number;
  readonly quietMinutes: number;
};

export type Action =
  | { readonly kind: "wait"; readonly why: string }
  | { readonly kind: "writer"; readonly mode: WriterMode; readonly why: string }
  | { readonly kind: "ready"; readonly head: string }
  | { readonly kind: "review"; readonly head: string }
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

const needsHuman: Rule = (s) => {
  const line = open(s);
  return line !== "none" && line.needsHuman ? { kind: "wait", why: "needs-human: a person decides" } : "next";
};

const interrupted: Rule = (s) => {
  const i = s.runs.interrupted;
  return i.kind === "interrupted" ? { kind: "needs-human", why: `the ${i.phase} run started at ${i.at} never ended; check what it pushed` } : "next";
};

const approval: Rule = (s) => {
  if (s.approval.kind === "approved") {
    return "next";
  }
  const line = open(s);
  const why = s.approval.kind === "stale" ? "the spec changed after its approval" : "the ticket has no approval";
  return line !== "none" && line.claimed ? { kind: "release", why } : { kind: "wait", why };
};

const stopped: Rule = (s) => {
  const line = open(s);
  if (line === "none" || line.stop.kind === "none" || s.approval.kind !== "approved") {
    return "next";
  }
  const newer = line.stop.kind === "undated" || Date.parse(line.stop.at) > Date.parse(s.approval.at);
  return newer ? { kind: "wait", why: "a maintainer's /stop is newer than the approval; approve again to go on" } : "next";
};

function quiet(s: TicketState): boolean {
  const last = Date.parse(s.runs.lastAt);
  return Number.isFinite(last) && s.now - last > s.quietMinutes * 60_000;
}

const asks: Rule = (s) => {
  const line = open(s);
  if (line === "none" || line.asks === 0) {
    return "next";
  }
  const release = line.claimed && quiet(s);
  return release ? { kind: "release", why: `an open question, quiet for over ${s.quietMinutes} minutes` } : { kind: "wait", why: "an open question waits for a person" };
};

const unknownPipeline: Rule = (s) => {
  const line = open(s);
  return line !== "none" && line.pipeline.kind === "unknown" ? { kind: "needs-human", why: `the forge reports a pipeline state the factory does not know: ${line.pipeline.raw}` } : "next";
};

// the writer's next run, when the last one ended in a way that calls for one
const writerAgain: Rule = (s) => {
  const w = s.runs.lastWriter;
  if (w.kind === "none") {
    const bug = s.approval.kind === "approved" && s.approval.lane === "bug";
    return { kind: "writer", mode: bug ? "test-first" : "fix", why: "approved; no run yet" };
  }
  if (w.mode === "test-first" && w.outcome === "done") {
    return { kind: "writer", mode: "fix", why: "the failing test is in; now the fix" };
  }
  return w.outcome === "done" ? "next" : { kind: "writer", mode: "fix", why: w.outcome === "asked" ? "the question was answered" : "a person removed needs-human" };
};

const noChange: Rule = (s) => (s.change.kind === "none" && s.runs.lastWriter.kind === "ended" ? { kind: "wait", why: `a run ended but no change is open for factory/${s.ticket}; tell a person` } : "next");

function writerHead(s: TicketState): string {
  return s.runs.lastWriter.kind === "ended" ? s.runs.lastWriter.head : "";
}

const headMoved: Rule = (s) => {
  const line = open(s);
  return line !== "none" && line.head !== writerHead(s) ? { kind: "wait", why: "the head is not the writer's: a person pushed; stand off" } : "next";
};

const samePatch: Rule = (s) => {
  const w = s.runs.lastWriter;
  if (w.kind !== "ended") {
    return "next";
  }
  if (w.patch === "") {
    return { kind: "needs-human", why: "the writer's run changed nothing" };
  }
  return w.patch === s.runs.previousPatch ? { kind: "needs-human", why: "the writer made the same patch twice" } : "next";
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
    : { kind: "writer", mode: "rework", why: "the ready check failed at this head" };
};

const review: Rule = (s) => {
  const head = writerHead(s);
  const r = s.runs.lastReview;
  const spent = s.runs.reviewRounds >= MAX_REVIEW_ROUNDS;
  if (r.kind === "none" || r.head !== head) {
    return spent ? { kind: "needs-human", why: `${s.runs.reviewRounds} review rounds and still not through` } : { kind: "review", head };
  }
  if (r.actOn === 0) {
    return "next";
  }
  return spent ? { kind: "needs-human", why: `Act on findings after ${s.runs.reviewRounds} review rounds` } : { kind: "writer", mode: "rework", why: `${r.actOn} Act on finding(s)` };
};

const WAITS: Readonly<Record<string, string>> = {
  running: "CI is running at this head",
  none: "no CI result at this head yet",
  manual: "a manual CI job waits for a person",
  skipped: "CI skipped this head",
};

const gate: Rule = (s) => {
  const line = open(s);
  const pipeline = line === "none" ? "none" : line.pipeline.kind;
  if (pipeline === "failed" || pipeline === "canceled") {
    return s.runs.ciRounds >= MAX_CI_ROUNDS ? { kind: "needs-human", why: `CI is still red after ${s.runs.ciRounds} CI rounds` } : { kind: "writer", mode: "ci", why: "CI is red at this head" };
  }
  if (pipeline !== "success") {
    return { kind: "wait", why: WAITS[pipeline] ?? "waiting for CI" };
  }
  const head = writerHead(s);
  return s.runs.pingedAt === head ? { kind: "wait", why: "the gate is green; the human reviews and merges" } : { kind: "ping", head };
};

const RULES: readonly Rule[] = [merged, needsHuman, interrupted, approval, stopped, asks, unknownPipeline, writerAgain, noChange, headMoved, samePatch, ready, review, gate];

// decide : the one action for this ticket now.
export function decide(state: TicketState): Action {
  for (const rule of RULES) {
    const action = rule(state);
    if (action !== "next") {
      return action;
    }
  }
  return { kind: "wait", why: "nothing to do" };
}
