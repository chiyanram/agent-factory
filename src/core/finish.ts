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
// On a ticket's first run there is no change yet: finishFirst pushes first, opens the change (#164), then finishes.

import type { Done, Result } from "./forge/api.js";
import type { Forge } from "./forge/types.js";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hostGit } from "./git.js";
import { agentTrailer, commitKind } from "./notes.js";
import type { Post, PostField, Seat } from "./post.js";
import { noAgentSettings } from "./agent-settings.js";
import { noCiFiles, type CiSetup } from "./ci-files.js";
import { hostPush, newCommits, type Guard, type PushRequest } from "./push.js";
import { hungLine, type Ending, type Evidence, type Outcome } from "./report.js";

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

async function done(input: FinishInput, evidence: readonly Evidence[]): Promise<Result<Next>> {
  const head = input.push.commit;
  const items = evidence.map((e) => `${e.criterion} · ${e.command} · ${e.result}`);
  const said = await post(input, {
    seat: "writer",
    title: `done at ${short(head)}`,
    fields: runFields(input.ending),
    items,
  });
  return said.kind === "ok" ? { kind: "ok", value: { kind: "ready-check", head, evidence } } : said;
}

async function asked(input: FinishInput, questions: readonly string[]): Promise<Result<Next>> {
  const [only] = questions;
  const ask: Post =
    questions.length === 1 && only !== undefined
      ? { seat: "writer", title: `OPEN: ${only}`, fields: runFields(input.ending), items: [] }
      : {
          seat: "writer",
          title: `OPEN: ${questions.length} questions`,
          fields: runFields(input.ending),
          items: questions,
        };
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
