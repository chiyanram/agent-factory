// settings — the reviewer's settings, read once from the environment, for `agent-factory review` and the dispatcher's
// review step (#138). A value that is set but not valid is refused, never replaced by the default.
//
//   FACTORY_REPO                  the project's clone; packs go to <repo>/.claude/packs, pass answers to <repo>/.claude/runs
//   FACTORY_REVIEW_FIND / _VERIFY the instructions (default: the package's prompts/review-*.md)
//   FACTORY_FIND_MODEL, FACTORY_RULE_MODEL, FACTORY_LOGIC_MODEL   full model ids, never an alias (ADR-0015 E9, #213);
//                                 default REVIEW_MODELS (pinned.ts)
//   FACTORY_MAX_USD               the most one model run may spend, in US dollars (ADR-0011 D14)
//   FACTORY_FINDER_MINUTES, FACTORY_VERIFY_MINUTES   each finder's and each verify pass's time limit (agent/limits.ts)
//   FACTORY_MAX_RUNS              runs at once: live runs allowed on this machine (default 1, ADR-0012 S16)
//   FACTORY_HOME                  the run folders go in <home>/review-runs; the spec and its approval are read from
//                                 <home>/specs and <home>/approvals (default ~/.factory)
//
// The plugins come from the project's pinned list (process/use.ts, #232): the process plugin's folder holds the review
// references (skills/<domain>/references/). The model runs go through the agent seam (src/core/agent/), which gives
// the CLI only the environment it needs: no forge token, no FACTORY_* (ADR-0012 S2).

import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
import { runsAtOnceOf } from "../dispatch/caps.js";
import { recordsDirOf } from "../kept.js";
import { openAgentCli } from "../agent/index.js";
import { limitOf } from "../agent/limits.js";
import type { Sessions } from "./live.js";
import type { Model, RunLimit } from "./model.js";
import type { ReviewSetup } from "./round.js";
import { settingName, settingOf } from "../settings/machine.js";
import { PINNED_HINT, pinnedModel, type MachineId } from "../settings/variables.js";
import { REVIEW_MODELS } from "./pinned.js";

export { REVIEW_MODELS } from "./pinned.js";
import type { PluginDir } from "../process/read.js";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "prompts");

function absolute(name: string, set: string | undefined): Result<string> {
  const value = set ?? "";
  return isAbsolute(value)
    ? { kind: "ok", value }
    : { kind: "failed", reason: `${name} must be an absolute path, got ${JSON.stringify(value)}` };
}

export function maxUsd(env: NodeJS.ProcessEnv): Result<string> {
  const value = settingOf(env, "caps.usdPerRun") ?? "";
  return value === "" || /^\d+(\.\d+)?$/.test(value)
    ? { kind: "ok", value }
    : {
        kind: "failed",
        reason: `${settingName("caps.usdPerRun")} must be a dollar amount such as 2 or 0.50, got ${JSON.stringify(value)}`,
      };
}

const MODEL_KEYS = { find: "review.findModel", rule: "review.ruleModel", logic: "review.logicModel" } as const;

export function unpinnedModel(env: NodeJS.ProcessEnv, ids: readonly MachineId[]): string {
  const bad = ids.find((id) => {
    const value = settingOf(env, id);
    return value !== undefined && !pinnedModel(value);
  });
  return bad === undefined
    ? ""
    : `${settingName(bad)} must be ${PINNED_HINT}, got ${JSON.stringify(settingOf(env, bad))}`;
}

function home(env: NodeJS.ProcessEnv): Result<string> {
  return env.FACTORY_HOME === undefined
    ? { kind: "ok", value: join(homedir(), ".factory") }
    : absolute("FACTORY_HOME", env.FACTORY_HOME);
}

export type Paths = {
  readonly repo: string;
  readonly home: string;
  readonly maxUsd: string;
  readonly maxRuns: number;
  readonly maxFinders: number;
  readonly limits: RunLimits;
};

export type RunLimits = { readonly finder: RunLimit; readonly verify: RunLimit };

type Limits = {
  readonly maxUsd: string;
  readonly maxRuns: number;
  readonly maxFinders: number;
  readonly limits: RunLimits;
};

export function runLimitsOf(env: NodeJS.ProcessEnv): Result<RunLimits> {
  const finder = limitOf(env, "review.finderMinutes");
  if (finder.kind === "failed") {
    return finder;
  }
  const verify = limitOf(env, "review.verifyMinutes");
  return verify.kind === "ok" ? { kind: "ok", value: { finder: finder.value, verify: verify.value } } : verify;
}

export const MAX_FINDERS = 4;

export function maxFindersOf(env: NodeJS.ProcessEnv): Result<number> {
  const raw = settingOf(env, "review.maxFinders") ?? String(MAX_FINDERS);
  return /^[1-9]\d?$/.test(raw)
    ? { kind: "ok", value: Number(raw) }
    : {
        kind: "failed",
        reason: `${settingName("review.maxFinders")} must be a whole number from 1, got ${JSON.stringify(raw)}`,
      };
}

function limits(env: NodeJS.ProcessEnv): Result<Limits> {
  const usd = maxUsd(env);
  if (usd.kind === "failed") {
    return usd;
  }
  const runs = runsAtOnceOf(env);
  if (runs.kind === "failed") {
    return runs;
  }
  const finders = maxFindersOf(env);
  if (finders.kind === "failed") {
    return finders;
  }
  const times = runLimitsOf(env);
  return times.kind === "ok"
    ? { kind: "ok", value: { maxUsd: usd.value, maxRuns: runs.value, maxFinders: finders.value, limits: times.value } }
    : times;
}

type Places = { readonly repo: string; readonly home: string };

function places(env: NodeJS.ProcessEnv): Result<Places> {
  const repo = absolute(settingName("clone"), settingOf(env, "clone"));
  if (repo.kind === "failed") {
    return repo;
  }
  const h = home(env);
  return h.kind === "ok" ? { kind: "ok", value: { repo: repo.value, home: h.value } } : h;
}

export function paths(env: NodeJS.ProcessEnv): Result<Paths> {
  const alias = unpinnedModel(env, Object.values(MODEL_KEYS));
  if (alias !== "") {
    return { kind: "failed", reason: alias };
  }
  const where = places(env);
  if (where.kind === "failed") {
    return where;
  }
  const most = limits(env);
  return most.kind === "ok" ? { kind: "ok", value: { ...where.value, ...most.value } } : most;
}

function prompts(env: NodeJS.ProcessEnv): ReviewSetup["prompts"] {
  return {
    find: settingOf(env, "review.findPrompt") ?? join(PROMPTS, "review-find.md"),
    verify: settingOf(env, "review.verifyPrompt") ?? join(PROMPTS, "review-verify.md"),
  };
}

export function reviewModels(env: NodeJS.ProcessEnv): ReviewSetup["models"] {
  return {
    find: settingOf(env, MODEL_KEYS.find) ?? REVIEW_MODELS.find,
    rule: settingOf(env, MODEL_KEYS.rule) ?? REVIEW_MODELS.rule,
    logic: settingOf(env, MODEL_KEYS.logic) ?? REVIEW_MODELS.logic,
  };
}

export function reviewSetup(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly forge: Forge;
  readonly factory: string;
  readonly project: string;
  readonly number: number;
  readonly paths: Paths;
  readonly plugins: readonly PluginDir[];
  readonly model?: Model;
  readonly sessions?: Sessions;
}): ReviewSetup {
  const { env, paths: p } = input;
  const agent = openAgentCli({ env });
  return {
    forge: input.forge,
    number: input.number,
    factory: input.factory,
    label: settingOf(env, "claimLabel") ?? "agent::claimed",
    repo: p.repo,
    env,
    home: p.home,
    project: input.project,
    plugins: input.plugins,
    packDir: join(p.repo, ".claude", "packs"),
    recordsDir: recordsDirOf(p.repo),
    runsDir: join(p.home, "review-runs"),
    prompts: prompts(env),
    models: reviewModels(env),
    maxUsd: p.maxUsd,
    limits: p.limits,
    model: input.model ?? agent.readOnly,
    sessions: input.sessions ?? agent.sessions,
    maxRuns: p.maxRuns,
    maxFinders: p.maxFinders,
  };
}
