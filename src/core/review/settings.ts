// settings — the reviewer's settings, read once from the environment, for `agent-factory review` and the dispatcher's
// review step (#138). A value that is set but not valid is refused, never replaced by the default.
//
//   FACTORY_REPO                  the project's clone; packs go to <repo>/.claude/packs, pass answers to <repo>/.claude/runs
//   FACTORY_REVIEW_FIND / _VERIFY the instructions (default: the package's prompts/review-*.md)
//   FACTORY_FIND_MODEL, FACTORY_RULE_MODEL, FACTORY_LOGIC_MODEL   default sonnet, sonnet, opus (#22 Q4)
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
};

type Limits = { readonly maxUsd: string; readonly maxRuns: number };

function limits(env: NodeJS.ProcessEnv): Result<Limits> {
  const usd = maxUsd(env);
  if (usd.kind === "failed") {
    return usd;
  }
  const runs = runsAtOnceOf(env);
  return runs.kind === "ok" ? { kind: "ok", value: { maxUsd: usd.value, maxRuns: runs.value } } : runs;
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

// paths : the settings, each checked; a value that is set but not valid is refused
export function paths(env: NodeJS.ProcessEnv): Result<Paths> {
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
  "NODE_EXTRA_CA_CERTS",
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
    find: settingOf(env, "review.findModel") ?? "sonnet",
    rule: settingOf(env, "review.ruleModel") ?? "sonnet",
    logic: settingOf(env, "review.logicModel") ?? "opus",
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
  };
}
