// harness — `agent-factory eval reviewer`: one eval pass of the automated review over the golden set (ADR-0015 E4, E7,
// E11; #215). Per case: a throwaway clone at base.sha with change.patch on factory/<case> (clone.ts), then RUNS rounds
// of the real reviewRound against a fake git host (forge.ts), each round a fresh run: one find pass and a verify pass
// per kind, as in production. Each run's Act on findings are matched with the case's seeds (judge.ts), and the pass is
// written to evals/reviewer/results/<date>-<sha>.json (results.ts).
//
// Only cases the operator approved in cases.md run; drafts run only when asked, and the result says so. Every model
// run, review and judge, goes through the $100 purse (budget.ts): a pass that could spend more is refused unless the
// operator allows a partial one, and a pass that reaches the cap stops and is marked partial. It runs on the host, as
// the production review does, never in CI.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "../forge/api.js";
import { hostGit } from "../git.js";
import { specHash } from "../spec.js";
import { ACT_ON_FILE, isActOn, type ActOn } from "../review/act-on.js";
import { readKept } from "../kept.js";
import type { Model } from "../review/model.js";
import { reviewRound, type Outcome, type ReviewSetup } from "../review/round.js";
import { JUDGE_MODEL } from "../review/pinned.js";
import { reviewSetup } from "../review/settings.js";
import { settingOf } from "../settings/machine.js";
import { attempt } from "../review/safe.js";
import {
  capped,
  CAP_USD,
  dollars,
  purse,
  RUNS_PER_ROUND,
  typical,
  worstCase,
  type Plan,
  type Purse,
} from "./budget.js";
import { choose, readCase, readRows, specOf, CASES_DIR, type Case } from "./cases.js";
import { throwaway, type Cloned } from "./clone.js";
import { evalChange, evalForge } from "./forge.js";
import type { Row } from "./golden.js";
import { matchRun, modelJudge, type Judge } from "./judge.js";
import { blobSha, document, type CaseRecord, type Inputs, type RunRecord } from "./results.js";

// three runs per case (ADR-0015 E5)
export const RUNS = 3;
export const PROJECT = "eval";
export const LOGIN = "agent-factory-eval";
const LABEL = "agent::claimed";
const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "prompts");

export type EvalSettings = {
  // each review model run's cap and each judge run's, in US dollars, as text ("2", "0.50")
  readonly runUsd: string;
  readonly judgeUsd: string;
  readonly judgeModel: string;
  readonly judgePrompt: string;
  readonly drafts: boolean;
  readonly allowPartial: boolean;
};

export type EvalInput = {
  // this repository's checkout: the golden set, and the history its base.sha commits are in
  readonly root: string;
  readonly env: NodeJS.ProcessEnv;
  // a private folder for the pass's clones and run folders, never under a world-writable /tmp; removed after
  readonly work: string;
  readonly rulebook: string;
  // the agent CLI behind every review and judge run
  readonly model: Model;
  readonly settings: EvalSettings;
  readonly now: Date;
  readonly log: (line: string) => void;
};

export type Written = { readonly path: string; readonly partial: boolean; readonly proof: boolean };

// evalSettings : the eval's own settings from the environment; a review run with no cap is given one, since an
// uncapped run could spend anything (budget.ts)
export function evalSettings(
  env: NodeJS.ProcessEnv,
  flags: { readonly drafts: boolean; readonly allowPartial: boolean },
): EvalSettings {
  return {
    runUsd: settingOf(env, "caps.usdPerRun") || "2",
    judgeUsd: settingOf(env, "eval.judgeUsdPerRun") || "0.50",
    judgeModel: settingOf(env, "eval.judgeModel") || JUDGE_MODEL,
    judgePrompt: env.FACTORY_EVAL_JUDGE || join(PROMPTS, "eval-judge.md"),
    ...flags,
  };
}

type Ctx = EvalInput & { readonly purse: Purse; readonly capped: Model; readonly judgeText: string };

async function cases(root: string, rows: readonly Row[]): Promise<Result<readonly Case[]>> {
  const out: Case[] = [];
  for (const row of rows) {
    const c = await readCase(root, row);
    if (c.kind === "failed") {
      return c;
    }
    out.push(c.value);
  }
  return { kind: "ok", value: out };
}

function planOf(list: readonly Case[], s: EvalSettings): Plan {
  return {
    seeds: list.map((c) => c.golden.length),
    runs: RUNS,
    runUsd: dollars(s.runUsd),
    judgeUsd: dollars(s.judgeUsd),
  };
}

// afford : the pass's worst case against the cap; over it, refused unless a partial pass is allowed
function afford(list: readonly Case[], input: EvalInput): Result<number> {
  const plan = planOf(list, input.settings);
  const worst = worstCase(plan);
  input.log(
    `eval reviewer: ${list.length} case(s) × ${RUNS} runs; at most $${worst.toFixed(2)} (each review run capped at $${input.settings.runUsd}, each judge run at $${input.settings.judgeUsd}), about $${typical(plan).toFixed(2)} at $0.84 a round; cap $${CAP_USD}`,
  );
  if (worst <= CAP_USD || input.settings.allowPartial) {
    return { kind: "ok", value: worst };
  }
  return {
    kind: "failed",
    reason: `the pass could spend $${worst.toFixed(2)}, over the $${CAP_USD} cap; lower FACTORY_MAX_USD or FACTORY_JUDGE_MAX_USD, or pass --allow-partial to stop at the cap with a partial result, never proof`,
  };
}

async function git(repo: string, env: NodeJS.ProcessEnv, args: readonly string[]): Promise<string> {
  const r = await hostGit({
    args,
    repo: { kind: "repo", path: repo },
    env,
    ownHelper: { kind: "none" },
    stdin: { kind: "none" },
  });
  return r.kind === "ok" ? r.stdout.trim() : "";
}

async function blobOf(path: string): Promise<string> {
  return readFile(path).then(blobSha, () => "missing");
}

async function inputsOf(ctx: Ctx, setup: ReviewSetup): Promise<Result<Inputs>> {
  const head = await git(ctx.root, ctx.env, ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/.test(head)) {
    return { kind: "failed", reason: `cannot read the commit ${ctx.root} is at` };
  }
  const rulebook = await git(ctx.rulebook, ctx.env, ["rev-parse", "HEAD"]);
  return {
    kind: "ok",
    value: {
      head,
      models: { ...setup.models, judge: ctx.settings.judgeModel },
      prompts: {
        find: await blobOf(setup.prompts.find),
        verify: await blobOf(setup.prompts.verify),
        judge: await blobOf(ctx.settings.judgePrompt),
      },
      rulebook: /^[0-9a-f]{40}$/.test(rulebook) ? rulebook : "unknown",
    },
  };
}

// setupFor : the production review's setup for one run of a case, on its clone, with the fake git host
function setupFor(ctx: Ctx, cloned: Cloned, home: string, run: number, description: string): ReviewSetup {
  const change = evalChange({ number: run, head: cloned.head, branch: cloned.branch, label: LABEL, description });
  const setup = reviewSetup({
    env: ctx.env,
    forge: evalForge(change, LOGIN),
    factory: LOGIN,
    project: PROJECT,
    number: run,
    paths: { repo: cloned.repo, rulebook: ctx.rulebook, home, maxUsd: ctx.settings.runUsd, maxRuns: 1 },
    model: ctx.capped,
    sessions: async () => ({ kind: "ok", value: [] }),
  });
  return { ...setup, label: LABEL };
}

// specHome : the case's spec and its approval in the pass's own home: the operator's approval of the case in cases.md
// stands for the approval of its spec; nothing is written to the real factory home
async function specHome(home: string, c: Case): Promise<void> {
  const text = specOf(c);
  const specs = join(home, "specs", PROJECT, c.name);
  const approvals = join(home, "approvals", PROJECT);
  await mkdir(specs, { recursive: true, mode: 0o700 });
  await mkdir(approvals, { recursive: true, mode: 0o700 });
  await writeFile(join(specs, "spec.md"), text);
  const record = {
    version: 1,
    project: PROJECT,
    ticket: c.name,
    spec_hash: specHash(text),
    by: `cases.md (${c.status})`,
    at: "eval",
  };
  await writeFile(join(approvals, `${c.name}.json`), JSON.stringify(record));
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

async function actOn(setup: ReviewSetup, head: string): Promise<readonly ActOn[]> {
  const kept = await readKept({ recordsDir: setup.recordsDir, change: setup.number, head }, ACT_ON_FILE);
  const raw = kept.kind === "ok" ? parsed(kept.value) : [];
  return Array.isArray(raw) ? raw.filter(isActOn) : [];
}

// roundOf : what the round did, and why it is an error when it did not post. Pure.
function roundOf(round: Result<Outcome>): { readonly outcome: string; readonly error: string } {
  if (round.kind === "failed") {
    return { outcome: "failed", error: round.reason };
  }
  const kind = round.value.kind;
  return { outcome: kind, error: kind === "posted" ? "" : `the round did not post: ${kind}` };
}

async function oneRun(ctx: Ctx, c: Case, cloned: Cloned, home: string, run: number, judge: Judge): Promise<RunRecord> {
  const before = ctx.purse.spent();
  const setup = setupFor(ctx, cloned, home, run, c.pr);
  const round = roundOf(await reviewRound(setup));
  const found = round.outcome === "posted" ? await actOn(setup, cloned.head) : [];
  const seeds = await matchRun(c.golden, found, judge);
  const judged = seeds.find((s) => s.error !== "")?.error ?? "";
  return {
    run,
    outcome: round.outcome,
    error: round.error || judged,
    cost_usd: Math.round((ctx.purse.spent() - before) * 10_000) / 10_000,
    act_on: found,
    seeds,
  };
}

async function runs(ctx: Ctx, c: Case, cloned: Cloned, home: string): Promise<readonly RunRecord[]> {
  const judgeDir = join(home, "judge");
  await mkdir(judgeDir, { recursive: true, mode: 0o700 });
  const judge = modelJudge({
    model: ctx.capped,
    modelId: ctx.settings.judgeModel,
    instructions: ctx.judgeText,
    folder: judgeDir,
    maxUsd: ctx.settings.judgeUsd,
  });
  const out: RunRecord[] = [];
  for (let run = 1; run <= RUNS; run++) {
    if (!ctx.purse.reserve(RUNS_PER_ROUND * dollars(ctx.settings.runUsd), `${c.name} run ${run}'s review round`)) {
      break;
    }
    out.push(await oneRun(ctx, c, cloned, home, run, judge));
    ctx.log(
      `eval reviewer: ${c.name} run ${run}: ${out.at(-1)?.outcome ?? ""}; $${ctx.purse.spent().toFixed(2)} spent`,
    );
  }
  return out;
}

async function oneCase(ctx: Ctx, c: Case): Promise<CaseRecord> {
  const dir = join(ctx.work, c.name);
  const home = join(dir, "home");
  const made = await attempt(() => specHome(home, c), `cannot write the spec of ${c.name}`);
  const cloned =
    made.kind === "ok"
      ? await throwaway({ root: ctx.root, into: dir, name: c.name, base: c.base, patch: c.patch, env: ctx.env })
      : made;
  if (cloned.kind === "failed") {
    return { case: c, error: cloned.reason, runs: [] };
  }
  const done = await runs(ctx, c, cloned.value, home);
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  return { case: c, error: "", runs: done };
}

async function resultsPath(root: string, date: string, head: string): Promise<string> {
  const dir = join(root, CASES_DIR, "results");
  await mkdir(dir, { recursive: true });
  const name = `${date}-${head.slice(0, 12)}`;
  for (let n = 1; ; n++) {
    const path = join(dir, `${name}${n === 1 ? "" : `-${n}`}.json`);
    const free = await readFile(path).then(
      () => false,
      () => true,
    );
    if (free) {
      return path;
    }
  }
}

type Started = { readonly ctx: Ctx; readonly list: readonly Case[]; readonly skipped: readonly Row[] };

// chosenCases : the rows to run, read; none is refused
async function chosenCases(
  input: EvalInput,
): Promise<Result<{ readonly list: readonly Case[]; readonly skipped: readonly Row[] }>> {
  const rows = await readRows(input.root);
  if (rows.kind === "failed") {
    return rows;
  }
  const chosen = choose(rows.value, input.settings.drafts);
  const draft = chosen.skipped.filter((r) => r.status === "draft").length;
  input.log(
    `eval reviewer: ${chosen.run.length} case(s) to run; ${chosen.skipped.length} skipped (${draft} draft: only cases the operator approved in cases.md count; --drafts runs them too, never as proof)`,
  );
  if (chosen.run.length === 0) {
    return {
      kind: "failed",
      reason: "no case to run: the operator approves a case by setting its row in evals/reviewer/cases.md to approved",
    };
  }
  const list = await cases(input.root, chosen.run);
  return list.kind === "ok" ? { kind: "ok", value: { list: list.value, skipped: chosen.skipped } } : list;
}

async function start(input: EvalInput): Promise<Result<Started>> {
  const chosen = await chosenCases(input);
  if (chosen.kind === "failed") {
    return chosen;
  }
  const ok = afford(chosen.value.list, input);
  if (ok.kind === "failed") {
    return ok;
  }
  const judgeText = await readFile(input.settings.judgePrompt, "utf8").catch(() => "");
  if (judgeText === "") {
    return { kind: "failed", reason: `the judge's instructions are missing: ${input.settings.judgePrompt}` };
  }
  const p = purse(CAP_USD);
  const ctx: Ctx = { ...input, purse: p, capped: capped(input.model, p), judgeText };
  return { kind: "ok", value: { ctx, ...chosen.value } };
}

// evalReviewer : one eval pass, written to the results file; refused before it spends when it could exceed the cap
export async function evalReviewer(input: EvalInput): Promise<Result<Written>> {
  const started = await start(input);
  if (started.kind === "failed") {
    return started;
  }
  const { ctx, list, skipped } = started.value;
  await mkdir(ctx.work, { recursive: true, mode: 0o700 });
  try {
    return await pass(ctx, list, skipped);
  } finally {
    await rm(ctx.work, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function pass(ctx: Ctx, list: readonly Case[], skipped: readonly Row[]): Promise<Result<Written>> {
  const probe = setupFor(ctx, { repo: ctx.root, head: "", branch: "" }, ctx.work, 1, "");
  const inputs = await inputsOf(ctx, probe);
  if (inputs.kind === "failed") {
    return inputs;
  }
  const records: CaseRecord[] = [];
  for (const c of list) {
    if (ctx.purse.stopped() !== "") {
      break;
    }
    records.push(await oneCase(ctx, c));
  }
  const date = ctx.now.toISOString().slice(0, 10);
  const doc = document({
    date,
    inputs: inputs.value,
    runs: RUNS,
    cap: CAP_USD,
    spent: ctx.purse.spent(),
    stopped: ctx.purse.stopped(),
    drafts: ctx.settings.drafts,
    skipped: [
      ...skipped,
      ...list.slice(records.length).map((c) => ({ name: c.name, kind: c.kind, status: "not run: the cap" })),
    ],
    cases: records,
  });
  const path = await resultsPath(ctx.root, date, inputs.value.head);
  const wrote = await attempt(() => writeFile(path, `${JSON.stringify(doc, null, 2)}\n`), `cannot write ${path}`);
  return wrote.kind === "ok"
    ? { kind: "ok", value: { path, partial: doc.partial === true, proof: doc.proof === true } }
    : wrote;
}
