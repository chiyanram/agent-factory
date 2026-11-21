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
// The review converges (P15). Its findings feed one grill round: the coordinator asks the person every CONFLICT and
// OPEN at once and writes the answers into the spec. The edit is new hashes, but a re-review runs only when the last
// round kept an Act on CONFLICT, and it gets every earlier round's findings and decisions, so it reviews only what
// changed. Consider items never block. At most MAX_DESIGN_ROUNDS rounds; after that the person decides, with no
// further review, and is told so once ("no further design review (round cap)"). An edit that raises the lane or changes
// the Planned files to a pair no earlier round read is a new review, not a further round: it runs past MAX_DESIGN_ROUNDS,
// at most MAX_MOVED_REVIEWS times, since the earlier rounds never saw it; an edit back to a pair already read is not.
// The engine drops each finding an earlier round settled, so a repeat never reaches the person, whatever the model did.
//
// A spec whose Planned files need a heavier lane than its own holds the review: no run reads a spec in the
// wrong lane, and the person is told once to raise it; the raised spec is new hashes. A failure no retry fixes (a cite
// that does not hold) stops the step at once. Pure.

import type { Lane } from "../spec.js";
import { above } from "../lane.js";
import { toVerify, type DesignFinding, type Kept } from "../design/findings.js";
import { backoffMs, type DesignStep, type Event } from "./records.js";

export const MAX_DESIGN_FAILURES = 3;
export const MAX_DESIGN_ROUNDS = 2;
export const MAX_MOVED_REVIEWS = 2;
export const ROUND_CAP = "no further design review (round cap): the person decides on the findings they have";

export type DesignView =
  | { readonly kind: "off" }
  | { readonly kind: "note"; readonly spec: string; readonly design: string; readonly why: string }
  | { readonly kind: "held"; readonly why: string }
  | { readonly kind: "run"; readonly step: DesignStep; readonly spec: string; readonly design: string }
  | { readonly kind: "later"; readonly step: DesignStep; readonly at: string }
  | { readonly kind: "stopped"; readonly step: DesignStep; readonly why: string }
  | { readonly kind: "early"; readonly at: string }
  | { readonly kind: "done" };

type Ended = Extract<Event, { kind: "design-ended" }>;
type Hashes = { readonly spec: string; readonly design: string };

const PHASE_STEP: Readonly<Record<string, DesignStep>> = { "design-review": "review", "design-verify": "verify" };

type Open = { readonly step: DesignStep; readonly at: string } | "none";

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

function unended(events: readonly Event[]): Open {
  return events.reduce<Open>(openAfter, "none");
}

function at(e: Ended, h: Hashes): boolean {
  return e.spec === h.spec && e.design === h.design;
}

type Tries = { readonly done: Ended | "none"; readonly failures: readonly string[]; readonly final: string };

function tries(ended: readonly Ended[], step: DesignStep, after: string): Tries {
  const mine = ended.filter((e) => e.step === step && Date.parse(e.at) >= Date.parse(after));
  const done = mine.findLast((e) => e.outcome === "done") ?? "none";
  const since = done === "none" ? "1970-01-01T00:00:00Z" : done.at;
  const failed = mine.filter((e) => e.outcome === "failed" && Date.parse(e.at) > Date.parse(since));
  const last = failed.at(-1);
  return { done, failures: failed.map((e) => e.at), final: last?.final === true ? last.why : "" };
}

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

export function earlierRounds(events: readonly Event[], h: Hashes): readonly Ended[] {
  return events.filter(
    (e): e is Ended => e.kind === "design-ended" && e.step === "verify" && e.outcome === "done" && !at(e, h),
  );
}

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

export function roundsBefore(events: readonly Event[], h: Hashes): readonly EarlierRound[] {
  return earlierRounds(events, h).map((v, i) => roundOf(events, v, i + 1));
}

function roundOf(events: readonly Event[], v: Ended, round: number): EarlierRound {
  const review = events.findLast(
    (e): e is Ended => e.kind === "design-ended" && e.step === "review" && e.outcome === "done" && at(e, v),
  );
  const findings = review?.findings ?? [];
  const keptIds = new Set(v.kept.map((k) => k.id));
  const dismissed = toVerify(findings).filter((f) => !keptIds.has(f.id));
  return { round, spec: v.spec, design: v.design, ...readOf(v), findings, kept: v.kept, dismissed };
}

function readOf(v: Ended): Partial<SpecRead> {
  return {
    ...(v.lane === undefined ? {} : { lane: v.lane }),
    ...(v.planned === undefined ? {} : { planned: v.planned }),
  };
}

function sameFinding(f: DesignFinding): string {
  return `${f.verdict}\n${f.decision.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

function settled(rounds: readonly EarlierRound[]): ReadonlySet<string> {
  return new Set(
    rounds.flatMap((r) => [...r.dismissed, ...r.kept.filter((k) => !actOnConflict({ kept: [k] }))].map(sameFinding)),
  );
}

export function dropRepeats(
  findings: readonly DesignFinding[],
  rounds: readonly EarlierRound[],
): { readonly findings: readonly DesignFinding[]; readonly dropped: number } {
  const done = settled(rounds);
  const left = findings.filter((f) => f.verdict === "aligned" || !done.has(sameFinding(f)));
  return { findings: left, dropped: findings.length - left.length };
}

function actOnConflict(round: { readonly kept: readonly Kept[] }): boolean {
  return round.kept.some((k) => k.verdict === "conflict" && k.bucket === "act_on");
}

export type SpecRead = { readonly lane: Lane; readonly planned: readonly string[] };

function moved(round: Ended, now: SpecRead): boolean {
  const rose = round.lane !== undefined && above(now.lane, round.lane);
  const was = round.planned === undefined ? undefined : filesOf(round.planned);
  return rose || (was !== undefined && was !== filesOf(now.planned));
}

function filesOf(planned: readonly string[]): string {
  return [...planned].toSorted().join("\n");
}

function seen(earlier: readonly Ended[], now: SpecRead): boolean {
  return earlier.some(
    (r) => r.lane === now.lane && r.planned !== undefined && filesOf(r.planned) === filesOf(now.planned),
  );
}

function newRead(earlier: readonly Ended[], last: Ended, now: SpecRead): boolean {
  return moved(last, now) && !seen(earlier, now);
}

function noted(events: readonly Event[], h: Hashes): boolean {
  return events.some((e) => e.kind === "design-noted" && e.spec === h.spec && e.design === h.design);
}

export type ViewInput = {
  readonly events: readonly Event[];
  readonly spec: string;
  readonly design: string;
  readonly read: SpecRead;
  readonly raised: string;
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

function roundLimit(earlier: readonly Ended[], last: Ended, read: SpecRead): number | "none" {
  if (newRead(earlier, last, read)) {
    return MAX_DESIGN_ROUNDS + MAX_MOVED_REVIEWS;
  }
  return actOnConflict(last) ? MAX_DESIGN_ROUNDS : "none";
}

function capped(input: ViewInput, h: Hashes, last: Ended): DesignView {
  return noted(input.events, h) ? afterRound(input.approvedAt, last.at) : { kind: "note", ...h, why: ROUND_CAP };
}

function afterRound(approvedAt: string, roundAt: string): DesignView {
  const early = approvedAt !== "" && roundAt !== "" && Date.parse(approvedAt) < Date.parse(roundAt);
  return early ? { kind: "early", at: roundAt } : { kind: "done" };
}

export function keptAt(events: readonly Event[], h: Hashes): Ended | "none" {
  return events.findLast((e): e is Ended => e.kind === "design-ended" && e.step === "verify" && at(e, h)) ?? "none";
}
