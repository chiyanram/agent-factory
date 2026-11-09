// settings — the reviewer's settings, read once from the environment, for `agent-factory review` and the dispatcher's
// review step (#138). A value that is set but not valid is refused, never replaced by the default.
//
//   FACTORY_REPO                  the project's clone; packs go to <repo>/.claude/packs, pass answers to <repo>/.claude/runs
//   FACTORY_RULEBOOK              the rulebook plugin folder, the one that holds skills/<domain>/references/
//   FACTORY_REVIEW_FIND / _VERIFY the instructions (default: the package's prompts/review-*.md)
//   FACTORY_FIND_MODEL, FACTORY_RULE_MODEL, FACTORY_LOGIC_MODEL   default sonnet, sonnet, opus (#22 Q4)
//   FACTORY_MAX_USD               the most one model run may spend, in US dollars (ADR-0011 D14)
//   FACTORY_CLAUDE                the claude CLI (default: claude)
//   FACTORY_MAX_RUNS              live runs allowed on this machine at once (default 2)
//   FACTORY_HOME                  the run folders go in <home>/review-runs; the spec and its approval are read from
//                                 <home>/specs and <home>/approvals (default ~/.factory)
//
// The claude CLI gets only the environment it needs (CLAUDE_ENV): no forge token, no FACTORY_* (ADR-0012 S2).

import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
import { recordsDirOf } from "../kept.js";
import { claudeSessions, type Sessions } from "./live.js";
import { claudeModel, runInFolder, type Model } from "./model.js";
import type { ReviewSetup } from "./round.js";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "prompts");

function absolute(env: NodeJS.ProcessEnv, name: string): Result<string> {
  const value = env[name] ?? "";
  return isAbsolute(value)
    ? { kind: "ok", value }
    : { kind: "failed", reason: `${name} must be an absolute path, got ${JSON.stringify(value)}` };
}

export function maxUsd(env: NodeJS.ProcessEnv): Result<string> {
  const value = env.FACTORY_MAX_USD ?? "";
  return value === "" || /^\d+(\.\d+)?$/.test(value)
    ? { kind: "ok", value }
    : {
        kind: "failed",
        reason: `FACTORY_MAX_USD must be a dollar amount such as 2 or 0.50, got ${JSON.stringify(value)}`,
      };
}

function maxRuns(env: NodeJS.ProcessEnv): Result<number> {
  const value = env.FACTORY_MAX_RUNS ?? "2";
  return /^[1-9]\d{0,2}$/.test(value)
    ? { kind: "ok", value: Number(value) }
    : { kind: "failed", reason: `FACTORY_MAX_RUNS must be a whole number from 1, got ${JSON.stringify(value)}` };
}

function home(env: NodeJS.ProcessEnv): Result<string> {
  return env.FACTORY_HOME === undefined
    ? { kind: "ok", value: join(homedir(), ".factory") }
    : absolute(env, "FACTORY_HOME");
}

export type Paths = {
  readonly repo: string;
  readonly rulebook: string;
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
  const runs = maxRuns(env);
  return runs.kind === "ok" ? { kind: "ok", value: { maxUsd: usd.value, maxRuns: runs.value } } : runs;
}

type Places = { readonly repo: string; readonly rulebook: string; readonly home: string };

function places(env: NodeJS.ProcessEnv): Result<Places> {
  const repo = absolute(env, "FACTORY_REPO");
  if (repo.kind === "failed") {
    return repo;
  }
  const rulebook = absolute(env, "FACTORY_RULEBOOK");
  if (rulebook.kind === "failed") {
    return rulebook;
  }
  const h = home(env);
  return h.kind === "ok" ? { kind: "ok", value: { repo: repo.value, rulebook: rulebook.value, home: h.value } } : h;
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
    find: env.FACTORY_REVIEW_FIND ?? join(PROMPTS, "review-find.md"),
    verify: env.FACTORY_REVIEW_VERIFY ?? join(PROMPTS, "review-verify.md"),
  };
}

function models(env: NodeJS.ProcessEnv): ReviewSetup["models"] {
  return {
    find: env.FACTORY_FIND_MODEL ?? "sonnet",
    rule: env.FACTORY_RULE_MODEL ?? "sonnet",
    logic: env.FACTORY_LOGIC_MODEL ?? "opus",
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
  readonly model?: Model;
  readonly sessions?: Sessions;
}): ReviewSetup {
  const { env, paths: p } = input;
  return {
    forge: input.forge,
    number: input.number,
    factory: input.factory,
    label: env.FACTORY_CLAIM_LABEL ?? "agent::claimed",
    repo: p.repo,
    env,
    home: p.home,
    project: input.project,
    rulebook: p.rulebook,
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
