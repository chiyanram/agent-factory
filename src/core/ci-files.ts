// ci-files — the host push refuses any commit that touches CI config (#115; ADR-0012 S9, Q5a). An agent never changes
// CI: a CI file runs with the project's secrets, and `rules:` is no gate, since GitLab runs the branch's own copy of
// .gitlab-ci.yml. The human makes such a change in their own commit.
//
//   .gitlab-ci.yml, and every file it includes with `include: local` (or a bare path), followed into those files
//   .github/workflows/** and .github/actions/**
//
// Every commit the push adds is checked, with renames split into a delete and an add, so moving a CI file away counts.
// The includes are read from .gitlab-ci.yml at the pushed commit; a change to .gitlab-ci.yml itself is refused anyway.
// `project:`, `remote:`, `template:` and `component:` includes live outside the repository and are not ours to guard.

import { hostGit } from "./git.js";
import type { Done, Result } from "./forge/api.js";
import { newCommits, type Guard } from "./push.js";

export const GITLAB_CI = ".gitlab-ci.yml";
const FIXED = [GITLAB_CI, ".github/workflows/**", ".github/actions/**"];
// the most included files followed, so a loop of includes ends
const MAX_FILES = 50;
const OUTSIDE = /^(project|remote|template|component|file|ref|rules|inputs|cache|when|if|exists|changes)\s*:/;

function bare(text: string): string {
  const noComment = text.replace(/\s+#.*$/, "").trim();
  return noComment.replace(/^(['"])(.*)\1$/, "$2").trim();
}

// entry : the local path one include entry names, or "" for one outside the repository
function entry(text: string): string {
  const value = bare(text.replace(/^-\s*/, ""));
  const local = /^local\s*:\s*(.+)$/.exec(value);
  if (local !== null) {
    return bare(local[1] ?? "");
  }
  return outside(value) ? "" : value;
}

// outside : an entry that names no file in this repository: another project, a URL, a template, or a sub-key
function outside(value: string): boolean {
  return value === "" || OUTSIDE.test(value) || /^[a-z]+:\/\//i.test(value);
}

// flow : the entries of an inline value: one path, [a, b], or {local: a}
function flow(value: string): readonly string[] {
  const inner = /^[[{](.*)[\]}]$/.exec(value.trim());
  return (inner === null ? [value] : (inner[1] ?? "").split(",")).map(entry);
}

function indent(line: string): number {
  return line.length - line.trimStart().length;
}

// block : the lines under a top-level `include:`, up to the next top-level key
function block(lines: readonly string[], from: number): readonly string[] {
  const rest = lines.slice(from + 1);
  const end = rest.findIndex((l) => l.trim() !== "" && !l.trimStart().startsWith("#") && indent(l) === 0);
  return end < 0 ? rest : rest.slice(0, end);
}

// localIncludes : the repository paths a GitLab CI file includes, without a leading /; a glob stays a glob
export function localIncludes(yaml: string): readonly string[] {
  const lines = yaml.split(/\r?\n/);
  const found: string[] = [];
  lines.forEach((line, i) => {
    const top = /^include\s*:\s*(.*)$/.exec(line);
    if (top === null) {
      return;
    }
    const inline = bare(top[1] ?? "");
    const items = inline === "" ? block(lines, i).map((l) => l.trim()) : flow(inline);
    found.push(...items.map(entry));
  });
  return [...new Set(found.filter((p) => p !== "").map((p) => p.replace(/^\/+/, "")))];
}

function git(env: NodeJS.ProcessEnv, repo: string, args: readonly string[]): ReturnType<typeof hostGit> {
  return hostGit({
    args,
    repo: { kind: "repo", path: repo },
    env,
    ownHelper: { kind: "none" },
    stdin: { kind: "none" },
  });
}

// fileAt : a file's text at the commit, or "" when it is not there
async function fileAt(env: NodeJS.ProcessEnv, repo: string, commit: string, path: string): Promise<string> {
  const shown = await git(env, repo, ["show", `${commit}:${path}`]);
  return shown.kind === "ok" ? shown.stdout : "";
}

// includedAt : every local include of .gitlab-ci.yml at the commit, followed into the included files that are plain
// paths; a glob is guarded as a glob and not followed
export async function includedAt(env: NodeJS.ProcessEnv, repo: string, commit: string): Promise<readonly string[]> {
  const seen = new Set<string>();
  const queue = [...localIncludes(await fileAt(env, repo, commit, GITLAB_CI))];
  for (let path = queue.shift(); path !== undefined && seen.size < MAX_FILES; path = queue.shift()) {
    if (!seen.has(path)) {
      seen.add(path);
      queue.push(...(await followed(env, repo, commit, path)));
    }
  }
  return [...seen];
}

// followed : the includes of one included file; a glob is guarded as a glob and not followed
async function followed(
  env: NodeJS.ProcessEnv,
  repo: string,
  commit: string,
  path: string,
): Promise<readonly string[]> {
  return /[*?[]/.test(path) ? [] : localIncludes(await fileAt(env, repo, commit, path));
}

// touched : the CI files any commit the push adds touches, renames split into a delete and an add
async function touched(
  env: NodeJS.ProcessEnv,
  input: Parameters<Guard>[0],
  paths: readonly string[],
): Promise<Result<readonly string[]>> {
  const listed = await git(env, input.repo, [
    "log",
    "--format=",
    "--name-only",
    "--no-renames",
    ...newCommits(input),
    "--",
    ...paths.map((p) => `:(glob)${p}`),
  ]);
  if (listed.kind !== "ok") {
    const why = listed.kind === "refused" ? listed.reason : listed.stderr.trim();
    return { kind: "failed", reason: `cannot list the commits of ${input.commit.slice(0, 8)}: ${why}` };
  }
  return { kind: "ok", value: [...new Set(listed.stdout.split("\n").filter((l) => l !== ""))].toSorted() };
}

// noCiFiles : refuses a push whose commits touch a CI file; the work is then blocked with the files named
export function noCiFiles(env: NodeJS.ProcessEnv): Guard {
  return async (input): Promise<Done> => {
    const paths = [...FIXED, ...(await includedAt(env, input.repo, input.commit))];
    const files = await touched(env, input, paths);
    if (files.kind === "failed") {
      return files;
    }
    return files.value.length === 0
      ? { kind: "ok" }
      : {
          kind: "failed",
          reason: `touches CI config (${files.value.join(", ")}): an agent never changes CI; a person makes that change in their own commit`,
        };
  };
}
