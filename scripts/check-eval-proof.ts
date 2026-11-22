// check-eval-proof — CI checks the proof, not the model (#217; ADR-0015 E10). When the change against the default
// branch touches a reviewer input, it must add an evals/reviewer/results/*.json that proves the change:
//   proof      not partial, no draft case ("proof": true), and no case or run with an error: an errored run on a
//              clean case reports no finding, so it would read as a clean floor kept (ADR-0021 N11)
//   inputs     each prompt's git blob SHA is the one the change has (prompts/review-find.md, review-verify.md,
//              eval-judge.md), each model is the one src/core/review/pinned.ts pins (find, rule, logic, judge;
//              ADR-0015 E9, #213), and the pass ran at a commit on this branch ("head" is an ancestor of HEAD)
//   hold       recall@act_on is not below evals/reviewer/baseline.json's by more than the noise, and 0 clean-floor
//              hits (ADR-0021, which replaces ADR-0015 E3's bar)
//   aim        the pass says what the change aims at (agent-factory eval reviewer --aim), and beats the baseline on it
//              by more than the noise: quality, recall above the baseline's plus the noise; cost, the pass costs less
//              than the baseline's less the noise
// The noise is the spread of the baseline's own repeat runs, read from its per_case: the most seeds one run matched
// less the fewest, never under one seed (ADR-0021); and for cost, the spread of a run's cost times the runs. Recall is
// compared in counts, never as rounded floats, so a pass exactly on the line does not beat it.
// With no baseline.json yet (#216), a reviewer-input change is refused: there is nothing to prove it against.
// A change to baseline.json needs the operator's approval: the pull request label eval-baseline-approved, which
// --approval reads from the pull request event (GITHUB_EVENT_PATH; no token, no API call). Without that event, as in
// a local run, a baseline change is refused. The approval has its own mode and its own CI job (eval-approval.yml),
// which runs when a label changes, so adding the label re-runs that one small check and not the whole suite. Without
// --approval (make lint), the new baseline must itself be a proof pass with 0 clean-floor hits.
//
// The reviewer inputs today are the prompts below. A results file must also have run with the model pins. The pins
// file itself becomes a reviewer input with the first baseline (#216): until then no change to it can be proven, and
// it lands before the baseline (ADR-0015, build order 1 before 4). The rulebook's pin is the project's plugin pin,
// kept in the factory home and not in this repository (#232), so inputs.rulebook is not checked here yet. No model
// call, no token: it reads git, JSON and the model pins' leaf module only.
//
//   node scripts/check-eval-proof.ts [ROOT]                (make lint)
//   node scripts/check-eval-proof.ts --approval [ROOT]     (eval-approval.yml)
//
// The default branch is FACTORY_BASE_REF, else origin/<GITHUB_BASE_REF> on a pull request, else origin/main; CI checks
// out with fetch-depth 0, so it is there. git reads this repository's own files, not a project's, so it runs plain
// git, as check-links does. Runs on Node's type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as Bar from "../src/core/eval/bar.js";

const bar: typeof Bar = await import(new URL("../src/core/eval/bar.ts", import.meta.url).href);
const { aimProblems, baselineOf, countsOf, field, holdProblems, partialWhy, ranOf } = bar;
type Baseline = Bar.Baseline;

export const PROMPTS = {
  find: "prompts/review-find.md",
  verify: "prompts/review-verify.md",
  judge: "prompts/eval-judge.md",
} as const;
type PromptKey = keyof typeof PROMPTS;
const PROMPT_KEYS: readonly PromptKey[] = ["find", "verify", "judge"];

export const MODELS = "src/core/review/pinned.ts";
type ModelKey = "find" | "rule" | "logic" | "judge";
const MODEL_KEYS: readonly ModelKey[] = ["find", "rule", "logic", "judge"];

export const BASELINE = "evals/reviewer/baseline.json";
export const LABEL = "eval-baseline-approved";
const RESULTS = /^evals\/reviewer\/results\/[^/]+\.json$/;
const SHA = /^[0-9a-f]{40}$/;

export function isReviewerInput(file: string): boolean {
  return /^prompts\/review-[^/]+\.md$/.test(file) || file === PROMPTS.judge;
}

export type Facts = {
  readonly changed: readonly string[];
  readonly added: readonly string[];
  readonly results: ReadonlyMap<string, string>;
  readonly baseline: string | undefined;
  readonly prompts: Readonly<Record<PromptKey, string>>;
  readonly models: Readonly<Record<ModelKey, string>>;
  readonly onBranch: (sha: string) => boolean;
  readonly labels: readonly string[] | undefined;
};

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function errorProblems(value: unknown): readonly string[] {
  const ran = ranOf(value);
  return ran === undefined
    ? [
        "its per_case is not a list of cases, each with its case, its error and its runs, each run with its run and its error",
      ]
    : partialWhy(ran).map((why) => `${why}; an errored run proves nothing (ADR-0021 N11)`);
}

export function passProblems(value: unknown): readonly string[] {
  const hits = field(field(value, "clean_floor"), "hits");
  return [
    ...(field(value, "partial") === false ? [] : ["it is partial"]),
    ...(field(value, "proof") === true ? [] : ['it is not proof ("proof": true needs no draft case and not partial)']),
    ...(hits === 0 ? [] : [`it has ${String(hits)} clean-floor hit(s); the floor is 0`]),
    ...(countsOf(value) === undefined ? ["it has no recall_at_act_on.overall found and of"] : []),
    ...errorProblems(value),
  ];
}

export function inputProblems(value: unknown, facts: Facts): readonly string[] {
  const prompts = field(field(value, "inputs"), "prompts");
  const models = field(field(value, "inputs"), "models");
  const head = field(value, "head");
  const ran = typeof head === "string" && SHA.test(head) && facts.onBranch(head);
  return [
    ...PROMPT_KEYS.filter((k) => field(prompts, k) !== facts.prompts[k]).map(
      (k) => `inputs.prompts.${k} is ${String(field(prompts, k))}, not ${PROMPTS[k]} as changed (${facts.prompts[k]})`,
    ),
    ...MODEL_KEYS.filter((k) => facts.models[k] === "" || field(models, k) !== facts.models[k]).map(
      (k) =>
        `inputs.models.${k} is ${String(field(models, k))}, not the pin in ${MODELS} (${facts.models[k] || "none"})`,
    ),
    ...(ran ? [] : [`head ${String(head)} is not a commit on this branch`]),
  ];
}

function resultProblems(text: string, facts: Facts, b: Baseline): readonly string[] {
  const value = parse(text);
  if (value === undefined) {
    return ["it is not JSON"];
  }
  return [...passProblems(value), ...inputProblems(value, facts), ...holdProblems(value, b), ...aimProblems(value, b)];
}

function proven(facts: Facts, b: Baseline): readonly string[] {
  const added = facts.added.filter((f) => RESULTS.test(f));
  if (added.length === 0) {
    return ["add the results file of an eval pass run at this change (agent-factory eval reviewer)"];
  }
  const each = added.map((f) => ({ f, why: resultProblems(facts.results.get(f) ?? "", facts, b) }));
  return each.some((e) => e.why.length === 0) ? [] : each.flatMap((e) => e.why.map((w) => `${e.f}: ${w}`));
}

export function proofProblems(facts: Facts): readonly string[] {
  const touched = facts.changed.filter(isReviewerInput);
  if (touched.length === 0) {
    return [];
  }
  const head = `a reviewer input changed (${touched.join(", ")})`;
  if (facts.baseline === undefined) {
    return [
      `${head}, and there is no ${BASELINE} yet (#216): nothing to prove it against; wait for the first baseline`,
    ];
  }
  const b = baselineOf(parse(facts.baseline));
  if (typeof b === "string") {
    return [`${head}, and ${BASELINE} ${b}`];
  }
  return proven(facts, b).map((why) => `${head}: ${why}`);
}

function approval(labels: readonly string[] | undefined): readonly string[] {
  if (labels === undefined) {
    return [
      `only the operator may change it: the label ${LABEL} on the pull request, which CI's eval-approval job reads; this run has none`,
    ];
  }
  return labels.includes(LABEL) ? [] : [`only the operator may change it: the pull request has no ${LABEL} label`];
}

function shapeProblems(value: unknown): readonly string[] {
  const b = baselineOf(value);
  return [
    ...passProblems(value),
    ...(typeof b === "string" && countsOf(value) !== undefined ? [`it ${b}`] : []),
    ...(field(value, "aim") == null ? [] : ["it says an aim; a baseline proves no change, so run it with no --aim"]),
  ];
}

export function baselineProblems(facts: Facts): readonly string[] {
  if (!facts.changed.includes(BASELINE) || facts.baseline === undefined) {
    return [];
  }
  return shapeProblems(parse(facts.baseline)).map((why) => `${BASELINE} changed: ${why}`);
}

export function approvalProblems(changed: readonly string[], labels: readonly string[] | undefined): readonly string[] {
  return changed.includes(BASELINE) ? approval(labels).map((why) => `${BASELINE} changed: ${why}`) : [];
}

function git(root: string, args: readonly string[]): { readonly code: number; readonly out: string } {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? -1, out: r.stdout };
}

export function baseRef(env: NodeJS.ProcessEnv): string {
  const pr = env.GITHUB_BASE_REF ?? "";
  return env.FACTORY_BASE_REF || (pr === "" ? "origin/main" : `origin/${pr}`);
}

export function labelsOf(eventText: string): readonly string[] | undefined {
  const labels = field(field(parse(eventText), "pull_request"), "labels");
  return Array.isArray(labels) ? labels.map((l) => String(field(l, "name"))) : undefined;
}

function eventLabels(env: NodeJS.ProcessEnv): readonly string[] | undefined {
  const path = env.GITHUB_EVENT_PATH ?? "";
  return path !== "" && existsSync(path) ? labelsOf(readFileSync(path, "utf8")) : undefined;
}

export function nameStatus(out: string): readonly (readonly [string, string])[] {
  const parts = out.split("\0").filter((p) => p !== "");
  return parts.flatMap((p, i) => (i % 2 === 0 ? [[p, parts[i + 1] ?? ""] as const] : []));
}

function read(root: string, file: string): string | undefined {
  return existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : undefined;
}

function blob(root: string, file: string): string {
  return existsSync(join(root, file)) ? git(root, ["hash-object", "--", file]).out.trim() : "";
}

async function modelPins(root: string): Promise<Readonly<Record<ModelKey, string>>> {
  const path = join(root, MODELS);
  const pins: unknown = existsSync(path) ? await import(pathToFileURL(path).href).catch(() => undefined) : undefined;
  const review = field(pins, "REVIEW_MODELS");
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    find: text(field(review, "find")),
    rule: text(field(review, "rule")),
    logic: text(field(review, "logic")),
    judge: text(field(pins, "JUDGE_MODEL")),
  };
}

async function readFacts(root: string, base: string, env: NodeJS.ProcessEnv): Promise<Facts> {
  const pairs = nameStatus(git(root, ["diff", "--name-status", "--no-renames", "-z", base]).out);
  const untracked = git(root, ["ls-files", "-z", "-o", "--exclude-standard"])
    .out.split("\0")
    .filter((f) => f !== "");
  const added = [...pairs.filter(([s]) => s === "A").map(([, f]) => f), ...untracked];
  return {
    changed: [...pairs.map(([, f]) => f), ...untracked],
    added,
    results: new Map(added.filter((f) => RESULTS.test(f)).map((f) => [f, read(root, f) ?? ""])),
    baseline: read(root, BASELINE),
    prompts: { find: blob(root, PROMPTS.find), verify: blob(root, PROMPTS.verify), judge: blob(root, PROMPTS.judge) },
    models: await modelPins(root),
    onBranch: (sha) => git(root, ["merge-base", "--is-ancestor", sha, "HEAD"]).code === 0,
    labels: eventLabels(env),
  };
}

async function main(root: string, env: NodeJS.ProcessEnv, approvalOnly: boolean): Promise<readonly string[]> {
  const ref = baseRef(env);
  const base = git(root, ["merge-base", ref, "HEAD"]);
  if (base.code !== 0) {
    return [`cannot find the default branch ${ref} to compare with; fetch it or set FACTORY_BASE_REF`];
  }
  if (approvalOnly) {
    const changed = nameStatus(git(root, ["diff", "--name-status", "--no-renames", "-z", base.out.trim()]).out);
    return approvalProblems(
      changed.map(([, file]) => file),
      eventLabels(env),
    );
  }
  const f = await readFacts(root, base.out.trim(), env);
  return [...baselineProblems(f), ...proofProblems(f)];
}

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2);
  const problems = await main(args.find((a) => a !== "--approval") ?? ".", process.env, args.includes("--approval"));
  for (const problem of problems) {
    console.log(problem);
  }
  if (problems.length > 0) {
    console.log(`check-eval-proof: ${problems.length} problem(s); see evals/reviewer/README.md#the-proof-check`);
    process.exit(1);
  }
}
