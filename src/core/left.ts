// left — what a dead writer run left behind, and its commits pushed on top of the change's branch as a blocked run's
// work in progress is (finish.ts pushOnTop). The dispatcher's hand-over of a run that never ended finds such work in
// the run folder its start line names. It never commits an uncommitted file nor deletes the folder: a person decides
// what becomes of them.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pushOnTop, type Pusher } from "./finish.js";
import type { Done, Result } from "./forge/api.js";
import type { Forge } from "./forge/types.js";
import { hostGit } from "./git.js";
import type { Post } from "./post.js";
import type { PushRequest } from "./push.js";
import type { PushTarget } from "./writer/step.js";

export type Left = { readonly head: string; readonly commits: readonly string[]; readonly files: readonly string[] };

export type Landing = { readonly target: Result<PushTarget>; readonly pusher: Pusher };

export type GitIn = (args: readonly string[]) => ReturnType<typeof hostGit>;

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function gitWhy(result: Awaited<ReturnType<typeof hostGit>>): string {
  if (result.kind === "refused") {
    return result.reason;
  }
  const last = result.stderr.trim().split("\n").at(-1) ?? "";
  return last === "" ? "git failed" : last;
}

function out(result: Awaited<ReturnType<typeof hostGit>>, what: string): Result<string> {
  return result.kind === "ok" ? { kind: "ok", value: result.stdout } : failed(`cannot ${what}: ${gitWhy(result)}`);
}

function textOf(r: Result<string>): string {
  return r.kind === "ok" ? r.value : "";
}

function leftOf(head: Result<string>, commits: Result<string>, files: Result<string>): Left {
  return {
    head: textOf(head).trim(),
    commits: textOf(commits)
      .split("\n")
      .filter((l) => l !== ""),
    files: textOf(files)
      .split("\0")
      .filter((e) => e.length > 3)
      .map((e) => e.slice(3)),
  };
}

async function leftIn(git: GitIn, not: readonly string[]): Promise<Result<Left>> {
  const head = out(await git(["rev-parse", "HEAD"]), "read its head");
  const commits = out(await git(["rev-list", "HEAD", "--not", ...not]), "list its commits");
  const files = out(
    await git(["status", "--porcelain", "--no-renames", "--untracked-files=all", "-z"]),
    "read its status",
  );
  const bad = [head, commits, files].find((r) => r.kind === "failed");
  return bad?.kind === "failed" ? bad : { kind: "ok", value: leftOf(head, commits, files) };
}

export function leftNote(left: Left, pushed: string): Pick<Post, "fields" | "items"> {
  return {
    fields: [
      { label: "unlanded commits", value: left.commits.map((c) => c.slice(0, 8)).join(", ") || "none" },
      { label: "push", value: pushed },
      { label: `uncommitted files, never committed by the hand-over`, value: String(left.files.length) },
    ],
    items: left.files.slice(0, 20),
  };
}

export type Onto = { readonly repo: string; readonly branch: string; readonly sha: string };

async function landed(input: Pushing, onto: Onto, left: Left, fits: () => Promise<Done>): Promise<string> {
  if (left.commits.length === 0 || left.head === onto.sha) {
    return "nothing to push";
  }
  const push = await requestFor(input, onto, left, fits);
  const done =
    push.kind === "ok" ? await pushOnTop({ forge: input.forge, pusher: input.landing.pusher, push: push.value }) : push;
  return done.kind === "ok" ? `pushed ${left.commits.length} on top of ${onto.branch}` : `not pushed: ${done.reason}`;
}

type Pushing = { readonly forge: Forge; readonly landing: Landing };

async function requestFor(
  input: Pushing,
  onto: Onto,
  left: Left,
  fits: () => Promise<Done>,
): Promise<Result<PushRequest>> {
  const { target } = input.landing;
  if (target.kind === "failed") {
    return target;
  }
  const fit = await fits();
  const base = fit.kind === "ok" ? await input.forge.defaultBranch() : fit;
  return base.kind === "ok"
    ? {
        kind: "ok",
        value: {
          ...target.value,
          repo: onto.repo,
          branch: onto.branch,
          commit: left.head,
          lease: { kind: "sha", sha: onto.sha },
          protectedBranches: [base.value],
          guards: [],
        },
      }
    : base;
}

export type KeptInput = {
  readonly folder: string;
  readonly since: string;
  readonly change: { readonly branch: string; readonly head: string } | "none";
};

export type KeptRun = Left & { readonly pushed: string };

function fromStart(input: KeptInput, head: string): () => Promise<Done> {
  return async () =>
    head === input.since
      ? { kind: "ok" }
      : failed(`the branch moved to ${head.slice(0, 8)} since the writer started; a person puts the two together`);
}

export function keepLeft(setup: {
  readonly env: NodeJS.ProcessEnv;
  readonly forge: Forge;
  readonly landing: Landing;
}): (input: KeptInput) => Promise<Result<KeptRun>> {
  return async (input) => {
    const repo = join(input.folder, "repo");
    const git: GitIn = (args) =>
      hostGit({
        args,
        repo: { kind: "repo", path: repo },
        env: { ...setup.env, GIT_CEILING_DIRECTORIES: input.folder },
        stdin: { kind: "none" },
      });
    if (!existsSync(join(repo, ".git"))) {
      return failed(`${input.folder} holds no clone: the run stopped before it was made, or its step removed it`);
    }
    const left = await leftIn(git, input.since === "" ? ["HEAD"] : [input.since]);
    if (left.kind === "failed") {
      return left;
    }
    const pushed =
      input.change === "none"
        ? "nothing pushed: no change is open"
        : await landed(
            setup,
            { repo, branch: input.change.branch, sha: input.change.head },
            left.value,
            fromStart(input, input.change.head),
          );
    return { kind: "ok", value: { ...left.value, pushed } };
  };
}
