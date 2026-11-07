// push — the host pushes the writer's branch after the writer exits, as the project's identity (#108; ADR-0012 S6, S14).
// The writer commits inside its box and has no forge login; only this host step reaches the forge.
//
// What it checks before anything is sent, each as a refusal:
//   - the branch is a plain branch name and none of the protected ones (the default branch)
//   - the commit and the lease are full SHAs, and the commit is in the clone
//   - the clone's own push URL names the project (an App's token goes to https://github.com/<owner/name> only)
//   - with an App: the repo's own config sets no credential helper. hostGit would put the operator's trusted helpers
//     back after the App's, and the push would go out as the developer, not the App.
//   - every guard the caller passes (the CI-file refusal, #115)
// Then one `git push --force-with-lease`, through hostGit: the remote branch must still be what the caller saw, so a
// human's push in between is never overwritten.
//
// The App's token reaches git only as the credential helper's answer for https://github.com, from an environment variable
// of that one git process; an empty credential.helper first drops every other helper, so no other login answers.

import { hostGit, type GitResult } from "./git.js";
import type { Identity } from "./identity.js";
import type { Done, Result } from "./forge/api.js";

export type Lease = { readonly kind: "sha"; readonly sha: string } | { readonly kind: "absent" };

export type GuardInput = { readonly repo: string; readonly commit: string; readonly lease: Lease };
export type Guard = (input: GuardInput) => Promise<Done>;

export type PushRequest = {
  // the clone or worktree that holds the commit
  readonly repo: string;
  readonly forge: "github" | "gitlab";
  // owner/name on GitHub, the full path on GitLab
  readonly project: string;
  readonly branch: string;
  readonly commit: string;
  // what the remote branch must be right now
  readonly lease: Lease;
  // branches never pushed to: the default branch at least
  readonly protectedBranches: readonly string[];
  readonly identity: Identity;
  readonly env: NodeJS.ProcessEnv;
  readonly guards: readonly Guard[];
};

const SHA = /^[0-9a-f]{40}$/;
const TOKEN_VARIABLE = "FACTORY_PUSH_TOKEN";
// git runs this helper with "get", "store" or "erase"; it answers only "get", from the variable above
const HELPER = `!f() { test "$1" = get && printf 'username=x-access-token\\npassword=%s\\n' "$${TOKEN_VARIABLE}"; }; f`;

// plainBranch : a branch name git accepts and no option or refspec can hide in.
export function plainBranch(branch: string): boolean {
  const shape = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch);
  const bad = /\.\.|\/\/|\/\.|@\{|\.lock$|\/$|\.$/.test(branch);
  return shape && !bad && branch !== "HEAD";
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// pushUrlFits : whether the clone's push URL is the project's. An App needs https to github.com exactly.
export function pushUrlFits(input: { readonly url: string; readonly project: string; readonly forge: "github" | "gitlab"; readonly app: boolean }): boolean {
  const project = escape(input.project);
  if (input.app) {
    return new RegExp(`^https://github\\.com/${project}(\\.git)?/?$`, "i").test(input.url);
  }
  const host = input.forge === "github" ? "github\\.com" : "[A-Za-z0-9.-]+(:\\d+)?";
  return new RegExp(`^(https://${host}/|ssh://git@${host}/|git@${host}:)${project}(\\.git)?/?$`, "i").test(input.url);
}

function failed(what: string, result: GitResult): Done {
  return { kind: "failed", reason: result.kind === "refused" ? result.reason : `${what}: ${result.stderr.trim().split("\n").slice(-2).join(" ")}` };
}

// pushEnv : the environment of the git push. With an App: every other helper dropped, the App's helper for github.com.
export function pushEnv(identity: Identity, env: NodeJS.ProcessEnv): Result<NodeJS.ProcessEnv> {
  if (identity.kind === "own") {
    return { kind: "ok", value: env };
  }
  const from = env.GIT_CONFIG_COUNT ?? "0";
  if (!/^\d+$/.test(from)) {
    return { kind: "failed", reason: `GIT_CONFIG_COUNT is not a whole number ('${from}')` };
  }
  const n = Number(from);
  return {
    kind: "ok",
    value: {
      ...env,
      GIT_CONFIG_COUNT: String(n + 2),
      [`GIT_CONFIG_KEY_${n}`]: "credential.helper",
      [`GIT_CONFIG_VALUE_${n}`]: "",
      [`GIT_CONFIG_KEY_${n + 1}`]: "credential.https://github.com.helper",
      [`GIT_CONFIG_VALUE_${n + 1}`]: HELPER,
      [TOKEN_VARIABLE]: identity.token,
    },
  };
}

function git(request: PushRequest, args: readonly string[], env: NodeJS.ProcessEnv = request.env): Promise<GitResult> {
  return hostGit({ args, repo: { kind: "repo", path: request.repo }, env, ownHelper: { kind: "none" }, stdin: { kind: "none" } });
}

function shapeProblem(request: PushRequest): string {
  if (!plainBranch(request.branch)) {
    return `refused: ${JSON.stringify(request.branch)} is not a plain branch name`;
  }
  if (request.protectedBranches.includes(request.branch)) {
    return `refused: ${request.branch} is protected; the factory never pushes to it`;
  }
  const leaseOk = request.lease.kind === "absent" || SHA.test(request.lease.sha);
  return SHA.test(request.commit) && leaseOk ? "" : "refused: the commit and the lease must be full SHAs";
}

// the URL the clone's own config pushes to: pushurl, else url
async function pushUrl(request: PushRequest): Promise<Result<string>> {
  for (const key of ["remote.origin.pushurl", "remote.origin.url"]) {
    const read = await git(request, ["config", "--get", key]);
    if (read.kind === "ok") {
      return { kind: "ok", value: read.stdout.trim() };
    }
    if (read.kind === "refused") {
      return { kind: "failed", reason: read.reason };
    }
  }
  return { kind: "failed", reason: "refused: the clone has no origin remote" };
}

async function placeChecks(request: PushRequest): Promise<Done> {
  const found = await git(request, ["rev-parse", "--verify", "--quiet", `${request.commit}^{commit}`]);
  if (found.kind !== "ok" || found.stdout.trim() !== request.commit) {
    return { kind: "failed", reason: found.kind === "refused" ? found.reason : `refused: ${request.commit} is not a commit in ${request.repo}` };
  }
  const url = await pushUrl(request);
  if (url.kind === "failed") {
    return url;
  }
  const app = request.identity.kind === "app";
  return pushUrlFits({ url: url.value, project: request.project, forge: request.forge, app })
    ? { kind: "ok" }
    : { kind: "failed", reason: `refused: the clone pushes to ${url.value}, which is not ${request.project}${app ? " over https://github.com" : ""}` };
}

// repoHelpers : refuses, with an App, a credential helper the repo's own config sets.
async function repoHelpers(request: PushRequest): Promise<Done> {
  if (request.identity.kind === "own") {
    return { kind: "ok" };
  }
  const listed = await git(request, ["config", "--show-scope", "--name-only", "--get-regexp", "^credential\\..*helper$"]);
  if (listed.kind === "refused" || (listed.kind === "failed" && listed.exitCode !== 1)) {
    return failed("cannot list the repo's credential helpers", listed);
  }
  const own = listed.stdout.split("\n").filter((line) => /^(local|worktree)\t/.test(line));
  return own.length === 0
    ? { kind: "ok" }
    : { kind: "failed", reason: `refused: the repo's own config sets ${own.map((l) => l.split("\t")[1]).join(", ")}; with an App the push would go out as you. Remove it` };
}

async function guarded(request: PushRequest): Promise<Done> {
  for (const guard of request.guards) {
    const verdict = await guard({ repo: request.repo, commit: request.commit, lease: request.lease });
    if (verdict.kind === "failed") {
      return verdict;
    }
  }
  return { kind: "ok" };
}

async function send(request: PushRequest): Promise<Done> {
  const env = pushEnv(request.identity, request.env);
  if (env.kind === "failed") {
    return env;
  }
  const ref = `refs/heads/${request.branch}`;
  const expected = request.lease.kind === "sha" ? request.lease.sha : "";
  const args = ["push", "--porcelain", "--no-verify", `--force-with-lease=${ref}:${expected}`, "origin", `${request.commit}:${ref}`];
  const pushed = await git(request, args, env.value);
  if (pushed.kind === "ok") {
    return { kind: "ok" };
  }
  const stale = pushed.kind === "failed" && /stale info|\[rejected\]|fetch first/.test(`${pushed.stdout}${pushed.stderr}`);
  return stale ? { kind: "failed", reason: `the branch ${request.branch} moved since the run started; nothing was pushed` } : failed("git push failed", pushed);
}

// hostPush : the writer's commit onto its branch, after every check, as the project's identity.
export async function hostPush(request: PushRequest): Promise<Done> {
  const shape = shapeProblem(request);
  if (shape !== "") {
    return { kind: "failed", reason: shape };
  }
  for (const step of [placeChecks, repoHelpers, guarded]) {
    const verdict = await step(request);
    if (verdict.kind === "failed") {
      return verdict;
    }
  }
  return send(request);
}
