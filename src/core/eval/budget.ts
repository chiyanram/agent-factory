// budget — the $100 cap of one eval pass (ADR-0015 E11, #215). Two guards:
//   before the pass  the most it could spend: every model run at its own cap (the agent CLI's --max-budget-usd). Over
//                    the cap the pass is refused, unless the operator asks for a pass that stops at the cap.
//   during the pass  every model run first reserves its own cap; a run that would not fit is never started, the purse
//                    stops, and the result is marked partial. A partial result is never proof.
// A model run with no cap of its own could spend anything, so it is refused.

import { prop } from "../dispatch/records.js";
import type { Model, ModelResult } from "../review/model.js";
import { MAX_JUDGED } from "./judge.js";

export const CAP_USD = 100;
// one review round runs at most three model runs: find, then verify once per kind (rule, logic)
export const RUNS_PER_ROUND = 3;
// what one round cost when ADR-0015 was written: a guide for the operator, never a guard
export const TYPICAL_ROUND_USD = 0.84;

export type Purse = {
  readonly cap: number;
  readonly spent: () => number;
  // why the purse stopped, or ""
  readonly stopped: () => string;
  // whether `usd` more fits under the cap; when it does not, the purse stops and says why
  readonly reserve: (usd: number, what: string) => boolean;
  readonly add: (usd: number) => void;
};

export function purse(cap: number): Purse {
  let spent = 0;
  let stopped = "";
  return {
    cap,
    spent: () => spent,
    stopped: () => stopped,
    reserve: (usd, what) => {
      const fits = stopped === "" && Number.isFinite(usd) && spent + usd <= cap;
      if (!fits && stopped === "") {
        stopped = `stopped at the $${cap} cap: ${what} may spend $${usd}, and $${spent.toFixed(2)} is spent`;
      }
      return fits;
    },
    add: (usd) => {
      spent += usd;
    },
  };
}

// dollars : a dollar amount as the settings hold it ("2", "0.50"); "" (no cap) is Infinity. Pure.
export function dollars(text: string): number {
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : Number.POSITIVE_INFINITY;
}

// costOf : what one model run spent, a failed one too (the CLI's total_cost_usd). Pure.
export function costOf(result: ModelResult): number {
  if (result.kind === "ok") {
    return result.value.costUsd;
  }
  const cost = prop(result.answer, "total_cost_usd");
  return typeof cost === "number" ? cost : 0;
}

// capped : the model, behind the purse: a run that does not fit is refused before it starts, and every run's cost is
// added after it
export function capped(model: Model, p: Purse): Model {
  return async (run) => {
    if (!p.reserve(dollars(run.maxUsd), `one ${run.name} run`)) {
      return { kind: "failed", reason: p.stopped(), answer: undefined };
    }
    const result = await model(run);
    p.add(costOf(result));
    return result;
  };
}

export type Plan = {
  // the seeds of each case to run: 0 for a clean case
  readonly seeds: readonly number[];
  readonly runs: number;
  // each review model run's cap, and each judge run's
  readonly runUsd: number;
  readonly judgeUsd: number;
};

// worstCase : the most a pass could spend, every model run at its cap. Pure.
export function worstCase(plan: Plan): number {
  const round = RUNS_PER_ROUND * plan.runUsd;
  return plan.seeds.reduce((sum, seeds) => sum + plan.runs * (round + seeds * MAX_JUDGED * plan.judgeUsd), 0);
}

// typical : what a pass would cost at the round cost ADR-0015 measured, judges left out. Pure.
export function typical(plan: Plan): number {
  return plan.seeds.length * plan.runs * TYPICAL_ROUND_USD;
}
