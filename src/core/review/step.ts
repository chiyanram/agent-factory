// step — the reviewer as the dispatcher's review step (#103, #138). The table needs only the Act on count; every other
// outcome maps onto it, with what the round spent (#131; only a posted round runs a model):
//   posted, reused, already   their Act on count
//   no-progress               needs-human is on the change, which the table reads first next pass
//   moved                     a person pushed during the review: a failure, so the run's start is left and a person looks

import type { Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
import type { RunInput, Step } from "../dispatch/tick.js";
import type { Sessions } from "./live.js";
import type { Model } from "./model.js";
import { reviewRound, type Outcome } from "./round.js";
import { paths, reviewSetup } from "./settings.js";
import { NO_SPEND, type Spend } from "../dispatch/spend.js";

type OutcomeMap = { readonly [O in Outcome as O["kind"]]: O };
type ActOn = Result<{ readonly actOn: number; readonly spend: Spend }>;
type Mappers = { readonly [K in keyof OutcomeMap]: (o: OutcomeMap[K]) => ActOn };

const MAP: Mappers = {
  posted: (o) => ({ kind: "ok", value: { actOn: o.counts.act_on, spend: { usd: o.costUsd, tokens: o.tokens } } }),
  reused: (o) => ({ kind: "ok", value: { actOn: o.actOn, spend: NO_SPEND } }),
  already: (o) => ({ kind: "ok", value: { actOn: o.actOn, spend: NO_SPEND } }),
  "no-progress": () => ({ kind: "ok", value: { actOn: 1, spend: NO_SPEND } }),
  moved: (o) => ({
    kind: "failed",
    reason: `the head moved from ${o.from.slice(0, 8)} to ${o.to.slice(0, 8)} during the review`,
  }),
};

function mapAs<K extends keyof OutcomeMap>(kind: K, o: OutcomeMap[K]): ActOn {
  return MAP[kind](o);
}

function actOnOf(outcome: Outcome): ActOn {
  return mapAs(outcome.kind, outcome);
}

// reviewStep : available when the reviewer's settings are there
export function reviewStep(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly forge: Forge;
  readonly factory: string;
  readonly project: string;
  readonly model?: Model;
  readonly sessions?: Sessions;
}): Step<RunInput, { readonly actOn: number; readonly spend: Spend }> {
  const p = paths(input.env);
  if (p.kind === "failed") {
    return { kind: "unavailable", reason: `the reviewer is not set up: ${p.reason}` };
  }
  return {
    kind: "available",
    run: async (run) => {
      if (run.change.kind !== "open") {
        return { kind: "failed", reason: "no open change to review" };
      }
      const round = await reviewRound(reviewSetup({ ...input, number: run.change.line.number, paths: p.value }));
      return round.kind === "ok" ? actOnOf(round.value) : round;
    },
  };
}
