// finish — what the host does after a writer run, from its outcome (#109; ADR-0012 S3, S13). The writer has no forge
// login; the host pushes and posts for it, as the project's identity (#108), and every post goes through the template
// (#126).
//
//   done     push the writer's commits; post the evidence; next: the ready check re-runs the evidence rows
//   asked    push; post each question as "[writer] OPEN: …", which poll counts as an open ask; next: wait for a person
//   blocked  label needs-human first, so nothing hands the change out again; push the work in progress; post the
//            reason; next: a person
// A push that fails turns done or asked into blocked, with the push's reason. The report itself is never pushed: the
// push refuses a commit whose tree holds .factory/.
//
// finishRun keeps no record of its own: the dispatcher (#103) calls it once per run end and keeps the per-head record.

import type { Done, Result } from "./forge/api.js";
import type { Forge } from "./forge/types.js";
import { hostGit } from "./git.js";
import type { Post } from "./post.js";
import { hostPush, type Guard, type PushRequest } from "./push.js";
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

// noFactoryFolder : refuses a commit whose tree holds .factory/, so the report and the writer's run files never leave.
export function noFactoryFolder(env: NodeJS.ProcessEnv): Guard {
  return async (input) => {
    const listed = await hostGit({ args: ["ls-tree", "--name-only", input.commit, "--", ".factory"], repo: { kind: "repo", path: input.repo }, env, ownHelper: { kind: "none" }, stdin: { kind: "none" } });
    if (listed.kind !== "ok") {
      return { kind: "failed", reason: `cannot list ${input.commit.slice(0, 8)}: ${listed.kind === "refused" ? listed.reason : listed.stderr.trim()}` };
    }
    return listed.stdout.trim() === "" ? { kind: "ok" } : { kind: "failed", reason: "the commit holds .factory/: the run's report and files are never pushed" };
  };
}

function short(sha: string): string {
  return sha.slice(0, 8);
}

// nothing new: the writer made no commit on top of the branch it started from
function unchanged(push: PushRequest): boolean {
  return push.lease.kind === "sha" && push.lease.sha === push.commit;
}

async function pushed(input: FinishInput): Promise<Done> {
  if (unchanged(input.push)) {
    return { kind: "ok" };
  }
  const request = { ...input.push, guards: [noFactoryFolder(input.push.env), ...input.push.guards] };
  return (input.pusher ?? hostPush)(request);
}

async function post(input: FinishInput, post: Post): Promise<Done> {
  return input.forge.note({ number: input.change, post });
}

async function blocked(input: FinishInput, reason: string, pushFirst: boolean): Promise<Result<Next>> {
  const label = await input.forge.addLabel({ number: input.change, label: NEEDS_HUMAN });
  if (label.kind === "failed") {
    return label;
  }
  const wip = pushFirst ? await pushed(input) : ({ kind: "ok" } as const);
  const why = wip.kind === "ok" ? reason : `${reason}; the work in progress was not pushed: ${wip.reason}`;
  const said = await post(input, { seat: "coordinator", title: `blocked: ${why}`, fields: [], items: [] });
  return said.kind === "ok" ? { kind: "ok", value: { kind: "needs-human", reason: why } } : said;
}

async function done(input: FinishInput, evidence: readonly Evidence[]): Promise<Result<Next>> {
  const head = input.push.commit;
  const items = evidence.map((e) => `${e.criterion} · ${e.command} · ${e.result}`);
  const said = await post(input, { seat: "writer", title: `done at ${short(head)}`, fields: [], items });
  return said.kind === "ok" ? { kind: "ok", value: { kind: "ready-check", head, evidence } } : said;
}

async function asked(input: FinishInput, questions: readonly string[]): Promise<Result<Next>> {
  for (const question of questions) {
    const said = await post(input, { seat: "writer", title: `OPEN: ${question}`, fields: [], items: [] });
    if (said.kind === "failed") {
      return said;
    }
  }
  return { kind: "ok", value: { kind: "wait-for-answer", head: input.push.commit } };
}

// finishRun : push and post for one run end; the result says what comes next, or why the forge could not be told.
export async function finishRun(input: FinishInput): Promise<Result<Next>> {
  const { outcome } = input;
  if (outcome.kind === "blocked") {
    return blocked(input, outcome.reason, true);
  }
  const sent = await pushed(input);
  if (sent.kind === "failed") {
    return blocked(input, `the push failed: ${sent.reason}`, false);
  }
  return outcome.kind === "done" ? done(input, outcome.evidence) : asked(input, outcome.questions);
}
