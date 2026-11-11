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
// further review, and is told so once ("no further design review (round cap)"). An edit that raises the lane or changes
// the Planned files to a pair no earlier round read is a new review, not a further round: it runs past MAX_DESIGN_ROUNDS,
// at most MAX_MOVED_REVIEWS times, since the earlier rounds never saw it; an edit back to a pair already read is not.
//
// A spec whose Planned files need a heavier lane than its own holds the review (#230, #489): no run reads a spec in the
// wrong lane, and the person is told once to raise it; the raised spec is new hashes. A failure no retry fixes (a cite
// that does not hold) stops the step at once. Pure.

import type { Lane } from "../spec.js";
import { above } from "../lane.js";
import { toVerify, type DesignFinding, type Kept } from "../design/findings.js";
import { backoffMs, type DesignStep, type Event } from "./records.js";

export const MAX_DESIGN_FAILURES = 3;
// the most design review rounds one ticket gets, at different spec or design hashes; then the person decides (#489)
export const MAX_DESIGN_ROUNDS = 2;
// the most reviews beyond those for an edit that moved the lane or the Planned files to a pair no round read; then the
// person decides, told once (#489 review)
export const MAX_MOVED_REVIEWS = 2;
// what the person is told when the round cap skips a review
export const ROUND_CAP = "no further design review (round cap): the person decides on the findings they have";

export type DesignView =
  // no design review is due: the lane has none, or the ticket has no START or no spec
  | { readonly kind: "off" }
  // a person is told why the review holds or ends at these hashes (a raised lane, the round cap): once
  | { readonly kind: "note"; readonly spec: string; readonly design: string; readonly why: string }
  // the review holds for a person, who was told why: the lane must be raised first
  | { readonly kind: "held"; readonly why: string }
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

// failures: the times of the step's failures since its last finished run; final: the newest failure's reason when no
// retry fixes it, "" otherwise
type Tries = { readonly done: Ended | "none"; readonly failures: readonly string[]; readonly final: string };

// tries : the step's last finished run at these hashes after `after`, and the times of its failures since that run
function tries(ended: readonly Ended[], step: DesignStep, after: string): Tries {
  const mine = ended.filter((e) => e.step === step && Date.parse(e.at) >= Date.parse(after));
  const done = mine.findLast((e) => e.outcome === "done") ?? "none";
  const since = done === "none" ? "1970-01-01T00:00:00Z" : done.at;
  const failed = mine.filter((e) => e.outcome === "failed" && Date.parse(e.at) > Date.parse(since));
  const last = failed.at(-1);
  return { done, failures: failed.map((e) => e.at), final: last?.final === true ? last.why : "" };
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

// one earlier round, as a re-review reads it in earlier.json: its hashes, the spec's lane and Planned files then, the
// design-reviewer's findings, what the verify pass kept (with its bucket and why), and what it dismissed
export type EarlierRound = {
  readonly round: number;
  readonly spec: string;
  readonly design: string;
  readonly lane?: Lane;
  readonly planned?: readonly string[];
  readonly findings: readonly DesignFinding[];
  readonly kept: readonly Kept[];
  readonly dismissed: readonly DesignFinding[];
};

// roundsBefore : the ticket's earlier rounds, oldest first, each with the review it verified. Pure.
export function roundsBefore(events: readonly Event[], h: Hashes): readonly EarlierRound[] {
  return earlierRounds(events, h).map((v, i) => roundOf(events, v, i + 1));
}

// roundOf : one earlier round: its verify pass, and the review at the same hashes. Pure.
function roundOf(events: readonly Event[], v: Ended, round: number): EarlierRound {
  const review = events.findLast(
    (e): e is Ended => e.kind === "design-ended" && e.step === "review" && e.outcome === "done" && at(e, v),
  );
  const findings = review?.findings ?? [];
  const keptIds = new Set(v.kept.map((k) => k.id));
  const dismissed = toVerify(findings).filter((f) => !keptIds.has(f.id));
  return { round, spec: v.spec, design: v.design, ...readOf(v), findings, kept: v.kept, dismissed };
}

// readOf : a round's lane and Planned files, as fields to spread; none on an older line. Pure.
function readOf(v: Ended): Partial<SpecRead> {
  return {
    ...(v.lane === undefined ? {} : { lane: v.lane }),
    ...(v.planned === undefined ? {} : { planned: v.planned }),
  };
}

function sameFinding(f: DesignFinding): string {
  return `${f.verdict}\n${f.decision.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

// settled : the findings an earlier round settled: every one the verify pass dismissed, and every one it kept that the
// person answered in the grill (all but an Act on CONFLICT, which is what a re-review checks again). Pure.
function settled(rounds: readonly EarlierRound[]): ReadonlySet<string> {
  return new Set(
    rounds.flatMap((r) => [...r.dismissed, ...r.kept.filter((k) => !actOnConflict({ kept: [k] }))].map(sameFinding)),
  );
}

// dropRepeats : a re-review's findings less the conflicts and opens an earlier round settled, by verdict and decision,
// so a repeat never reaches the person again whatever the model did with earlier.json; with the count dropped. Pure.
export function dropRepeats(
  findings: readonly DesignFinding[],
  rounds: readonly EarlierRound[],
): { readonly findings: readonly DesignFinding[]; readonly dropped: number } {
  const done = settled(rounds);
  const left = findings.filter((f) => f.verdict === "aligned" || !done.has(sameFinding(f)));
  return { findings: left, dropped: findings.length - left.length };
}

// actOnConflict : whether a round kept a CONFLICT the verify pass put in Act on: the only finding that reviews again
function actOnConflict(round: { readonly kept: readonly Kept[] }): boolean {
  return round.kept.some((k) => k.verdict === "conflict" && k.bucket === "act_on");
}

// the spec as the review sees it: its lane and its Planned files
export type SpecRead = { readonly lane: Lane; readonly planned: readonly string[] };

// moved : the spec's lane rose, or its Planned files changed, since a round read it; a round older than these fields
// never counts as moved
function moved(round: Ended, now: SpecRead): boolean {
  const rose = round.lane !== undefined && above(now.lane, round.lane);
  const was = round.planned === undefined ? undefined : filesOf(round.planned);
  return rose || (was !== undefined && was !== filesOf(now.planned));
}

function filesOf(planned: readonly string[]): string {
  return [...planned].toSorted().join("\n");
}

// seen : whether an earlier round already read this lane and these Planned files: an edit back to them (A → B → A) is
// no new review (#489 review)
function seen(earlier: readonly Ended[], now: SpecRead): boolean {
  return earlier.some(
    (r) => r.lane === now.lane && r.planned !== undefined && filesOf(r.planned) === filesOf(now.planned),
  );
}

// newRead : the edit moved the lane or the Planned files to a pair no earlier round read
function newRead(earlier: readonly Ended[], last: Ended, now: SpecRead): boolean {
  return moved(last, now) && !seen(earlier, now);
}

// noted : whether the person was told already at these hashes
function noted(events: readonly Event[], h: Hashes): boolean {
  return events.some((e) => e.kind === "design-noted" && e.spec === h.spec && e.design === h.design);
}

// designView : where the design review of the spec and design with these hashes stands
export type ViewInput = {
  readonly events: readonly Event[];
  readonly spec: string;
  readonly design: string;
  // the spec's lane and Planned files
  readonly read: SpecRead;
  // why the spec's Planned files need a heavier lane (lane.ts raisedWhy), or "" when they do not
  readonly raised: string;
  // the approval record's time, or "" with no current approval
  readonly approvedAt: string;
  readonly now: number;
};

export function designView(input: ViewInput): DesignView {
  const h = { spec: input.spec, design: input.design };
  if (input.raised !== "") {
    return noted(input.events, h) ? { kind: "held", why: input.raised } : { kind: "note", ...h, why: input.raised };
  }
  return reviewAt(input, h);
}

// reviewAt : where the review at these hashes stands, once no raise holds it
function reviewAt(input: ViewInput, h: Hashes): DesignView {
  const open = unended(input.events);
  const ended = input.events.filter((e): e is Ended => e.kind === "design-ended" && at(e, h));
  const lost = (step: DesignStep): readonly string[] => (open !== "none" && open.step === step ? [open.at] : []);
  const reviewed = tries(ended, "review", "1970-01-01T00:00:00Z");
  if (reviewed.final !== "") {
    return { kind: "stopped", step: "review", why: reviewed.final };
  }
  if (reviewed.done === "none") {
    return reviewDue(input, h, [...reviewed.failures, ...lost("review")]);
  }
  const verified = tries(ended, "verify", reviewed.done.at);
  if (verified.done === "none") {
    return next("verify", [...verified.failures, ...lost("verify")], h, input.now);
  }
  return afterRound(input.approvedAt, verified.done.at);
}

// reviewDue : the review at these hashes: a first round, a new review after an edit that moved the lane or the
// Planned files, or a re-review for an Act on CONFLICT under the cap; else the person decides, told once at the cap
function reviewDue(input: ViewInput, h: Hashes, failures: readonly string[]): DesignView {
  const earlier = earlierRounds(input.events, h);
  const last = earlier.at(-1);
  if (last === undefined) {
    return next("review", failures, h, input.now);
  }
  const limit = roundLimit(earlier, last, input.read);
  if (limit === "none") {
    return afterRound(input.approvedAt, last.at);
  }
  return earlier.length < limit ? next("review", failures, h, input.now) : capped(input, h, last);
}

// roundLimit : how many rounds the ticket may have before this edit's review is skipped: more for a lane or Planned
// files no round read, MAX_DESIGN_ROUNDS for an Act on CONFLICT; "none" when no review is due at all
function roundLimit(earlier: readonly Ended[], last: Ended, read: SpecRead): number | "none" {
  if (newRead(earlier, last, read)) {
    return MAX_DESIGN_ROUNDS + MAX_MOVED_REVIEWS;
  }
  return actOnConflict(last) ? MAX_DESIGN_ROUNDS : "none";
}

// capped : the round cap skipped a review: the person is told once, then decides
function capped(input: ViewInput, h: Hashes, last: Ended): DesignView {
  return noted(input.events, h) ? afterRound(input.approvedAt, last.at) : { kind: "note", ...h, why: ROUND_CAP };
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
