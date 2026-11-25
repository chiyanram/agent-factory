// eval-host — the guards every eval command runs before it spends on model runs: it runs on the host, never in CI or
// in a dry run, with its dollar caps readable and every model pinned by its full id (ADR-0015 E9, E10), and its work
// goes in a fresh private folder under the factory home, never /tmp, where anyone could plant a CLAUDE.md above a run
// folder. `eval reviewer` (eval-cli.ts) and `eval pin` (eval-pin-cli.ts) share them.

import { mkdir, mkdtemp } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Result } from "./core/forge/api.js";
import { unpinnedModel } from "./core/review/settings.js";
import { settingName, settingOf } from "./core/settings/machine.js";

export type EvalIo = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly readLine?: (prompt: string) => Promise<string>;
};

const DOLLARS = /^\d+(\.\d+)?$/;

function inCi(env: NodeJS.ProcessEnv): boolean {
  return !["", "false"].includes(env.CI ?? "");
}

function badDollars(env: NodeJS.ProcessEnv): string {
  const caps = ["caps.usdPerRun", "eval.judgeUsdPerRun"] as const;
  const bad = caps.find((id) => !DOLLARS.test(settingOf(env, id) || "0"));
  return bad === undefined
    ? ""
    : `${settingName(bad)} must be a dollar amount such as 2 or 0.50, got ${JSON.stringify(settingOf(env, bad))}`;
}

function noRulebook(env: NodeJS.ProcessEnv, needed: boolean): boolean {
  return needed && !isAbsolute(settingOf(env, "rulebook") ?? "");
}

export function refusal(env: NodeJS.ProcessEnv, needs: { readonly rulebook: boolean } = { rulebook: true }): string {
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
    [noRulebook(env, needs.rulebook), "FACTORY_RULEBOOK must be the rulebook plugin folder, an absolute path"],
  ];
  return checks.find(([refused]) => refused)?.[1] ?? "";
}

export async function workDir(env: NodeJS.ProcessEnv): Promise<Result<string>> {
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
