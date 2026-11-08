// registry — the plugins this machine trusts, pinned (#134; ADR-0014 P2, P8, P10). `<home>/plugins.json` names each
// plugin's absolute path and the sha256 of its file, as `plugin add` saw them. Every call hashes the file again, and a
// file that changed is refused, so a plugin never changes under the person after review. There is no PATH scan at run
// time and no network install: a plugin is bundled with the package or a local file the person names.

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Done, Result } from "../forge/api.js";
import { codeOf, prop } from "../dispatch/records.js";
import { attempt } from "../review/safe.js";
import {
  PROTOCOL,
  isPoint,
  pluginEnv,
  readDescribe,
  readResult,
  type Described,
  type ExtensionPoint,
  type PluginResult,
} from "./contract.js";
import { DEFAULT_LIMITS, runPlugin, type Exec, type Limits, type Ran } from "./exec.js";

export type Entry = Described & { readonly path: string; readonly sha256: string };
export type Registry = Readonly<Record<string, Entry>>;

export type Setup = {
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  // the PATH a plugin finds its CLI on: no relative entry, nothing inside a project
  readonly path: string;
  readonly exec?: Exec;
  readonly limits?: Limits;
};

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

export function registryPath(home: string): string {
  return join(home, "plugins.json");
}

export async function hashFile(path: string): Promise<Result<string>> {
  try {
    return {
      kind: "ok",
      value: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    };
  } catch {
    return failed(`cannot read ${path}`);
  }
}

function pinOf(raw: unknown): { readonly path: string; readonly sha256: string } | "none" {
  const path = prop(raw, "path");
  const sha = prop(raw, "sha256");
  const ok = typeof path === "string" && isAbsolute(path) && typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha);
  return ok ? { path, sha256: sha } : "none";
}

function entryOf(name: string, raw: unknown): Entry | "none" {
  const described = readDescribe(JSON.stringify(raw));
  const pin = pinOf(raw);
  return described.kind === "ok" && described.value.name === name && pin !== "none"
    ? { ...described.value, ...pin }
    : "none";
}

async function registryText(file: string): Promise<Result<string>> {
  try {
    return { kind: "ok", value: await readFile(file, "utf8") };
  } catch (error) {
    return codeOf(error) === "ENOENT" ? { kind: "ok", value: "{}" } : failed(`cannot read ${file}`);
  }
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function pluginsOf(file: string, raw: unknown): Result<object> {
  if (raw === undefined) {
    return failed(`${file} is not JSON; fix it or remove it, then plugin add again`);
  }
  const plugins = prop(raw, "plugins") ?? {};
  return typeof plugins === "object" && plugins !== null
    ? { kind: "ok", value: plugins }
    : failed(`${file} is not a plugins file`);
}

function entriesOf(file: string, raw: unknown): Result<Registry> {
  const found = pluginsOf(file, raw);
  if (found.kind === "failed") {
    return found;
  }
  const plugins = found.value;
  const read = Object.entries(plugins).map(([name, value]) => [name, entryOf(name, value)] as const);
  const bad = read.find(([, e]) => e === "none");
  return bad === undefined
    ? { kind: "ok", value: Object.fromEntries(read.filter((r): r is readonly [string, Entry] => r[1] !== "none")) }
    : failed(`${file}: the entry for ${bad[0]} is not valid; run agent-factory plugin add again`);
}

// readRegistry : the registered plugins; no file is none; a file that does not read is refused, never read as empty
export async function readRegistry(home: string): Promise<Result<Registry>> {
  const file = registryPath(home);
  const text = await registryText(file);
  return text.kind === "ok" ? entriesOf(file, parsed(text.value)) : text;
}

async function writeRegistry(home: string, registry: Registry): Promise<Done> {
  const file = registryPath(home);
  return attempt(async () => {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(`${file}.new`, `${JSON.stringify({ plugins: registry }, null, 2)}\n`, { mode: 0o600 });
    await chmod(`${file}.new`, 0o600);
    await rename(`${file}.new`, file);
  }, `cannot write ${file}`);
}

const REASONS: { readonly [K in Ran["kind"]]: (ran: Extract<Ran, { kind: K }>) => string } = {
  exited: (r) => `exited ${r.code}${r.stderr.trim() === "" ? "" : `: ${r.stderr.trim().split("\n").at(-1) ?? ""}`}`,
  timedOut: (r) => `ran out of time (${r.ms} ms)`,
  overCap: (r) => `printed more than ${r.bytes} bytes`,
  failed: (r) => r.reason,
};

function reasonAs<K extends Ran["kind"]>(kind: K, ran: Extract<Ran, { kind: K }>): string {
  return REASONS[kind](ran);
}

function ranReason(ran: Ran): string {
  return reasonAs(ran.kind, ran);
}

// stdoutOf : what the plugin printed when it exited 0, or why it gave nothing usable
function stdoutOf(ran: Ran): Result<string> {
  return ran.kind === "exited" && ran.code === 0 ? { kind: "ok", value: ran.stdout } : failed(ranReason(ran));
}

async function describeAt(setup: Setup, path: string): Promise<Result<Described>> {
  const ran = await (setup.exec ?? runPlugin)({
    path,
    args: ["describe"],
    stdin: "",
    env: pluginEnv(setup.env, [], setup.path),
    limits: setup.limits ?? DEFAULT_LIMITS,
  });
  const out = stdoutOf(ran);
  return out.kind === "ok" ? readDescribe(out.value) : failed(`describe ${out.reason}`);
}

async function executable(path: string): Promise<Done> {
  const s = await stat(path).catch(() => undefined);
  if (s === undefined || !s.isFile()) {
    return failed(`${path} is not a file`);
  }
  return (s.mode & 0o111) === 0 ? failed(`${path} is not executable`) : { kind: "ok" };
}

// inspect : what a plugin file says about itself, and its hash; nothing is recorded
export async function inspect(setup: Setup, path: string): Promise<Result<Entry>> {
  if (!isAbsolute(path)) {
    return failed(`a plugin is named by its absolute path, got ${JSON.stringify(path)}`);
  }
  const file = await executable(path);
  const sha = file.kind === "ok" ? await hashFile(path) : file;
  if (sha.kind === "failed") {
    return sha;
  }
  const described = await describeAt(setup, path);
  return described.kind === "ok" ? { kind: "ok", value: { ...described.value, path, sha256: sha.value } } : described;
}

function nameFree(registry: Registry, entry: Entry): Done {
  const taken = registry[entry.name];
  return taken === undefined || taken.path === entry.path
    ? { kind: "ok" }
    : failed(`the name ${entry.name} is already ${taken.path}; plugin update it, or remove it first`);
}

// addPlugin : the plugin, recorded with its path and hash; a name already taken by another file is refused
export async function addPlugin(setup: Setup, path: string): Promise<Result<Entry>> {
  const registry = await readRegistry(setup.home);
  if (registry.kind === "failed") {
    return registry;
  }
  const entry = await inspect(setup, path);
  return entry.kind === "ok" ? recorded(setup.home, registry.value, entry.value) : entry;
}

async function recorded(home: string, registry: Registry, entry: Entry): Promise<Result<Entry>> {
  const free = nameFree(registry, entry);
  const written = free.kind === "ok" ? await writeRegistry(home, { ...registry, [entry.name]: entry }) : free;
  return written.kind === "ok" ? { kind: "ok", value: entry } : written;
}

export type Change = { readonly before: Entry; readonly after: Entry; readonly writesAdded: readonly string[] };

// registered : one plugin's entry, or why there is none
async function registered(home: string, name: string): Promise<Result<Entry>> {
  const registry = await readRegistry(home);
  if (registry.kind === "failed") {
    return registry;
  }
  const entry = registry.value[name];
  return entry === undefined ? failed(`no plugin named ${name}; plugin add it first`) : { kind: "ok", value: entry };
}

function changeOf(name: string, before: Entry, after: Entry): Result<Change> {
  const writesAdded = after.writes.filter((w) => !before.writes.includes(w));
  return after.name === name
    ? { kind: "ok", value: { before, after, writesAdded } }
    : failed(`${before.path} now calls itself ${after.name}, not ${name}`);
}

// planUpdate : what an update would record, and the writes it would add; nothing is written yet
export async function planUpdate(setup: Setup, name: string): Promise<Result<Change>> {
  const before = await registered(setup.home, name);
  if (before.kind === "failed") {
    return before;
  }
  const after = await inspect(setup, before.value.path);
  return after.kind === "ok" ? changeOf(name, before.value, after.value) : after;
}

export async function applyUpdate(setup: Setup, change: Change): Promise<Done> {
  const registry = await readRegistry(setup.home);
  return registry.kind === "ok"
    ? writeRegistry(setup.home, { ...registry.value, [change.after.name]: change.after })
    : registry;
}

export type Call = {
  readonly plugin: string;
  readonly capability: ExtensionPoint;
  readonly op: string;
  readonly input: unknown;
};

async function unchanged(entry: Entry, name: string): Promise<Done> {
  const sha = await hashFile(entry.path);
  return sha.kind === "ok" && sha.value === entry.sha256
    ? { kind: "ok" }
    : failed(`the plugin ${name} changed since it was added (${entry.path}); review it, then plugin update`);
}

// checked : the plugin's entry, when its file is the one recorded and it declares the capability
async function checked(setup: Setup, call: Call): Promise<Result<Entry>> {
  const entry = await registered(setup.home, call.plugin);
  if (entry.kind === "failed") {
    return entry;
  }
  const same = await unchanged(entry.value, call.plugin);
  return same.kind === "ok" ? declares(entry.value, call) : same;
}

function declares(entry: Entry, call: Call): Result<Entry> {
  return entry.capabilities.some((c) => c.name === call.capability)
    ? { kind: "ok", value: entry }
    : failed(`the plugin ${call.plugin} does not declare ${call.capability}`);
}

// callPlugin : one call of a registered plugin; a changed file, an undeclared capability or a broken answer is refused
export async function callPlugin(setup: Setup, call: Call): Promise<Result<PluginResult>> {
  const entry = isPoint(call.capability)
    ? await checked(setup, call)
    : failed(`${String(call.capability)} is not an extension point`);
  if (entry.kind === "failed") {
    return entry;
  }
  const ran = await runCall(setup, entry.value, call);
  const out = stdoutOf(ran);
  const result = out.kind === "ok" ? readResult(out.value) : out;
  return result.kind === "ok" ? result : failed(`the plugin ${call.plugin}: ${result.reason}`);
}

function runCall(setup: Setup, entry: Entry, call: Call): Promise<Ran> {
  const request = { protocol: PROTOCOL, capability: call.capability, op: call.op, input: call.input };
  return (setup.exec ?? runPlugin)({
    path: entry.path,
    args: ["call"],
    stdin: JSON.stringify(request),
    env: pluginEnv(setup.env, entry.env, setup.path),
    limits: setup.limits ?? DEFAULT_LIMITS,
  });
}
