// budget — the $100 cap of one eval pass (ADR-0015 E11, #215). Two guards:
//   before the pass  the most it could spend: every model run at its own cap (the agent CLI's --max-budget-usd). Over
//                    the cap the pass is refused, unless the operator asks for a pass that stops at the cap.
//   during the pass  every model run first reserves its own cap; a run that would not fit is never started, the purse
//                    stops, and the result is marked partial. A partial result is never proof.
// A model run with no cap of its own could spend anything, so it is refused.
//
// The typical round cost is a guide for the operator, never a guard.

import type { Model, ModelResult } from "../review/model.js";
import { MAX_JUDGED } from "./judge.js";
import { prop } from "../field.js";

export const CAP_USD = 100;
export const RUNS_PER_ROUND = 3;
export const TYPICAL_ROUND_USD = 0.84;

export type Purse = {
  readonly cap: number;
  readonly spent: () => number;
  readonly stopped: () => string;
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

export function dollars(text: string): number {
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : Number.POSITIVE_INFINITY;
}

export function costOf(result: ModelResult): number {
  if (result.kind === "ok") {
    return result.value.costUsd;
  }
  const cost = prop(result.answer, "total_cost_usd");
  return typeof cost === "number" ? cost : 0;
}

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
  readonly seeds: readonly number[];
  readonly runs: number;
  readonly runUsd: number;
  readonly judgeUsd: number;
};

export function worstCase(plan: Plan): number {
  const round = RUNS_PER_ROUND * plan.runUsd;
  return plan.seeds.reduce((sum, seeds) => sum + plan.runs * (round + seeds * MAX_JUDGED * plan.judgeUsd), 0);
}

export function typical(plan: Plan): number {
  return plan.seeds.length * plan.runs * TYPICAL_ROUND_USD;
}
