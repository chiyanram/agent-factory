// step — the writer as the dispatcher's step (#113 PR 2b; ADR-0012 S3, S5, S13). One run:
//   1 the ticket's approved spec, the start (the change's branch at its head, or the default branch on a first run),
//     and the box's model login
//   2 the writer's clone (clone.ts), the run in a fresh box (run.ts), the outcome from its report
//   3 the host pushes and posts (finish.ts): on a first run it pushes, opens the draft change (#164) and claims it
//   4 the run folder goes, however the run ended
// It runs test-first and fix. A rework or CI run needs forge context the writer cannot read; until #171 the host
// says so on the change, labelled needs-human (decided on #30, 2026-11-08).

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { approvalState } from "../approval.js";
import type { BoxToken } from "../token/rules.js";
import type { WriterMode } from "../dispatch/records.js";
import { BRANCH_PREFIX, type RunInput, type Steps } from "../dispatch/tick.js";
import { fastForwardOnly, finishFirst, finishRun, type Next, type Pusher } from "../finish.js";
import type { Result } from "../forge/api.js";
import type { Forge, ForgeName } from "../forge/types.js";
import type { Identity } from "../identity.js";
import type { PushRequest } from "../push.js";
import { REPORT_INSTRUCTIONS, type Evidence, type Outcome } from "../report.js";
import type { Spec } from "../spec.js";
import type { BoxSetup } from "../ready/boxrun.js";
import { makeClone, removeClone, type Clone, type Start } from "./clone.js";
import { writerRun, type Ended } from "./run.js";
import type { WriterSettings } from "./settings.js";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "prompts");
// named in words: a "#171" on the project's forge would be read as the project's own issue
export const LATER_TICKET = "agent-factory issue 171";

export type Prompts = { readonly fix: string; readonly testFirst: string };

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

type Input = RunInput & { readonly mode: WriterMode };
export type WriterOut = {
  readonly head: string;
  readonly outcome: "done" | "asked" | "blocked";
  readonly patch: string;
  readonly evidence: readonly Evidence[];
};

// readPrompts : the package's writer prompts
export async function readPrompts(): Promise<Result<Prompts>> {
  try {
    const [fix, testFirst] = await Promise.all(
      ["writer.md", "writer-test-first.md"].map((f) => readFile(join(PROMPTS, f), "utf8")),
    );
    return fix === undefined || testFirst === undefined
      ? { kind: "failed", reason: "the writer prompts are missing" }
      : { kind: "ok", value: { fix, testFirst } };
  } catch {
    return { kind: "failed", reason: `cannot read the writer prompts in ${PROMPTS}` };
  }
}

// promptFor : the mode's prompt with the run's names, then the report's schema. Pure.
export function promptFor(input: {
  readonly prompts: Prompts;
  readonly mode: "test-first" | "fix";
  readonly ticket: string;
  readonly branch: string;
  readonly head: string;
}): string {
  const template = input.mode === "test-first" ? input.prompts.testFirst : input.prompts.fix;
  const filled = template
    .replaceAll("{{ticket}}", input.ticket)
    .replaceAll("{{branch}}", input.branch)
    .replaceAll("{{head}}", input.head);
  return `${filled.trimEnd()}\n\n${REPORT_INSTRUCTIONS}\n`;
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
    // test-first and fix only add commits: no run of theirs rewrites the branch (a rebase run would, #171)
    guards: [fastForwardOnly(setup.push.env)],
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

async function inClone(
  setup: WriterSetup,
  input: Input & { readonly mode: "test-first" | "fix" },
  p: Prepared,
): Promise<Result<WriterOut>> {
  const clone = await makeClone(setup.box, { start: p.start, spec: p.spec.text, rulebook: setup.settings.rulebook });
  if (clone.kind === "failed") {
    return clone;
  }
  const prompt = promptFor({
    prompts: setup.prompts,
    mode: input.mode,
    ticket: input.ticket,
    branch: clone.value.branch,
    head: clone.value.start,
  });
  const ended = await writerRun({
    setup: setup.box,
    clone: clone.value,
    prompt,
    login: p.login,
    timeoutSeconds: setup.settings.timeoutSeconds,
    claude: setup.settings.claude,
  });
  const out = ended.kind === "ok" ? await finished(setup, input, p, clone.value, ended.value) : ended;
  const removed = await removeClone(clone.value.dir);
  return removed.kind === "ok" ? out : removed;
}

// later : a mode this step does not run yet; the host says so on the change, labelled needs-human
async function later(setup: WriterSetup, input: Input): Promise<Result<WriterOut>> {
  if (input.change.kind !== "open") {
    return { kind: "failed", reason: `a ${input.mode} run needs an open change` };
  }
  const outcome: Outcome = {
    kind: "blocked",
    reason: `the writer's ${input.mode} run is not built yet (${LATER_TICKET}); a person takes it`,
    by: "host",
  };
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

async function runOne(setup: WriterSetup, input: Input): Promise<Result<WriterOut>> {
  const { mode } = input;
  if (mode !== "test-first" && mode !== "fix") {
    return later(setup, input);
  }
  const p = await prepare(setup, input);
  return p.kind === "ok" ? inClone(setup, { ...input, mode }, p.value) : p;
}

// writerStep : the dispatcher's writer, or why it cannot run here
export function writerStep(setup: Result<WriterSetup>): Steps["writer"] {
  return setup.kind === "ok"
    ? { kind: "available", run: (input) => runOne(setup.value, input) }
    : { kind: "unavailable", reason: setup.reason };
}
