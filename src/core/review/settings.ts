// settings — the reviewer's settings, read once from the environment, for `agent-factory review` and the dispatcher's
// review step (#138). A value that is set but not valid is refused, never replaced by the default.
//
//   FACTORY_REPO                  the project's clone; packs go to <repo>/.claude/packs, pass answers to <repo>/.claude/runs
//   FACTORY_RULEBOOK              the rulebook plugin folder, the one that holds skills/<domain>/references/
//   FACTORY_REVIEW_FIND / _VERIFY the instructions (default: the package's prompts/review-*.md)
//   FACTORY_FIND_MODEL, FACTORY_RULE_MODEL, FACTORY_LOGIC_MODEL   default sonnet, sonnet, opus (#22 Q4)
//   FACTORY_MAX_USD               the most one model run may spend, in US dollars (ADR-0011 D14)
//   FACTORY_CLAUDE                the claude CLI (default: claude)

import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
import { claudeModel, runInFolder, type Model } from "./model.js";
import type { ReviewSetup } from "./round.js";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "prompts");

function absolute(env: NodeJS.ProcessEnv, name: string): Result<string> {
  const value = env[name] ?? "";
  return isAbsolute(value)
    ? { kind: "ok", value }
    : { kind: "failed", reason: `${name} must be an absolute path, got ${JSON.stringify(value)}` };
}

function maxUsd(env: NodeJS.ProcessEnv): Result<string> {
  const value = env.FACTORY_MAX_USD ?? "";
  return value === "" || /^\d+(\.\d+)?$/.test(value)
    ? { kind: "ok", value }
    : {
        kind: "failed",
        reason: `FACTORY_MAX_USD must be a dollar amount such as 2 or 0.50, got ${JSON.stringify(value)}`,
      };
}

export type Paths = { readonly repo: string; readonly rulebook: string; readonly maxUsd: string };

// paths : the settings that have no default
export function paths(env: NodeJS.ProcessEnv): Result<Paths> {
  const repo = absolute(env, "FACTORY_REPO");
  if (repo.kind === "failed") {
    return repo;
  }
  const rulebook = absolute(env, "FACTORY_RULEBOOK");
  if (rulebook.kind === "failed") {
    return rulebook;
  }
  const usd = maxUsd(env);
  return usd.kind === "ok"
    ? { kind: "ok", value: { repo: repo.value, rulebook: rulebook.value, maxUsd: usd.value } }
    : usd;
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
  return given ?? claudeModel({ bin: env.FACTORY_CLAUDE ?? "claude", env, run: runInFolder });
}

// reviewSetup : everything one round needs, for change `number`, acting as `factory` on `forge`
export function reviewSetup(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly forge: Forge;
  readonly factory: string;
  readonly number: number;
  readonly paths: Paths;
  readonly model?: Model;
}): ReviewSetup {
  const { env, paths: p } = input;
  return {
    forge: input.forge,
    number: input.number,
    factory: input.factory,
    label: env.FACTORY_CLAIM_LABEL ?? "agent::claimed",
    repo: p.repo,
    env,
    rulebook: p.rulebook,
    packDir: join(p.repo, ".claude", "packs"),
    recordsDir: join(p.repo, ".claude", "runs"),
    tmpDir: tmpdir(),
    prompts: prompts(env),
    models: models(env),
    maxUsd: p.maxUsd,
    model: modelOf(env, input.model),
  };
}
