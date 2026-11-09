// step — the reviewer as the dispatcher's review step (#103, #138). The table needs only the Act on count; every other
// outcome maps onto it, with what the round spent (#131): every model answer of the round, a failed pass's too, is
// metered, so a round that fails still hands the orchestrator its spend. The outcomes:
//   posted, reused, already   their Act on count
//   no-progress               needs-human is on the change, which the table reads first next pass
//   moved                     a person pushed during the review: a failure, so the run's start is left and a person looks

import type { PluginDir } from "../process/read.js";
import type { Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
import type { Steps } from "../dispatch/tick.js";
import type { Sessions } from "./live.js";
import type { Model, ModelResult } from "./model.js";
import { lensSetupOf, roundLenses } from "./finders.js";
import { reviewRound, VERIFY_PASSES, type Outcome } from "./round.js";
import { paths, reviewSetup } from "./settings.js";
import { addSpend, NO_SPEND, spendOf, type Spend } from "../dispatch/spend.js";

type OutcomeMap = { readonly [O in Outcome as O["kind"]]: O };
type ActOn = Result<{ readonly actOn: number }>;
type Mappers = { readonly [K in keyof OutcomeMap]: (o: OutcomeMap[K]) => ActOn };

const MAP: Mappers = {
  posted: (o) => ({ kind: "ok", value: { actOn: o.counts.act_on } }),
  reused: (o) => ({ kind: "ok", value: { actOn: o.actOn } }),
  already: (o) => ({ kind: "ok", value: { actOn: o.actOn } }),
  "no-progress": () => ({ kind: "ok", value: { actOn: 1 } }),
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

// Meter : what the round's model answers have spent so far
type Meter = { spend: Spend };

// metered : the model, with each answer's spend added to the meter, whether the pass succeeded or not
function metered(model: Model, meter: Meter): Model {
  return async (run) => {
    const ran: ModelResult = await model(run);
    const spent = ran.kind === "ok" ? { usd: ran.value.costUsd, tokens: ran.value.tokens } : spendOf(ran.answer);
    meter.spend = addSpend(meter.spend, spent);
    return ran;
  };
}

// worstCase : the most a round spends with this many finders, each run at the per-run cap ("" for none): the finders
// and the verify passes; "unbounded" with no per-run cap. Pure.
export function worstCase(finders: number, maxUsd: string): number | "unbounded" {
  return maxUsd === "" ? "unbounded" : (finders + VERIFY_PASSES) * Number(maxUsd);
}

// worstUsd : the worst case of a round of this project: every lens its settings let a round pick (#237)
async function worstUsd(input: {
  readonly home: string;
  readonly project: string;
  readonly maxUsd: string;
}): Promise<Result<number | "unbounded">> {
  const setup = await lensSetupOf(input);
  return setup.kind === "ok"
    ? { kind: "ok", value: worstCase(roundLenses(setup.value.lenses).length, input.maxUsd) }
    : setup;
}

// reviewStep : available when the reviewer's settings are there
export function reviewStep(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly forge: Forge;
  readonly factory: string;
  readonly project: string;
  readonly plugins: readonly PluginDir[];
  readonly model?: Model;
  readonly sessions?: Sessions;
}): Steps["review"] {
  const p = paths(input.env);
  if (p.kind === "failed") {
    return { kind: "unavailable", reason: `the reviewer is not set up: ${p.reason}` };
  }
  const { home, maxUsd } = p.value;
  return {
    kind: "available",
    worstUsd: () => worstUsd({ home, project: input.project, maxUsd }),
    run: async (run) => {
      if (run.change.kind !== "open") {
        return { kind: "failed", reason: "no open change to review" };
      }
      const setup = reviewSetup({ ...input, number: run.change.line.number, paths: p.value });
      const meter: Meter = { spend: NO_SPEND };
      const round = await reviewRound({ ...setup, model: metered(setup.model, meter) });
      const mapped = round.kind === "ok" ? actOnOf(round.value) : round;
      return mapped.kind === "ok"
        ? { kind: "ok", value: { ...mapped.value, spend: meter.spend } }
        : { ...mapped, spend: meter.spend };
    },
  };
}
