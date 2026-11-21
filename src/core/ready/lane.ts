// lane — the lane the change's real diff needs, read in the ready check (#230; lane.ts; rulebook crq LN2). Like the
// floor guard, it reads the diff from the merge base with the default branch to the head, on the host and through
// hostGit only, and runs no branch code. Each file the diff touches needs a lane, and the change needs the heaviest:
//
//   one-way door   the file, or the path it moved from, is under one of the project's one-way-door paths
//   tiny           a doc (Markdown, reStructuredText, AsciiDoc, plain text, README, LICENSE and the like); a change
//                  that only touches comments; or, in a config file (JSON, YAML, TOML, INI, properties), one that only
//                  changes the values of keys that stay
//   bug            anything else: a code change, a file moved or its mode changed with no line changed, a new key
//
// When unsure it reads the heavier lane (crq: unsure between two lanes, take the heavier). Nothing here throws, and a
// diff it cannot read fails the step, so no lane is ever read from a diff no one read.

import type { Result } from "../forge/api.js";
import { hostGit, type GitResult } from "../git.js";
import { heavier, matches } from "../lane.js";
import type { Lane } from "../spec.js";
import { changesOf, mergeBase, type Change, type FloorInput } from "./floor.js";

export type DiffLane = { readonly lane: Lane; readonly why: string };

const DOC = /\.(?:md|mdx|markdown|rst|adoc|asciidoc|txt)$/i;
const DOC_NAME = /(?:^|\/)(?:README|LICENSE|LICENCE|NOTICE|AUTHORS|CONTRIBUTORS|CHANGELOG|COPYING)(?:\.[^/]*)?$/i;
const CONFIG = /\.(?:json|ya?ml|toml|ini|properties|conf|cfg)$/i;
const COMMENT = /^(?:\/\/|\/\*|\*\/|\*(?:\s|$)|<!--|-->|#(?:\s|$)|--(?:\s|$))/;
const CONFIG_COMMENT = /^(?:#|\/\/|;)/;
const KEY = /^(?:-\s+)?["']?([^"'\s:=]+)["']?\s*[:=]/;

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function git(input: FloorInput, args: readonly string[]): Promise<GitResult> {
  return hostGit({
    args,
    repo: { kind: "repo", path: input.repo },
    env: { ...input.env, GIT_NO_REPLACE_OBJECTS: "1", GIT_LITERAL_PATHSPECS: "1" },
    stdin: { kind: "none" },
  });
}

function out(result: GitResult, what: string): Result<string> {
  if (result.kind === "ok") {
    return { kind: "ok", value: result.stdout };
  }
  const why = result.kind === "refused" ? result.reason : (result.stderr.trim().split("\n").at(-1) ?? "");
  return failed(`the lane check cannot ${what}: ${why || "git failed"}`);
}

function pathsOf(change: Change): readonly string[] {
  return change.kind === "renamed" ? [change.from, change.path] : [change.path];
}

function isDoc(path: string): boolean {
  return DOC.test(path) || DOC_NAME.test(path);
}

function marked(diff: string): readonly string[] {
  const lines = diff.split("\n");
  const first = lines.findIndex((l) => l.startsWith("@@"));
  return first === -1 ? [] : lines.slice(first).filter((l) => /^[+-]/.test(l));
}

export function changedLines(diff: string): readonly string[] {
  return marked(diff).map((l) => l.slice(1).trim());
}

export function commentsOnly(lines: readonly string[]): boolean {
  return lines.every((l) => l === "" || COMMENT.test(l));
}

function keyOf(line: string): string {
  return KEY.exec(line)?.[1] ?? "";
}

function sameKeys(removed: readonly string[], added: readonly string[]): boolean {
  const before = new Set(removed.map(keyOf));
  const after = new Set(added.map(keyOf));
  return before.size === after.size && [...before].every((k) => after.has(k));
}

export function valuesOnly(diff: string): boolean {
  const lines = marked(diff).filter((l) => !CONFIG_COMMENT.test(l.slice(1).trim()) && l.slice(1).trim() !== "");
  const removed = lines.filter((l) => l.startsWith("-")).map((l) => l.slice(1).trim());
  const added = lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1).trim());
  return lines.every((l) => keyOf(l.slice(1).trim()) !== "") && sameKeys(removed, added);
}

export function contentLane(paths: readonly string[], diff: string): Lane {
  const lines = changedLines(diff);
  if (lines.length === 0) {
    return "bug";
  }
  const config = paths.every((p) => CONFIG.test(p)) && valuesOnly(diff);
  return config || commentsOnly(lines) ? "tiny" : "bug";
}

async function fileDiff(input: FloorInput, base: string, paths: readonly string[]): Promise<Result<string>> {
  const args = ["diff", "-U0", "-M", "--text", "--no-color", "--no-ext-diff", "--no-textconv", base, input.head];
  return out(await git(input, [...args, "--", ...paths]), `read the diff of ${paths.at(-1) ?? ""}`);
}

const WHY: Readonly<Record<Lane, string>> = {
  tiny: "changes only docs, comments or config values",
  bug: "changes code",
  feature: "changes code",
  "one-way door": "is under a one-way-door path",
};

async function fileLane(
  input: FloorInput,
  base: string,
  change: Change,
  oneWayDoor: readonly string[],
): Promise<Result<Lane>> {
  const paths = pathsOf(change);
  if (paths.some((p) => matches(p, oneWayDoor))) {
    return { kind: "ok", value: "one-way door" };
  }
  if (paths.every(isDoc)) {
    return { kind: "ok", value: "tiny" };
  }
  const diff = await fileDiff(input, base, paths);
  return diff.kind === "ok" ? { kind: "ok", value: contentLane(paths, diff.value) } : diff;
}

async function changes(input: FloorInput, base: string): Promise<Result<readonly Change[]>> {
  const listed = out(
    await git(input, ["diff", "--name-status", "-M", "-z", "--no-color", base, input.head]),
    "list the files the change touches",
  );
  return listed.kind === "ok" ? { kind: "ok", value: changesOf(listed.value) } : listed;
}

type FileLane = { readonly path: string; readonly lane: Lane };

function heaviest(files: readonly FileLane[]): DiffLane {
  const lane = files.reduce<Lane>((a, f) => heavier(a, f.lane), "tiny");
  const first = files.find((f) => f.lane === lane);
  return first === undefined ? { lane, why: "the diff is empty" } : { lane, why: `${first.path} ${WHY[lane]}` };
}

async function lanesOfChanges(
  input: FloorInput,
  base: string,
  oneWayDoor: readonly string[],
): Promise<Result<readonly FileLane[]>> {
  const listed = await changes(input, base);
  if (listed.kind === "failed") {
    return listed;
  }
  const files: FileLane[] = [];
  for (const change of listed.value) {
    const lane = await fileLane(input, base, change, oneWayDoor);
    if (lane.kind === "failed") {
      return lane;
    }
    files.push({ path: change.path, lane: lane.value });
  }
  return { kind: "ok", value: files };
}

export async function diffLane(input: FloorInput, oneWayDoor: readonly string[]): Promise<Result<DiffLane>> {
  const base = await mergeBase(input);
  const files = base.kind === "ok" ? await lanesOfChanges(input, base.value, oneWayDoor) : base;
  return files.kind === "ok" ? { kind: "ok", value: heaviest(files.value) } : files;
}
