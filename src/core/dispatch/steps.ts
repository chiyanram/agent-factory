// steps — the contract between the orchestrator's pass (tick.ts) and the runs it starts (#547): what each step takes,
// what it gives back, and the value for a step that is not set up. The steps live with what they run
// (writer/step.ts, ready/steps.ts, review/step.ts, design/step.ts) and import this file, not the pass.

import type { Acted, FoundByRule } from "../review/acted-on.js";
import type { DesignFinding, Kept } from "../design/findings.js";
import type { Result } from "../forge/api.js";
import type { Evidence } from "../report.js";
import type { KeptInput, KeptRun } from "../left.js";
import type { Lane } from "../spec.js";
import type { EarlierRound } from "./design.js";
import type { Task } from "./records.js";
import type { FailedSpent, RoundSpend, Spend } from "./spend.js";
import type { ChangeView } from "./table.js";

export const BRANCH_PREFIX = "factory/";

export type Unavailable = { readonly kind: "unavailable"; readonly reason: string; readonly held?: boolean };
export type Step<I, O, F = never, X = unknown> =
  | Unavailable
  | ({ readonly kind: "available"; readonly run: (input: I) => Promise<Result<O> | F> } & X);

export type WriterExtras = {
  readonly folder?: () => Promise<Result<string>>;
  readonly keep?: (input: KeptInput) => Promise<Result<KeptRun>>;
};

export type RunInput = { readonly ticket: string; readonly change: ChangeView; readonly head: string };
export type DesignInput = {
  readonly ticket: string;
  readonly spec: string;
  readonly design: string;
  readonly earlier?: readonly EarlierRound[];
};
export type DesignRan<T> = { readonly card: string; readonly spend?: Spend; readonly trace?: string } & (
  | ({ readonly kind: "done" } & T)
  | { readonly kind: "failed"; readonly why: string; readonly final?: true }
);
export type ReadyFacts = { readonly criteria: readonly string[]; readonly oneWayDoor: readonly string[] };
export type Steps = {
  readonly writer: Step<
    RunInput & { readonly task: Task; readonly folder?: string },
    {
      readonly head: string;
      readonly outcome: "done" | "asked" | "blocked" | "parked";
      readonly parked?: { readonly until: string; readonly said: string };
      readonly patch: string;
      readonly evidence: readonly Evidence[];
      readonly hung: boolean;
      readonly spend?: Spend;
      readonly card?: string;
      readonly deferred?: readonly string[];
      readonly stale?: readonly string[];
      readonly why?: string;
      readonly output?: string;
      readonly trace?: string;
    },
    FailedSpent,
    WriterExtras
  >;
  readonly ready: Step<
    RunInput & { readonly evidence: readonly Evidence[] } & ReadyFacts,
    { readonly passed: boolean; readonly why: string; readonly human: boolean; readonly lane?: Lane }
  >;
  readonly review:
    | Unavailable
    | {
        readonly kind: "available";
        readonly worstUsd?: () => Promise<Result<number | "unbounded">>;
        readonly run: (input: RunInput) => Promise<
          | Result<{
              readonly actOn: number;
              readonly spend: Spend;
              readonly split?: RoundSpend;
              readonly acted?: Acted;
              readonly lenses?: Readonly<Record<string, number>>;
              readonly citesNotFound?: number;
              readonly found?: FoundByRule;
              readonly traces?: readonly string[];
            }>
          | FailedSpent
        >;
      };
  readonly verify: Step<RunInput, { readonly passed: boolean }>;
  readonly designReview: Step<DesignInput, DesignRan<{ readonly findings: readonly DesignFinding[] }>>;
  readonly designVerify: Step<
    DesignInput & { readonly findings: readonly DesignFinding[] },
    DesignRan<{ readonly kept: readonly Kept[] }>
  >;
};

export const STEPS_TODAY: Steps = {
  writer: { kind: "unavailable", reason: "the writer's box is not built yet (#113)" },
  ready: { kind: "unavailable", reason: "the ready check needs a box (#113) and the project file" },
  review: { kind: "unavailable", reason: "the reviewer needs FACTORY_REPO and a plugin that holds its references" },
  verify: { kind: "unavailable", reason: "the local verifier needs a box (#113) and the project file" },
  designReview: { kind: "unavailable", reason: "the design review needs FACTORY_REPO" },
  designVerify: { kind: "unavailable", reason: "the design review needs FACTORY_REPO" },
};
