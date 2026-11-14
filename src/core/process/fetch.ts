// fetch — one version of a plugin, fetched from its marketplace's clone in the factory home and copied into the store
// by its hash (#232; docs/DESIGN.md section 5 "Plugins"). The marketplace names each plugin's folder in
// .claude-plugin/marketplace.json ("source": "./plugins/<name>"), which must be a folder inside the marketplace. Every
// git call goes through hostGit; the checkout is a worktree of the marketplace's clone, removed after the copy.
// Nothing is pinned here: `agent-factory plugin update` shows the change, checks it, then moves the pin.

import { cp, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import type { Result } from "../forge/api.js";
import { prop } from "../dispatch/records.js";
import { hostGit, type GitResult } from "../git.js";
import { attempt } from "../review/safe.js";
import { COMMIT, marketplaceDir, matching, parsedJson, treeHash, type Pin } from "./pins.js";
import type { PluginRef } from "./plugins.js";

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function git(env: NodeJS.ProcessEnv, repo: string, args: readonly string[]): Promise<GitResult> {
  return hostGit({
    args,
    repo: { kind: "repo", path: repo },
    env,
    stdin: { kind: "none" },
  });
}

function gitWhy(r: GitResult): string {
  return r.kind === "refused" ? r.reason : r.kind === "failed" ? r.stderr.trim() : "";
}

// targetCommit : the given commit, or the marketplace's HEAD after a fetch from its origin
export async function targetCommit(
  env: NodeJS.ProcessEnv,
  dir: string,
  given: string | undefined,
): Promise<Result<string>> {
  if (given !== undefined) {
    const held = await commitOf(env, dir, given, given);
    return held.kind === "ok" || !COMMIT.test(given) ? held : fetchedCommit(env, dir, given);
  }
  const fetched = await git(env, dir, ["fetch", "-q", "origin", "HEAD"]);
  return fetched.kind === "ok"
    ? commitOf(env, dir, "FETCH_HEAD", "the fetched HEAD")
    : failed(`cannot fetch the marketplace in ${dir}: ${gitWhy(fetched)}`);
}

// fetchedCommit : a full commit the clone does not hold yet, fetched from its origin (#607); only a full commit
// reaches here, so no word is read as a ref or an option
async function fetchedCommit(env: NodeJS.ProcessEnv, dir: string, commit: string): Promise<Result<string>> {
  const fetched = await git(env, dir, ["fetch", "-q", "--end-of-options", "origin", commit]);
  return fetched.kind === "ok"
    ? commitOf(env, dir, commit, commit)
    : failed(`cannot fetch ${commit} into the marketplace in ${dir}: ${gitWhy(fetched)}`);
}

async function commitOf(env: NodeJS.ProcessEnv, dir: string, rev: string, named: string): Promise<Result<string>> {
  const got = await git(env, dir, ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`]);
  const commit = got.kind === "ok" ? matching(got.stdout.trim(), COMMIT) : undefined;
  return commit === undefined ? failed(`${named} is not a commit of ${dir}`) : { kind: "ok", value: commit };
}

type Entry = { readonly source: string; readonly version: string };

// entryOf : the plugin's folder and version, as the marketplace file names them at that commit. Pure.
export function entryOf(text: string, name: string): Result<Entry> {
  const list = prop(parsedJson(text), "plugins");
  const found: unknown = Array.isArray(list) ? list.find((p: unknown) => prop(p, "name") === name) : undefined;
  const path = inside(prop(found, "source"));
  return path === undefined
    ? failed(`the marketplace lists no plugin ${name} with a folder inside it ("source": "./plugins/${name}")`)
    : { kind: "ok", value: { source: path, version: matching(prop(found, "version"), /^/) ?? "" } };
}

// inside : a relative folder inside the marketplace's repo, normalized; a git, URL or outside source is not one
function inside(source: unknown): string | undefined {
  const path = typeof source === "string" ? normalize(source) : "..";
  return path.startsWith("..") || isAbsolute(path) || path === "." ? undefined : path;
}

export type Fetched = Pin & { readonly dir: string; readonly files: readonly string[] };

// fetchPlugin : one plugin at one commit of its marketplace, copied into the store by its hash; nothing is pinned
export async function fetchPlugin(input: {
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  readonly ref: PluginRef;
  readonly commit: string;
}): Promise<Result<Fetched>> {
  const market = marketplaceDir(input.home, input.ref.marketplace);
  const listed = await git(input.env, market, ["cat-file", "blob", `${input.commit}:.claude-plugin/marketplace.json`]);
  const entry =
    listed.kind === "ok"
      ? entryOf(listed.stdout, input.ref.name)
      : failed(`${market}: no marketplace file at ${input.commit.slice(0, 12)}`);
  if (entry.kind === "failed") {
    return entry;
  }
  const base = join(input.home, "plugins", input.ref.marketplace, input.ref.name);
  await mkdir(base, { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(base, ".fetch-"));
  try {
    return await stored({ ...input, market, base, work, entry: entry.value });
  } finally {
    await git(input.env, market, ["worktree", "remove", "--force", join(work, "tree")]);
    await rm(work, { recursive: true, force: true });
  }
}

async function stored(s: {
  readonly env: NodeJS.ProcessEnv;
  readonly commit: string;
  readonly market: string;
  readonly base: string;
  readonly work: string;
  readonly entry: Entry;
}): Promise<Result<Fetched>> {
  const tree = join(s.work, "tree");
  const added = await git(s.env, s.market, ["worktree", "add", "-q", "--detach", tree, s.commit]);
  if (added.kind !== "ok") {
    return failed(`cannot check out ${s.commit.slice(0, 12)} of ${s.market}: ${gitWhy(added)}`);
  }
  const copy = join(s.work, "plugin");
  const copied = await attempt(
    () => cp(join(tree, s.entry.source), copy, { recursive: true }),
    `${s.entry.source} is not a folder`,
  );
  const hash = copied.kind === "ok" ? await treeHash(copy) : copied;
  if (hash.kind === "failed") {
    return hash;
  }
  const dir = join(s.base, hash.value.sha256);
  await rm(dir, { recursive: true, force: true });
  await rename(copy, dir);
  return {
    kind: "ok",
    value: { commit: s.commit, version: s.entry.version, sha256: hash.value.sha256, dir, files: hash.value.files },
  };
}

// changedFiles : what a new version adds, removes and changes, by path, from both versions' file lines. Pure.
// FOLDER_DEPTH : how many path parts name a folder in a first pin's count (skills/crq, not each references file)
const FOLDER_DEPTH = 2;

// folderCounts : a first pin's files as one "+ N files in <folder>" line per folder, so a person reads the plugin's
// shape, not every file; a later pin shows each changed file (changedFiles) (#482, ledger pilot row 12). Pure.
export function folderCounts(files: readonly string[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const line of files) {
    const path = line.slice(line.indexOf(" ", 2) + 1);
    const parts = path.split("/");
    const folder = parts.length > 1 ? parts.slice(0, Math.min(FOLDER_DEPTH, parts.length - 1)).join("/") : ".";
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([folder, n]) => `+ ${n} ${n === 1 ? "file" : "files"} in ${folder}`);
}

export function changedFiles(before: readonly string[], after: readonly string[]): readonly string[] {
  const byPath = (lines: readonly string[]): Map<string, string> =>
    new Map(lines.map((l) => [l.slice(l.indexOf(" ", 2) + 1), l.slice(0, l.indexOf(" ", 2))]));
  const [b, a] = [byPath(before), byPath(after)];
  const added = [...a.keys()].filter((p) => !b.has(p)).map((p) => `+ ${p}`);
  const removed = [...b.keys()].filter((p) => !a.has(p)).map((p) => `- ${p}`);
  const changed = [...a.keys()].filter((p) => b.has(p) && b.get(p) !== a.get(p)).map((p) => `~ ${p}`);
  return [...added, ...removed, ...changed].toSorted((x, y) => x.slice(2).localeCompare(y.slice(2)));
}
