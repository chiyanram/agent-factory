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
import type { LaneProps } from "../lane.js";
import type { BoxToken } from "../token/rules.js";
import type { Task } from "../dispatch/records.js";
import { BRANCH_PREFIX, type RunInput, type Steps } from "../dispatch/steps.js";
import { fastForwardOnly, finishFirst, finishRun, seatOnEvery, type Next, type Pusher } from "../finish.js";
import type { Done, Result } from "../forge/api.js";
import type { Forge, ForgeName } from "../forge/types.js";
import type { Identity } from "../identity.js";
import type { PushRequest } from "../push.js";
import { CLEAN, type Evidence, type Outcome } from "../report.js";
import type { Approver, Spec, SpecStore } from "../spec.js";
import type { BodyPost, PrBody } from "../post.js";
import type { BoxSetup } from "../ready/boxrun.js";
import { keepText, readKept, recordsDirOf } from "../kept.js";
import { dataFence } from "../review/fence.js";
import { makeClone, removeClone, runFolder, SETTINGS_FILE, type Clone, type Start } from "./clone.js";
import { keepLeft } from "../left.js";
import { readTools, TARGET_REF, toolLines } from "./tools.js";
import { scopesOf } from "./scope.js";
import type { ClaudeWriter } from "../agent/claude-writer.js";
import { DEFAULT_MODEL, runsField, type RunNamed } from "../agent/ran.js";
import { knownFor, type Known } from "../onboard/known.js";
import { knowledgeLines, runPrompt, type RunMode } from "./prompt.js";
import { spentFailure, type FailedSpent, type Spend } from "../dispatch/spend.js";
import { NO_TRACE, openTrace, type TraceKept, type TraceSink } from "../dispatch/trace.js";
import { writerRun, type Ended } from "./run.js";
import { keepOutput, whyOf, whyText, withSaid } from "./why.js";
import { ciText, taskText, verifyText } from "./task.js";
import { answersText, type Answer } from "../answers.js";
import { VERIFY_FILE } from "../ready/steps.js";
import type { WriterSettings } from "./settings.js";
import { inputsOf, readCard, type Card, type Part, type Role } from "../process/cards.js";

export const ROLE_OF: Readonly<Record<RunMode, Role>> = {
  "test-first": "test-first",
  fix: "implementer",
  rework: "implementer",
  ci: "implementer",
  merge: "implementer",
  cleanup: "cleanup",
};

export type PushTarget = {
  readonly forge: ForgeName;
  readonly host: string;
  readonly project: string;
  readonly identity: Identity;
  readonly env: NodeJS.ProcessEnv;
};

export type WriterSetup = {
  readonly box: BoxSetup;
  readonly settings: WriterSettings;
  readonly forge: Forge;
  readonly push: PushTarget;
  readonly home: string;
  readonly project: string;
  readonly label: string;
  readonly login: () => Promise<BoxToken>;
  readonly pusher: Pusher;
  readonly programs: readonly string[];
  readonly testFiles: readonly string[];
  readonly agent: ClaudeWriter;
  readonly lanes?: readonly LaneProps[];
  readonly specs?: SpecStore;
  readonly cards?: string;
};

type Input = RunInput & { readonly task: Task; readonly folder: string };
export type WriterOut = {
  readonly head: string;
  readonly outcome: "done" | "asked" | "blocked" | "parked";
  readonly parked?: { readonly until: string; readonly said: string };
  readonly patch: string;
  readonly evidence: readonly Evidence[];
  readonly hung: boolean;
  readonly spend?: Spend;
  readonly card?: string;
  readonly deferred?: readonly string[];
  readonly stale?: readonly string[];
  readonly why?: string;
  readonly output?: string;
  readonly trace?: string;
  readonly runs?: readonly RunNamed[];
};

function deferredOf(outcome: Outcome): { readonly deferred?: readonly string[] } {
  return outcome.kind === "done" && outcome.deferred !== undefined ? { deferred: outcome.deferred } : {};
}

function whyField(why: string): { readonly why?: string } {
  return why === "" ? {} : { why };
}

function nextWhy(ended: Ended, next: Extract<Next, { kind: "needs-human" }>): string {
  const host = ended.outcome.kind !== "blocked" || ended.outcome.by === "host";
  return whyText(withSaid(next.reason, host && ended.outcome.kind !== "done" ? ended.said : ""));
}

function spendField(spend: Spend | "unmeasured"): { readonly spend?: Spend } {
  return spend === "unmeasured" ? {} : { spend };
}

function traceField(trace: string | undefined): { readonly trace?: string } {
  return trace === undefined ? {} : { trace };
}

function spentOn(result: Result<WriterOut>, ended: Result<Ended> | FailedSpent): Result<WriterOut> | FailedSpent {
  if (result.kind === "ok") {
    return result;
  }
  if (ended.kind === "failed") {
    return ended;
  }
  const failed = spentFailure(result.reason, ended.value.spend);
  return ended.value.trace === undefined ? failed : { ...failed, traces: [ended.value.trace] };
}

export function outOf(ended: Ended, next: Next): WriterOut {
  const base = {
    head: ended.tip,
    patch: ended.patch,
    hung: ended.ending.kind === "hung",
    ...spendField(ended.spend),
    ...deferredOf(ended.outcome),
    ...traceField(ended.trace),
  };
  switch (next.kind) {
    case "ready-check":
      return { ...base, outcome: "done", evidence: next.evidence };
    case "wait-for-answer":
      return { ...base, outcome: "asked", evidence: [], ...whyField(whyOf(ended.outcome, ended.said)) };
    case "needs-human":
      return { ...base, outcome: "blocked", evidence: [], ...whyField(nextWhy(ended, next)) };
    case "parked":
      return { ...base, head: next.head, outcome: "parked", evidence: [], ...parkedField(ended.outcome) };
  }
}

function parkedField(outcome: Outcome): { readonly parked?: { readonly until: string; readonly said: string } } {
  return outcome.kind === "parked" ? { parked: { until: outcome.until, said: whyText(outcome.said) } } : {};
}

type Prepared = {
  readonly spec: Spec;
  readonly approver: Approver;
  readonly start: Start;
  readonly base: string;
  readonly login: Readonly<Record<string, string>>;
};

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

function pushOf(setup: WriterSetup, p: Prepared, clone: Clone, tip: string): PushRequest {
  return {
    ...setup.push,
    repo: clone.repo,
    branch: clone.branch,
    commit: tip,
    lease: p.start.kind === "branch" ? { kind: "sha", sha: clone.start } : { kind: "absent" },
    protectedBranches: [p.base],
    guards: [fastForwardOnly(setup.push.env), seatOnEvery(setup.push.env, { since: clone.start, seat: "writer" })],
  };
}

export function bodyOf(
  p: Pick<Prepared, "spec" | "approver">,
  deferred: readonly string[] = [],
  prBody?: PrBody,
): BodyPost {
  return {
    ...(prBody === undefined ? {} : { prBody }),
    seat: "coordinator",
    title: p.spec.title,
    fields: [
      { label: "spec", value: p.spec.hash },
      { label: p.approver.said ?? "approved", value: `locally by ${p.approver.by} at ${p.approver.at}` },
    ],
    items: deferred.map((d) => `deferred by the cleanup run: ${d}`),
  };
}

function openFor(
  setup: WriterSetup,
  p: Prepared,
  branch: string,
  prBody: PrBody | undefined,
): () => Promise<Result<number>> {
  return async () => {
    const { title } = p.spec;
    const opened = await setup.forge.openChange({ branch, base: p.base, title, body: bodyOf(p, [], prBody) });
    if (opened.kind === "failed") {
      return opened;
    }
    const claimed = await setup.forge.addLabel({ number: opened.value, label: setup.label });
    return claimed.kind === "ok" ? opened : claimed;
  };
}

async function onChange(
  setup: WriterSetup,
  input: Input,
  p: Prepared,
  run: { readonly push: PushRequest; readonly ended: Ended; readonly number: number; readonly mode: RunMode },
): Promise<Result<WriterOut>> {
  const { ended, number } = run;
  const next = await finishRun({
    outcome: ended.outcome,
    ending: ended.ending,
    change: number,
    forge: setup.forge,
    push: run.push,
    pusher: setup.pusher,
    questions: setup.settings.questions,
  });
  if (next.kind === "failed") {
    return next;
  }
  const shown =
    run.mode === "cleanup"
      ? await deferredShown(setup, input, p, number, ended.outcome)
      : await prBodyShown(setup, p, { number, mode: run.mode, ended });
  return shown.kind === "ok" ? { kind: "ok", value: outOf(ended, next.value) } : shown;
}

async function finished(
  setup: WriterSetup,
  input: Input,
  p: Prepared,
  run: { readonly clone: Clone; readonly ended: Ended; readonly mode: RunMode },
): Promise<Result<WriterOut>> {
  const { clone, ended, mode } = run;
  const push = pushOf(setup, p, clone, ended.tip);
  const { outcome } = ended;
  if (input.change.kind === "open") {
    return onChange(setup, input, p, { push, ended, number: input.change.line.number, mode });
  }
  if (ended.tip === clone.start) {
    return {
      kind: "ok",
      value: {
        head: ended.tip,
        outcome: outcome.kind,
        ...parkedField(outcome),
        patch: "",
        evidence: [],
        hung: ended.ending.kind === "hung",
        ...spendField(ended.spend),
        ...whyField(whyOf(outcome, ended.said)),
        ...traceField(ended.trace),
      },
    };
  }
  const first = await finishFirst({
    outcome,
    ending: ended.ending,
    forge: setup.forge,
    push,
    pusher: setup.pusher,
    questions: setup.settings.questions,
    open: openFor(setup, p, clone.branch, prBodyOf(setup, mode, ended)),
  });
  if (first.kind === "failed") {
    return first;
  }
  const kept = await prBodyKept(setup, { number: first.value.change, mode, ended });
  return kept.kind === "ok" ? { kind: "ok", value: outOf(ended, first.value.next) } : kept;
}

export const PR_BODY_KEPT = "pr.md";

function prBodyOf(setup: WriterSetup, mode: RunMode, ended: Ended): PrBody | undefined {
  return ROLE_OF[mode] === "implementer" && ended.pr !== undefined
    ? { markdown: ended.pr, host: setup.push.host }
    : undefined;
}

type Wrote = { readonly number: number; readonly mode: RunMode; readonly ended: Ended };

async function prBodyKept(setup: WriterSetup, run: Wrote): Promise<Done> {
  const body = prBodyOf(setup, run.mode, run.ended);
  if (body === undefined) {
    return { kind: "ok" };
  }
  const at = { recordsDir: recordsDirOf(setup.box.repo), change: run.number, head: run.ended.tip };
  const kept = await keepText(at, PR_BODY_KEPT, body.markdown);
  return kept.kind === "ok" ? { kind: "ok" } : kept;
}

async function prBodyShown(setup: WriterSetup, p: Prepared, run: Wrote): Promise<Done> {
  const body = prBodyOf(setup, run.mode, run.ended);
  if (body === undefined) {
    return { kind: "ok" };
  }
  const set = await setup.forge.setBody({ number: run.number, post: bodyOf(p, [], body) });
  return set.kind === "ok"
    ? prBodyKept(setup, run)
    : { kind: "failed", reason: `the PR body was not set: ${set.reason}` };
}

async function keptPrBody(setup: WriterSetup, number: number, head: string): Promise<PrBody | undefined> {
  const kept = await readKept({ recordsDir: recordsDirOf(setup.box.repo), change: number, head }, PR_BODY_KEPT);
  return kept.kind === "ok" ? { markdown: kept.value, host: setup.push.host } : undefined;
}

async function deferredShown(
  setup: WriterSetup,
  input: Input,
  p: Prepared,
  number: number,
  outcome: Outcome,
): Promise<Done> {
  if (input.task.kind !== "cleanup" || outcome.kind !== "done") {
    return { kind: "ok" };
  }
  const kept = await keptPrBody(setup, number, input.task.head);
  const set = await setup.forge.setBody({ number, post: bodyOf(p, outcome.deferred, kept) });
  return set.kind === "ok" ? set : { kind: "failed", reason: `the PR body was not set: ${set.reason}` };
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
    return clone;
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

async function handOver(setup: WriterSetup, input: Input, reason: string): Promise<Result<WriterOut>> {
  if (input.change.kind !== "open") {
    return { kind: "failed", reason: `${reason}; and there is no open change to say so on` };
  }
  const outcome: Outcome = { kind: "blocked", reason, by: "host" };
  const head = input.change.line.head;
  const next = await finishRun({
    outcome,
    ending: CLEAN,
    change: input.change.line.number,
    forge: setup.forge,
    push: {
      ...setup.push,
      repo: setup.box.repo,
      branch: input.change.line.branch,
      commit: head,
      lease: { kind: "sha", sha: head },
      protectedBranches: [],
      guards: [],
    },
  });
  return next.kind === "ok"
    ? { kind: "ok", value: { head, outcome: "blocked", patch: "", evidence: [], hung: false } }
    : next;
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
  return p.kind === "ok" ? inClone(setup, input, p.value, plan.work) : p;
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
