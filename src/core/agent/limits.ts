// limits — each read-only run kind's wall-clock limit, from its settings key (ADR-0012 S7, Constitution P7). The keys
// follow the run kinds the review, design, onboard, retro and eval setups already have; each setup picks its own, so
// the adapter never names a run kind. A value that is set but not valid is refused, never replaced by the default.
// Pure.

import type { Result } from "../forge/api.js";
import type { RunLimit } from "../review/model.js";
import { settingName, settingOf } from "../settings/machine.js";

export type LimitId =
  | "review.finderMinutes"
  | "review.verifyMinutes"
  | "design.minutes"
  | "onboard.minutes"
  | "retro.minutes"
  | "eval.judgeMinutes";

export const LIMIT_DEFAULT = 20;
export const LIMIT_MOST = 60;

// minutesIn : the minutes a set value names, LIMIT_DEFAULT for none, or NaN for text that is no whole number
function minutesIn(set: string | undefined): number {
  if (set === undefined) {
    return LIMIT_DEFAULT;
  }
  return /^\d+$/.test(set) ? Number(set) : Number.NaN;
}

// limitOf : the run's limit from its key, LIMIT_DEFAULT minutes when no layer sets it
export function limitOf(env: NodeJS.ProcessEnv, id: LimitId): Result<RunLimit> {
  const setting = settingName(id);
  const minutes = minutesIn(settingOf(env, id));
  return minutes >= 1 && minutes <= LIMIT_MOST
    ? { kind: "ok", value: { minutes, setting } }
    : { kind: "failed", reason: `${setting} must be a whole number from 1 to ${LIMIT_MOST}` };
}
