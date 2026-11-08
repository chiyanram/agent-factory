// target — which forge and which project the factory acts on, checked (ADR-0010). One module with no other import than
// the seam's types, so the forge plugins carry the same checks as the core (#134).

import type { Result } from "./api.js";
import type { ForgeName } from "./types.js";

export type GithubProject = { readonly owner: string; readonly name: string };

// every segment starts with a letter or a digit, so "." and ".." never reach an API path
const GITHUB_PROJECT = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)$/;
const GITLAB_PROJECT = /^[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)+$/;

export function githubProject(project: string): Result<GithubProject> {
  const parts = GITHUB_PROJECT.exec(project);
  const [, owner, name] = parts ?? [];
  return owner === undefined || name === undefined
    ? {
        kind: "failed",
        reason: `FACTORY_PROJECT must be owner/name (for example chiyanram/ledger), got ${JSON.stringify(project)}`,
      }
    : { kind: "ok", value: { owner, name } };
}

export function gitlabProject(project: string): Result<string> {
  return GITLAB_PROJECT.test(project)
    ? { kind: "ok", value: project }
    : {
        kind: "failed",
        reason: `FACTORY_PROJECT must be the project's full path (for example aruvii/agent-platform), got ${JSON.stringify(project)}`,
      };
}

// forgeName : FACTORY_FORGE, checked.
export function forgeName(env: NodeJS.ProcessEnv): Result<ForgeName> {
  const kind = env.FACTORY_FORGE ?? "gitlab";
  return kind === "github" || kind === "gitlab"
    ? { kind: "ok", value: kind }
    : { kind: "failed", reason: `FACTORY_FORGE must be gitlab or github, got ${JSON.stringify(kind)}` };
}

export function markOf(name: ForgeName): "!" | "#" {
  return name === "github" ? "#" : "!";
}
