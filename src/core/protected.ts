// protected — a host push guard over files an agent never changes (#110, #115; ADR-0012 S9, S12). The CI files and the
// agent's own settings are two such sets; each names its files, and this compares them.
//
// The trees are compared, not the commits: for every protected file, the pushed commit's version must be the branch's
// version before the push (the lease) or the default branch's version, freshly fetched. So an edited merge, a reset past
// the lease or a branch started elsewhere is caught, and a merge or rebase onto the default branch, which only brings a
// person's change, passes. Replace refs are ignored (GIT_NO_REPLACE_OBJECTS), so git reads the commits that are sent.

import type { Done, Result } from "./forge/api.js";
import { hostGit } from "./git.js";
import type { Guard, GuardInput } from "./push.js";

// path → "<mode> <blob>": a mode or content change both count
export type Tree = ReadonlyMap<string, string>;

// the trees one push is judged on: the commit sent, the default branch, and the branch before the push
export type Heads = { readonly commit: Tree; readonly base: Tree; readonly lease: Tree | "none" };

export type Found = Result<readonly string[]>;

export type ProtectedSetup = {
  readonly env: NodeJS.ProcessEnv;
  // the project's default branch, fetched fresh as the base a protected file may equal
  readonly defaultBranch: string;
};

export type FileSet = {
  // where the default branch is fetched to, one ref per set: refs/factory/<name>-base
  readonly name: string;
  // what the set is called in a refusal: "the CI files"
  readonly what: string;
  // the set's files in any of the trees
  readonly filesIn: (heads: Heads, repo: string) => Promise<Found>;
  // the refusal, naming the files changed
  readonly refusal: (changed: readonly string[]) => string;
};

export function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

export function git(env: NodeJS.ProcessEnv, repo: string, args: readonly string[]): ReturnType<typeof hostGit> {
  return hostGit({
    args,
    repo: { kind: "repo", path: repo },
    env: { ...env, GIT_NO_REPLACE_OBJECTS: "1" },
    stdin: { kind: "none" },
  });
}

export function why(ran: Awaited<ReturnType<typeof hostGit>>): string {
  return ran.kind === "refused" ? ran.reason : ran.kind === "failed" ? ran.stderr.trim() : "";
}

// treeOf : `git ls-tree -r -z` as a map. Pure.
export function treeOf(listing: string): Tree {
  const entries = listing
    .split("\u0000")
    .filter((l) => l !== "")
    .map((l): [string, string] => {
      const tab = l.indexOf("\t");
      const [mode = "", , sha = ""] = l.slice(0, tab).split(" ");
      return [l.slice(tab + 1), `${mode} ${sha}`];
    });
  return new Map(entries);
}

async function treeAt(env: NodeJS.ProcessEnv, repo: string, rev: string): Promise<Result<Tree>> {
  const listed = await git(env, repo, ["ls-tree", "-r", "-z", "--full-tree", rev]);
  return listed.kind === "ok"
    ? { kind: "ok", value: treeOf(listed.stdout) }
    : failed(`cannot list the files at ${rev.slice(0, 8)}: ${why(listed)}`);
}

async function baseOf(setup: ProtectedSetup, set: FileSet, repo: string): Promise<Result<string>> {
  const ref = `refs/factory/${set.name}-base`;
  const fetched = await git(setup.env, repo, ["fetch", "-q", "origin", `+refs/heads/${setup.defaultBranch}:${ref}`]);
  if (fetched.kind !== "ok") {
    return failed(`cannot fetch ${setup.defaultBranch} to compare ${set.what} with: ${why(fetched)}`);
  }
  const sha = await git(setup.env, repo, ["rev-parse", ref]);
  return sha.kind === "ok" ? { kind: "ok", value: sha.stdout.trim() } : failed(why(sha));
}

async function leaseTree(setup: ProtectedSetup, input: GuardInput): Promise<Result<Tree | "none">> {
  return input.lease.kind === "sha" ? treeAt(setup.env, input.repo, input.lease.sha) : { kind: "ok", value: "none" };
}

async function baseTreeOf(setup: ProtectedSetup, set: FileSet, repo: string): Promise<Result<Tree>> {
  const base = await baseOf(setup, set, repo);
  return base.kind === "ok" ? treeAt(setup.env, repo, base.value) : base;
}

function failedOf(r: Result<unknown>): { readonly kind: "failed"; readonly reason: string } {
  return r.kind === "failed" ? r : failed("cannot read the trees");
}

async function heads(setup: ProtectedSetup, set: FileSet, input: GuardInput): Promise<Result<Heads>> {
  const baseTree = await baseTreeOf(setup, set, input.repo);
  if (baseTree.kind === "failed") {
    return baseTree;
  }
  const commit = await treeAt(setup.env, input.repo, input.commit);
  const lease = commit.kind === "ok" ? await leaseTree(setup, input) : commit;
  return commit.kind === "ok" && lease.kind === "ok"
    ? { kind: "ok", value: { commit: commit.value, base: baseTree.value, lease: lease.value } }
    : failedOf(lease);
}

// changedFiles : the files whose version at the commit is neither the lease's nor the base's. Pure.
export function changedFiles(h: Heads, files: readonly string[]): readonly string[] {
  const now = (p: string) => h.commit.get(p) ?? "";
  const kept = (p: string) => h.lease !== "none" && (h.lease.get(p) ?? "") === now(p);
  return [...new Set(files)].filter((p) => now(p) !== (h.base.get(p) ?? "") && !kept(p)).toSorted();
}

// the trees of one push: the lease's only when there is one
export function treesOf(h: Heads): readonly Tree[] {
  return h.lease === "none" ? [h.commit, h.base] : [h.commit, h.base, h.lease];
}

async function check(setup: ProtectedSetup, set: FileSet, input: GuardInput): Promise<Done> {
  const h = await heads(setup, set, input);
  if (h.kind === "failed") {
    return failed(`cannot check ${set.what}, so nothing is pushed: ${h.reason}`);
  }
  const files = await set.filesIn(h.value, input.repo);
  if (files.kind === "failed") {
    return failed(`cannot check ${set.what}, so nothing is pushed: ${files.reason}`);
  }
  const changed = changedFiles(h.value, files.value);
  return changed.length === 0 ? { kind: "ok" } : failed(set.refusal(changed));
}

// protectedFiles : refuses a push that changes a file of the set; the work is then blocked with the files named
export function protectedFiles(setup: ProtectedSetup, set: FileSet): Guard {
  return (input) => check(setup, set, input);
}
