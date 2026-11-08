// settings — what the writer step reads from the environment (#113), each value checked. Pure but for one stat.
//
//   FACTORY_RULEBOOK         the rulebook plugin folder (it holds .claude-plugin/plugin.json); copied into each run
//   FACTORY_WRITER_MINUTES   how long one writer run may take (default 60, at most 240)
//   FACTORY_MAX_USD          the most one run may spend, in US dollars (ADR-0011 D14); unset: no cap
//   FACTORY_WRITER_MODEL     the writer's model; unset: Claude's default

import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Result } from "../forge/api.js";
import { maxUsd } from "../review/settings.js";
import type { Claude } from "./run.js";

export type WriterSettings = {
  readonly rulebook: string;
  readonly timeoutSeconds: number;
  readonly claude: Claude;
};

const DEFAULT_MINUTES = 60;
const MAX_MINUTES = 240;

// minutesOf : the run's time limit in seconds. Pure.
export function minutesOf(env: NodeJS.ProcessEnv): Result<number> {
  const set = env.FACTORY_WRITER_MINUTES;
  const minutes = set === undefined ? DEFAULT_MINUTES : Number(set);
  return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES
    ? { kind: "ok", value: minutes * 60 }
    : { kind: "failed", reason: `FACTORY_WRITER_MINUTES must be a whole number from 1 to ${MAX_MINUTES}` };
}

async function rulebookOf(env: NodeJS.ProcessEnv): Promise<Result<string>> {
  const dir = env.FACTORY_RULEBOOK ?? "";
  const manifest = join(dir, ".claude-plugin", "plugin.json");
  const found = isAbsolute(dir)
    ? await stat(manifest).then(
        (s) => s.isFile(),
        () => false,
      )
    : false;
  return found
    ? { kind: "ok", value: dir }
    : { kind: "failed", reason: `FACTORY_RULEBOOK must be the rulebook plugin's folder, with ${manifest}` };
}

export async function writerSettings(env: NodeJS.ProcessEnv): Promise<Result<WriterSettings>> {
  const rulebook = await rulebookOf(env);
  if (rulebook.kind === "failed") {
    return rulebook;
  }
  const timeout = minutesOf(env);
  if (timeout.kind === "failed") {
    return timeout;
  }
  const usd = maxUsd(env);
  return usd.kind === "ok"
    ? {
        kind: "ok",
        value: {
          rulebook: rulebook.value,
          timeoutSeconds: timeout.value,
          claude: { maxUsd: usd.value, model: env.FACTORY_WRITER_MODEL ?? "" },
        },
      }
    : usd;
}
