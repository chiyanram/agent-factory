// clone — the writer's own copy of the branch, made by the host before each run (#113 Q1, decided on #30, 2026-11-07).
// Only this folder is mounted into the box (/work):
//   1 the branch (or, on a ticket's first run, the default branch) is fetched into the project's clone through hostGit,
//     and on a later run its tip must be the head the run is for
//   2 a new repo in a private folder fetches that one ref from the clone: no hardlink to the clone's objects, so the
//     writer can never change them (git clone --no-hardlinks gives the same)
//   3 origin is the project's forge URL, so the host can push from it; the commits get the writer's author name
//   4 a prepare-commit-msg hook gives every commit the writer makes its "Agent: writer" trailer (#128); the host's push
//     refuses a commit without it, so a commit made past the hook never leaves
//   5 .factory holds the approved spec, the rulebook and, for a rework or CI run, the task (task.ts); the agent's
//     settings, those files and the repo's git config and hooks are mounted read-only (ADR-0012 S12)
// A branch that holds .factory, or a symlink where a read-only path goes, is refused: the host writes into .factory,
// and docker would mount a symlink's target from the host. Nothing here throws.

import { AGENT_SETTINGS } from "../agent-settings.js";
import { cp, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { excludeFactory } from "../finish.js";
import type { Result } from "../forge/api.js";
import { hostGit, type GitResult, type RepoTarget } from "../git.js";
import { agentTrailer } from "../notes.js";
import { attempt } from "../review/safe.js";

export const AUTHOR = { name: "agent-factory writer", email: "writer@agent-factory.invalid" };
export const SPEC_FILE = ".factory/spec.md";
export const RULEBOOK_DIR = ".factory/rulebook";
export const TASK_FILE = ".factory/task.md";

// a file the host may write into .factory: the task of a rework or CI run (task.ts), the writer's settings (tools.ts)
export type FileText = { readonly kind: "none" } | { readonly kind: "text"; readonly text: string };
export const SETTINGS_FILE = ".factory/settings.json";

// the hook git runs on every commit, merge and amend; --no-verify does not skip it. The host's own git never runs it.
const TRAILER_HOOK = [
  "#!/bin/sh",
  "# agent-factory: every commit of the writer carries its seat (#128)",
  `exec git interpret-trailers --in-place --if-exists replace --trailer "${agentTrailer({ seat: "writer" })}" "$1"`,
  "",
].join("\n");

// paths the writer may read but not change, when the checkout has them; the push refuses the rest (agent-settings.ts)
const SETTINGS = AGENT_SETTINGS;
const GIT_OWN = [".git/config", ".git/hooks"] as const;

// where the run starts: a change's branch at its head, or a ticket's first run on the default branch
export type Start =
  | { readonly kind: "branch"; readonly branch: string; readonly head: string }
  | { readonly kind: "new"; readonly branch: string; readonly base: string };

export type CloneSetup = {
  // the project's clone (FACTORY_REPO): only git reads it, through hostGit
  readonly repo: string;
  readonly env: NodeJS.ProcessEnv;
  // a private folder (0700) the run folders go in
  readonly runsDir: string;
};

export type Clone = {
  // the run folder: remove it after the run
  readonly dir: string;
  // the clone the box mounts
  readonly repo: string;
  readonly branch: string;
  // the commit the run starts from: the push's lease on a later run, the base of the patch on every run
  readonly start: string;
  readonly readOnly: readonly string[];
};

function reason(result: GitResult): string {
  return result.kind === "refused" ? result.reason : result.kind === "failed" ? result.stderr.trim() : "";
}

const OUTSIDE: RepoTarget = { kind: "none" };

// git : one hardened git call in a repo path, or outside any repo
async function git(
  env: NodeJS.ProcessEnv,
  repo: string | RepoTarget,
  args: readonly string[],
): Promise<Result<string>> {
  const ran = await hostGit({
    args,
    repo: typeof repo === "string" ? { kind: "repo", path: repo } : repo,
    env,
    ownHelper: { kind: "none" },
    stdin: { kind: "none" },
  });
  return ran.kind === "ok"
    ? { kind: "ok", value: ran.stdout.trim() }
    : { kind: "failed", reason: `git ${args[0] ?? ""}: ${reason(ran)}` };
}

// atHead : on a later run, the tip must be the head the run is for. Pure.
function atHead(start: Start, tip: string): Result<string> {
  return start.kind === "new" || tip === start.head
    ? { kind: "ok", value: tip }
    : {
        kind: "failed",
        reason: `the tip of ${start.branch} is ${tip.slice(0, 8)}, not ${start.head.slice(0, 8)}: the head moved`,
      };
}

// fetchStart : the start's ref in the project's clone, and its commit
async function fetchStart(setup: CloneSetup, start: Start, ref: string): Promise<Result<string>> {
  const from = start.kind === "branch" ? start.branch : start.base;
  const fetched = await git(setup.env, setup.repo, ["fetch", "-q", "origin", `+refs/heads/${from}:${ref}`]);
  const tip = fetched.kind === "ok" ? await git(setup.env, setup.repo, ["rev-parse", ref]) : fetched;
  return tip.kind === "ok" ? atHead(start, tip.value) : tip;
}

// fill : the new repo, at the start, on the run's branch, set up to push to the forge
async function fill(setup: CloneSetup, repo: string, ref: string, branch: string): Promise<Result<string>> {
  const url = await git(setup.env, setup.repo, ["config", "--get", "remote.origin.url"]);
  if (url.kind === "failed") {
    return { kind: "failed", reason: "the project's clone has no origin URL" };
  }
  const steps: readonly (readonly string[])[] = [
    ["fetch", "-q", "--no-tags", setup.repo, `+${ref}:refs/heads/${branch}`],
    ["checkout", "-q", branch],
    ["remote", "add", "origin", url.value],
    ["config", "user.name", AUTHOR.name],
    ["config", "user.email", AUTHOR.email],
  ];
  for (const args of steps) {
    const done = await git(setup.env, repo, args);
    if (done.kind === "failed") {
      return done;
    }
  }
  return git(setup.env, repo, ["rev-parse", "HEAD"]);
}

// trailerHook : the clone's prepare-commit-msg hook, in .git/hooks, which the box mounts read-only
async function trailerHook(repo: string): Promise<Result<string>> {
  const hooks = join(repo, ".git", "hooks");
  return attempt(async () => {
    await mkdir(hooks, { recursive: true });
    await writeFile(join(hooks, "prepare-commit-msg"), TRAILER_HOOK, { mode: 0o755 });
    return hooks;
  }, `cannot write the trailer hook into ${hooks}`);
}

type Entry = { readonly kind: "absent" } | { readonly kind: "plain" } | { readonly kind: "symlink" };

async function entry(path: string): Promise<Entry> {
  try {
    return (await lstat(path)).isSymbolicLink() ? { kind: "symlink" } : { kind: "plain" };
  } catch {
    return { kind: "absent" };
  }
}

// readOnlyPaths : the settings and git paths the checkout has; a symlink at one is refused
async function readOnlyPaths(repo: string): Promise<Result<readonly string[]>> {
  const paths = [...SETTINGS, ...GIT_OWN];
  const found = await Promise.all(paths.map(async (p) => ({ path: p, entry: await entry(join(repo, p)) })));
  const link = found.find((f) => f.entry.kind === "symlink");
  if (link !== undefined) {
    return { kind: "failed", reason: `the branch has a symlink at ${link.path}; a person checks it` };
  }
  return { kind: "ok", value: found.filter((f) => f.entry.kind === "plain").map((f) => f.path) };
}

type Files = {
  readonly spec: string;
  readonly rulebook: string;
  readonly task: FileText;
  readonly settings: FileText;
};

// the optional files the host writes, each by its path
function optional(files: Files): readonly { readonly path: string; readonly text: string }[] {
  return [
    ...(files.task.kind === "text" ? [{ path: TASK_FILE, text: files.task.text }] : []),
    ...(files.settings.kind === "text" ? [{ path: SETTINGS_FILE, text: files.settings.text }] : []),
  ];
}

// factoryFiles : the approved spec, the rulebook and the task in .factory, which the branch must not hold
async function factoryFiles(repo: string, files: Files): Promise<Result<readonly string[]>> {
  if ((await entry(join(repo, ".factory"))).kind !== "absent") {
    return { kind: "failed", reason: "the branch holds .factory; a person removes it" };
  }
  return attempt(
    async () => {
      await mkdir(join(repo, ".factory"), { mode: 0o755 });
      await writeFile(join(repo, SPEC_FILE), files.spec, { mode: 0o644 });
      await cp(files.rulebook, join(repo, RULEBOOK_DIR), { recursive: true });
      const more = optional(files);
      for (const file of more) {
        await writeFile(join(repo, file.path), file.text, { mode: 0o644 });
      }
      return [SPEC_FILE, RULEBOOK_DIR, ...more.map((f) => f.path)];
    },
    `cannot write the spec, the rulebook, the task and the settings into ${join(repo, ".factory")}`,
  );
}

// checkedOut : the new repo in `dir`, at the start, on the run's branch; the start's commit
async function checkedOut(setup: CloneSetup, dir: string, start: Start): Promise<Result<Checkout>> {
  const repo = join(dir, "repo");
  const ref = `refs/factory/writer-${start.branch.replaceAll("/", "-")}`;
  const tip = await fetchStart(setup, start, ref);
  if (tip.kind === "failed") {
    return tip;
  }
  const made = await git(setup.env, OUTSIDE, ["init", "-q", repo]);
  if (made.kind === "failed") {
    return made;
  }
  const head = await fill(setup, repo, ref, start.branch);
  if (head.kind === "failed") {
    return head;
  }
  const hook = await trailerHook(repo);
  return hook.kind === "ok" ? { kind: "ok", value: { repo, start: head.value } } : hook;
}

type Checkout = { readonly repo: string; readonly start: string };

async function prepared(
  setup: CloneSetup,
  input: Files & { readonly dir: string; readonly start: Start },
): Promise<Result<Clone>> {
  const out = await checkedOut(setup, input.dir, input.start);
  if (out.kind === "failed") {
    return out;
  }
  const { repo, start } = out.value;
  const own = await readOnlyPaths(repo);
  if (own.kind === "failed") {
    return own;
  }
  const files = await factoryFiles(repo, input);
  if (files.kind === "failed") {
    return files;
  }
  const excluded = await excludeFactory({ repo, env: setup.env });
  const readOnly = [...own.value, ...files.value];
  return excluded.kind === "ok"
    ? { kind: "ok", value: { dir: input.dir, repo, branch: input.start.branch, start, readOnly } }
    : excluded;
}

// removeClone : the run folder gone; the box wrote its files as the host owner, so this user can remove them
export async function removeClone(dir: string): Promise<Result<string>> {
  return attempt(async () => {
    await rm(dir, { recursive: true, force: true });
    return dir;
  }, `cannot remove ${dir}`);
}

// makeClone : a run folder with the writer's clone in it; a folder that could not be set up is removed again
export async function makeClone(setup: CloneSetup, input: Files & { readonly start: Start }): Promise<Result<Clone>> {
  const dir = await attempt(async () => {
    await mkdir(setup.runsDir, { recursive: true, mode: 0o700 });
    return mkdtemp(join(setup.runsDir, "writer-"));
  }, `cannot make a folder in ${setup.runsDir}`);
  if (dir.kind === "failed") {
    return dir;
  }
  const clone = await prepared(setup, { ...input, dir: dir.value });
  if (clone.kind === "failed") {
    await removeClone(dir.value);
  }
  return clone;
}
