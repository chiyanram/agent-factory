// eval-cli — `agent-factory eval reviewer` on the command line (ADR-0015 E7, #215): the eval pass of the automated
// review over the golden set, on the host, through the same agent CLI as the production review. It spends on model
// runs, so it never runs in CI or in a dry run, and it is refused before it spends when it could pass the $100 cap.

import { mkdir, mkdtemp } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Result } from "./core/forge/api.js";
import { evalReviewer, evalSettings, type EvalInput, type EvalSettings, type Written } from "./core/eval/harness.js";
import { claudeModel, runInFolder } from "./core/review/model.js";
import { claudeEnv } from "./core/review/settings.js";

export const EVAL_HELP = `  eval reviewer [<repo>] [--drafts] [--allow-partial]
                               the automated review's eval (ADR-0015): each case the operator approved in
                               evals/reviewer/cases.md, 3 runs of the real review round on a throwaway clone, Act on
                               findings matched with the seeds by place and judge; writes
                               evals/reviewer/results/<date>-<sha>.json. <repo> is this repository's checkout (default
                               .). --drafts runs draft cases too (never proof). It refuses a pass that could spend over
                               $100 unless --allow-partial, which stops at the cap and marks the result partial. Host
                               only: refused in CI. Exit 0 written, 3 written but partial, 1 refused
`;

export type EvalIo = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
};

type Parsed = {
  readonly root: string;
  readonly drafts: boolean;
  readonly allowPartial: boolean;
};

function parsed(argv: readonly string[]): Parsed | "usage" {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: { drafts: { type: "boolean" }, "allow-partial": { type: "boolean" } },
    });
    const [what, root = ".", ...rest] = positionals;
    return what === "reviewer" && rest.length === 0
      ? { root: resolve(root), drafts: values.drafts === true, allowPartial: values["allow-partial"] === true }
      : "usage";
  } catch {
    return "usage";
  }
}

const DOLLARS = /^\d+(\.\d+)?$/;

function inCi(env: NodeJS.ProcessEnv): boolean {
  return !["", "false"].includes(env.CI ?? "");
}

// badDollars : the first cap setting that is set but not a dollar amount, or ""
function badDollars(env: NodeJS.ProcessEnv): string {
  return ["FACTORY_MAX_USD", "FACTORY_JUDGE_MAX_USD"].find((k) => !DOLLARS.test(env[k] || "0")) ?? "";
}

// refusal : why this pass may not run here, or ""
export function refusal(env: NodeJS.ProcessEnv): string {
  const bad = badDollars(env);
  const checks: readonly (readonly [boolean, string])[] = [
    [inCi(env), "it runs on the host, never in CI: CI holds no model token (ADR-0015 E10)"],
    [
      env.FACTORY_DRY_RUN === "1",
      "FACTORY_DRY_RUN is set, and an eval spends on model runs; run it without the dry run",
    ],
    [bad !== "", `${bad} must be a dollar amount such as 2 or 0.50, got ${JSON.stringify(env[bad])}`],
    [!isAbsolute(env.FACTORY_RULEBOOK ?? ""), "FACTORY_RULEBOOK must be the rulebook plugin folder, an absolute path"],
  ];
  return checks.find(([refused]) => refused)?.[1] ?? "";
}

// workDir : a fresh private folder under the factory home for the pass's clones; never /tmp, where anyone could plant
// a CLAUDE.md above a run folder
async function workDir(env: NodeJS.ProcessEnv): Promise<Result<string>> {
  const home = env.FACTORY_HOME ?? join(homedir(), ".factory");
  if (!isAbsolute(home)) {
    return { kind: "failed", reason: `FACTORY_HOME must be an absolute path, got ${JSON.stringify(home)}` };
  }
  try {
    await mkdir(home, { recursive: true, mode: 0o700 });
    return { kind: "ok", value: await mkdtemp(join(home, "eval-")) };
  } catch {
    return { kind: "failed", reason: `cannot make a folder for the pass in ${home}` };
  }
}

async function run(p: Parsed, s: EvalSettings, io: EvalIo): Promise<number> {
  const work = await workDir(io.env);
  if (work.kind === "failed") {
    io.err(`agent-factory eval: ${work.reason}\n`);
    return 1;
  }
  const written = await evalReviewer(inputOf(p, s, io, work.value));
  if (written.kind === "failed") {
    io.err(`agent-factory eval: ${written.reason}\n`);
    return 1;
  }
  io.out(`${written.value.path}${note(written.value)}\n`);
  return written.value.partial ? 3 : 0;
}

function inputOf(p: Parsed, s: EvalSettings, io: EvalIo, work: string): EvalInput {
  return {
    root: p.root,
    env: io.env,
    work,
    rulebook: io.env.FACTORY_RULEBOOK ?? "",
    model: claudeModel({ bin: io.env.FACTORY_CLAUDE ?? "claude", env: claudeEnv(io.env), run: runInFolder }),
    settings: s,
    now: new Date(),
    log: (line) => io.err(`${line}\n`),
  };
}

function note(w: Written): string {
  if (w.partial) {
    return " (partial: never proof)";
  }
  return w.proof ? "" : " (draft cases: not proof)";
}

// evalCommand : `eval reviewer`
export async function evalCommand(argv: readonly string[], io: EvalIo): Promise<number> {
  const p = parsed(argv);
  if (p === "usage") {
    io.err(`usage: agent-factory eval reviewer [<repo>] [--drafts] [--allow-partial]\n`);
    return 64;
  }
  const refused = refusal(io.env);
  if (refused !== "") {
    io.err(`agent-factory eval: ${refused}\n`);
    return 1;
  }
  return run(p, evalSettings(io.env, { drafts: p.drafts, allowPartial: p.allowPartial }), io);
}
