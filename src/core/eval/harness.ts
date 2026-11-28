// harness — `agent-factory eval reviewer`: one eval pass of the automated review over the golden set (ADR-0015 E4, E7,
// E11; #215). Per case: a throwaway clone at base.sha with change.patch on factory/<case> (clone.ts), then RUNS rounds
// of the real reviewRound against a fake git host (forge.ts), each round a fresh run: one find pass and a verify pass
// per kind, as in production. Each run's Act on findings are matched with the case's seeds (judge.ts), and the pass is
// written to evals/reviewer/results/<date>-<sha>.json (results.ts).
//
// Only cases the operator approved in cases.md run; drafts run only when asked, and the result says so. Every model
// run, review and judge, goes through the $100 purse (budget.ts): a pass whose worst case is over the cap still
// starts, and stops before any run that would not fit under it, marked partial (#483). It runs on the host, as
// the production review does, never in CI.
//
// A pin move's targeted pass (slice.ts) runs only the cases it names, with fewer runs, on a plugin's store copy, which
// has no git commit of its own, so the caller names the commit, and writes the pass where the caller says.
//
// The operator's approval of a case in cases.md stands for the approval of its spec, so the pass writes that approval
// in its own home, never the real factory home. Its clones and run folders live in a private folder, never under a
// world-writable /tmp. When the caller names a streams folder, each review run's stream is kept there (streams.ts).

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "../forge/api.js";
import { hostGit } from "../git.js";
import { specHash } from "../spec.js";
import { ACT_ON_FILE, isActOn, type ActOn } from "../review/act-on.js";
import { readKept } from "../kept.js";
import { limitOf } from "../agent/limits.js";
import type { Model, RunLimit } from "../review/model.js";
import { reviewRound, type Outcome, type ReviewSetup } from "../review/round.js";
import { JUDGE_MODEL } from "../review/pinned.js";
import type { Aim } from "./bar.js";
import { MAX_FINDERS, reviewSetup, runLimitsOf, type RunLimits } from "../review/settings.js";
import { settingOf } from "../settings/machine.js";
import { attempt } from "../review/safe.js";
import { keepStreams } from "./streams.js";
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
import { choose, readCase, readRows, specOf, CASES_DIR, type Case, type Chosen } from "./cases.js";
import { throwaway, type Cloned } from "./clone.js";
import { evalChange, evalForge } from "./forge.js";
import type { Row } from "./golden.js";
import { matchRun, modelJudge, type Judge } from "./judge.js";
import { blobSha, document, type CaseRecord, type Inputs, type RunRecord } from "./results.js";

export const RUNS = 3;
export const PROJECT = "eval";
export const LOGIN = "agent-factory-eval";
const LABEL = "agent::claimed";
const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "prompts");

export type EvalSettings = {
  readonly runUsd: string;
  readonly judgeUsd: string;
  readonly judgeModel: string;
  readonly judgePrompt: string;
  readonly limits: RunLimits & { readonly judge: RunLimit };
  readonly drafts: boolean;
  readonly aim: Aim | "none";
};

export type EvalInput = {
  readonly root: string;
  readonly env: NodeJS.ProcessEnv;
  readonly work: string;
  readonly rulebook: string;
  readonly model: Model;
  readonly settings: EvalSettings;
  readonly now: Date;
  readonly log: (line: string) => void;
  readonly only?: readonly string[];
  readonly runs?: number;
  readonly rulebookCommit?: string;
  readonly resultsDir?: string;
  readonly streams?: string;
};

export type Written = { readonly path: string; readonly partial: boolean; readonly proof: boolean };

export function evalSettings(
  env: NodeJS.ProcessEnv,
  flags: { readonly drafts: boolean; readonly aim: Aim | "none" },
): Result<EvalSettings> {
  const limits = evalLimits(env);
  return limits.kind === "ok" ? { kind: "ok", value: { ...evalCaps(env), limits: limits.value, ...flags } } : limits;
}

export function evalCaps(
  env: NodeJS.ProcessEnv,
): Pick<EvalSettings, "runUsd" | "judgeUsd" | "judgeModel" | "judgePrompt"> {
  return {
    runUsd: settingOf(env, "caps.usdPerRun") || "2",
    judgeUsd: settingOf(env, "eval.judgeUsdPerRun") || "0.50",
    judgeModel: settingOf(env, "eval.judgeModel") || JUDGE_MODEL,
    judgePrompt: env.FACTORY_EVAL_JUDGE || join(PROMPTS, "eval-judge.md"),
  };
}

function evalLimits(env: NodeJS.ProcessEnv): Result<EvalSettings["limits"]> {
  const review = runLimitsOf(env);
  if (review.kind === "failed") {
    return review;
  }
  const judge = limitOf(env, "eval.judgeMinutes");
  return judge.kind === "ok" ? { kind: "ok", value: { ...review.value, judge: judge.value } } : judge;
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

function runsOf(input: EvalInput): number {
  return input.runs ?? RUNS;
}

function planOf(list: readonly Case[], input: EvalInput): Plan {
  const s = input.settings;
  return {
    seeds: list.map((c) => c.golden.length),
    runs: runsOf(input),
    runUsd: dollars(s.runUsd),
    judgeUsd: dollars(s.judgeUsd),
  };
}

function afford(list: readonly Case[], input: EvalInput): void {
  const plan = planOf(list, input);
  const worst = worstCase(plan);
  const over = worst > CAP_USD ? "; over the cap, so it may stop there with a partial result, never proof" : "";
  input.log(
    `eval reviewer: ${list.length} case(s) × ${runsOf(input)} runs; at most $${worst.toFixed(2)} (each review run capped at $${input.settings.runUsd}, each judge run at $${input.settings.judgeUsd}), about $${typical(plan).toFixed(2)} at $0.84 a round; cap $${CAP_USD}${over}`,
  );
}

async function git(repo: string, env: NodeJS.ProcessEnv, args: readonly string[]): Promise<string> {
  const r = await hostGit({
    args,
    repo: { kind: "repo", path: repo },
    env,
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
  const rulebook = ctx.rulebookCommit ?? (await git(ctx.rulebook, ctx.env, ["rev-parse", "HEAD"]));
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

function modelFor(ctx: Ctx, name: string, run: number): Model {
  return ctx.streams === undefined || name === "" ? ctx.capped : keepStreams(ctx.capped, join(ctx.streams, name), run);
}

function setupFor(ctx: Ctx, cloned: Cloned, home: string, run: number, c: Pick<Case, "name" | "pr">): ReviewSetup {
  const description = c.pr;
  const change = evalChange({ number: run, head: cloned.head, branch: cloned.branch, label: LABEL, description });
  const setup = reviewSetup({
    env: ctx.env,
    forge: evalForge(change, LOGIN),
    factory: LOGIN,
    project: PROJECT,
    number: run,
    paths: {
      repo: cloned.repo,
      home,
      maxUsd: ctx.settings.runUsd,
      maxRuns: 1,
      maxFinders: MAX_FINDERS,
      limits: { finder: ctx.settings.limits.finder, verify: ctx.settings.limits.verify },
    },
    plugins: [{ label: "the eval's plugin", dir: ctx.rulebook }],
    model: modelFor(ctx, c.name, run),
    sessions: async () => ({ kind: "ok", value: [] }),
  });
  return { ...setup, label: LABEL };
}

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

function roundOf(round: Result<Outcome>): { readonly outcome: string; readonly error: string } {
  if (round.kind === "failed") {
    return { outcome: "failed", error: round.reason };
  }
  const kind = round.value.kind;
  return { outcome: kind, error: kind === "posted" ? "" : `the round did not post: ${kind}` };
}

async function oneRun(ctx: Ctx, c: Case, cloned: Cloned, home: string, run: number, judge: Judge): Promise<RunRecord> {
  const before = ctx.purse.spent();
  const setup = setupFor(ctx, cloned, home, run, c);
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
    limit: ctx.settings.limits.judge,
  });
  const out: RunRecord[] = [];
  for (let run = 1; run <= runsOf(ctx); run++) {
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

async function resultsPath(dir: string, date: string, head: string): Promise<string> {
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

function onlyThese(all: Chosen, only: readonly string[] | undefined): Chosen {
  if (only === undefined) {
    return all;
  }
  const left = all.run.filter((r) => !only.includes(r.name));
  return {
    run: all.run.filter((r) => only.includes(r.name)),
    skipped: [...all.skipped, ...left.map((r) => Object.assign({}, r, { status: "not in the slice" }))],
  };
}

type Started = { readonly ctx: Ctx; readonly list: readonly Case[]; readonly skipped: readonly Row[] };

async function chosenCases(
  input: EvalInput,
): Promise<Result<{ readonly list: readonly Case[]; readonly skipped: readonly Row[] }>> {
  const rows = await readRows(input.root);
  if (rows.kind === "failed") {
    return rows;
  }
  const chosen = onlyThese(choose(rows.value, input.settings.drafts), input.only);
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
  afford(chosen.value.list, input);
  const judgeText = await readFile(input.settings.judgePrompt, "utf8").catch(() => "");
  if (judgeText === "") {
    return { kind: "failed", reason: `the judge's instructions are missing: ${input.settings.judgePrompt}` };
  }
  const p = purse(CAP_USD);
  const ctx: Ctx = { ...input, purse: p, capped: capped(input.model, p), judgeText };
  return { kind: "ok", value: { ctx, ...chosen.value } };
}

export async function evalReviewer(input: EvalInput): Promise<Result<Written>> {
  const started = await start(input);
  if (started.kind === "failed") {
    return started;
  }
  const { ctx, list, skipped } = started.value;
  if (ctx.streams !== undefined) {
    ctx.log(`eval reviewer: each review run's stream is kept in ${ctx.streams}`);
  }
  await mkdir(ctx.work, { recursive: true, mode: 0o700 });
  try {
    return await pass(ctx, list, skipped);
  } finally {
    await rm(ctx.work, { recursive: true, force: true }).catch(() => undefined);
  }
}

function resultsDirOf(ctx: Ctx): string {
  return ctx.resultsDir ?? join(ctx.root, CASES_DIR, "results");
}

async function pass(ctx: Ctx, list: readonly Case[], skipped: readonly Row[]): Promise<Result<Written>> {
  const probe = setupFor(ctx, { repo: ctx.root, head: "", branch: "" }, ctx.work, 1, { name: "", pr: "" });
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
    runs: runsOf(ctx),
    cap: CAP_USD,
    spent: ctx.purse.spent(),
    stopped: ctx.purse.stopped(),
    drafts: ctx.settings.drafts,
    aim: ctx.settings.aim,
    skipped: [
      ...skipped,
      ...list.slice(records.length).map((c) => ({ name: c.name, kind: c.kind, status: "not run: the cap" })),
    ],
    cases: records,
  });
  const path = await resultsPath(resultsDirOf(ctx), date, inputs.value.head);
  const wrote = await attempt(() => writeFile(path, `${JSON.stringify(doc, null, 2)}\n`), `cannot write ${path}`);
  return wrote.kind === "ok"
    ? { kind: "ok", value: { path, partial: doc.partial === true, proof: doc.proof === true } }
    : wrote;
}
