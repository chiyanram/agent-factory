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
// A change to baseline.json needs the operator's approval: the pull request label eval-baseline-approved, which CI
// reads from the pull request event (GITHUB_EVENT_PATH; no token, no API call). Without that event, as in a local run,
// a baseline change is refused. The new baseline must itself be a proof pass with 0 clean-floor hits.
//
// The reviewer inputs today are the prompts below. A results file must also have run with the model pins. The pins
// file itself becomes a reviewer input with the first baseline (#216): until then no change to it can be proven, and
// it lands before the baseline (ADR-0015, build order 1 before 4). The rulebook's pin is the project's plugin pin,
// kept in the factory home and not in this repository (#232), so inputs.rulebook is not checked here yet. No model
// call, no token: it reads git, JSON and the model pins' leaf module only.
//
//   node scripts/check-eval-proof.ts [ROOT]     (make lint)
//
// The default branch is FACTORY_BASE_REF, else origin/<GITHUB_BASE_REF> on a pull request, else origin/main; CI checks
// out with fetch-depth 0, so it is there. git reads this repository's own files, not a project's, so it runs plain
// git, as check-links does. Runs on Node's type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as Bar from "../src/core/eval/bar.js";

// the bar a change must pass lives in src/ (the eval harness reads its aims too); loaded on Node's type stripping
const bar: typeof Bar = await import(new URL("../src/core/eval/bar.ts", import.meta.url).href);
const { aimProblems, baselineOf, countsOf, field, holdProblems } = bar;
type Baseline = Bar.Baseline;

export const PROMPTS = {
  find: "prompts/review-find.md",
  verify: "prompts/review-verify.md",
  judge: "prompts/eval-judge.md",
} as const;
type PromptKey = keyof typeof PROMPTS;
const PROMPT_KEYS: readonly PromptKey[] = ["find", "verify", "judge"];

// the model pins: a leaf module, loaded from the checkout under check
export const MODELS = "src/core/review/pinned.ts";
type ModelKey = "find" | "rule" | "logic" | "judge";
const MODEL_KEYS: readonly ModelKey[] = ["find", "rule", "logic", "judge"];

export const BASELINE = "evals/reviewer/baseline.json";
export const LABEL = "eval-baseline-approved";
const RESULTS = /^evals\/reviewer\/results\/[^/]+\.json$/;
const SHA = /^[0-9a-f]{40}$/;

// isReviewerInput : a file whose change can change what the automated review finds (ADR-0015 E8). Pure.
export function isReviewerInput(file: string): boolean {
  return /^prompts\/review-[^/]+\.md$/.test(file) || file === PROMPTS.judge;
}

export type Facts = {
  // every file the change touches against the default branch, and the ones it adds
  readonly changed: readonly string[];
  readonly added: readonly string[];
  // each added results file's text
  readonly results: ReadonlyMap<string, string>;
  // baseline.json's text in the change, or undefined when there is none
  readonly baseline: string | undefined;
  // each prompt's git blob SHA in the change, "" when it is not there
  readonly prompts: Readonly<Record<PromptKey, string>>;
  // each pinned model in the change, "" when the pins cannot be read
  readonly models: Readonly<Record<ModelKey, string>>;
  readonly onBranch: (sha: string) => boolean;
  // the pull request's labels, or undefined when this run has no pull request event
  readonly labels: readonly string[] | undefined;
};

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function entries(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

// errorProblems : each case and each run of a results document that has an error, named (ADR-0021 N11). The harness
// marks such a pass partial; this holds when a file's flags do not match its runs. Pure.
export function errorProblems(value: unknown): readonly string[] {
  return entries(field(value, "per_case")).flatMap((c) => {
    const name = String(field(c, "case"));
    const own = field(c, "error");
    const runs = entries(field(c, "runs")).filter((r) => (field(r, "error") ?? "") !== "");
    return [
      ...((own ?? "") === "" ? [] : [`case ${name} has an error: ${String(own)}`]),
      ...runs.map((r) => `case ${name} run ${String(field(r, "run"))} has an error: ${String(field(r, "error"))}`),
    ].map((why) => `${why}; an errored run proves nothing (ADR-0021 N11)`);
  });
}

// passProblems : why a results document is not a proof pass with a clean floor. Pure.
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

// inputProblems : why the inputs a results document ran with are not the change's. Pure.
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

// proofProblems : why a change to a reviewer input is not proven. Pure.
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
      `only the operator may change it: the label ${LABEL} on the pull request, which CI reads; this run has none`,
    ];
  }
  return labels.includes(LABEL) ? [] : [`only the operator may change it: the pull request has no ${LABEL} label`];
}

// shapeProblems : why a new baseline cannot be one: not a proof pass with a clean floor, no noise to measure, or an
// aim, since a baseline proves no change (ADR-0021). Pure.
function shapeProblems(value: unknown): readonly string[] {
  const b = baselineOf(value);
  return [
    ...passProblems(value),
    ...(typeof b === "string" && countsOf(value) !== undefined ? [`it ${b}`] : []),
    ...(field(value, "aim") == null ? [] : ["it says an aim; a baseline proves no change, so run it with no --aim"]),
  ];
}

// baselineProblems : a change to baseline.json needs the operator's label, and a proof pass with a clean floor whose
// noise can be measured. Pure.
export function baselineProblems(facts: Facts): readonly string[] {
  if (!facts.changed.includes(BASELINE)) {
    return [];
  }
  const shape = facts.baseline === undefined ? [] : shapeProblems(parse(facts.baseline));
  return [...approval(facts.labels), ...shape].map((why) => `${BASELINE} changed: ${why}`);
}

// --- reading the facts from git ---

function git(root: string, args: readonly string[]): { readonly code: number; readonly out: string } {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? -1, out: r.stdout };
}

// baseRef : the default branch to compare with
export function baseRef(env: NodeJS.ProcessEnv): string {
  const pr = env.GITHUB_BASE_REF ?? "";
  return env.FACTORY_BASE_REF || (pr === "" ? "origin/main" : `origin/${pr}`);
}

// labelsOf : the labels of the pull request in a GitHub event's JSON, or undefined when it holds no pull request. Pure.
export function labelsOf(eventText: string): readonly string[] | undefined {
  const labels = field(field(parse(eventText), "pull_request"), "labels");
  return Array.isArray(labels) ? labels.map((l) => String(field(l, "name"))) : undefined;
}

function eventLabels(env: NodeJS.ProcessEnv): readonly string[] | undefined {
  const path = env.GITHUB_EVENT_PATH ?? "";
  return path !== "" && existsSync(path) ? labelsOf(readFileSync(path, "utf8")) : undefined;
}

// nameStatus : the -z --name-status output of a diff, as [status, file] pairs. Pure.
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

// modelPins : the pinned models in the checkout; "" for each when its pins module is missing or not as expected
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

async function main(root: string, env: NodeJS.ProcessEnv): Promise<readonly string[]> {
  const ref = baseRef(env);
  const base = git(root, ["merge-base", ref, "HEAD"]);
  if (base.code !== 0) {
    return [`cannot find the default branch ${ref} to compare with; fetch it or set FACTORY_BASE_REF`];
  }
  const f = await readFacts(root, base.out.trim(), env);
  return [...baselineProblems(f), ...proofProblems(f)];
}

if (process.argv[1] === import.meta.filename) {
  const problems = await main(process.argv[2] ?? ".", process.env);
  for (const problem of problems) {
    console.log(problem);
  }
  if (problems.length > 0) {
    console.log(`check-eval-proof: ${problems.length} problem(s); see evals/reviewer/README.md#the-proof-check`);
    process.exit(1);
  }
}
