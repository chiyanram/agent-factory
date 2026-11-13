// eval-cli — `agent-factory eval reviewer` on the command line (ADR-0015 E7, #215): the eval pass of the automated
// review over the golden set, on the host, through the same agent CLI as the production review. It spends on model
// runs, so it never runs in CI or in a dry run, and it is refused before it spends when it could pass the $100 cap.

import { mkdir, mkdtemp } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Result } from "./core/forge/api.js";
import { AIMS, type Aim } from "./core/eval/bar.js";
import { evalReviewer, evalSettings, type EvalInput, type EvalSettings, type Written } from "./core/eval/harness.js";
import { claudeModel, runInFolder } from "./core/review/model.js";
import { claudeEnv, unpinnedModel } from "./core/review/settings.js";
import { settingName, settingOf } from "./core/settings/machine.js";

export const EVAL_HELP = `  eval reviewer [<repo>] [--drafts] [--aim quality|cost]
                               the automated review's eval (ADR-0015): each case the operator approved in
                               evals/reviewer/cases.md, 3 runs of the real review round on a throwaway clone, Act on
                               findings matched with the seeds by place and judge; writes
                               evals/reviewer/results/<date>-<sha>.json. <repo> is this repository's checkout (default
                               .). --drafts runs draft cases too (never proof). It stops before it spends over $100 and
                               marks that result partial, never proof. --aim says what the change it proves aims
                               at, as the proof check needs (ADR-0021): quality, recall above the baseline's plus
                               the noise; cost, a cheaper pass. Leave it out for a baseline. Host
                               only: refused in CI. A human runs it; the coordinator's settings deny it. Exit 0 written, 3 written but partial, 1 refused
`;

export type EvalIo = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
};

type Parsed = {
  readonly root: string;
  readonly drafts: boolean;
  readonly aim: Aim | "none";
};

function parsed(argv: readonly string[]): Parsed | "usage" {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: { drafts: { type: "boolean" }, aim: { type: "string" } },
    });
    const aim = aimOf(values.aim);
    return aim === "bad" ? "usage" : reviewerOf(positionals, values.drafts === true, aim);
  } catch {
    return "usage";
  }
}

// reviewerOf : `reviewer [<repo>]` with its flags, or usage for any other words
function reviewerOf(positionals: readonly string[], drafts: boolean, aim: Aim | "none"): Parsed | "usage" {
  const [what, root = ".", ...rest] = positionals;
  return what === "reviewer" && rest.length === 0 ? { root: resolve(root), drafts, aim } : "usage";
}

// aimOf : the --aim value; none when it is not given, bad when it is not an aim
function aimOf(value: string | undefined): Aim | "none" | "bad" {
  return value === undefined ? "none" : (AIMS.find((a) => a === value) ?? "bad");
}

const DOLLARS = /^\d+(\.\d+)?$/;

function inCi(env: NodeJS.ProcessEnv): boolean {
  return !["", "false"].includes(env.CI ?? "");
}

// badDollars : why the first cap setting that is set is not a dollar amount, or ""
function badDollars(env: NodeJS.ProcessEnv): string {
  const caps = ["caps.usdPerRun", "eval.judgeUsdPerRun"] as const;
  const bad = caps.find((id) => !DOLLARS.test(settingOf(env, id) || "0"));
  return bad === undefined
    ? ""
    : `${settingName(bad)} must be a dollar amount such as 2 or 0.50, got ${JSON.stringify(settingOf(env, bad))}`;
}

// refusal : why this pass may not run here, or ""
export function refusal(env: NodeJS.ProcessEnv): string {
  const bad = badDollars(env);
  const alias = unpinnedModel(env, ["review.findModel", "review.ruleModel", "review.logicModel", "eval.judgeModel"]);
  const checks: readonly (readonly [boolean, string])[] = [
    [inCi(env), "it runs on the host, never in CI: CI holds no model token (ADR-0015 E10)"],
    [
      settingOf(env, "dryRun") === "1",
      "FACTORY_DRY_RUN is set, and an eval spends on model runs; run it without the dry run",
    ],
    [bad !== "", bad],
    [alias !== "", `${alias}: a pass with an alias proves nothing about the model it ran (ADR-0015 E9)`],
    [
      !isAbsolute(settingOf(env, "rulebook") ?? ""),
      "FACTORY_RULEBOOK must be the rulebook plugin folder, an absolute path",
    ],
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
    rulebook: settingOf(io.env, "rulebook") ?? "",
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
    io.err(`usage: agent-factory eval reviewer [<repo>] [--drafts] [--aim quality|cost]\n`);
    return 64;
  }
  const refused = refusal(io.env);
  if (refused !== "") {
    io.err(`agent-factory eval: ${refused}\n`);
    return 1;
  }
  return run(p, evalSettings(io.env, { drafts: p.drafts, aim: p.aim }), io);
}
