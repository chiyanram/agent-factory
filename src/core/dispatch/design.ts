// design — where a ticket's design review stands (#236; docs/DESIGN.md section 3). In a lane whose lanes entry says
// designReview, the orchestrator runs, after the coordinator writes the spec and its design and before the human's
// approval:
//
//   1 a design-reviewer run (its role card), over the spec, the design and the code at the default branch
//   2 a verify pass over its conflicts and opens, the same verify pass the automated review uses
//   3 what the verify pass kept is posted to the ticket's front doors, and the human approves after it
//
// Both runs are read-only and push nothing, so a run that fails, or one whose start has no end because the pass died,
// is tried again after the backoff (records.ts backoffMs), at most MAX_DESIGN_FAILURES times at the same spec and
// design hashes; then the ticket waits for a person. An edit to the spec or the design is a new pair of hashes, so the
// review's failures count afresh. An approval given before the verify pass ended at these hashes does not let the
// build begin: the human approves again, after the findings.
//
// The review converges (P15, #489). Its findings feed one grill round: the coordinator asks the person every CONFLICT and
// OPEN at once and writes the answers into the spec. The edit is new hashes, but a re-review runs only when the last
// round kept an Act on CONFLICT, and it gets every earlier round's findings and decisions, so it reviews only what
// changed. Consider items never block. At most MAX_DESIGN_ROUNDS rounds; after that the person decides, with no
// further review. Pure.

import { backoffMs, type DesignStep, type Event } from "./records.js";

export const MAX_DESIGN_FAILURES = 3;
// the most design review rounds one ticket gets, at different spec or design hashes; then the person decides (#489)
export const MAX_DESIGN_ROUNDS = 2;

export type DesignView =
  // no design review is due: the lane has none, the ticket has no START or no spec, or a raise holds it
  | { readonly kind: "off" }
  | { readonly kind: "run"; readonly step: DesignStep; readonly spec: string; readonly design: string }
  // the step failed at these hashes; its next try is at `at`
  | { readonly kind: "later"; readonly step: DesignStep; readonly at: string }
  // the step failed MAX_DESIGN_FAILURES times at these hashes
  | { readonly kind: "stopped"; readonly step: DesignStep; readonly why: string }
  // approved before the verify pass ended at the approved hashes
  | { readonly kind: "early"; readonly at: string }
  | { readonly kind: "done" };

type Ended = Extract<Event, { kind: "design-ended" }>;
type Hashes = { readonly spec: string; readonly design: string };

const PHASE_STEP: Readonly<Record<string, DesignStep>> = { "design-review": "review", "design-verify": "verify" };

type Open = { readonly step: DesignStep; readonly at: string } | "none";

// openAfter : the design run still open after one more line: a design start opens one, any end or other start closes it
function openAfter(open: Open, e: Event): Open {
  if (e.kind === "design-ended") {
    return "none";
  }
  if (e.kind !== "started") {
    return open;
  }
  const step = PHASE_STEP[e.phase];
  return step === undefined ? "none" : { step, at: e.at };
}

// unended : the step of a design run whose start has no end (the pass died during it), with its start time
function unended(events: readonly Event[]): Open {
  return events.reduce<Open>(openAfter, "none");
}

function at(e: Ended, h: Hashes): boolean {
  return e.spec === h.spec && e.design === h.design;
}

type Tries = { readonly done: Ended | "none"; readonly failures: readonly string[] };

// tries : the step's last finished run at these hashes after `after`, and the times of its failures since that run
function tries(ended: readonly Ended[], step: DesignStep, after: string): Tries {
  const mine = ended.filter((e) => e.step === step && Date.parse(e.at) >= Date.parse(after));
  const done = mine.findLast((e) => e.outcome === "done") ?? "none";
  const since = done === "none" ? "1970-01-01T00:00:00Z" : done.at;
  const failures = mine.filter((e) => e.outcome === "failed" && Date.parse(e.at) > Date.parse(since)).map((e) => e.at);
  return { done, failures };
}

// next : the step to run, or its backoff, or its stop
function next(step: DesignStep, failures: readonly string[], h: Hashes, now: number): DesignView {
  const n = failures.length;
  if (n >= MAX_DESIGN_FAILURES) {
    return {
      kind: "stopped",
      step,
      why: `the design ${step === "review" ? "review" : "verify pass"} failed ${n} times at this spec and design; a person looks, or the coordinator edits them`,
    };
  }
  const last = failures.at(-1);
  const due = last === undefined ? 0 : Date.parse(last) + backoffMs(n);
  return now < due ? { kind: "later", step, at: new Date(due).toISOString() } : { kind: "run", step, ...h };
}

// earlierRounds : the verify passes that finished at other hashes than these, oldest first: the ticket's earlier rounds
export function earlierRounds(events: readonly Event[], h: Hashes): readonly Ended[] {
  return events.filter(
    (e): e is Ended => e.kind === "design-ended" && e.step === "verify" && e.outcome === "done" && !at(e, h),
  );
}

// actOnConflict : whether a round kept a CONFLICT the verify pass put in Act on: the only finding that reviews again
function actOnConflict(round: Ended): boolean {
  return round.kept.some((k) => k.verdict === "conflict" && k.bucket === "act_on");
}

// converged : the review at new hashes is not due: the last round kept no Act on CONFLICT, or the ticket had its
// rounds; the person decides on the findings they have
function converged(earlier: readonly Ended[]): boolean {
  const last = earlier.at(-1);
  return last !== undefined && (!actOnConflict(last) || earlier.length >= MAX_DESIGN_ROUNDS);
}

// designView : where the design review of the spec and design with these hashes stands
export function designView(input: {
  readonly events: readonly Event[];
  readonly spec: string;
  readonly design: string;
  // the approval record's time, or "" with no current approval
  readonly approvedAt: string;
  readonly now: number;
}): DesignView {
  const h = { spec: input.spec, design: input.design };
  const open = unended(input.events);
  const ended = input.events.filter((e): e is Ended => e.kind === "design-ended" && at(e, h));
  const lost = (step: DesignStep): readonly string[] => (open !== "none" && open.step === step ? [open.at] : []);
  const reviewed = tries(ended, "review", "1970-01-01T00:00:00Z");
  if (reviewed.done === "none") {
    return reviewDue(input, h, [...reviewed.failures, ...lost("review")]);
  }
  const verified = tries(ended, "verify", reviewed.done.at);
  if (verified.done === "none") {
    return next("verify", [...verified.failures, ...lost("verify")], h, input.now);
  }
  return afterRound(input.approvedAt, verified.done.at);
}

// reviewDue : the review at these hashes, or, when the review has converged, the person's decision with no new round
function reviewDue(
  input: { readonly events: readonly Event[]; readonly approvedAt: string; readonly now: number },
  h: Hashes,
  failures: readonly string[],
): DesignView {
  const earlier = earlierRounds(input.events, h);
  const last = earlier.at(-1);
  return converged(earlier) && last !== undefined
    ? afterRound(input.approvedAt, last.at)
    : next("review", failures, h, input.now);
}

// afterRound : done, unless the approval came before the round's findings did
function afterRound(approvedAt: string, roundAt: string): DesignView {
  const early = approvedAt !== "" && roundAt !== "" && Date.parse(approvedAt) < Date.parse(roundAt);
  return early ? { kind: "early", at: roundAt } : { kind: "done" };
}

// keptAt : what the verify pass kept at these hashes, for the post; none before it ended
export function keptAt(events: readonly Event[], h: Hashes): Ended | "none" {
  return events.findLast((e): e is Ended => e.kind === "design-ended" && e.step === "verify" && at(e, h)) ?? "none";
}
