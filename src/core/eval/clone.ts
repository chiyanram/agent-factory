// clone — one case's throwaway clone (ADR-0015 E7, #215): this repository cloned into the pass's private folder, main
// set to base.sha, change.patch committed on factory/<case>, and both pushed to a bare origin beside it, so the review
// fetches main and the change's branch from origin as it does in production. Every git call goes through hostGit, so a
// hook or config in the clone runs nothing (AGENTS.md MUST).

import { join } from "node:path";
import type { Result } from "../forge/api.js";
import { hostGit, type RepoTarget } from "../git.js";

export const BRANCH_OF = (name: string): string => `factory/${name}`;

export type Cloned = { readonly repo: string; readonly head: string; readonly branch: string };

// the commit's author, so no global identity is needed and none is read
const AUTHOR = {
  GIT_AUTHOR_NAME: "agent-factory eval",
  GIT_AUTHOR_EMAIL: "eval@agent-factory.invalid",
  GIT_COMMITTER_NAME: "agent-factory eval",
  GIT_COMMITTER_EMAIL: "eval@agent-factory.invalid",
};

async function git(repo: RepoTarget, env: NodeJS.ProcessEnv, args: readonly string[]): Promise<Result<string>> {
  const ran = await hostGit({
    args,
    repo,
    env: { ...env, ...AUTHOR },
    stdin: { kind: "none" },
  });
  if (ran.kind === "ok") {
    return { kind: "ok", value: ran.stdout.trim() };
  }
  const why = ran.kind === "refused" ? ran.reason : (ran.stderr.trim().split("\n")[0] ?? "");
  return { kind: "failed", reason: `git ${args[0] ?? ""}: ${why}` };
}

// steps : the calls one after another; the first that fails stops the rest
async function steps(
  calls: readonly (readonly [RepoTarget, readonly string[]])[],
  env: NodeJS.ProcessEnv,
): Promise<Result<string>> {
  let last: Result<string> = { kind: "ok", value: "" };
  for (const [repo, args] of calls) {
    last = await git(repo, env, args);
    if (last.kind === "failed") {
      return last;
    }
  }
  return last;
}

// throwaway : the clone of `root` under `into`, with the case's change as the head of factory/<name>
export async function throwaway(input: {
  readonly root: string;
  readonly into: string;
  readonly name: string;
  readonly base: string;
  readonly patch: string;
  readonly env: NodeJS.ProcessEnv;
}): Promise<Result<Cloned>> {
  const repo = join(input.into, "clone");
  const origin = join(input.into, "origin.git");
  const branch = BRANCH_OF(input.name);
  const none: RepoTarget = { kind: "none" };
  const here: RepoTarget = { kind: "repo", path: repo };
  const made = await steps(
    [
      [none, ["clone", "-q", "--no-hardlinks", "--no-checkout", input.root, repo]],
      [none, ["init", "-q", "--bare", origin]],
      [here, ["checkout", "-q", "-B", "main", input.base]],
      [here, ["checkout", "-q", "-b", branch]],
      [here, ["apply", "--index", input.patch]],
      [here, ["-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", `eval: ${input.name}`]],
      [here, ["push", "-q", origin, "main", branch]],
      [here, ["remote", "set-url", "origin", origin]],
      [here, ["rev-parse", "HEAD"]],
    ],
    input.env,
  );
  return made.kind === "ok" ? { kind: "ok", value: { repo, head: made.value, branch } } : made;
}
