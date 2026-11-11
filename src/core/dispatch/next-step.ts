// next-step — what happens next for a ticket, as a structured step: the factory carries it on, or a person does a named
// action (#485, "can it get stuck?"). The table's waits and hand-overs say why in words; this names who acts and what
// they do, so no ticket with an open change is ever left without one. A why this does not know has no next step, and
// the generated-state test fails on it, so a new row must say who acts. Pure.

import type { Action } from "./table.js";

export type NextStep = { readonly who: "factory" | "person"; readonly does: string };

const FACTORY_RUNS: ReadonlySet<Action["kind"]> = new Set([
  "writer",
  "ready",
  "review",
  "verify",
  "design",
  "ping",
  "design-note",
]);

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
  [/^the gate is green; the human reviews and merges$/, { who: "person", does: "reviews and merges the change" }],
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
    return { who: "person", does: `decides; to go on, removes needs-human and ${AGAIN}` };
  }
  return "why" in action ? stepOf(action.why) : undefined;
}
