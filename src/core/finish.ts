// finish — what the host does after a writer run, from its outcome (#109; ADR-0012 S3, S13). The writer has no forge
// login; the host pushes and posts for it, as the project's identity (#108), and every post goes through the template
// (#126).
//
//   done     push the writer's commits; post the evidence; next: the ready check re-runs the evidence rows
//   asked    push; post the questions in one "[writer] OPEN: …" note, which poll counts as one open ask (one note, so a
//            retry after a failure never posts a question twice); next: wait for a person
//   blocked  label needs-human first, so nothing hands the change out again; push the work in progress, but only on top
//            of the branch (a run stopped in a rebase never rewrites it); post the reason, in the writer's seat when
//            the writer said it; next: a person
// A push that fails turns done or asked into blocked, with the push's reason. The run's files are never pushed: the
// push refuses when any new commit adds, changes or removes a path under .factory, in any letter case. excludeFactory
// keeps the folder out of `git add` in the first place.
//
// finishRun keeps no record of its own: the dispatcher (#103) calls it once per run end and keeps the per-head record.

import type { Done, Result } from "./forge/api.js";
import type { Forge } from "./forge/types.js";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hostGit } from "./git.js";
import type { Post } from "./post.js";
import { hostPush, type Guard, type GuardInput, type PushRequest } from "./push.js";
import type { Evidence, Outcome } from "./report.js";

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
  readonly pusher?: Pusher;
};

function git(env: NodeJS.ProcessEnv, repo: string, args: readonly string[]): ReturnType<typeof hostGit> {
  return hostGit({ args, repo: { kind: "repo", path: repo }, env, ownHelper: { kind: "none" }, stdin: { kind: "none" } });
}

function gitProblem(what: string, result: Awaited<ReturnType<typeof hostGit>>): Done {
  return { kind: "failed", reason: `${what}: ${result.kind === "refused" ? result.reason : result.kind === "failed" ? result.stderr.trim() : ""}` };
}

// the commits the push adds: after the lease, or, for a new branch, those on no remote branch
function newCommits(input: GuardInput): readonly string[] {
  return input.lease.kind === "sha" ? [`${input.lease.sha}..${input.commit}`] : [input.commit, "--not", "--remotes"];
}

// noFactoryFolder : refuses when any commit the push adds touches .factory (as a folder or a file, in any letter case),
// so a report committed and then deleted still never leaves.
export function noFactoryFolder(env: NodeJS.ProcessEnv): Guard {
  return async (input) => {
    const listed = await git(env, input.repo, ["log", "--format=%H", "--name-only", ...newCommits(input), "--", ":(icase).factory"]);
    if (listed.kind !== "ok") {
      return gitProblem(`cannot list the commits of ${input.commit.slice(0, 8)}`, listed);
    }
    return listed.stdout.trim() === "" ? { kind: "ok" } : { kind: "failed", reason: "a commit touches .factory: the run's report and files are never pushed" };
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
    return checked.kind === "failed" && checked.exitCode === 1 ? { kind: "failed", reason: "the run rewrote the branch's history" } : gitProblem("cannot compare the commits", checked);
  };
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

// pushed : the writer's commits on the branch. Work in progress (a blocked run) only ever goes on top of the branch.
async function pushed(input: FinishInput, mode: "any" | "on-top"): Promise<Done> {
  if (unchanged(input.push)) {
    return { kind: "ok" };
  }
  const env = input.push.env;
  const ours = mode === "on-top" ? [noFactoryFolder(env), fastForwardOnly(env)] : [noFactoryFolder(env)];
  return (input.pusher ?? hostPush)({ ...input.push, guards: [...ours, ...input.push.guards] });
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
  const said = await post(input, { seat: block.by === "writer" ? "writer" : "coordinator", title: `blocked: ${why}`, fields: [], items: [] });
  return said.kind === "ok" ? { kind: "ok", value: { kind: "needs-human", reason: why } } : said;
}

async function done(input: FinishInput, evidence: readonly Evidence[]): Promise<Result<Next>> {
  const head = input.push.commit;
  const items = evidence.map((e) => `${e.criterion} · ${e.command} · ${e.result}`);
  const said = await post(input, { seat: "writer", title: `done at ${short(head)}`, fields: [], items });
  return said.kind === "ok" ? { kind: "ok", value: { kind: "ready-check", head, evidence } } : said;
}

async function asked(input: FinishInput, questions: readonly string[]): Promise<Result<Next>> {
  const [only] = questions;
  const ask: Post = questions.length === 1 && only !== undefined
    ? { seat: "writer", title: `OPEN: ${only}`, fields: [], items: [] }
    : { seat: "writer", title: `OPEN: ${questions.length} questions`, fields: [], items: questions };
  const said = await post(input, ask);
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
  return outcome.kind === "done" ? done(input, outcome.evidence) : asked(input, outcome.questions);
}
