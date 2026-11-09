// pins — each listed plugin pinned by commit and hash in the factory home, and checked against its hash before every
// run (#232; docs/DESIGN.md section 5 "Plugins"). Nothing here touches a product repo.
//
//   <home>/marketplaces/<marketplace>/                   the marketplace's git clone, made by the operator (as a team's)
//   <home>/plugins/<marketplace>/<name>/<sha256>/        one fetched version of a plugin, by its hash
//   <home>/projects/<project>.plugins.json               the project's pins: {"<name@marketplace>": {commit, version, sha256}}
//
// The hash covers each file's path, mode and bytes, so a file changed, added or removed in the store is caught on the
// next run, and the run refuses it. A plugin the list names but no pin holds is refused too: only `agent-factory plugin
// update` moves a pin, with a version fetch.ts fetched. **Today:** that command comes in the next part of #232.

import { createHash } from "node:crypto";
import { lstat, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../forge/api.js";
import { prop } from "../dispatch/records.js";
import { projectPath, readProjectRaw } from "../project.js";
import { attempt } from "../review/safe.js";
import { pluginListOf, refText, type PluginRef } from "./plugins.js";
import type { PluginDir } from "./read.js";

export type Pin = { readonly commit: string; readonly version: string; readonly sha256: string };
export type Pins = Readonly<Record<string, Pin>>;
// a pinned plugin, checked against its hash: what a run hands the agent CLI and writes into its records
export type Pinned = PluginDir & { readonly ref: string; readonly pin: Pin };

export const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const SHA256 = /^[0-9a-f]{64}$/;

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

export function marketplaceDir(home: string, marketplace: string): string {
  return join(home, "marketplaces", marketplace);
}

export function pinsPath(home: string, project: string): string {
  return projectPath(home, project).replace(/\.json$/, ".plugins.json");
}

export function storeDir(home: string, ref: PluginRef, sha256: string): string {
  return join(home, "plugins", ref.marketplace, ref.name, sha256);
}

// ---- the hash

// fileLines : one line per file under dir, "<mode> <sha256> <path>", sorted by path; a symlink is refused
async function fileLines(dir: string, under: string): Promise<readonly string[]> {
  const lines: string[] = [];
  for (const name of (await readdir(join(dir, under))).toSorted()) {
    lines.push(...(await entryLines(dir, under === "" ? name : `${under}/${name}`)));
  }
  return lines;
}

// entryLines : a folder's lines, or a plain file's one line; anything else throws, and the hash is refused
async function entryLines(dir: string, path: string): Promise<readonly string[]> {
  const s = await lstat(join(dir, path));
  if (s.isDirectory()) {
    return fileLines(dir, path);
  }
  if (!s.isFile()) {
    throw new Error(`${path} is not a plain file`);
  }
  const sum = createHash("sha256")
    .update(await readFile(join(dir, path)))
    .digest("hex");
  return [`${s.mode & 0o111 ? "x" : "-"} ${sum} ${path}`];
}

// treeHash : the plugin folder's files, each line "<mode> <sha256> <path>", and their sha256
export async function treeHash(
  dir: string,
): Promise<Result<{ readonly sha256: string; readonly files: readonly string[] }>> {
  return attempt(async () => {
    const files = await fileLines(dir, "");
    return { sha256: createHash("sha256").update(files.join("\n")).digest("hex"), files };
  }, `cannot hash ${dir}: it must be a folder of plain files, with no symlink`);
}

// ---- the pins file

export function matching(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function pinOf(value: unknown): Pin | undefined {
  const commit = matching(prop(value, "commit"), COMMIT);
  const version = matching(prop(value, "version"), /^/);
  const sha256 = matching(prop(value, "sha256"), SHA256);
  return commit === undefined || version === undefined || sha256 === undefined
    ? undefined
    : { commit, version, sha256 };
}

export function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isMap(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readPins(home: string, project: string): Promise<Result<Pins>> {
  const path = pinsPath(home, project);
  const raw = parsedJson(await readFile(path, "utf8").catch(() => "{}"));
  const pins = isMap(raw) ? Object.entries(raw).map(([ref, value]) => [ref, pinOf(value)] as const) : [["", undefined]];
  const good = pins.flatMap(([ref, pin]) => (pin === undefined ? [] : [[ref, pin] as const]));
  return good.length === pins.length
    ? { kind: "ok", value: Object.fromEntries(good) }
    : failed(`${path}: must map each name@marketplace to {"commit", "version", "sha256"}`);
}

export async function writePins(home: string, project: string, pins: Pins): Promise<Result<string>> {
  const path = pinsPath(home, project);
  const temp = `${path}.${process.pid}.tmp`;
  return attempt(async () => {
    await writeFile(temp, `${JSON.stringify(pins, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, path);
    return path;
  }, `cannot write ${path}`);
}

// ---- before every run

// verified : the pinned version of one plugin, when its stored folder still has the pin's hash
async function verified(home: string, ref: PluginRef, pins: Pins): Promise<Result<Pinned>> {
  const text = refText(ref);
  const pin = pins[text];
  if (pin === undefined) {
    return failed(`${text} is listed but not pinned: run agent-factory plugin update <project> ${text}`);
  }
  const dir = storeDir(home, ref, pin.sha256);
  const hash = await treeHash(dir);
  if (hash.kind === "failed" || hash.value.sha256 !== pin.sha256) {
    return failed(`${dir} does not match the pin of ${text} (sha256:${pin.sha256.slice(0, 12)}); a person checks it`);
  }
  return { kind: "ok", value: { label: text, dir, ref: text, pin } };
}

// pinnedPlugins : every plugin the project lists, in order, each checked against its pin; none when it lists none
export async function pinnedPlugins(input: {
  readonly home: string;
  readonly project: string;
  readonly env: NodeJS.ProcessEnv;
}): Promise<Result<readonly Pinned[]>> {
  const refs = await listedPlugins(input);
  if (refs.kind === "failed") {
    return refs;
  }
  const pins = refs.value.length === 0 ? { kind: "ok" as const, value: {} } : await readPins(input.home, input.project);
  return pins.kind === "ok" ? allVerified(input.home, refs.value, pins.value) : pins;
}

async function allVerified(home: string, refs: readonly PluginRef[], pins: Pins): Promise<Result<readonly Pinned[]>> {
  const out: Pinned[] = [];
  for (const ref of refs) {
    const one = await verified(home, ref, pins);
    if (one.kind === "failed") {
      return one;
    }
    out.push(one.value);
  }
  return { kind: "ok", value: out };
}

// listedPlugins : the plugins the project's resolved settings list; none when it has no project file
export async function listedPlugins(input: {
  readonly home: string;
  readonly project: string;
  readonly env: NodeJS.ProcessEnv;
}): Promise<Result<readonly PluginRef[]>> {
  const raw = await readProjectRaw(input, "no plugins");
  if (raw.kind !== "ok") {
    return raw.kind === "missing" ? { kind: "ok", value: [] } : raw;
  }
  return pluginListOf(raw.path, raw.value);
}
