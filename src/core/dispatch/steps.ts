// steps — the contract between the orchestrator's pass (tick.ts) and the runs it starts (#547): what each step takes,
// what it gives back, and the value for a step that is not set up. The steps live with what they run
// (writer/step.ts, ready/steps.ts, review/step.ts, design/step.ts) and import this file, not the pass. The contract
// still names a few of the pass's types (ChangeView, Task, EarlierRound), so a change to those reaches the steps too.

import type { Acted, FoundByRule } from "../review/acted-on.js";
import type { DesignFinding, Kept } from "../design/findings.js";
import type { Result } from "../forge/api.js";
import type { Evidence } from "../report.js";
import type { Lane } from "../spec.js";
import type { EarlierRound } from "./design.js";
import type { Task } from "./records.js";
import type { FailedSpent, RoundSpend, Spend } from "./spend.js";
import type { ChangeView } from "./table.js";

export const BRANCH_PREFIX = "factory/";

// held: a cap kept the run from starting (#131, #237), not a step that is not set up
export type Unavailable = { readonly kind: "unavailable"; readonly reason: string; readonly held?: boolean };
// F: how a failed run may say what it spent, for a step whose runs spend (#483)
export type Step<I, O, F = never> =
  | Unavailable
  | { readonly kind: "available"; readonly run: (input: I) => Promise<Result<O> | F> };

export type RunInput = { readonly ticket: string; readonly change: ChangeView; readonly head: string };
// what a design review's run reads (#236): the spec and design with these hashes, and for the verify pass the
// design-reviewer's conflicts and opens
// earlier: every earlier round, with its hashes, findings, what the verify pass kept and what it dismissed, for a
// re-review and its verify pass (#489); none on a first round
export type DesignInput = {
  readonly ticket: string;
  readonly spec: string;
  readonly design: string;
  readonly earlier?: readonly EarlierRound[];
};
// how a design review's run ended; its card's hash and what it spent are kept either way
// final: a failure no retry fixes (a cite that does not hold), so the step stops at once (#489)
// trace: the run's trace, a plain file name in the ticket's folder (trace.ts, #487); none when it kept none
export type DesignRan<T> = { readonly card: string; readonly spend?: Spend; readonly trace?: string } & (
  | ({ readonly kind: "done" } & T)
  | { readonly kind: "failed"; readonly why: string; readonly final?: true }
);
// what the ready check holds the change to, read on the host (#230): the spec's acceptance criteria, in order (AC-1
// first), and the project's one-way-door paths
export type ReadyFacts = { readonly criteria: readonly string[]; readonly oneWayDoor: readonly string[] };
export type Steps = {
  readonly writer: Step<
    RunInput & { readonly task: Task },
    {
      readonly head: string;
      readonly outcome: "done" | "asked" | "blocked";
      readonly patch: string;
      readonly evidence: readonly Evidence[];
      // the writer hung after its report, and the host stopped it after the completion window (#182)
      readonly hung: boolean;
      // what the run spent (#131); none when it was not measured
      readonly spend?: Spend;
      // the role card's hash, and what a cleanup run deferred (#236)
      readonly card?: string;
      readonly deferred?: readonly string[];
      // each cite of the project's brief that went stale (#235)
      readonly stale?: readonly string[];
      // why a run that is not done stopped, and the file that keeps the end of its output (#62)
      readonly why?: string;
      readonly output?: string;
      // the run's trace, a plain file name in the ticket's folder (trace.ts, #487)
      readonly trace?: string;
    },
    // a writer step that fails after the run still says what the run spent (#483)
    FailedSpent
  >;
  // the ready check runs the writer's evidence rows again at the head; why names the first row that failed, and human
  // says a test check stopped it for a person (#231). It reads the lane the real diff needs (#230), and holds each
  // acceptance criterion of the spec to an evidence row.
  readonly ready: Step<
    RunInput & { readonly evidence: readonly Evidence[] } & ReadyFacts,
    { readonly passed: boolean; readonly why: string; readonly human: boolean; readonly lane?: Lane }
  >;
  // what the round spent: zero when it ran no model, as when it reused a verdict (#131); a round that fails says what
  // its passes spent too, so the caps and usage count it
  readonly review:
    | Unavailable
    | {
        readonly kind: "available";
        // the most a round can spend, in dollars: every finder it can pick and its verify passes at the per-run cap;
        // "unbounded" with no per-run cap. A round whose worst case could pass a dollar cap is held (#237)
        readonly worstUsd?: () => Promise<Result<number | "unbounded">>;
        readonly run: (input: RunInput) => Promise<
          | Result<{
              readonly actOn: number;
              readonly spend: Spend;
              // the round's spend per run: each finder's by its lens, and the verify pass's (#337)
              readonly split?: RoundSpend;
              readonly acted?: Acted;
              readonly lenses?: Readonly<Record<string, number>>;
              readonly citesNotFound?: number;
              // every finding of the round, per rule ID and bucket (#488)
              readonly found?: FoundByRule;
              // each pass's trace, plain file names in the ticket's folder (trace.ts, #487)
              readonly traces?: readonly string[];
            }>
          | FailedSpent
        >;
      };
  // the local verifier (#91): it posts its result as a commit status at the head
  readonly verify: Step<RunInput, { readonly passed: boolean }>;
  // the design review's two read-only runs (#236): the design-reviewer, then the verify pass over its findings
  readonly designReview: Step<DesignInput, DesignRan<{ readonly findings: readonly DesignFinding[] }>>;
  readonly designVerify: Step<
    DesignInput & { readonly findings: readonly DesignFinding[] },
    DesignRan<{ readonly kept: readonly Kept[] }>
  >;
};

// The steps when nothing is set up: the writer waits on the container box (#113); the ready check and the verifier on
// a box and the project file; the reviewer on its settings.
export const STEPS_TODAY: Steps = {
  writer: { kind: "unavailable", reason: "the writer's box is not built yet (#113)" },
  ready: { kind: "unavailable", reason: "the ready check needs a box (#113) and the project file" },
  review: { kind: "unavailable", reason: "the reviewer needs FACTORY_REPO and a plugin that holds its references" },
  verify: { kind: "unavailable", reason: "the local verifier needs a box (#113) and the project file" },
  designReview: { kind: "unavailable", reason: "the design review needs FACTORY_REPO" },
  designVerify: { kind: "unavailable", reason: "the design review needs FACTORY_REPO" },
};
