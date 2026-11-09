// check-eval-proof — CI checks the proof, not the model (#217; ADR-0015 E10). When the change against the default
// branch touches a reviewer input, it must add an evals/reviewer/results/*.json that proves the change:
//   proof      not partial, no draft case ("proof": true)
//   inputs     each prompt's git blob SHA is the one the change has (prompts/review-find.md, review-verify.md,
//              eval-judge.md), and the pass ran at a commit on this branch ("head" is an ancestor of HEAD)
//   recall     recall_at_act_on.overall.recall is not below evals/reviewer/baseline.json's (E3)
//   clean      0 clean-floor hits (E2)
// With no baseline.json yet (#216), a reviewer-input change is refused: there is nothing to prove it against.
// A change to baseline.json needs the operator's approval: the pull request label eval-baseline-approved, which CI
// reads from the pull request event (GITHUB_EVENT_PATH; no token, no API call). Without that event, as in a local run,
// a baseline change is refused. The new baseline must itself be a proof pass with 0 clean-floor hits.
//
// The reviewer inputs today are the prompts below. The model and rulebook pins join REVIEWER_INPUTS and the input
// check when they land (#213, then the plugin pins with #232). No model call, no token: it reads git and JSON only.
//
//   node scripts/check-eval-proof.ts [ROOT]     (make lint)
//
// The default branch is FACTORY_BASE_REF, else origin/<GITHUB_BASE_REF> on a pull request, else origin/main; CI checks
// out with fetch-depth 0, so it is there. git reads this repository's own files, not a project's, so it runs plain
// git, as check-links does. Runs on Node's type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PROMPTS = {
  find: "prompts/review-find.md",
  verify: "prompts/review-verify.md",
  judge: "prompts/eval-judge.md",
} as const;
type PromptKey = keyof typeof PROMPTS;
const PROMPT_KEYS: readonly PromptKey[] = ["find", "verify", "judge"];

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
  readonly onBranch: (sha: string) => boolean;
  // the pull request's labels, or undefined when this run has no pull request event
  readonly labels: readonly string[] | undefined;
};

// field : one property of a parsed JSON value, or undefined
function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? (Reflect.get(value, name) as unknown) : undefined;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

// recallOf : recall_at_act_on.overall.recall, or undefined when it is not a number. Pure.
export function recallOf(value: unknown): number | undefined {
  const r = field(field(field(value, "recall_at_act_on"), "overall"), "recall");
  return typeof r === "number" ? r : undefined;
}

// passProblems : why a results document is not a proof pass with a clean floor. Pure.
export function passProblems(value: unknown): readonly string[] {
  const hits = field(field(value, "clean_floor"), "hits");
  return [
    ...(field(value, "partial") === false ? [] : ["it is partial"]),
    ...(field(value, "proof") === true ? [] : ['it is not proof ("proof": true needs no draft case and not partial)']),
    ...(hits === 0 ? [] : [`it has ${String(hits)} clean-floor hit(s); the floor is 0`]),
    ...(recallOf(value) === undefined ? ["it has no recall_at_act_on.overall.recall"] : []),
  ];
}

// inputProblems : why the inputs a results document ran with are not the change's. Pure.
export function inputProblems(value: unknown, facts: Facts): readonly string[] {
  const prompts = field(field(value, "inputs"), "prompts");
  const head = field(value, "head");
  const ran = typeof head === "string" && SHA.test(head) && facts.onBranch(head);
  return [
    ...PROMPT_KEYS.filter((k) => field(prompts, k) !== facts.prompts[k]).map(
      (k) => `inputs.prompts.${k} is ${String(field(prompts, k))}, not ${PROMPTS[k]} as changed (${facts.prompts[k]})`,
    ),
    ...(ran ? [] : [`head ${String(head)} is not a commit on this branch`]),
  ];
}

function resultProblems(text: string, facts: Facts, floor: number): readonly string[] {
  const value = parse(text);
  if (value === undefined) {
    return ["it is not JSON"];
  }
  const recall = recallOf(value);
  const below = recall !== undefined && recall < floor;
  return [
    ...passProblems(value),
    ...inputProblems(value, facts),
    ...(below ? [`recall@act_on ${recall} is below the baseline's ${floor}`] : []),
  ];
}

function proven(facts: Facts, floor: number): readonly string[] {
  const added = facts.added.filter((f) => RESULTS.test(f));
  if (added.length === 0) {
    return ["add the results file of an eval pass run at this change (agent-factory eval reviewer)"];
  }
  const each = added.map((f) => ({ f, why: resultProblems(facts.results.get(f) ?? "", facts, floor) }));
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
  const floor = recallOf(parse(facts.baseline));
  if (floor === undefined) {
    return [`${head}, and ${BASELINE} has no recall_at_act_on.overall.recall`];
  }
  return proven(facts, floor).map((why) => `${head}: ${why}`);
}

function approval(labels: readonly string[] | undefined): readonly string[] {
  if (labels === undefined) {
    return [
      `only the operator may change it: the label ${LABEL} on the pull request, which CI reads; this run has none`,
    ];
  }
  return labels.includes(LABEL) ? [] : [`only the operator may change it: the pull request has no ${LABEL} label`];
}

// baselineProblems : a change to baseline.json needs the operator's label, and a proof pass with a clean floor. Pure.
export function baselineProblems(facts: Facts): readonly string[] {
  if (!facts.changed.includes(BASELINE)) {
    return [];
  }
  const shape = facts.baseline === undefined ? [] : passProblems(parse(facts.baseline));
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

function readFacts(root: string, base: string, env: NodeJS.ProcessEnv): Facts {
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
    onBranch: (sha) => git(root, ["merge-base", "--is-ancestor", sha, "HEAD"]).code === 0,
    labels: eventLabels(env),
  };
}

function main(root: string, env: NodeJS.ProcessEnv): readonly string[] {
  const ref = baseRef(env);
  const base = git(root, ["merge-base", ref, "HEAD"]);
  if (base.code !== 0) {
    return [`cannot find the default branch ${ref} to compare with; fetch it or set FACTORY_BASE_REF`];
  }
  const f = readFacts(root, base.out.trim(), env);
  return [...baselineProblems(f), ...proofProblems(f)];
}

if (process.argv[1] === import.meta.filename) {
  const problems = main(process.argv[2] ?? ".", process.env);
  for (const problem of problems) {
    console.log(problem);
  }
  if (problems.length > 0) {
    console.log(`check-eval-proof: ${problems.length} problem(s); see evals/reviewer/README.md#the-proof-check`);
    process.exit(1);
  }
}
