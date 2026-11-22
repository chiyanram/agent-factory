// next-step — what happens next for a ticket, as a structured step: the factory carries it on, or a person does a named
// action (#485, "can it get stuck?"). The table's waits and hand-overs say why in words; this names who acts and what
// they do, so no ticket with an open change is ever left without one. Each wait carries its kind, and the type gives
// every kind a step, so a new kind of wait cannot compile without saying who acts. Pure.
//
// whoseTurn reads the same step as a lane: needs you (a person's step other than the merge), ready to merge (the gate is green; a person reviews and merges) or factory (a step the factory carries
// on by itself: a run, or the gate). A notice the factory sends goes in the lane of the turn it announces. The board,
// the ping and the UI read the lane from here, never from the records, so it cannot drift from the decision table.

import { RUNS, type Action, type WaitKind } from "./table.js";

export type NextStep = { readonly who: "factory" | "person"; readonly does: string };

export type Lane = "needs-you" | "ready-to-merge" | "factory";

export const LANES: readonly Lane[] = ["needs-you", "ready-to-merge", "factory"];

export type Turn =
  | { readonly lane: "needs-you" | "ready-to-merge"; readonly step: NextStep }
  | { readonly lane: "factory"; readonly on: "run" | "gate"; readonly step: NextStep };

const MERGE: NextStep = { who: "person", does: "reviews and merges the change" };

const AGAIN = "STARTs the ticket again (tiny) or approves its spec again: agent-factory start | approve";

const APPROVE: NextStep = { who: "person", does: "approves the spec: agent-factory approve <project> <ticket> <hash>" };
const RUN_AGAIN: NextStep = { who: "factory", does: "runs the step again at its next try" };

const HAND_BACK: NextStep = {
  who: "person",
  does: `reads the note on the change, removes needs-human, and ${AGAIN}`,
};

const WAIT_STEPS: { readonly [K in WaitKind]: NextStep } = {
  ci: { who: "factory", does: "polls the git host again for CI" },
  retry: RUN_AGAIN,
  "design-retry": RUN_AGAIN,
  "usage-limit": { who: "factory", does: "runs the step again once the provider's usage limit resets" },
  "manual-ci": { who: "person", does: "runs the manual CI job on the git host" },
  "ci-skipped": { who: "person", does: "starts CI at this head on the git host, or pushes a commit" },
  merge: MERGE,
  question: { who: "person", does: "answers the OPEN round on the change: a choice per question" },
  "claimed-elsewhere": {
    who: "person",
    does: "whoever claimed it finishes it, or gives it back by removing the claim label on the git host",
  },
  "head-moved": { who: "person", does: `the person who pushed finishes, then ${AGAIN}` },
  "needs-human": HAND_BACK,
  "handed-over": HAND_BACK,
  stopped: { who: "person", does: AGAIN },
  "approval-stale": {
    who: "person",
    does: "approves the spec again: agent-factory approve <project> <ticket> <hash>",
  },
  "no-start": { who: "person", does: "STARTs the ticket: agent-factory start <project> <ticket>" },
  "start-only": APPROVE,
  "spec-unwritten": {
    who: "person",
    does: "writes the spec with the coordinator, then checks it: agent-factory spec <project> <ticket>",
  },
  "lane-raised": { who: "person", does: "raises the spec's ## Lane with the coordinator, then approves it" },
  "lane-check-failed": {
    who: "person",
    does: "reads why the lane check failed, fixes the spec's planned files or the lanes, then the design review runs",
  },
  "approved-early": { who: "person", does: "reads the design review's findings, then approves again" },
  "design-failed": {
    who: "person",
    does: "reads the design run's log, or edits the spec or design, which reviews it afresh",
  },
  blocked: {
    who: "factory",
    does: "waits for each blocker to merge, then starts the build from the default branch (#494)",
  },
  broken: { who: "person", does: "reads the orchestrator's log for the ticket's error" },
  idle: { who: "factory", does: "decides the ticket again at the next pass" },
};

const UNANSWERED = /^the git host did not answer for the ticket's blockers on \d+ passes in a row/;
const UNANSWERED_STEP: NextStep = {
  who: "person",
  does: "checks the git host's login and the tickets the spec is blocked by; the ticket goes on by itself once the git host answers",
};

function handOverStep(why: string): NextStep {
  return UNANSWERED.test(why)
    ? UNANSWERED_STEP
    : { who: "person", does: `decides; to go on, removes needs-human and ${AGAIN}` };
}

const RUN_STEP = (action: Action): NextStep => ({ who: "factory", does: `starts the ${action.kind} step` });
const WAITED = (action: { readonly wait: WaitKind }): NextStep => WAIT_STEPS[action.wait];

const STEP_OF: { readonly [K in Action["kind"]]: (action: Extract<Action, { kind: K }>) => NextStep } = {
  writer: RUN_STEP,
  ready: RUN_STEP,
  review: RUN_STEP,
  verify: RUN_STEP,
  design: RUN_STEP,
  ping: RUN_STEP,
  "design-note": RUN_STEP,
  held: RUN_STEP,
  "blockers-unread": RUN_STEP,
  reconcile: () => ({ who: "factory", does: "removes the claim from the merged change" }),
  "needs-human": (action) => handOverStep(action.why),
  wait: WAITED,
  release: WAITED,
};

function stepAs<K extends Action["kind"]>(kind: K, action: Extract<Action, { kind: K }>): NextStep {
  return STEP_OF[kind](action);
}

export function nextStep(action: Action): NextStep {
  return stepAs(action.kind, action);
}

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

function turnOf(action: Action, step: NextStep): Turn {
  if (step.who === "factory") {
    return { lane: "factory", on: RUNS.has(action.kind) ? "run" : "gate", step };
  }
  return { lane: step === MERGE ? "ready-to-merge" : "needs-you", step };
}

export function whoseTurn(action: Action): Turn {
  return announced(action) ?? turnOf(action, nextStep(action));
}
