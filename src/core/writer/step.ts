// step — the writer as the dispatcher's step (#113 PR 2b; ADR-0012 S3, S5, S13). One run:
//   1 the ticket's approved spec, the start (the change's branch at its head, or the default branch on a first run),
//     and the box's model login
//   2 the writer's clone (clone.ts), the run in a fresh box (run.ts), the outcome from its report
//   3 the host pushes and posts (finish.ts): on a first run it pushes, opens the draft change (#164) and claims it
//   4 the run folder goes, however the run ended
// It runs test-first, fix, rework and CI (#171), and merge (#103). A rework or CI run gets its task in .factory/task.md
// (task.ts): the failed evidence row, the factory's own Act on findings, or the failed CI jobs and their logs' ends. A
// task the host cannot read goes to a person: the host says why on the change, labelled needs-human. A merge run, for a
// change that conflicts with its target, gets the default branch fetched into its clone as origin/<default>, merges it
// in and resolves the conflicts; the push stays a fast-forward, so nothing rebases or force-pushes. A cleanup run (#236)
// gets the implementer's evidence rows as its task, with the default branch fetched in to diff against; what it defers
// goes in the PR body. **Today:** no dispatcher rule starts a cleanup run; a person runs cleanup by hand.
//
// Every run is started from its role card (process/cards.ts): its prompt is prompt.ts's, the run gets only the card's
// tools, the card's must_not_see leaves its input out of the run, and the card's hash goes in the run record.
// No run rewrites the branch: test-first and fix only add commits. A host step that fails after the run still records
// what the run spent. A failed step whose start line names the run folder writes no end, so the folder stays for the
// next pass's hand-over.

import { rmdir } from "node:fs/promises";
import { goAhead, type GoAhead } from "../start.js";
import type { Task } from "../dispatch/records.js";
import { BRANCH_PREFIX, type Steps } from "../dispatch/steps.js";
import type { Result } from "../forge/api.js";
import type { Evidence } from "../report.js";
import { readKept, recordsDirOf } from "../kept.js";
import { dataFence } from "../review/fence.js";
import { makeClone, removeClone, runFolder, SETTINGS_FILE, type Start } from "./clone.js";
import { keepLeft } from "../left.js";
import { readTools, TARGET_REF, toolLines } from "./tools.js";
import { scopesOf } from "./scope.js";
import { DEFAULT_MODEL, runsField } from "../agent/ran.js";
import { knownFor, type Known } from "../onboard/known.js";
import { knowledgeLines, ROLE_OF, runPrompt, type RunMode } from "./prompt.js";
import { spentFailure, type FailedSpent } from "../dispatch/spend.js";
import { NO_TRACE, openTrace, type TraceKept, type TraceSink } from "../dispatch/trace.js";
import { writerRun, type Ended } from "./run.js";
import { keepOutput, whyText } from "./why.js";
import { ciText, taskText, verifyText } from "./task.js";
import { answersText, type Answer } from "../answers.js";
import { VERIFY_FILE } from "../ready/steps.js";
import { inputsOf, readCard, type Card, type Part } from "../process/cards.js";
import { beforeBox, finished, handOver } from "./host-post.js";
import type { Input, Prepared, WriterOut, WriterSetup } from "./types.js";

function spentOn(result: Result<WriterOut>, ended: Result<Ended> | FailedSpent): Result<WriterOut> | FailedSpent {
  if (result.kind === "ok") {
    return result;
  }
  if (ended.kind === "failed") {
    return ended;
  }
  const failed = spentFailure(result.reason, ended.value.spend, ended.value.reason);
  return ended.value.trace === undefined ? failed : { ...failed, traces: [ended.value.trace] };
}

function startOf(input: Input, base: string): Result<Start> {
  switch (input.change.kind) {
    case "open":
      return { kind: "ok", value: { kind: "branch", branch: input.change.line.branch, head: input.change.line.head } };
    case "none":
      return { kind: "ok", value: { kind: "new", branch: `${BRANCH_PREFIX}${input.ticket}`, base } };
    case "merged":
    case "many":
      return { kind: "failed", reason: `the ticket's change is ${input.change.kind}; no writer runs on it` };
  }
}

async function loginOf(setup: WriterSetup): Promise<Result<Readonly<Record<string, string>>>> {
  const token = await setup.login();
  return token.kind === "ready" ? { kind: "ok", value: token.env } : { kind: "failed", reason: token.reason };
}

async function goFor(setup: WriterSetup, ticket: string): Promise<Result<Extract<GoAhead, { kind: "go" }>>> {
  const go = await goAhead({
    home: setup.home,
    project: setup.project,
    ticket,
    lanes: setup.lanes,
    ...(setup.specs === undefined ? {} : { store: setup.specs }),
  });
  if (go.kind === "go") {
    return { kind: "ok", value: go };
  }
  return {
    kind: "failed",
    reason: `nothing a human said lets ${ticket} build: ${go.kind === "held" ? go.why : go.reason}`,
  };
}

async function prepare(setup: WriterSetup, input: Input): Promise<Result<Prepared>> {
  const go = await goFor(setup, input.ticket);
  if (go.kind === "failed") {
    return go;
  }
  const base = await setup.forge.defaultBranch();
  if (base.kind === "failed") {
    return base;
  }
  const start = startOf(input, base.value);
  if (start.kind === "failed") {
    return start;
  }
  const login = await loginOf(setup);
  const { spec } = go.value;
  return login.kind === "ok"
    ? {
        kind: "ok",
        value: {
          spec,
          approver: { by: go.value.by, at: go.value.at, said: go.value.said },
          start: start.value,
          base: base.value,
          login: login.value,
        },
      }
    : login;
}

type TaskFile = { readonly kind: "none" } | { readonly kind: "text"; readonly text: string; readonly part: Part };

type Draft = { readonly mode: RunMode; readonly task: TaskFile };

type Work = Draft & { readonly card: Card };

const SPEC_PART: Part = { names: ["the approved spec", "the spec", "the bug spec"], needed: true };

function mergeOf(work: Work, base: string): { readonly merge?: string } {
  return work.mode === "merge" || work.mode === "cleanup" ? { merge: base } : {};
}

function withCard(result: Result<WriterOut>, work: Work): Result<WriterOut> {
  return result.kind === "ok" ? { kind: "ok", value: { ...result.value, card: work.card.sha256 } } : result;
}

function knowledgeOf(known: Known): Pick<Parameters<typeof makeClone>[1], "knowledge"> {
  return known.files.kind === "text" ? { knowledge: { brief: known.files.brief, glossary: known.files.glossary } } : {};
}

function withStale(result: Result<WriterOut>, known: Known): Result<WriterOut> {
  return result.kind === "ok" && known.stale.length > 0
    ? { kind: "ok", value: { ...result.value, stale: known.stale } }
    : result;
}

function personHome(env: NodeJS.ProcessEnv): string {
  return env.HOME ?? "";
}

async function inClone(
  setup: WriterSetup,
  input: Input,
  p: Prepared,
  work: Work,
): Promise<Result<WriterOut> | FailedSpent> {
  const tools = await readTools({ repo: setup.box.repo, env: setup.box.env, base: p.base });
  const scopes = scopesOf(work.card, setup.testFiles);
  const settings = setup.agent.settings({
    guardrails: work.card.guardrails,
    home: personHome(setup.box.env),
    lint: tools.lint,
    scopes: scopes.map((s) => s.globs),
  });
  const known = await knownFor({
    home: setup.home,
    project: setup.project,
    repo: setup.box.repo,
    env: setup.box.env,
    ref: TARGET_REF,
  });
  const clone = await makeClone(setup.box, {
    dir: input.folder,
    start: p.start,
    spec: p.spec.text,
    plugins: setup.settings.plugins.map((d) => d.dir),
    task: work.task,
    settings,
    ...mergeOf(work, p.base),
    ...knowledgeOf(known),
  });
  if (clone.kind === "failed") {
    return beforeBox(clone);
  }
  const prompt = runPrompt({
    card: work.card,
    mode: work.mode,
    names: { ticket: input.ticket, branch: clone.value.branch, head: clone.value.start, base: p.base },
    tools: [...knowledgeLines(known), ...toolLines(tools)],
    programs: setup.programs,
  });
  const trace = await writerTrace(setup, input);
  const ran = await writerRun({
    trace,
    setup: setup.box,
    clone: clone.value,
    prompt,
    login: p.login,
    timeoutSeconds: setup.settings.timeoutSeconds,
    agent: setup.agent,
    call: {
      claude: setup.settings.claude,
      settings: settings.kind === "text" ? { kind: "file", path: SETTINGS_FILE } : { kind: "none" },
      plugins: setup.settings.plugins.length,
      tools: work.card.tools,
    },
    scopes,
    completion: setup.settings.completion,
    stallMs: setup.settings.stallMs,
  });
  const ended = withTrace(ran, await trace.close());
  const result =
    ended.kind === "ok"
      ? await finished(setup, input, p, { clone: clone.value, ended: ended.value, mode: work.mode })
      : ended;
  const out = spentOn(await withOutput(setup, input, ended, withStale(withCard(result, work), known)), ended);
  return withRuns(await afterRun(input, clone.value.dir, out, ended), ended);
}

function withRuns(
  out: Result<WriterOut> | FailedSpent,
  ended: Result<Ended> | FailedSpent,
): Result<WriterOut> | FailedSpent {
  const runs = runsField(ended.kind === "ok" ? ended.value.runs : "runs" in ended ? ended.runs : undefined);
  return out.kind === "ok" ? { kind: "ok", value: { ...out.value, ...runs } } : { ...out, ...runs };
}

async function afterRun(
  input: Input,
  dir: string,
  out: Result<WriterOut> | FailedSpent,
  ended: Result<Ended> | FailedSpent,
): Promise<Result<WriterOut> | FailedSpent> {
  if (out.kind !== "ok") {
    return out;
  }
  const removed = await removeClone(dir);
  return removed.kind === "ok" ? out : spentOn(removed, ended);
}

async function writerTrace(setup: WriterSetup, input: Input): Promise<TraceSink> {
  const at = { home: setup.home, project: setup.project, ticket: input.ticket };
  const opened = await openTrace({ ...at, kind: "writer", at: Date.now() });
  return opened.kind === "ok" ? opened.value : NO_TRACE;
}

function withTrace(ended: Result<Ended> | FailedSpent, kept: Result<TraceKept>): Result<Ended> | FailedSpent {
  if (kept.kind === "failed") {
    return ended;
  }
  return ended.kind === "ok"
    ? { kind: "ok", value: { ...ended.value, trace: kept.value.name } }
    : { ...ended, traces: [kept.value.name] };
}

function toKeep(ended: Result<Ended> | FailedSpent): readonly string[] {
  if (ended.kind === "failed") {
    return [];
  }
  const { outcome, output } = ended.value;
  return outcome.kind === "blocked" && outcome.by === "host" ? output : [];
}

async function withOutput(
  setup: WriterSetup,
  input: Input,
  ended: Result<Ended> | FailedSpent,
  result: Result<WriterOut>,
): Promise<Result<WriterOut>> {
  const lines = toKeep(ended);
  if (result.kind === "failed" || lines.length === 0) {
    return result;
  }
  const at = { home: setup.home, project: setup.project, ticket: input.ticket };
  const kept = await keepOutput({ ...at, at: Date.now(), lines });
  const value = result.value;
  return kept.kind === "ok"
    ? { kind: "ok", value: { ...value, output: kept.value } }
    : { kind: "ok", value: { ...value, why: notKept(value.why, kept.reason) } };
}

function notKept(why: string | undefined, reason: string): string {
  return whyText(`${why ?? "blocked"}; its output was not kept: ${reason}`);
}

type Drafted = { readonly kind: "run"; readonly work: Draft } | { readonly kind: "hand-over"; readonly reason: string };
type Planned = { readonly kind: "run"; readonly work: Work } | { readonly kind: "hand-over"; readonly reason: string };

const ACT_ON: Part = { names: ["the act_on list", "review findings"], needed: true };
const FAILED_ROW: Part = { names: ["the failed evidence row"], needed: true };
const FAILED_CI: Part = { names: ["the failed CI jobs"], needed: true };
const EVIDENCE_ROWS: Part = {
  names: ["the evidence rows of the implementer's report", "the implementer's report"],
  needed: true,
};

async function reworkPlan(
  setup: WriterSetup,
  input: Input,
  task: Extract<Task, { readonly kind: "ready-failed" | "act-on" }>,
): Promise<Drafted> {
  if (input.change.kind !== "open") {
    return { kind: "hand-over", reason: "a rework run needs an open change" };
  }
  const text = await taskText(task, { recordsDir: recordsDirOf(setup.box.repo), change: input.change.line.number });
  return text.kind === "ok"
    ? {
        kind: "run",
        work: {
          mode: "rework",
          task: { kind: "text", text: text.value, part: task.kind === "act-on" ? ACT_ON : FAILED_ROW },
        },
      }
    : { kind: "hand-over", reason: `the rework run has no task: ${text.reason}; a person takes it` };
}

async function ciPlan(
  setup: WriterSetup,
  input: Input,
  task: Extract<Task, { readonly kind: "ci-red" }>,
): Promise<Drafted> {
  if (input.change.kind !== "open") {
    return { kind: "hand-over", reason: "a CI run needs an open change" };
  }
  const jobs = await setup.forge.failedJobs({ number: input.change.line.number, head: task.head });
  if (jobs.kind === "failed") {
    return { kind: "hand-over", reason: `the CI run has no task: ${jobs.reason}; a person takes it` };
  }
  return jobs.value.length === 0
    ? { kind: "hand-over", reason: "CI is red, but the forge names no failed job at the head; a person takes it" }
    : { kind: "run", work: { mode: "ci", task: { kind: "text", text: ciText(jobs.value), part: FAILED_CI } } };
}

async function verifyPlan(
  setup: WriterSetup,
  input: Input,
  task: Extract<Task, { readonly kind: "verify-failed" }>,
): Promise<Drafted> {
  if (input.change.kind !== "open") {
    return { kind: "hand-over", reason: "a CI run needs an open change" };
  }
  const at = { recordsDir: recordsDirOf(setup.box.repo), change: input.change.line.number, head: task.head };
  const kept = await readKept(at, VERIFY_FILE);
  return kept.kind === "ok"
    ? { kind: "run", work: { mode: "ci", task: { kind: "text", text: verifyText(kept.value), part: FAILED_CI } } }
    : { kind: "hand-over", reason: `the CI run has no task: ${kept.reason}; a person takes it` };
}

function mergePlan(_setup: WriterSetup, input: Input): Promise<Drafted> {
  return Promise.resolve(
    input.change.kind === "open"
      ? { kind: "run", work: { mode: "merge", task: { kind: "none" } } }
      : { kind: "hand-over", reason: "a merge run needs an open change" },
  );
}

export function cleanupText(evidence: readonly Evidence[], base: string): string {
  const rows = evidence.map((e) => `- ${e.criterion}: \`${e.command}\` gave: ${e.result}`);
  return [
    "# Cleanup",
    "",
    `The branch's own lines are its diff against origin/${base}: \`git diff origin/${base}...HEAD\`.`,
    "",
    "The implementer's evidence rows. Run each again after your cleanup; each must give the same result, and your report's evidence is these rows, run again:",
    dataFence({ title: "the evidence rows", text: rows.join("\n") }),
  ].join("\n");
}

async function cleanupPlan(
  setup: WriterSetup,
  input: Input,
  task: Extract<Task, { readonly kind: "cleanup" }>,
): Promise<Drafted> {
  if (input.change.kind !== "open") {
    return { kind: "hand-over", reason: "a cleanup run needs an open change" };
  }
  const base = await setup.forge.defaultBranch();
  return base.kind === "ok"
    ? {
        kind: "run",
        work: {
          mode: "cleanup",
          task: { kind: "text", text: cleanupText(task.evidence, base.value), part: EVIDENCE_ROWS },
        },
      }
    : { kind: "hand-over", reason: `the cleanup run has no default branch to diff against: ${base.reason}` };
}

const ANSWERS: Part = { names: ["the person's answers", "the answers"], needed: true };

const plain = (mode: "test-first" | "fix", answers: readonly Answer[] = []): Promise<Drafted> =>
  Promise.resolve({
    kind: "run",
    work: {
      mode,
      task: answers.length === 0 ? { kind: "none" } : { kind: "text", text: answersText(answers), part: ANSWERS },
    },
  });

type TaskMap = { readonly [T in Task as T["kind"]]: T };
type Planners = {
  readonly [K in keyof TaskMap]: (setup: WriterSetup, input: Input, task: TaskMap[K]) => Promise<Drafted>;
};

const PLANNERS: Planners = {
  "test-first": (_setup, _input, task) => plain("test-first", task.answers),
  fix: (_setup, _input, task) => plain("fix", task.answers),
  "ready-failed": reworkPlan,
  "act-on": reworkPlan,
  "ci-red": ciPlan,
  "verify-failed": verifyPlan,
  conflict: mergePlan,
  cleanup: cleanupPlan,
};

function planOn<K extends keyof TaskMap>(
  kind: K,
  setup: WriterSetup,
  input: Input,
  task: TaskMap[K],
): Promise<Drafted> {
  return PLANNERS[kind](setup, input, task);
}

async function carded(setup: WriterSetup, draft: Draft): Promise<Planned> {
  const role = ROLE_OF[draft.mode];
  const card = await readCard(role, setup.cards);
  if (card.kind === "failed") {
    return { kind: "hand-over", reason: `the ${role} run has no role card: ${card.reason}` };
  }
  const parts = draft.task.kind === "text" ? [SPEC_PART, draft.task.part] : [SPEC_PART];
  const inputs = inputsOf(card.value, parts);
  return inputs.kind === "ok"
    ? { kind: "run", work: { ...draft, card: card.value } }
    : { kind: "hand-over", reason: `the ${role} run cannot start: ${inputs.reason}` };
}

async function planned(setup: WriterSetup, input: Input): Promise<Planned> {
  const draft = await planOn(input.task.kind, setup, input, input.task);
  return draft.kind === "run" ? carded(setup, draft.work) : draft;
}

async function runOne(setup: WriterSetup, input: Input): Promise<Result<WriterOut> | FailedSpent> {
  const plan = await planned(setup, input);
  if (plan.kind === "hand-over") {
    return handOver(setup, input, plan.reason);
  }
  const p = await prepare(setup, input);
  return p.kind === "ok" ? inClone(setup, input, p.value, plan.work) : beforeBox(p);
}

async function runIn(setup: WriterSetup, input: Input): Promise<Result<WriterOut> | FailedSpent> {
  const out = await runOne(setup, input);
  await rmdir(input.folder).catch(() => undefined);
  return out;
}

export function writerStep(setup: Result<WriterSetup>): Steps["writer"] {
  if (setup.kind === "failed") {
    return { kind: "unavailable", reason: setup.reason };
  }
  const s = setup.value;
  const model = s.settings.claude.model;
  return {
    kind: "available",
    named: { cli: s.agent.name, asks: { writer: model === "" ? DEFAULT_MODEL : model } },
    run: (input) => runIn(s, input),
    folder: () => runFolder(s.box),
    keep: keepLeft({
      env: s.box.env,
      forge: s.forge,
      landing: { target: { kind: "ok", value: s.push }, pusher: s.pusher },
    }),
  };
}
