// model — one fresh, read-only model run, as the review, the design review, the onboarder, the retro draft and the eval
// judge ask for it. Which agent CLI answers it, with which argv, and how the run is stopped at its limit is the agent
// seam's business (src/core/agent/, ADR-0022). A test passes its own Model.

import type { RoundPart } from "../dispatch/spend.js";

// RunLimit : how long one run may take, and the setting that says so, for the reason a stopped run gives (P7)
export type RunLimit = {
  readonly minutes: number;
  // the variable a person sets to change it, such as FACTORY_FINDER_MINUTES
  readonly setting: string;
};

export type ModelRun = {
  // the folder the run reads: ./pack.md, ./code/, and for verify ./findings.json
  readonly folder: string;
  readonly model: string;
  readonly schema: string;
  readonly prompt: string;
  // the session's display name, such as reviewer-12
  readonly name: string;
  // "" for no cap
  readonly maxUsd: string;
  // the run's wall-clock limit: past it the run is stopped and answers failed (ADR-0012 S7)
  readonly limit: RunLimit;
  // a role card's tools, each one of the read-only ones; none given is all of them
  readonly tools?: readonly string[];
  // which run of an automated review round this is, so its spend is metered per run; none outside a round
  readonly part?: RoundPart;
};

export type ModelAnswer = {
  readonly output: unknown;
  // the CLI's whole answer, its result event, kept with the head for the retro (ADR-0011 D16)
  readonly answer: unknown;
  readonly costUsd: number;
  readonly tokens: number;
  // the run's whole stream-json output, raw, for its trace; the trace scrubs it. None from a model that streams
  // nothing, such as a test's
  readonly stream?: string;
};

// A failed run still gives back what the CLI answered, so a pass that failed for its budget is kept and counted.
export type ModelResult =
  | { readonly kind: "ok"; readonly value: ModelAnswer }
  | { readonly kind: "failed"; readonly reason: string; readonly answer: unknown; readonly stream?: string };

export type Model = (run: ModelRun) => Promise<ModelResult>;
