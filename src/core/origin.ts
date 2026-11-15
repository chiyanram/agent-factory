// origin — the project's clone is the project's repo: its `origin` (the URL it fetches from) names the git host and project the settings name.
// A clone whose origin points elsewhere (another repo, a fork) would build from or push to the wrong place with no
// warning, so `config check` and each orchestrator pass stop on a mismatch and name both URLs. Host and path compare
// without letter case, as both git hosts route them; a `.git` suffix and the URL form (https, ssh, scp) do not count.

import type { Result } from "./forge/api.js";
import { forgeHost } from "./forge/index.js";
import { forgeName } from "./forge/target.js";
import { hostGit } from "./git.js";
import { parseRemote } from "./init/detect.js";
import { settingOf } from "./settings/machine.js";

// expectedRepo : the project's repo as host/project, from the settings; "" when the project is not set
function expectedRepo(env: NodeJS.ProcessEnv): Result<string> {
  const project = (settingOf(env, "gitHostProject") ?? "").replace(/\.git$/i, "");
  if (project === "") {
    return { kind: "ok", value: "" };
  }
  const name = forgeName(env);
  const host = name.kind === "ok" ? forgeHost(env, name.value) : name;
  return host.kind === "ok" ? { kind: "ok", value: `${host.value}/${project}` } : host;
}

async function originUrl(clone: string, env: NodeJS.ProcessEnv): Promise<Result<string>> {
  const got = await hostGit({
    args: ["remote", "get-url", "origin"],
    repo: { kind: "repo", path: clone },
    env,
    stdin: { kind: "none" },
  });
  if (got.kind === "ok") {
    return { kind: "ok", value: got.stdout.trim() };
  }
  return { kind: "failed", reason: got.kind === "refused" ? got.reason : notRead(got.stderr) };
}

// notRead : why git could not read the origin: none set, or the clone itself (no folder, not a git repo). Pure.
function notRead(stderr: string): string {
  const line = stderr.trim().split("\n")[0] ?? "";
  return /no such remote/i.test(line) ? "it has no origin remote" : `cannot read its origin: ${line}`;
}

// mismatch : why the origin URL is not the expected host/project, or "" when it is. Pure.
function mismatch(url: string, expected: string): string {
  const remote = parseRemote(url);
  if (remote === "bad") {
    return `origin ${JSON.stringify(url)} is not a git host URL`;
  }
  return `${remote.host}/${remote.path}`.toLowerCase() === expected.toLowerCase() ? "" : `origin is ${url}`;
}

// originProblem : why the clone in the settings is not the project's repo, or "" when it is or nothing names both
export async function originProblem(env: NodeJS.ProcessEnv): Promise<string> {
  const clone = settingOf(env, "clone") ?? "";
  if (clone === "") {
    return "";
  }
  const expected = expectedRepo(env);
  if (expected.kind === "failed") {
    return `${clone}: cannot tell the project's repo: ${expected.reason}`;
  }
  return expected.value === "" ? "" : cloneProblem(clone, expected.value, env);
}

// cloneProblem : why the clone's origin is not the expected host/project, or "" when it is
async function cloneProblem(clone: string, expected: string, env: NodeJS.ProcessEnv): Promise<string> {
  const url = await originUrl(clone, env);
  const why = url.kind === "ok" ? mismatch(url.value, expected) : url.reason;
  return why === ""
    ? ""
    : `${clone}: ${why}, but the project is ${expected} (gitHostProject); fix the clone's origin or the project file`;
}

// checkedSetup : a pass's setup, run only once the clone is the project's repo
export async function checkedSetup<T>(env: NodeJS.ProcessEnv, setup: () => Promise<Result<T>>): Promise<Result<T>> {
  const why = await originProblem(env);
  return why === "" ? setup() : { kind: "failed", reason: why };
}
