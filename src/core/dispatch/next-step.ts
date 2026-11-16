// next-step — what happens next for a ticket, as a structured step: the factory carries it on, or a person does a named
// action (#485, "can it get stuck?"). The table's waits and hand-overs say why in words; this names who acts and what
// they do, so no ticket with an open change is ever left without one. A why this does not know has no next step, and
// the generated-state test fails on it, so a new row must say who acts. Pure.
//
// whoseTurn reads the same step as a lane: needs you (a person's step other than the merge, or a wait with no
// known step), ready to merge (the gate is green; a person reviews and merges) or factory (a step the factory carries
// on by itself: a run, or the gate). A notice the factory sends goes in the lane of the turn it announces. The board,
// the ping and the UI read the lane from here, never from the records, so it cannot drift from the decision table.

import { RUNS, type Action } from "./table.js";

export type NextStep = { readonly who: "factory" | "person"; readonly does: string };

export type Lane = "needs-you" | "ready-to-merge" | "factory";

// the lanes in the order a person reads them: what needs them first
export const LANES: readonly Lane[] = ["needs-you", "ready-to-merge", "factory"];

export type Turn =
  | { readonly lane: "needs-you" | "ready-to-merge"; readonly step: NextStep }
  // run: a step the factory starts itself; gate: CI, a backoff, the blockers or a quiet claim given back
  | { readonly lane: "factory"; readonly on: "run" | "gate"; readonly step: NextStep };

const FACTORY_RUNS: ReadonlySet<Action["kind"]> = new Set([
  "writer",
  "ready",
  "review",
  "verify",
  "design",
  "ping",
  "design-note",
  "held",
  "blockers-unread",
]);

// the person's step once the gate is green: the only step in the ready-to-merge lane
const MERGE: NextStep = { who: "person", does: "reviews and merges the change" };

// a person's step for a wait this module does not know (the generated-state test keeps this from happening)
const NO_STEP: NextStep = { who: "person", does: "looks at the ticket: the factory names no next step for this wait" };

const AGAIN = "STARTs the ticket again (tiny) or approves its spec again: agent-factory start | approve";

// each why the table gives a wait, a release or a hand-over, and the step that follows it
const STEPS: readonly (readonly [RegExp, NextStep])[] = [
  [
    /^CI is running at this head$|^no CI result at this head yet$|^waiting for CI$/,
    { who: "factory", does: "polls the git host again for CI" },
  ],
  [/failed; the next try is at /, { who: "factory", does: "runs the step again at its next try" }],
  [/^a manual CI job waits for a person$/, { who: "person", does: "runs the manual CI job on the git host" }],
  [/^CI skipped this head$/, { who: "person", does: "starts CI at this head on the git host, or pushes a commit" }],
  [/^the gate is green; the human reviews and merges$/, MERGE],
  [
    /^an open question waits for a person$/,
    { who: "person", does: "answers the OPEN round on the change: a choice per question" },
  ],
  [
    /^claimed, but not by this dispatcher$/,
    {
      who: "person",
      does: "whoever claimed it finishes it, or gives it back: agent-factory release <project> <change>",
    },
  ],
  [
    /^the head is not the writer's: a person pushed; stand off$/,
    { who: "person", does: `the person who pushed finishes, then ${AGAIN}` },
  ],
  [
    /^needs-human: a person decides$|^handed to a person earlier: /,
    { who: "person", does: `reads the note on the change, removes needs-human, and ${AGAIN}` },
  ],
  [/^a maintainer's \/stop is newer/, { who: "person", does: AGAIN }],
  [
    /^the spec or its design changed after its approval$/,
    { who: "person", does: "approves the spec again: agent-factory approve <project> <ticket> <hash>" },
  ],
  [
    /^the ticket has no START and no approval$|^approved, no START/,
    { who: "person", does: "STARTs the ticket: agent-factory start <project> <ticket>" },
  ],
  [
    /lane needs a human's approval; the ticket has a START only$/,
    { who: "person", does: "approves the spec: agent-factory approve <project> <ticket> <hash>" },
  ],
  [
    /^the ticket has a START; its spec is not written yet$/,
    {
      who: "person",
      does: "writes the spec with the coordinator, then checks it: agent-factory spec <project> <ticket>",
    },
  ],
  [
    /^blocked by .*: the build starts once each is merged$/,
    { who: "factory", does: "waits for each blocker to merge, then starts the build from the default branch (#494)" },
  ],
  [
    /^the lane is raised from /,
    { who: "person", does: "raises the spec's ## Lane with the coordinator, then approves it" },
  ],
  [
    /^approved before the design review's findings/,
    { who: "person", does: "reads the design review's findings, then approves again" },
  ],
  [
    /^the design (?:review|verify pass) failed \d+ times/,
    { who: "person", does: "reads the design run's log, or edits the spec or design, which reviews it afresh" },
  ],
];

// a held ticket's stop when the git host did not answer for its blockers (#494): it has no change to label, and it goes
// on by itself once the git host answers, so the person's step is to look at the git host, not to START again
const UNANSWERED = /^the git host did not answer for the ticket's blockers on \d+ passes in a row/;
const UNANSWERED_STEP: NextStep = {
  who: "person",
  does: "checks the git host's login and the tickets the spec is blocked by; the ticket goes on by itself once the git host answers",
};

// handOverStep : what the person does after a hand-over: look at the git host for an unanswered blocker read, else decide
// and go on by START or approval
function handOverStep(why: string): NextStep {
  return UNANSWERED.test(why)
    ? UNANSWERED_STEP
    : { who: "person", does: `decides; to go on, removes needs-human and ${AGAIN}` };
}

// stepOf : the step a why names, or undefined for one this module does not know
function stepOf(why: string): NextStep | undefined {
  const plain = why.replace(/^quiet for over \d+ minutes: /, "");
  return STEPS.find(([pattern]) => pattern.test(plain))?.[1];
}

// nextStep : who acts next on the ticket, and what they do; undefined for a wait this module does not know
export function nextStep(action: Action): NextStep | undefined {
  if (FACTORY_RUNS.has(action.kind)) {
    return { who: "factory", does: `starts the ${action.kind} step` };
  }
  if (action.kind === "reconcile") {
    return { who: "factory", does: "removes the claim from the merged change" };
  }
  if (action.kind === "needs-human") {
    return handOverStep(action.why);
  }
  return "why" in action ? stepOf(action.why) : undefined;
}

// announced : the person's step a notice tells them of, for a notice the factory sends: the ping on a green gate
// announces the merge; a design note announces a decision the person makes on the spec. Pure.
function announced(action: Action): Turn | undefined {
  if (action.kind === "ping") {
    return { lane: "ready-to-merge", step: MERGE };
  }
  return action.kind === "design-note"
    ? {
        lane: "needs-you",
        step: { who: "person", does: "reads the design note on the change, then decides how the spec goes on" },
      }
    : undefined;
}

// turnOf : the lane a next step puts the ticket in: the factory's run or gate, the merge, or a person's other step. Pure.
function turnOf(action: Action, step: NextStep): Turn {
  if (step.who === "factory") {
    // a run the factory starts itself (the table's RUNS); every other factory step waits on the gate
    return { lane: "factory", on: RUNS.has(action.kind) ? "run" : "gate", step };
  }
  return { lane: step === MERGE ? "ready-to-merge" : "needs-you", step };
}

// whoseTurn : the lane the ticket is in, from its next step: exactly one of needs you, ready to merge and factory. Pure.
export function whoseTurn(action: Action): Turn {
  return announced(action) ?? turnOf(action, nextStep(action) ?? NO_STEP);
}
