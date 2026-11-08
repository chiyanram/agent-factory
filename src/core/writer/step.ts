// step — the writer as the dispatcher's step (#113 PR 2b; ADR-0012 S3, S5, S13). One run:
//   1 the ticket's approved spec, the start (the change's branch at its head, or the default branch on a first run),
//     and the box's model login
//   2 the writer's clone (clone.ts), the run in a fresh box (run.ts), the outcome from its report
//   3 the host pushes and posts (finish.ts): on a first run it pushes, opens the draft change (#164) and claims it
//   4 the run folder goes, however the run ended
// It runs test-first, fix, rework and CI (#171). A rework or CI run gets its task in .factory/task.md (task.ts): the
// failed evidence row, the factory's own Act on findings, or the failed CI jobs and their logs' ends. A task the host
// cannot read goes to a person: the host says why on the change, labelled needs-human.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { approvalState } from "../approval.js";
import type { BoxToken } from "../token/rules.js";
import type { Task } from "../dispatch/records.js";
import { BRANCH_PREFIX, type RunInput, type Steps } from "../dispatch/tick.js";
import { fastForwardOnly, finishFirst, finishRun, seatOnEvery, type Next, type Pusher } from "../finish.js";
import type { Result } from "../forge/api.js";
import type { Forge, ForgeName } from "../forge/types.js";
import type { Identity } from "../identity.js";
import type { PushRequest } from "../push.js";
import { REPORT_INSTRUCTIONS, type Evidence, type Outcome } from "../report.js";
import type { Spec } from "../spec.js";
import type { BoxSetup } from "../ready/boxrun.js";
import { readKept, recordsDirOf } from "../kept.js";
import { makeClone, removeClone, SETTINGS_FILE, type Clone, type Start, type FileText } from "./clone.js";
import { readTools, settingsOf, toolLines } from "./tools.js";
import { writerRun, type Ended } from "./run.js";
import { ciText, taskText, verifyText } from "./task.js";
import { VERIFY_FILE } from "../ready/steps.js";
import type { WriterSettings } from "./settings.js";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "prompts");
// named in words: a "#171" on the project's forge would be read as the project's own issue

export type Prompts = {
  readonly fix: string;
  readonly testFirst: string;
  readonly rework: string;
  readonly ci: string;
};

// the modes this step runs, each with its prompt
export type RunMode = "test-first" | "fix" | "rework" | "ci";
const PROMPT_FILES = {
  fix: "writer.md",
  testFirst: "writer-test-first.md",
  rework: "writer-rework.md",
  ci: "writer-ci.md",
};

// where the host pushes to, and as whom (#108)
export type PushTarget = {
  readonly forge: ForgeName;
  readonly host: string;
  // owner/name on GitHub, the full path on GitLab (FACTORY_PROJECT)
  readonly project: string;
  readonly identity: Identity;
  readonly env: NodeJS.ProcessEnv;
};

export type WriterSetup = {
  readonly box: BoxSetup;
  readonly settings: WriterSettings;
  readonly prompts: Prompts;
  readonly forge: Forge;
  readonly push: PushTarget;
  readonly home: string;
  // the factory's project name: the approvals and specs folder
  readonly project: string;
  // the claim label the new change gets
  readonly label: string;
  readonly login: () => Promise<BoxToken>;
  // the host push: hostPush; a test passes its own
  readonly pusher: Pusher;
};

type Input = RunInput & { readonly task: Task };
export type WriterOut = {
  readonly head: string;
  readonly outcome: "done" | "asked" | "blocked";
  readonly patch: string;
  readonly evidence: readonly Evidence[];
};

// readPrompts : the package's writer prompts
export async function readPrompts(): Promise<Result<Prompts>> {
  try {
    const read = (file: string) => readFile(join(PROMPTS, file), "utf8");
    const [fix, testFirst, rework, ci] = await Promise.all([
      read(PROMPT_FILES.fix),
      read(PROMPT_FILES.testFirst),
      read(PROMPT_FILES.rework),
      read(PROMPT_FILES.ci),
    ]);
    return { kind: "ok", value: { fix, testFirst, rework, ci } };
  } catch {
    return { kind: "failed", reason: `cannot read the writer prompts in ${PROMPTS}` };
  }
}

const TEMPLATE: Readonly<Record<RunMode, keyof Prompts>> = {
  "test-first": "testFirst",
  fix: "fix",
  rework: "rework",
  ci: "ci",
};

// the project's own instructions: claude loads none of the branch's files (--setting-sources user, #110), so the writer
// reads them as it reads the code
export const PROJECT_INSTRUCTIONS = [
  "This project's instructions are not loaded for you. Before you change anything, read AGENTS.md and CLAUDE.md at the",
  "root, and the AGENTS.md or CLAUDE.md of each folder you change, and follow them. The project's skills are in",
  ".claude/skills and .agents/skills: read the one that fits a task before you do it. Never change these files, or",
  ".claude and .agents: the push refuses a commit that does.",
].join("\n");

// promptFor : the mode's prompt with the run's names, the project's instructions and tools, then the report's schema.
// Pure.
export function promptFor(input: {
  readonly prompts: Prompts;
  readonly mode: RunMode;
  readonly ticket: string;
  readonly branch: string;
  readonly head: string;
  // what the prompt says of the project's quick tools (tools.ts)
  readonly tools: readonly string[];
}): string {
  const template = input.prompts[TEMPLATE[input.mode]];
  const filled = template
    .replaceAll("{{ticket}}", input.ticket)
    .replaceAll("{{branch}}", input.branch)
    .replaceAll("{{head}}", input.head);
  const tools = input.tools.length === 0 ? "" : `\n\n${input.tools.join("\n")}`;
  return `${filled.trimEnd()}\n\n${PROJECT_INSTRUCTIONS}${tools}\n\n${REPORT_INSTRUCTIONS}\n`;
}

// outOf : what the dispatcher records, from what the host did with the run. Pure.
export function outOf(ended: Ended, next: Next): WriterOut {
  const base = { head: ended.tip, patch: ended.patch };
  switch (next.kind) {
    case "ready-check":
      return { ...base, outcome: "done", evidence: next.evidence };
    case "wait-for-answer":
      return { ...base, outcome: "asked", evidence: [] };
    case "needs-human":
      return { ...base, outcome: "blocked", evidence: [] };
  }
}

type Prepared = {
  readonly spec: Spec;
  readonly approver: { readonly by: string; readonly at: string };
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

// prepare : the approved spec, the default branch, where the run starts, and the box's model login
async function prepare(setup: WriterSetup, input: Input): Promise<Result<Prepared>> {
  const approval = await approvalState({ home: setup.home, project: setup.project, ticket: input.ticket });
  if (approval.kind !== "approved") {
    return { kind: "failed", reason: `the spec of ${input.ticket} is not approved (${approval.kind})` };
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
  const { spec, record } = approval;
  return login.kind === "ok"
    ? {
        kind: "ok",
        value: {
          spec,
          approver: { by: record.by, at: record.at },
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
    // test-first and fix only add commits: no run of theirs rewrites the branch (a rebase run would, #171); each one
    // carries the writer's seat, which the clone's hook adds (#128)
    guards: [fastForwardOnly(setup.push.env), seatOnEvery(setup.push.env, { since: clone.start, seat: "writer" })],
  };
}

// openFor : the first run's draft change, claimed; its body names the approved spec, never its text (#164)
function openFor(setup: WriterSetup, p: Prepared, branch: string): () => Promise<Result<number>> {
  return async () => {
    // the spec's first line is "# <ticket>: <title>", so its title already names the ticket
    const { title } = p.spec;
    const opened = await setup.forge.openChange({
      branch,
      base: p.base,
      title,
      body: {
        seat: "coordinator",
        title,
        fields: [
          { label: "spec", value: p.spec.hash },
          { label: "approved", value: `locally by ${p.approver.by} at ${p.approver.at}` },
        ],
        items: [],
      },
    });
    if (opened.kind === "failed") {
      return opened;
    }
    const claimed = await setup.forge.addLabel({ number: opened.value, label: setup.label });
    return claimed.kind === "ok" ? opened : claimed;
  };
}

// finished : the host's push and post for the run, and what the dispatcher records
async function finished(
  setup: WriterSetup,
  input: Input,
  p: Prepared,
  clone: Clone,
  ended: Ended,
): Promise<Result<WriterOut>> {
  const push = pushOf(setup, p, clone, ended.tip);
  const { outcome } = ended;
  if (input.change.kind === "open") {
    const next = await finishRun({
      outcome,
      change: input.change.line.number,
      forge: setup.forge,
      push,
      pusher: setup.pusher,
    });
    return next.kind === "ok" ? { kind: "ok", value: outOf(ended, next.value) } : next;
  }
  if (ended.tip === clone.start) {
    // nothing to push and no change to post on: the record says the run changed nothing, and a person looks
    return { kind: "ok", value: { head: ended.tip, outcome: outcome.kind, patch: "", evidence: [] } };
  }
  const first = await finishFirst({
    outcome,
    forge: setup.forge,
    push,
    pusher: setup.pusher,
    open: openFor(setup, p, clone.branch),
  });
  return first.kind === "ok" ? { kind: "ok", value: outOf(ended, first.value.next) } : first;
}

// what one run does: its prompt's mode, and the task the host hands it
type Work = { readonly mode: RunMode; readonly task: FileText };

async function inClone(setup: WriterSetup, input: Input, p: Prepared, work: Work): Promise<Result<WriterOut>> {
  const tools = await readTools({ repo: setup.box.repo, env: setup.box.env, base: p.base });
  const settings = settingsOf(tools);
  const clone = await makeClone(setup.box, {
    start: p.start,
    spec: p.spec.text,
    rulebook: setup.settings.rulebook,
    task: work.task,
    settings,
  });
  if (clone.kind === "failed") {
    return clone;
  }
  const prompt = promptFor({
    prompts: setup.prompts,
    mode: work.mode,
    ticket: input.ticket,
    branch: clone.value.branch,
    head: clone.value.start,
    tools: toolLines(tools),
  });
  const ended = await writerRun({
    setup: setup.box,
    clone: clone.value,
    prompt,
    login: p.login,
    timeoutSeconds: setup.settings.timeoutSeconds,
    claude: setup.settings.claude,
    settings: settings.kind === "text" ? { kind: "file", path: SETTINGS_FILE } : { kind: "none" },
  });
  const out = ended.kind === "ok" ? await finished(setup, input, p, clone.value, ended.value) : ended;
  const removed = await removeClone(clone.value.dir);
  return removed.kind === "ok" ? out : removed;
}

// handOver : a run the host does not start; it says why on the change, labelled needs-human
async function handOver(setup: WriterSetup, input: Input, reason: string): Promise<Result<WriterOut>> {
  if (input.change.kind !== "open") {
    return { kind: "failed", reason: `${reason}; and there is no open change to say so on` };
  }
  const outcome: Outcome = { kind: "blocked", reason, by: "host" };
  const head = input.change.line.head;
  const next = await finishRun({
    outcome,
    change: input.change.line.number,
    forge: setup.forge,
    push: {
      ...setup.push,
      repo: setup.box.repo,
      branch: input.change.line.branch,
      // nothing new: the branch stays where it is
      commit: head,
      lease: { kind: "sha", sha: head },
      protectedBranches: [],
      guards: [],
    },
  });
  return next.kind === "ok" ? { kind: "ok", value: { head, outcome: "blocked", patch: "", evidence: [] } } : next;
}

type Planned = { readonly kind: "run"; readonly work: Work } | { readonly kind: "hand-over"; readonly reason: string };

// reworkPlan : the task a rework run gets, or why a person takes it
async function reworkPlan(
  setup: WriterSetup,
  input: Input,
  task: Extract<Task, { readonly kind: "ready-failed" | "act-on" }>,
): Promise<Planned> {
  if (input.change.kind !== "open") {
    return { kind: "hand-over", reason: "a rework run needs an open change" };
  }
  const text = await taskText(task, { recordsDir: recordsDirOf(setup.box.repo), change: input.change.line.number });
  return text.kind === "ok"
    ? { kind: "run", work: { mode: "rework", task: { kind: "text", text: text.value } } }
    : { kind: "hand-over", reason: `the rework run has no task: ${text.reason}; a person takes it` };
}

// ciPlan : the failed jobs a CI run gets, or why a person takes it
async function ciPlan(
  setup: WriterSetup,
  input: Input,
  task: Extract<Task, { readonly kind: "ci-red" }>,
): Promise<Planned> {
  if (input.change.kind !== "open") {
    return { kind: "hand-over", reason: "a CI run needs an open change" };
  }
  const jobs = await setup.forge.failedJobs({ number: input.change.line.number, head: task.head });
  if (jobs.kind === "failed") {
    return { kind: "hand-over", reason: `the CI run has no task: ${jobs.reason}; a person takes it` };
  }
  return jobs.value.length === 0
    ? { kind: "hand-over", reason: "CI is red, but the forge names no failed job at the head; a person takes it" }
    : { kind: "run", work: { mode: "ci", task: { kind: "text", text: ciText(jobs.value) } } };
}

// verifyPlan : the local verifier's kept output, for a CI run, or why a person takes it
async function verifyPlan(
  setup: WriterSetup,
  input: Input,
  task: Extract<Task, { readonly kind: "verify-failed" }>,
): Promise<Planned> {
  if (input.change.kind !== "open") {
    return { kind: "hand-over", reason: "a CI run needs an open change" };
  }
  const at = { recordsDir: recordsDirOf(setup.box.repo), change: input.change.line.number, head: task.head };
  const kept = await readKept(at, VERIFY_FILE);
  return kept.kind === "ok"
    ? { kind: "run", work: { mode: "ci", task: { kind: "text", text: verifyText(kept.value) } } }
    : { kind: "hand-over", reason: `the CI run has no task: ${kept.reason}; a person takes it` };
}

const plain = (mode: "test-first" | "fix"): Promise<Planned> =>
  Promise.resolve({ kind: "run", work: { mode, task: { kind: "none" } } });

// each task by its kind, so a planner per kind is typed without an assertion, and a new kind fails to compile here
type TaskMap = { readonly [T in Task as T["kind"]]: T };
type Planners = {
  readonly [K in keyof TaskMap]: (setup: WriterSetup, input: Input, task: TaskMap[K]) => Promise<Planned>;
};

const PLANNERS: Planners = {
  "test-first": () => plain("test-first"),
  fix: () => plain("fix"),
  "ready-failed": reworkPlan,
  "act-on": reworkPlan,
  "ci-red": ciPlan,
  "verify-failed": verifyPlan,
};

function planOn<K extends keyof TaskMap>(
  kind: K,
  setup: WriterSetup,
  input: Input,
  task: TaskMap[K],
): Promise<Planned> {
  return PLANNERS[kind](setup, input, task);
}

// planned : what this run does, from its task
function planned(setup: WriterSetup, input: Input): Promise<Planned> {
  return planOn(input.task.kind, setup, input, input.task);
}

async function runOne(setup: WriterSetup, input: Input): Promise<Result<WriterOut>> {
  const plan = await planned(setup, input);
  if (plan.kind === "hand-over") {
    return handOver(setup, input, plan.reason);
  }
  const p = await prepare(setup, input);
  return p.kind === "ok" ? inClone(setup, input, p.value, plan.work) : p;
}

// writerStep : the dispatcher's writer, or why it cannot run here
export function writerStep(setup: Result<WriterSetup>): Steps["writer"] {
  return setup.kind === "ok"
    ? { kind: "available", run: (input) => runOne(setup.value, input) }
    : { kind: "unavailable", reason: setup.reason };
}
