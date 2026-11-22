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
//            the next run, after the answer, asks again whatever is still open (#320). The note is first rendered and
//            read back as answers.ts reads it; a question it would not hold as written (cut at the field limit, or
//            split by a " · " or " A) " in its text) is never posted as OPEN: the run ends blocked instead, with the
//            questions as written listed in the blocked note (#522)
//   parked   the provider's usage limit refused the run: push the work in progress on top of the branch, as a
//            blocked run's, with no label and no note; the dispatcher records the park and sends its one notice. A
//            push that fails goes to a person, as a blocked run does
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
import { cleanField, DEFAULT_FIELD_LIMIT, flatText, renderPost, type Post, type PostField, type Seat } from "./post.js";
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
  | { readonly kind: "needs-human"; readonly reason: string }
  | { readonly kind: "parked"; readonly head: string; readonly until: string; readonly said: string };

export type Pusher = (request: PushRequest) => Promise<Done>;

export type FinishInput = {
  readonly outcome: Outcome;
  readonly change: number;
  readonly forge: Forge;
  readonly push: PushRequest;
  readonly ending: Ending;
  readonly pusher?: Pusher;
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

export function noFactoryFolder(env: NodeJS.ProcessEnv): Guard {
  return async (input) => {
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

function carries(message: string, seat: Seat): boolean {
  const kind = commitKind({ message });
  return kind.kind === "agent" && kind.seat === seat;
}

export async function excludeFactory(input: { readonly repo: string; readonly env: NodeJS.ProcessEnv }): Promise<Done> {
  const common = await git(input.env, input.repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.kind !== "ok") {
    return gitProblem("cannot find the clone's git folder", common);
  }
  return excludeIn(join(common.stdout.trim(), "info", "exclude"));
}

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

function unchanged(push: PushRequest): boolean {
  return push.lease.kind === "sha" && push.lease.sha === push.commit;
}

export type Sending = Pick<FinishInput, "forge" | "push" | "pusher">;

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

export function pushOnTop(input: Sending): Promise<Done> {
  return pushed(input, "on-top");
}

function runFields(ending: Ending): readonly PostField[] {
  return ending.kind === "hung" ? [{ label: "run", value: hungLine(ending) }] : [];
}

function runItems(ending: Ending): readonly string[] {
  return ending.kind === "stalled" ? ending.last : [];
}

async function post(input: FinishInput, note: Post): Promise<Done> {
  return input.forge.note({ number: input.change, post: note });
}

type Block = {
  readonly reason: string;
  readonly by: "writer" | "host";
  readonly pushFirst: boolean;
  readonly items?: readonly string[];
};

async function blocked(input: FinishInput, block: Block): Promise<Result<Next>> {
  const label = await input.forge.addLabel({ number: input.change, label: NEEDS_HUMAN });
  if (label.kind === "failed") {
    return label;
  }
  const wip = block.pushFirst ? await pushed(input, "on-top") : ({ kind: "ok" } as const);
  const why = wip.kind === "ok" ? block.reason : `${block.reason}; the work in progress was not pushed: ${wip.reason}`;
  const said = await post(input, {
    seat: block.by === "writer" ? "writer" : "coordinator",
    title: `blocked: ${why}`,
    fields: runFields(input.ending),
    items: [...(block.items ?? []), ...runItems(input.ending)],
  });
  return said.kind === "ok" ? { kind: "ok", value: { kind: "needs-human", reason: why } } : said;
}

export function deviationPost(head: string, deviations: readonly Deviation[]): Post {
  return {
    seat: "writer",
    title: `${DEVIATION} ${deviations.length} change(s) from the approved design at ${short(head)}`,
    fields: [],
    items: deviations.map((d) => `${d.file}:${d.line} · ${d.what} · why: ${d.why}`),
  };
}

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

function asking(q: Question, i: number): string {
  const choices = q.choices.map((c, j) => `${LETTERS[j]}) ${c}${j === q.recommended ? " (recommended)" : ""}`);
  return `${i + 1}. ${q.question} ${choices.join(" · ")}`;
}

const HOW_TO_ANSWER =
  'reply with a letter per question, such as "1A 2B", or "accept all" to take every recommended choice';

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

export function questionRound(questions: readonly Question[]): {
  readonly title: string;
  readonly answer: PostField;
  readonly items: readonly string[];
} {
  return {
    title: `OPEN: ${counted(questions.length)}`,
    answer: { label: "answer", value: HOW_TO_ANSWER },
    items: questions.map(asking),
  };
}

export function readsBackAs(note: Post, questions: readonly Question[]): string {
  const text = renderPost(note);
  if (text.kind === "refused") {
    return text.reason;
  }
  const back = roundIn(text.text);
  const bad = questions.findIndex((q, i) => !readsBack(q, back.asked[i]));
  return back.malformed === "" && bad < 0
    ? ""
    : `question ${bad + 1} would not read back as written once posted: each question with its choices is cut at ${DEFAULT_FIELD_LIMIT} characters, and " · " or " A) " inside a text splits it; shorten or reword it`;
}

function readsBack(q: Question, back: Asked | undefined): boolean {
  if (back === undefined || !sameWords(back.text, q.question)) {
    return false;
  }
  return sameChoices(q, back);
}

function sameWords(back: string, written: string): boolean {
  return back === cleanField(`x ${flatText(written)}`, Number.POSITIVE_INFINITY).slice(2);
}

function sameChoices(q: Extract<Question, { kind: "choices" }>, back: Asked): boolean {
  return (
    back.recommended === q.recommended &&
    back.choices.length === q.choices.length &&
    back.choices.every((c, j) => sameWords(c, q.choices[j] ?? ""))
  );
}

function askPost(input: FinishInput, posted: readonly Question[], waiting: number): Post {
  const run = runFields(input.ending);
  const next = waitingFields(waiting);
  const round = questionRound(posted);
  return { seat: "writer", title: round.title, fields: [...run, round.answer, ...next], items: round.items };
}

async function asked(input: FinishInput, questions: readonly Question[]): Promise<Result<Next>> {
  const posted = input.questions === "one-at-a-time" ? questions.slice(0, 1) : questions;
  const ask = askPost(input, posted, questions.length - posted.length);
  const back = readsBackAs(ask, posted);
  if (back !== "") {
    return blocked(input, { reason: back, by: "host", pushFirst: false, items: posted.map(asking) });
  }
  const said = await post(input, ask);
  return said.kind === "ok" ? { kind: "ok", value: { kind: "wait-for-answer", head: input.push.commit } } : said;
}

async function parked(input: FinishInput, outcome: Extract<Outcome, { kind: "parked" }>): Promise<Result<Next>> {
  const wip = await pushed(input, "on-top");
  if (wip.kind === "failed") {
    const reason = `the provider's usage limit stopped the run; its work in progress was not pushed: ${wip.reason}`;
    return blocked(input, { reason, by: "host", pushFirst: false });
  }
  return { kind: "ok", value: { kind: "parked", head: input.push.commit, until: outcome.until, said: outcome.said } };
}

export async function finishRun(input: FinishInput): Promise<Result<Next>> {
  const { outcome } = input;
  if (outcome.kind === "blocked") {
    return blocked(input, { reason: outcome.reason, by: outcome.by, pushFirst: true });
  }
  if (outcome.kind === "parked") {
    return parked(input, outcome);
  }
  const sent = await pushed(input, "any");
  if (sent.kind === "failed") {
    return blocked(input, { reason: `the push failed: ${sent.reason}`, by: "host", pushFirst: false });
  }
  return outcome.kind === "done" ? done(input, outcome) : asked(input, outcome.questions);
}

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
  const next = await finishRun({
    ...input,
    change: change.value,
    push: { ...input.push, lease: { kind: "sha", sha: input.push.commit } },
  });
  return next.kind === "ok" ? { kind: "ok", value: { change: change.value, next: next.value } } : next;
}
