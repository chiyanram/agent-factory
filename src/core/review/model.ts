// model — one fresh, read-only model run, as the review, the design review, the onboarder, the retro draft and the eval
// judge ask for it. Which agent CLI answers it, with which argv, and how the run is stopped at its limit is the agent
// seam's business (src/core/agent/, ADR-0022). A test passes its own Model. A failed run still gives back what the CLI
// answered, so a pass that failed for its budget is kept and counted, and names how it ended where the adapter can
// tell (end-reason.ts).

import type { RoundPart } from "../dispatch/spend.js";
import type { FailedReason } from "../end-reason.js";

export type RunLimit = {
  readonly minutes: number;
  readonly setting: string;
};

export type ModelRun = {
  readonly folder: string;
  readonly model: string;
  readonly schema: string;
  readonly prompt: string;
  readonly name: string;
  readonly maxUsd: string;
  readonly limit: RunLimit;
  readonly tools?: readonly string[];
  readonly part?: RoundPart;
};

export type ModelAnswer = {
  readonly output: unknown;
  readonly answer: unknown;
  readonly costUsd: number;
  readonly tokens: number;
  readonly stream?: string;
};

export type ModelResult =
  | { readonly kind: "ok"; readonly value: ModelAnswer }
  | {
      readonly kind: "failed";
      readonly reason: string;
      readonly answer: unknown;
      readonly stream?: string;
      readonly end?: FailedReason;
    };

export type Model = (run: ModelRun) => Promise<ModelResult>;
