// finish — what the host does after a writer run, from its outcome (#109; ADR-0012 S3, S13). The writer has no forge
// login; the host pushes and posts for it, as the project's identity (#108), and every post goes through the template
// (#126).
//
//   done     push the writer's commits; post the evidence, then the build's deviations from the design in one
//            "[writer] DEVIATION: …" note (ADR-0018, #430; none when there are none); next: the ready check re-runs the
//            evidence rows
//   asked    push; post the questions in one "[writer] OPEN: …" note, which poll counts as one open ask (one note, so a
//            retry after a failure never posts a question twice); next: wait for a person. By default the note is one
//            numbered round: every question, its lettered choices with the recommended one marked, and how to answer
//            ("1A 2B", or "accept all"). With the project's questions setting at one-at-a-time it holds only the first;
//            the next run, after the answer, asks again whatever is still open (#320).
//   blocked  label needs-human first, so nothing hands the change out again; push the work in progress, but only on top
//            of the branch (a run stopped in a rebase never rewrites it); post the reason, in the writer's seat when
//            the writer said it; next: a person
// A push that fails turns done or asked into blocked, with the push's reason. The run's files are never pushed: the
// push refuses when any new commit adds, changes or removes a path under .factory, in any letter case. excludeFactory
// keeps the folder out of `git add` in the first place.
//
// finishRun keeps no record of its own: the dispatcher (#103) calls it once per run end and keeps the per-head record.
// On a ticket's first run there is no change yet: finishFirst pushes first, opens the change (#164), then finishes.

import type { Done, Result } from "./forge/api.js";
import type { Forge } from "./forge/types.js";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hostGit } from "./git.js";
import { agentTrailer, commitKind } from "./notes.js";
import { cleanField, DEFAULT_FIELD_LIMIT, renderPost, type Post, type PostField, type Seat } from "./post.js";
import { roundIn, type Asked } from "./answers.js";
import { noAgentSettings } from "./agent-settings.js";
import { noCiFiles, type CiSetup } from "./ci-files.js";
import type { Questions } from "./settings/variables.js";
import { hostPush, newCommits, type Guard, type PushRequest } from "./push.js";
import {
  DEVIATION,
  hungLine,
  type Deviation,
  type Ending,
  type Evidence,
  type Outcome,
  type Question,
} from "./report.js";

export const NEEDS_HUMAN = "needs-human";

export type Next =
  | { readonly kind: "ready-check"; readonly head: string; readonly evidence: readonly Evidence[] }
  | { readonly kind: "wait-for-answer"; readonly head: string }
  | { readonly kind: "needs-human"; readonly reason: string };

export type Pusher = (request: PushRequest) => Promise<Done>;

export type FinishInput = {
  readonly outcome: Outcome;
  // the change the run worked on
  readonly change: number;
  readonly forge: Forge;
  // the push of the writer's head: commit is the worktree's HEAD after the run, lease the branch before it
  readonly push: PushRequest;
  // how the run ended: on its own, or stopped after its completion window (#182); a hung run's post says so
  readonly ending: Ending;
  readonly pusher?: Pusher;
  // the project's questions setting; unset: round
  readonly questions?: Questions;
};

function git(env: NodeJS.ProcessEnv, repo: string, args: readonly string[]): ReturnType<typeof hostGit> {
  return hostGit({
    args,
    repo: { kind: "repo", path: repo },
    env,
    stdin: { kind: "none" },
  });
}

function gitProblem(what: string, result: Awaited<ReturnType<typeof hostGit>>): Done {
  return {
    kind: "failed",
    reason: `${what}: ${result.kind === "refused" ? result.reason : result.kind === "failed" ? result.stderr.trim() : ""}`,
  };
}

// noFactoryFolder : refuses when any commit the push adds touches .factory (as a folder or a file, in any letter case),
// so a report committed and then deleted still never leaves.
export function noFactoryFolder(env: NodeJS.ProcessEnv): Guard {
  return async (input) => {
    // a merge's own changes count too (first parent), and replace refs never stand in for the commits sent
    const listed = await git({ ...env, GIT_NO_REPLACE_OBJECTS: "1" }, input.repo, [
      "log",
      "--format=%H",
      "--name-only",
      "--diff-merges=first-parent",
      ...newCommits(input),
      "--",
      ":(icase).factory",
    ]);
    if (listed.kind !== "ok") {
      return gitProblem(`cannot list the commits of ${input.commit.slice(0, 8)}`, listed);
    }
    return listed.stdout.trim() === ""
      ? { kind: "ok" }
      : { kind: "failed", reason: "a commit touches .factory: the run's report and files are never pushed" };
  };
}

// fastForwardOnly : refuses a push that would rewrite the branch: the lease must be an ancestor of the commit.
export function fastForwardOnly(env: NodeJS.ProcessEnv): Guard {
  return async (input) => {
    if (input.lease.kind === "absent") {
      return { kind: "ok" };
    }
    const checked = await git(env, input.repo, ["merge-base", "--is-ancestor", input.lease.sha, input.commit]);
    if (checked.kind === "ok") {
      return { kind: "ok" };
    }
    return checked.kind === "failed" && checked.exitCode === 1
      ? { kind: "failed", reason: "the run rewrote the branch's history" }
      : gitProblem("cannot compare the commits", checked);
  };
}

// seatOnEvery : refuses when a commit on the branch's own line since `since` lacks the seat's "Agent:" trailer, read as
// git reads trailers (#128). The first-parent line leaves out the commits a merge brings in, which are people's work.
export function seatOnEvery(env: NodeJS.ProcessEnv, request: { readonly since: string; readonly seat: Seat }): Guard {
  return async (input) => {
    const plain = { ...env, GIT_NO_REPLACE_OBJECTS: "1" };
    const listed = await git(plain, input.repo, ["rev-list", "--first-parent", `${request.since}..${input.commit}`]);
    if (listed.kind !== "ok") {
      return gitProblem(`cannot list the commits of ${short(input.commit)}`, listed);
    }
    for (const sha of listed.stdout.split("\n").filter((line) => line !== "")) {
      const read = await git(plain, input.repo, ["log", "-1", "--format=%B", sha]);
      if (read.kind !== "ok") {
        return gitProblem(`cannot read commit ${short(sha)}`, read);
      }
      if (!carries(read.stdout, request.seat)) {
        const trailer = agentTrailer({ seat: request.seat });
        return {
          kind: "failed",
          reason: `commit ${short(sha)} has no "${trailer}" trailer: every commit of the ${request.seat} carries it`,
        };
      }
    }
    return { kind: "ok" };
  };
}

// carries : the message's trailer names this seat. Pure.
function carries(message: string, seat: Seat): boolean {
  const kind = commitKind({ message });
  return kind.kind === "agent" && kind.seat === seat;
}

// excludeFactory : adds /.factory/ to the clone's shared info/exclude once, so `git add -A` in any worktree leaves the
// run's files out. Call it when the clone is set up for runs.
export async function excludeFactory(input: { readonly repo: string; readonly env: NodeJS.ProcessEnv }): Promise<Done> {
  const common = await git(input.env, input.repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.kind !== "ok") {
    return gitProblem("cannot find the clone's git folder", common);
  }
  return excludeIn(join(common.stdout.trim(), "info", "exclude"));
}

// excludeIn : the /.factory/ line in an exclude file, added once
async function excludeIn(file: string): Promise<Done> {
  try {
    const now = await readFile(file, "utf8").catch(() => "");
    if (now.split("\n").some((line) => line.trim() === "/.factory/")) {
      return { kind: "ok" };
    }
    await mkdir(dirname(file), { recursive: true });
    const gap = now === "" || now.endsWith("\n") ? "" : "\n";
    await appendFile(file, `${gap}/.factory/\n`);
    return { kind: "ok" };
  } catch {
    return { kind: "failed", reason: `cannot write ${file}` };
  }
}

function short(sha: string): string {
  return sha.slice(0, 8);
}

// nothing new: the writer made no commit on top of the branch it started from
function unchanged(push: PushRequest): boolean {
  return push.lease.kind === "sha" && push.lease.sha === push.commit;
}

export type Sending = Pick<FinishInput, "forge" | "push" | "pusher">;

// ciSetup : what the CI-file guard compares against: the default branch, and the CI file the project runs
async function ciSetup(input: Sending): Promise<Result<CiSetup>> {
  const branch = await input.forge.defaultBranch();
  const config = branch.kind === "ok" ? await input.forge.ciConfig() : branch;
  return branch.kind === "ok" && config.kind === "ok"
    ? { kind: "ok", value: { env: input.push.env, defaultBranch: branch.value, config: config.value } }
    : {
        kind: "failed",
        reason: `cannot tell which CI files to guard, so nothing is pushed: ${config.kind === "failed" ? config.reason : ""}`,
      };
}

// pushed : the writer's commits on the branch. Work in progress (a blocked run) only ever goes on top of the branch.
async function pushed(input: Sending, mode: "any" | "on-top"): Promise<Done> {
  if (unchanged(input.push)) {
    return { kind: "ok" };
  }
  const env = input.push.env;
  const ci = await ciSetup(input);
  if (ci.kind === "failed") {
    return ci;
  }
  const always = [noFactoryFolder(env), noCiFiles(ci.value), noAgentSettings(ci.value)];
  const ours = mode === "on-top" ? [...always, fastForwardOnly(env)] : always;
  return (input.pusher ?? hostPush)({ ...input.push, guards: [...ours, ...input.push.guards] });
}

// pushOnTop : work in progress pushed only on top of the branch, with every guard a blocked run's push has; reconcile
// lands what a dead run left behind this way (#189)
export function pushOnTop(input: Sending): Promise<Done> {
  return pushed(input, "on-top");
}

// runFields : a hung run's one field, so a person sees a writer that does not exit (#182); none for a clean end
function runFields(ending: Ending): readonly PostField[] {
  return ending.kind === "hung" ? [{ label: "run", value: hungLine(ending) }] : [];
}

// runItems : a stalled run's last output lines, so a person sees where it stopped (#228); each one is cleaned as an
// item of the post
function runItems(ending: Ending): readonly string[] {
  return ending.kind === "stalled" ? ending.last : [];
}

async function post(input: FinishInput, post: Post): Promise<Done> {
  return input.forge.note({ number: input.change, post });
}

type Block = { readonly reason: string; readonly by: "writer" | "host"; readonly pushFirst: boolean };

async function blocked(input: FinishInput, block: Block): Promise<Result<Next>> {
  const label = await input.forge.addLabel({ number: input.change, label: NEEDS_HUMAN });
  if (label.kind === "failed") {
    return label;
  }
  const wip = block.pushFirst ? await pushed(input, "on-top") : ({ kind: "ok" } as const);
  const why = wip.kind === "ok" ? block.reason : `${block.reason}; the work in progress was not pushed: ${wip.reason}`;
  // the writer's own words stay in the writer's seat; what the host decided is the coordinator's
  const said = await post(input, {
    seat: block.by === "writer" ? "writer" : "coordinator",
    title: `blocked: ${why}`,
    fields: runFields(input.ending),
    items: runItems(input.ending),
  });
  return said.kind === "ok" ? { kind: "ok", value: { kind: "needs-human", reason: why } } : said;
}

// deviationPost : the build's deviations from the design, one item each, where and why. Pure.
export function deviationPost(head: string, deviations: readonly Deviation[]): Post {
  return {
    seat: "writer",
    title: `${DEVIATION} ${deviations.length} change(s) from the approved design at ${short(head)}`,
    fields: [],
    items: deviations.map((d) => `${d.file}:${d.line} · ${d.what} · why: ${d.why}`),
  };
}

// deviated : the deviation note, when the run gave any
async function deviated(input: FinishInput, deviations: readonly Deviation[]): Promise<Done> {
  return deviations.length === 0 ? { kind: "ok" } : post(input, deviationPost(input.push.commit, deviations));
}

async function done(input: FinishInput, outcome: Extract<Outcome, { kind: "done" }>): Promise<Result<Next>> {
  const head = input.push.commit;
  const { evidence } = outcome;
  const items = evidence.map((e) => `${e.criterion} · ${e.command} · ${e.result}`);
  const said = await post(input, {
    seat: "writer",
    title: `done at ${short(head)}`,
    fields: runFields(input.ending),
    items,
  });
  const noted = said.kind === "ok" ? await deviated(input, outcome.deviations ?? []) : said;
  return noted.kind === "ok" ? { kind: "ok", value: { kind: "ready-check", head, evidence } } : noted;
}

const LETTERS = "ABCD";

// asking : one question, numbered, with its lettered choices and the recommended one marked. Pure.
function asking(q: Question, i: number): string {
  if (q.kind === "plain") {
    return `${i + 1}. ${q.question} (no choices: answer in words)`;
  }
  const choices = q.choices.map((c, j) => `${LETTERS[j]}) ${c}${j === q.recommended ? " (recommended)" : ""}`);
  return `${i + 1}. ${q.question} ${choices.join(" · ")}`;
}

// howToAnswer : what a person replies, for the questions posted. Pure.
function howToAnswer(questions: readonly Question[]): string {
  const lettered = questions.some((q) => q.kind === "choices");
  return lettered
    ? 'reply with a letter per question, such as "1A 2B", or "accept all" to take every recommended choice; a question with no choices takes words'
    : 'reply in words, each answer after its number, such as "1: EUR"';
}

// waitingFields : with one-at-a-time, how many questions wait for a later run. Pure.
function waitingFields(waiting: number): readonly PostField[] {
  return waiting > 0
    ? [
        {
          label: "next",
          value: `${waiting} more question(s) wait: once this one is answered, the next run asks again what is still open`,
        },
      ]
    : [];
}

function counted(n: number): string {
  return n === 1 ? "1 question" : `${n} questions`;
}

// questionRound : a numbered round of questions as one OPEN note's title, how to answer, and its items, the one form
// answers.ts reads back, for the writer's round here and the coordinator's (loop.ts grill, #517). Pure.
export function questionRound(questions: readonly Question[]): {
  readonly title: string;
  readonly answer: PostField;
  readonly items: readonly string[];
} {
  return {
    title: `OPEN: ${counted(questions.length)}`,
    answer: { label: "answer", value: howToAnswer(questions) },
    items: questions.map(asking),
  };
}

// roundReadsBack : "" when the round, once rendered, reads back as written: the same questions, choices and recommended
// one. renderPost cuts each item at its limit, and a " · " or " A) " inside a text splits it, so a question that
// checks can still post damaged; the problem, naming the question, otherwise (#517). Pure.
export function roundReadsBack(questions: readonly Question[]): string {
  const round = questionRound(questions);
  const text = renderPost({ seat: "coordinator", title: round.title, fields: [round.answer], items: round.items });
  if (text.kind === "refused") {
    return text.reason;
  }
  const back = roundIn(text.text);
  const bad = questions.findIndex((q, i) => !readsBack(q, back.asked[i]));
  return back.malformed === "" && bad < 0
    ? ""
    : `question ${bad + 1} would not read back as written once posted: each question with its choices is cut at ${DEFAULT_FIELD_LIMIT} characters, and " · " or " A) " inside a text splits it; shorten or reword it`;
}

// readsBack : whether one question read back from the posted round is the one written. Pure.
function readsBack(q: Question, back: Asked | undefined): boolean {
  return back !== undefined && q.kind === "choices" && sameWords(back.text, q.question) && sameChoices(q, back);
}

// sameWords : whether a text read back is the text written, as the template made it inert
function sameWords(back: string, written: string): boolean {
  return back === cleanField(written, Number.POSITIVE_INFINITY);
}

// sameChoices : whether a question's choices and recommended one read back as written
function sameChoices(q: Extract<Question, { kind: "choices" }>, back: Asked): boolean {
  return (
    back.recommended === q.recommended &&
    back.choices.length === q.choices.length &&
    back.choices.every((c, j) => sameWords(c, q.choices[j] ?? ""))
  );
}

// askPost : the one OPEN note: every question as a numbered round, or with one-at-a-time only the first, saying how
// many wait. One plain question keeps its old form, the question as the title. Pure.
function askPost(input: FinishInput, questions: readonly Question[]): Post {
  const posted = input.questions === "one-at-a-time" ? questions.slice(0, 1) : questions;
  const run = runFields(input.ending);
  const waiting = waitingFields(questions.length - posted.length);
  const [only] = posted;
  if (posted.length === 1 && only?.kind === "plain") {
    return { seat: "writer", title: `OPEN: ${only.question}`, fields: [...run, ...waiting], items: [] };
  }
  const round = questionRound(posted);
  return { seat: "writer", title: round.title, fields: [...run, round.answer, ...waiting], items: round.items };
}

async function asked(input: FinishInput, questions: readonly Question[]): Promise<Result<Next>> {
  const said = await post(input, askPost(input, questions));
  return said.kind === "ok" ? { kind: "ok", value: { kind: "wait-for-answer", head: input.push.commit } } : said;
}

// finishRun : push and post for one run end; the result says what comes next, or why the forge could not be told.
export async function finishRun(input: FinishInput): Promise<Result<Next>> {
  const { outcome } = input;
  if (outcome.kind === "blocked") {
    return blocked(input, { reason: outcome.reason, by: outcome.by, pushFirst: true });
  }
  const sent = await pushed(input, "any");
  if (sent.kind === "failed") {
    return blocked(input, { reason: `the push failed: ${sent.reason}`, by: "host", pushFirst: false });
  }
  return outcome.kind === "done" ? done(input, outcome) : asked(input, outcome.questions);
}

// finishFirst : a ticket's first run: push the new branch with every guard, open its change, then finish on it. A push
// or an open that fails is the host's failure: there is no change yet to post it on.
export async function finishFirst(
  input: Omit<FinishInput, "change"> & { readonly open: () => Promise<Result<number>> },
): Promise<Result<{ readonly change: number; readonly next: Next }>> {
  const sent = await pushed(input, "any");
  if (sent.kind === "failed") {
    return { kind: "failed", reason: `the first push failed: ${sent.reason}` };
  }
  const change = await input.open();
  if (change.kind === "failed") {
    return { kind: "failed", reason: `pushed, but the change did not open: ${change.reason}` };
  }
  // the branch is now at the commit: finishRun has nothing more to push, only to post
  const next = await finishRun({
    ...input,
    change: change.value,
    push: { ...input.push, lease: { kind: "sha", sha: input.push.commit } },
  });
  return next.kind === "ok" ? { kind: "ok", value: { change: change.value, next: next.value } } : next;
}
