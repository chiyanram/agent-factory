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
// takes its instructions from the cleanup role card (process/cards.ts) and the implementer's evidence rows as its task,
// with the default branch fetched in to diff against; what it defers goes in the PR body, and its card's hash in the
// run record.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { goAhead, type GoAhead } from "../start.js";
import type { LaneProps } from "../lane.js";
import type { BoxToken } from "../token/rules.js";
import type { Task } from "../dispatch/records.js";
import { BRANCH_PREFIX, type RunInput, type Steps } from "../dispatch/tick.js";
import { fastForwardOnly, finishFirst, finishRun, seatOnEvery, type Next, type Pusher } from "../finish.js";
import type { Done, Result } from "../forge/api.js";
import type { Forge, ForgeName } from "../forge/types.js";
import type { Identity } from "../identity.js";
import type { PushRequest } from "../push.js";
import { CLEAN, REPORT_INSTRUCTIONS, type Evidence, type Outcome } from "../report.js";
import type { Approver, Spec } from "../spec.js";
import type { Post } from "../post.js";
import type { BoxSetup } from "../ready/boxrun.js";
import { readKept, recordsDirOf } from "../kept.js";
import { makeClone, removeClone, SETTINGS_FILE, type Clone, type Start, type FileText } from "./clone.js";
import { readTools, settingsOf, TARGET_REF, toolLines } from "./tools.js";
import { knownFor, type Known } from "../onboard/known.js";
import type { Spend } from "../dispatch/spend.js";
import { writerRun, type Ended } from "./run.js";
import { ciText, taskText, verifyText } from "./task.js";
import { VERIFY_FILE } from "../ready/steps.js";
import type { WriterSettings } from "./settings.js";
import { readCard, type Card } from "../process/cards.js";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "prompts");
// named in words: a "#171" on the project's forge would be read as the project's own issue

export type Prompts = {
  readonly fix: string;
  readonly testFirst: string;
  readonly rework: string;
  readonly ci: string;
  readonly merge: string;
};

// the modes this step runs, each with its prompt; cleanup's comes from its role card (#236)
export type RunMode = "test-first" | "fix" | "rework" | "ci" | "merge";
const PROMPT_FILES = {
  fix: "writer.md",
  testFirst: "writer-test-first.md",
  rework: "writer-rework.md",
  ci: "writer-ci.md",
  merge: "writer-merge.md",
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
  // the project's lanes (#232); the default lanes when absent
  readonly lanes?: readonly LaneProps[];
};

type Input = RunInput & { readonly task: Task };
export type WriterOut = {
  readonly head: string;
  readonly outcome: "done" | "asked" | "blocked";
  readonly patch: string;
  readonly evidence: readonly Evidence[];
  // the writer hung after its report and the host stopped it after the completion window (#182)
  readonly hung: boolean;
  // what the run spent (#131); none when the host started no run, or the run printed no result event
  readonly spend?: Spend;
  // the role card's hash, for a run started from one (#236)
  readonly card?: string;
  // what a cleanup run left for a person, as each would change behaviour (#236)
  readonly deferred?: readonly string[];
  // each cite of the project's brief that went stale, or why the run went without it (#235)
  readonly stale?: readonly string[];
};

// readPrompts : the package's writer prompts
export async function readPrompts(): Promise<Result<Prompts>> {
  try {
    const read = (file: string) => readFile(join(PROMPTS, file), "utf8");
    const [fix, testFirst, rework, ci, merge] = await Promise.all([
      read(PROMPT_FILES.fix),
      read(PROMPT_FILES.testFirst),
      read(PROMPT_FILES.rework),
      read(PROMPT_FILES.ci),
      read(PROMPT_FILES.merge),
    ]);
    return { kind: "ok", value: { fix, testFirst, rework, ci, merge } };
  } catch {
    return { kind: "failed", reason: `cannot read the writer prompts in ${PROMPTS}` };
  }
}

const TEMPLATE: Readonly<Record<RunMode, keyof Prompts>> = {
  "test-first": "testFirst",
  fix: "fix",
  rework: "rework",
  ci: "ci",
  merge: "merge",
};

// the project's own instructions: claude loads none of the branch's files (--setting-sources user, #110), so the writer
// reads them as it reads the code
// every mode's run ends when the model stops: a subagent or command left in the background is lost, or holds the
// process open (#192; the completion window, #182, is the net behind it)
export const FOREGROUND =
  "Run every subagent and command in the foreground and wait for it to finish. This run ends when you stop, so anything left in the background is lost.";

export const PROJECT_INSTRUCTIONS = [
  "This project's instructions are not loaded for you. Before you change anything, read AGENTS.md and CLAUDE.md at the",
  "root, and the AGENTS.md or CLAUDE.md of each folder you change, and follow them. The project's skills are in",
  ".claude/skills and .agents/skills: read the one that fits a task before you do it. Never change these files, or",
  ".claude and .agents: the push refuses a commit that does.",
].join("\n");

// promptFor : the mode's prompt with the run's names, the foreground rule, the project's instructions and tools, then the
// report's schema. Pure.
export function promptFor(input: {
  readonly prompts: Prompts;
  readonly mode: RunMode;
  readonly ticket: string;
  readonly branch: string;
  readonly head: string;
  // what the prompt says of the project's quick tools (tools.ts)
  readonly tools: readonly string[];
  // the project's default branch, which a merge run merges in
  readonly base?: string;
}): string {
  const template = input.prompts[TEMPLATE[input.mode]];
  const filled = template
    .replaceAll("{{ticket}}", input.ticket)
    .replaceAll("{{branch}}", input.branch)
    .replaceAll("{{head}}", input.head)
    .replaceAll("{{base}}", input.base ?? "");
  const tools = input.tools.length === 0 ? "" : `\n\n${input.tools.join("\n")}`;
  return `${filled.trimEnd()}\n\n${FOREGROUND}\n\n${PROJECT_INSTRUCTIONS}${tools}\n\n${REPORT_INSTRUCTIONS}\n`;
}

// CLEANUP_REPORT : the words a cleanup run's prompt adds to the report's schema (#236)
export const CLEANUP_REPORT =
  'A cleanup run\'s "done" report may add "deferred": a list of each cleanup you did not make because it would change behaviour, each with why. It goes in the PR body for a person.';

// cardPrompt : a run's prompt from its role card: the card's body, the foreground rule, the project's instructions and
// tools, then the report's schema. Pure.
export function cardPrompt(card: Card, tools: readonly string[]): string {
  const listed = tools.length === 0 ? "" : `\n\n${tools.join("\n")}`;
  return `${card.body}\n\n${FOREGROUND}\n\n${PROJECT_INSTRUCTIONS}${listed}\n\n${REPORT_INSTRUCTIONS}\n${CLEANUP_REPORT}\n`;
}

// deferredOf : a done report's deferred list, as a field to spread
function deferredOf(outcome: Outcome): { readonly deferred?: readonly string[] } {
  return outcome.kind === "done" && outcome.deferred !== undefined ? { deferred: outcome.deferred } : {};
}

// outOf : what the dispatcher records, from what the host did with the run. Pure.
export function outOf(ended: Ended, next: Next): WriterOut {
  const base = {
    head: ended.tip,
    patch: ended.patch,
    hung: ended.ending.kind === "hung",
    ...(ended.spend === "unmeasured" ? {} : { spend: ended.spend }),
    ...deferredOf(ended.outcome),
  };
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

// goFor : what lets the build begin: an approval, or a START in the tiny lane (#227)
async function goFor(setup: WriterSetup, ticket: string): Promise<Result<Extract<GoAhead, { kind: "go" }>>> {
  const go = await goAhead({ home: setup.home, project: setup.project, ticket, lanes: setup.lanes });
  if (go.kind === "go") {
    return { kind: "ok", value: go };
  }
  return {
    kind: "failed",
    reason: `nothing a human said lets ${ticket} build: ${go.kind === "held" ? go.why : go.reason}`,
  };
}

// prepare : the approved spec, the default branch, where the run starts, and the box's model login
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
    // test-first and fix only add commits: no run of theirs rewrites the branch (a rebase run would, #171); each one
    // carries the writer's seat, which the clone's hook adds (#128)
    guards: [fastForwardOnly(setup.push.env), seatOnEvery(setup.push.env, { since: clone.start, seat: "writer" })],
  };
}

// bodyOf : the change's body: it names the approved spec, never its text (#164), and lists what a cleanup run deferred
// (#236). Pure.
export function bodyOf(p: Pick<Prepared, "spec" | "approver">, deferred: readonly string[] = []): Post {
  return {
    seat: "coordinator",
    // the spec's first line is "# <ticket>: <title>", so its title already names the ticket
    title: p.spec.title,
    fields: [
      { label: "spec", value: p.spec.hash },
      { label: p.approver.said ?? "approved", value: `locally by ${p.approver.by} at ${p.approver.at}` },
    ],
    items: deferred.map((d) => `deferred by the cleanup run: ${d}`),
  };
}

// openFor : the first run's draft change, claimed
function openFor(setup: WriterSetup, p: Prepared, branch: string): () => Promise<Result<number>> {
  return async () => {
    const { title } = p.spec;
    const opened = await setup.forge.openChange({ branch, base: p.base, title, body: bodyOf(p) });
    if (opened.kind === "failed") {
      return opened;
    }
    const claimed = await setup.forge.addLabel({ number: opened.value, label: setup.label });
    return claimed.kind === "ok" ? opened : claimed;
  };
}

// onChange : a later run's push and post on its open change; a cleanup run's deferred list then goes in the PR body
async function onChange(
  setup: WriterSetup,
  input: Input,
  p: Prepared,
  run: { readonly push: PushRequest; readonly ended: Ended; readonly number: number },
): Promise<Result<WriterOut>> {
  const { ended, number } = run;
  const next = await finishRun({
    outcome: ended.outcome,
    ending: ended.ending,
    change: number,
    forge: setup.forge,
    push: run.push,
    pusher: setup.pusher,
  });
  if (next.kind === "failed") {
    return next;
  }
  const shown = await deferredShown(setup, input, p, number, ended.outcome);
  return shown.kind === "ok" ? { kind: "ok", value: outOf(ended, next.value) } : shown;
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
    return onChange(setup, input, p, { push, ended, number: input.change.line.number });
  }
  if (ended.tip === clone.start) {
    // nothing to push and no change to post on: the record says the run changed nothing, and a person looks
    return {
      kind: "ok",
      value: { head: ended.tip, outcome: outcome.kind, patch: "", evidence: [], hung: ended.ending.kind === "hung" },
    };
  }
  const first = await finishFirst({
    outcome,
    ending: ended.ending,
    forge: setup.forge,
    push,
    pusher: setup.pusher,
    open: openFor(setup, p, clone.branch),
  });
  return first.kind === "ok" ? { kind: "ok", value: outOf(ended, first.value.next) } : first;
}

// deferredShown : a cleanup run that ended done puts what it deferred, or nothing, in the PR body (#236)
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
  const set = await setup.forge.setBody({ number, post: bodyOf(p, outcome.deferred) });
  return set.kind === "ok" ? set : { kind: "failed", reason: `the PR body was not set: ${set.reason}` };
}

// what one run does: its prompt's mode, and the task the host hands it; a cleanup run's prompt is its role card
type Work = { readonly mode: RunMode; readonly task: FileText; readonly card?: Card };

// mergeOf : the default branch a merge run merges in, or a cleanup run diffs against, which the clone fetches in, as a
// field to spread
function mergeOf(work: Work, base: string): { readonly merge?: string } {
  return work.mode === "merge" || work.card !== undefined ? { merge: base } : {};
}

// promptOf : the mode's prompt, or the role card's for a run started from one
function promptOf(
  setup: WriterSetup,
  run: {
    readonly input: Input;
    readonly p: Prepared;
    readonly work: Work;
    readonly clone: Clone;
    readonly tools: readonly string[];
  },
): string {
  const { work } = run;
  return work.card === undefined
    ? promptFor({
        prompts: setup.prompts,
        mode: work.mode,
        ticket: run.input.ticket,
        branch: run.clone.branch,
        head: run.clone.start,
        tools: run.tools,
        base: run.p.base,
      })
    : cardPrompt(work.card, run.tools);
}

// withCard : a run from a role card records the card's hash (#236)
function withCard(result: Result<WriterOut>, work: Work): Result<WriterOut> {
  return result.kind === "ok" && work.card !== undefined
    ? { kind: "ok", value: { ...result.value, card: work.card.sha256 } }
    : result;
}

// KNOWLEDGE : what the prompt says of the project's accepted brief and glossary, when the run has them (#235)
export const KNOWLEDGE =
  "Read .factory/brief.md and .factory/glossary.md first: the project's commands, modules and gotchas, and its terms, accepted by a human. Use the build, test and run commands the brief names, and the glossary's words.";

// knowledgeOf : the accepted brief and glossary as clone files, as a field to spread
function knowledgeOf(known: Known): Pick<Parameters<typeof makeClone>[1], "knowledge"> {
  return known.files.kind === "text" ? { knowledge: { brief: known.files.brief, glossary: known.files.glossary } } : {};
}

// knowledgeLines : what the prompt says of the brief and glossary, when the run has them
function knowledgeLines(known: Known): readonly string[] {
  return known.files.kind === "text" ? [KNOWLEDGE] : [];
}

// withStale : each stale cite of the brief goes into the run record, for the retro (#235)
function withStale(result: Result<WriterOut>, known: Known): Result<WriterOut> {
  return result.kind === "ok" && known.stale.length > 0
    ? { kind: "ok", value: { ...result.value, stale: known.stale } }
    : result;
}

async function inClone(setup: WriterSetup, input: Input, p: Prepared, work: Work): Promise<Result<WriterOut>> {
  const tools = await readTools({ repo: setup.box.repo, env: setup.box.env, base: p.base });
  const settings = settingsOf(tools);
  const known = await knownFor({
    home: setup.home,
    project: setup.project,
    repo: setup.box.repo,
    env: setup.box.env,
    ref: TARGET_REF,
  });
  const clone = await makeClone(setup.box, {
    start: p.start,
    spec: p.spec.text,
    plugins: setup.settings.plugins,
    task: work.task,
    settings,
    ...mergeOf(work, p.base),
    ...knowledgeOf(known),
  });
  if (clone.kind === "failed") {
    return clone;
  }
  const prompt = promptOf(setup, {
    input,
    p,
    work,
    clone: clone.value,
    tools: [...knowledgeLines(known), ...toolLines(tools)],
  });
  const ended = await writerRun({
    setup: setup.box,
    clone: clone.value,
    prompt,
    login: p.login,
    timeoutSeconds: setup.settings.timeoutSeconds,
    claude: setup.settings.claude,
    settings: settings.kind === "text" ? { kind: "file", path: SETTINGS_FILE } : { kind: "none" },
    plugins: setup.settings.plugins.length,
    completion: setup.settings.completion,
    stallMs: setup.settings.stallMs,
  });
  const result = ended.kind === "ok" ? await finished(setup, input, p, clone.value, ended.value) : ended;
  const out = withStale(withCard(result, work), known);
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
    ending: CLEAN,
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
  return next.kind === "ok"
    ? { kind: "ok", value: { head, outcome: "blocked", patch: "", evidence: [], hung: false } }
    : next;
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

// mergePlan : a merge run for a conflict: no task file, the default branch fetched into the clone (inClone)
function mergePlan(_setup: WriterSetup, input: Input): Promise<Planned> {
  return Promise.resolve(
    input.change.kind === "open"
      ? { kind: "run", work: { mode: "merge", task: { kind: "none" } } }
      : { kind: "hand-over", reason: "a merge run needs an open change" },
  );
}

// cleanupText : the implementer's evidence rows, which the cleanup run runs again, and the branch it diffs against
export function cleanupText(evidence: readonly Evidence[], base: string): string {
  const rows = evidence.map((e) => `- ${e.criterion}: \`${e.command}\` gave: ${e.result}`);
  return [
    "# Cleanup",
    "",
    `The branch's own lines are its diff against origin/${base}: \`git diff origin/${base}...HEAD\`.`,
    "",
    "The implementer's evidence rows. Run each again after your cleanup; each must give the same result, and your report's evidence is these rows, run again:",
    "",
    ...rows,
    "",
  ].join("\n");
}

// cleanupPlan : the cleanup role card and the evidence rows a cleanup run gets, or why a person takes it (#236)
async function cleanupPlan(
  setup: WriterSetup,
  input: Input,
  task: Extract<Task, { readonly kind: "cleanup" }>,
): Promise<Planned> {
  if (input.change.kind !== "open") {
    return { kind: "hand-over", reason: "a cleanup run needs an open change" };
  }
  // the project's plugins, in order (#232): the process plugin among them holds the cleanup card
  const plugins = setup.settings.plugins.map((dir) => ({ label: dir, dir }));
  const card = await readCard(plugins, "cleanup");
  if (card.kind === "failed") {
    return { kind: "hand-over", reason: `the cleanup run has no role card: ${card.reason}` };
  }
  const base = await setup.forge.defaultBranch();
  return base.kind === "ok"
    ? {
        kind: "run",
        // the card replaces the mode's prompt (inClone); the mode only names the run's shape: a plain run on the branch
        work: { mode: "fix", task: { kind: "text", text: cleanupText(task.evidence, base.value) }, card: card.value },
      }
    : { kind: "hand-over", reason: `the cleanup run has no default branch to diff against: ${base.reason}` };
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
  conflict: mergePlan,
  cleanup: cleanupPlan,
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
