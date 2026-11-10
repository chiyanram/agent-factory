// settings — the reviewer's settings, read once from the environment, for `agent-factory review` and the dispatcher's
// review step (#138). A value that is set but not valid is refused, never replaced by the default.
//
//   FACTORY_REPO                  the project's clone; packs go to <repo>/.claude/packs, pass answers to <repo>/.claude/runs
//   FACTORY_REVIEW_FIND / _VERIFY the instructions (default: the package's prompts/review-*.md)
//   FACTORY_FIND_MODEL, FACTORY_RULE_MODEL, FACTORY_LOGIC_MODEL   full model ids, never an alias (ADR-0015 E9, #213);
//                                 default REVIEW_MODELS (pinned.ts)
//   FACTORY_MAX_USD               the most one model run may spend, in US dollars (ADR-0011 D14)
//   FACTORY_CLAUDE                the claude CLI (default: claude)
//   FACTORY_MAX_RUNS              runs at once: live runs allowed on this machine (default 1, ADR-0012 S16)
//   FACTORY_HOME                  the run folders go in <home>/review-runs; the spec and its approval are read from
//                                 <home>/specs and <home>/approvals (default ~/.factory)
//
// The plugins come from the project's pinned list (process/use.ts, #232): the process plugin's folder holds the review
// references (skills/<domain>/references/). The claude CLI gets only the environment it needs (CLAUDE_ENV): no forge token, no FACTORY_* (ADR-0012 S2).

import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
import { runsAtOnceOf } from "../dispatch/caps.js";
import { recordsDirOf } from "../kept.js";
import { claudeSessions, type Sessions } from "./live.js";
import { claudeModel, runInFolder, type Model } from "./model.js";
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

// unpinnedModel : the refusal of the first of these model keys that is set to an alias, or ""
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
};

type Limits = { readonly maxUsd: string; readonly maxRuns: number; readonly maxFinders: number };

// the most finder runs a round runs at once when no layer sets it (#237)
export const MAX_FINDERS = 4;

// maxFindersOf : review.maxFinders, a whole number from 1; the check of its key keeps it at 16 or less
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
  return finders.kind === "ok"
    ? { kind: "ok", value: { maxUsd: usd.value, maxRuns: runs.value, maxFinders: finders.value } }
    : finders;
}

type Places = { readonly repo: string; readonly home: string };

function places(env: NodeJS.ProcessEnv): Result<Places> {
  const repo = absolute("FACTORY_REPO", env.FACTORY_REPO);
  if (repo.kind === "failed") {
    return repo;
  }
  const h = home(env);
  return h.kind === "ok" ? { kind: "ok", value: { repo: repo.value, home: h.value } } : h;
}

// paths : the settings, each checked; a value that is set but not valid is refused, and so is a model alias
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

const CLAUDE_ENV = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "TMPDIR",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  // the company CA (egress.caCerts, #114)
  settingName("egress.caCerts"),
  "SSL_CERT_FILE",
]);

// claudeEnv : the environment the claude CLI gets: what it needs to run and sign in, and nothing else
export function claudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) =>
        value !== undefined && (CLAUDE_ENV.has(name) || name.startsWith("LC_") || name.startsWith("ANTHROPIC_")),
    ),
  );
}

function prompts(env: NodeJS.ProcessEnv): ReviewSetup["prompts"] {
  return {
    find: settingOf(env, "review.findPrompt") ?? join(PROMPTS, "review-find.md"),
    verify: settingOf(env, "review.verifyPrompt") ?? join(PROMPTS, "review-verify.md"),
  };
}

function models(env: NodeJS.ProcessEnv): ReviewSetup["models"] {
  return {
    find: settingOf(env, MODEL_KEYS.find) ?? REVIEW_MODELS.find,
    rule: settingOf(env, MODEL_KEYS.rule) ?? REVIEW_MODELS.rule,
    logic: settingOf(env, MODEL_KEYS.logic) ?? REVIEW_MODELS.logic,
  };
}

function modelOf(env: NodeJS.ProcessEnv, given: Model | undefined): Model {
  return given ?? claudeModel({ bin: env.FACTORY_CLAUDE ?? "claude", env: claudeEnv(env), run: runInFolder });
}

function sessionsOf(env: NodeJS.ProcessEnv, given: Sessions | undefined): Sessions {
  return given ?? claudeSessions({ bin: env.FACTORY_CLAUDE ?? "claude", env: claudeEnv(env) });
}

// reviewSetup : everything one round needs, for change `number`, acting as `factory` on `forge`
export function reviewSetup(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly forge: Forge;
  readonly factory: string;
  // the project whose specs and approvals the review reads (<home>/specs/<project>, <home>/approvals/<project>)
  readonly project: string;
  readonly number: number;
  readonly paths: Paths;
  // the project's plugins, in order (process/use.ts)
  readonly plugins: readonly PluginDir[];
  readonly model?: Model;
  readonly sessions?: Sessions;
}): ReviewSetup {
  const { env, paths: p } = input;
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
    models: models(env),
    maxUsd: p.maxUsd,
    model: modelOf(env, input.model),
    sessions: sessionsOf(env, input.sessions),
    maxRuns: p.maxRuns,
    maxFinders: p.maxFinders,
  };
}
