// settings — what the writer step reads from the environment (#113), each value checked, and the plugins the pass
// hands it (process/use.ts, #232). Pure.
//
//   FACTORY_WRITER_MINUTES   how long one writer run may take (default 60, at most 240)
//   FACTORY_WRITER_STALL_MINUTES  how long a run may print nothing before the host stops it (#228): a cap, so it can
//                            only be lowered, from 1 to 5 (default 5)
//   FACTORY_MAX_USD          the most one run may spend, in US dollars (ADR-0011 D14); unset: no cap
//   FACTORY_WRITER_MODEL     the writer's model; unset: Claude's default
//   FACTORY_QUESTIONS        how a run's questions are posted: round (default) or one-at-a-time (#320)

import type { Result } from "../forge/api.js";
import { maxUsd } from "../review/settings.js";
import { settingName, settingOf } from "../settings/machine.js";
import type { PluginDir } from "../process/read.js";
import { QUESTIONS, type Questions } from "../settings/variables.js";
import type { Claude } from "../agent/claude-writer.js";
import { COMPLETION, STALL_MS, type Completion } from "./run.js";

export type WriterSettings = {
  readonly plugins: readonly PluginDir[];
  readonly timeoutSeconds: number;
  readonly claude: Claude;
  readonly completion: Completion;
  readonly stallMs: number;
  readonly questions: Questions;
};

const DEFAULT_MINUTES = 60;
const MAX_MINUTES = 240;

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

export function stallOf(env: NodeJS.ProcessEnv): Result<number> {
  const most = STALL_MS / 60_000;
  const set = settingOf(env, "implementer.stallMinutes");
  const minutes = set === undefined ? most : Number(set);
  return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= most
    ? { kind: "ok", value: minutes * 60_000 }
    : {
        kind: "failed",
        reason: `${settingName("implementer.stallMinutes")} must be a whole number from 1 to ${most}: it can only lower the stall time`,
      };
}

export function questionsOf(env: NodeJS.ProcessEnv): Result<Questions> {
  const set = settingOf(env, "questions") ?? "round";
  const known = QUESTIONS.find((q) => q === set);
  return known === undefined
    ? { kind: "failed", reason: `${settingName("questions")} must be ${QUESTIONS.join(" or ")}` }
    : { kind: "ok", value: known };
}

function timesOf(env: NodeJS.ProcessEnv): Result<{ readonly timeoutSeconds: number; readonly stallMs: number }> {
  const timeout = minutesOf(env);
  const stall = stallOf(env);
  if (timeout.kind === "failed") {
    return timeout;
  }
  return stall.kind === "ok" ? { kind: "ok", value: { timeoutSeconds: timeout.value, stallMs: stall.value } } : stall;
}

export function writerSettings(env: NodeJS.ProcessEnv, plugins: readonly PluginDir[]): Result<WriterSettings> {
  const times = timesOf(env);
  if (times.kind === "failed") {
    return times;
  }
  const questions = questionsOf(env);
  if (questions.kind === "failed") {
    return questions;
  }
  const usd = maxUsd(env);
  return usd.kind === "ok"
    ? {
        kind: "ok",
        value: {
          plugins,
          ...times.value,
          claude: { maxUsd: usd.value, model: settingOf(env, "implementer.model") ?? "" },
          completion: COMPLETION,
          questions: questions.value,
        },
      }
    : usd;
}
