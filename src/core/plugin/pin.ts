// pin — what `plugin add` pins, and where the core runs it from (#134; ADR-0014 P2). A plugin is the folder its file
// sits in: every file under it counts, so a script's own modules are pinned with it. Its sha256 is taken over the
// tree, and the tree is copied into <home>/plugins/<sha256>/ (mode 700), which is what every call runs: the person's
// folder can change after review and the plugin does not. A folder or file that someone else could write to, a
// symlink inside it, or a tree past the size limits is refused. Nothing here throws.
//
// Not pinned: the interpreter a script names (#!/usr/bin/env node finds it on the trusted PATH) and the CLI the plugin
// calls. GUIDE marks this Today.

import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { chmod, cp, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { Done, Result } from "../forge/api.js";
import { attempt } from "../review/safe.js";

const MAX_FILES = 2000;
const MAX_BYTES = 100 * 1024 * 1024;

export type Pinned = { readonly sha256: string; readonly entry: string };
export type Source = { readonly file: string; readonly dir: string };

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function trusted(s: Stats): boolean {
  const uid = process.getuid?.() ?? s.uid;
  return (s.uid === uid || s.uid === 0) && (s.mode & 0o022) === 0;
}

// safeOwner : owned by this user or by root, and writable by no one else
async function safeOwner(path: string): Promise<Done> {
  const s = await stat(path).catch(() => undefined);
  if (s === undefined) {
    return failed(`${path} is not there`);
  }
  return trusted(s) ? { kind: "ok" } : failed(`${path} is owned or writable by someone else`);
}

type File = { readonly rel: string; readonly exec: boolean; readonly size: number };
type Walk = { readonly files: File[]; readonly dirs: string[] };

// visit : one entry of the tree into the walk; a symlink is refused
async function visit(root: string, path: string, walk: Walk): Promise<Done> {
  const s = await lstat(path);
  if (s.isSymbolicLink()) {
    return failed(`${path} is a symlink; a plugin folder holds plain files only`);
  }
  if (s.isDirectory()) {
    walk.dirs.push(path);
  } else {
    walk.files.push({ rel: relative(root, path), exec: (s.mode & 0o111) !== 0, size: s.size });
  }
  return { kind: "ok" };
}

async function walkDir(root: string, here: string, walk: Walk): Promise<Done> {
  for (const name of await readdir(here)) {
    const done = await visit(root, join(here, name), walk);
    if (done.kind === "failed") {
      return done;
    }
  }
  return { kind: "ok" };
}

function within(files: readonly File[], dir: string): Result<readonly File[]> {
  const bytes = files.reduce((n, f) => n + f.size, 0);
  return files.length > MAX_FILES || bytes > MAX_BYTES
    ? failed(`${dir} holds more than ${MAX_FILES} files or ${MAX_BYTES} bytes`)
    : { kind: "ok", value: files.toSorted((a, b) => (a.rel < b.rel ? -1 : 1)) };
}

// filesOf : every file of the tree, sorted
async function filesOf(dir: string): Promise<Result<readonly File[]>> {
  const walk: Walk = { files: [], dirs: [] };
  for (let here: string | undefined = dir; here !== undefined; here = walk.dirs.pop()) {
    const done = await walkDir(dir, here, walk);
    if (done.kind === "failed") {
      return done;
    }
  }
  return within(walk.files, dir);
}

async function hashed(dir: string, files: readonly File[]): Promise<string> {
  const hash = createHash("sha256");
  for (const f of files) {
    const content = await readFile(join(dir, f.rel));
    hash.update(`${f.rel}\u0000${f.exec ? "x" : "-"}\u0000${createHash("sha256").update(content).digest("hex")}\n`);
  }
  return hash.digest("hex");
}

// treeHash : the sha256 of every file's path, whether it is executable, and its content
export async function treeHash(dir: string): Promise<Result<string>> {
  const listed = await attempt(() => filesOf(dir), `cannot read ${dir}`);
  const files = listed.kind === "ok" ? listed.value : listed;
  if (files.kind === "failed") {
    return files;
  }
  return attempt(() => hashed(dir, files.value), `cannot read the files of ${dir}`);
}

// sourceOf : the real plugin file and its folder, both safe to trust
export async function sourceOf(path: string): Promise<Result<Source>> {
  const file = await realpath(path).catch(() => undefined);
  if (file === undefined) {
    return failed(`${path} is not there`);
  }
  const dir = dirname(file);
  const owners = [await safeOwner(file), await safeOwner(dir)];
  return owners.find((o) => o.kind === "failed") ?? { kind: "ok", value: { file, dir } };
}

export function storeDir(home: string, sha256: string): string {
  return join(home, "plugins", sha256);
}

async function staged(home: string, source: Source, staging: string): Promise<Result<string>> {
  const copied = await attempt(async () => {
    await mkdir(join(home, "plugins"), { recursive: true, mode: 0o700 });
    await rm(staging, { recursive: true, force: true });
    await cp(source.dir, staging, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    await chmod(staging, 0o700);
  }, `cannot copy ${source.dir}`);
  return copied.kind === "ok" ? treeHash(staging) : copied;
}

async function settle(staging: string, target: string, sha: string, again: Result<string>, dir: string): Promise<Done> {
  if (again.kind === "failed" || again.value !== sha) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    return again.kind === "failed" ? again : failed(`${dir} changed while it was copied; add it again`);
  }
  return attempt(async () => {
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  }, `cannot write ${target}`);
}

// store : the plugin's tree copied into <home>/plugins/<sha256>/ and hashed again there, so what runs is what was
// hashed
export async function store(home: string, source: Source): Promise<Result<Pinned>> {
  const sha = await treeHash(source.dir);
  if (sha.kind === "failed") {
    return sha;
  }
  const target = storeDir(home, sha.value);
  const staging = `${target}.new-${process.pid}`;
  const moved = await settle(staging, target, sha.value, await staged(home, source, staging), source.dir);
  return moved.kind === "ok"
    ? { kind: "ok", value: { sha256: sha.value, entry: join(target, basename(source.file)) } }
    : moved;
}
