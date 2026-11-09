// settings — what the writer step reads from the environment (#113), each value checked. Pure but for one stat.
//
//   FACTORY_RULEBOOK         the rulebook plugin folder (it holds .claude-plugin/plugin.json); copied into each run
//   FACTORY_WRITER_MINUTES   how long one writer run may take (default 60, at most 240)
//   FACTORY_WRITER_STALL_MINUTES  how long a run may print nothing before the host stops it (#228): a cap, so it can
//                            only be lowered, from 1 to 5 (default 5)
//   FACTORY_MAX_USD          the most one run may spend, in US dollars (ADR-0011 D14); unset: no cap
//   FACTORY_WRITER_MODEL     the writer's model; unset: Claude's default

import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Result } from "../forge/api.js";
import { maxUsd } from "../review/settings.js";
import { settingName, settingOf } from "../settings/machine.js";
import { COMPLETION, STALL_MS, type Claude, type Completion } from "./run.js";

export type WriterSettings = {
  readonly rulebook: string;
  readonly timeoutSeconds: number;
  readonly claude: Claude;
  readonly completion: Completion;
  // milliseconds a run may print nothing (#228)
  readonly stallMs: number;
};

const DEFAULT_MINUTES = 60;
const MAX_MINUTES = 240;

// minutesOf : the run's time limit in seconds. Pure.
export function minutesOf(env: NodeJS.ProcessEnv): Result<number> {
  const set = settingOf(env, "implementer.minutes");
  const minutes = set === undefined ? DEFAULT_MINUTES : Number(set);
  return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES
    ? { kind: "ok", value: minutes * 60 }
    : {
        kind: "failed",
        reason: `${settingName("implementer.minutes")} must be a whole number from 1 to ${MAX_MINUTES}`,
      };
}

// stallOf : the stall time in milliseconds; the setting may lower the default, never raise it. Pure.
export function stallOf(env: NodeJS.ProcessEnv): Result<number> {
  const most = STALL_MS / 60_000;
  const set = settingOf(env, "implementer.stallMinutes");
  // "" reads as 0, which is refused
  const minutes = set === undefined ? most : Number(set);
  return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= most
    ? { kind: "ok", value: minutes * 60_000 }
    : {
        kind: "failed",
        reason: `${settingName("implementer.stallMinutes")} must be a whole number from 1 to ${most}: it can only lower the stall time`,
      };
}

// timesOf : the run's time limit and its stall time. Pure.
function timesOf(env: NodeJS.ProcessEnv): Result<{ readonly timeoutSeconds: number; readonly stallMs: number }> {
  const timeout = minutesOf(env);
  const stall = stallOf(env);
  if (timeout.kind === "failed") {
    return timeout;
  }
  return stall.kind === "ok" ? { kind: "ok", value: { timeoutSeconds: timeout.value, stallMs: stall.value } } : stall;
}

async function rulebookOf(env: NodeJS.ProcessEnv): Promise<Result<string>> {
  const dir = settingOf(env, "rulebook") ?? "";
  const manifest = join(dir, ".claude-plugin", "plugin.json");
  const found = isAbsolute(dir)
    ? await stat(manifest).then(
        (s) => s.isFile(),
        () => false,
      )
    : false;
  return found
    ? { kind: "ok", value: dir }
    : { kind: "failed", reason: `${settingName("rulebook")} must be the rulebook plugin's folder, with ${manifest}` };
}

export async function writerSettings(env: NodeJS.ProcessEnv): Promise<Result<WriterSettings>> {
  const rulebook = await rulebookOf(env);
  if (rulebook.kind === "failed") {
    return rulebook;
  }
  const times = timesOf(env);
  if (times.kind === "failed") {
    return times;
  }
  const usd = maxUsd(env);
  return usd.kind === "ok"
    ? {
        kind: "ok",
        value: {
          rulebook: rulebook.value,
          ...times.value,
          claude: { maxUsd: usd.value, model: settingOf(env, "implementer.model") ?? "" },
          completion: COMPLETION,
        },
      }
    : usd;
}
