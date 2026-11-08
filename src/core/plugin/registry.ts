// registry — the plugins this machine trusts, pinned (#134; ADR-0014 P2, P8, P10). `<home>/plugins.json` (mode 600)
// names each plugin's source, the sha256 of its folder (pin.ts) and the copy in <home>/plugins/<sha256>/ the core runs.
// Every call hashes the copy again; a copy that changed is refused. `add` never replaces a plugin: `update` shows the
// new version and records it only for the hash the person saw. There is no PATH scan at run time and no network
// install: a plugin is bundled with the package or a local folder the person names. Nothing here throws.

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Done, Result } from "../forge/api.js";
import { codeOf, prop } from "../dispatch/records.js";
import { attempt } from "../review/safe.js";
import {
  isPoint,
  pluginEnv,
  readDescribe,
  readResult,
  WRITE_POINTS,
  type Described,
  type ExtensionPoint,
  type PluginResult,
} from "./contract.js";
import { DEFAULT_LIMITS, runPlugin, type Exec, type Limits, type Ran } from "./exec.js";
import { sourceOf, store, treeHash, type Source } from "./pin.js";
import type { Secret } from "../token/rules.js";

// source: the file the person named, as its real path; path: the pinned copy that runs
export type Entry = Described & { readonly source: string; readonly path: string; readonly sha256: string };
export type Registry = Readonly<Record<string, Entry>>;

export type Setup = {
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  // the PATH a plugin finds its CLI and its interpreter on (trustedPluginPath)
  readonly path: string;
  readonly exec?: Exec;
  readonly limits?: Limits;
  // the secrets a call of this plugin's capability carries in its input, on stdin only: never in env, argv or a file
  // the plugin did not make (the Discord webhook, #119); none when not set
  readonly secrets?: Secrets;
};

export type Secrets = (plugin: string, capability: ExtensionPoint) => Promise<Result<Readonly<Record<string, Secret>>>>;

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

export function registryPath(home: string): string {
  return join(home, "plugins.json");
}

function absoluteString(value: unknown): value is string {
  return typeof value === "string" && isAbsolute(value);
}

function pinOf(raw: unknown): Pick<Entry, "source" | "path" | "sha256"> | "none" {
  const source = prop(raw, "source");
  const path = prop(raw, "path");
  const sha = prop(raw, "sha256");
  const ok = absoluteString(source) && absoluteString(path) && typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha);
  return ok ? { source, path, sha256: sha } : "none";
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
    return codeOf(error) === "ENOENT" ? { kind: "ok", value: '{"plugins":{}}' } : failed(`cannot read ${file}`);
  }
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isMap(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pluginsOf(file: string, raw: unknown): Result<object> {
  const plugins = prop(raw, "plugins");
  return isMap(raw) && isMap(plugins)
    ? { kind: "ok", value: plugins }
    : failed(`${file} is not a plugins file; fix it or remove it, then plugin add again`);
}

function entriesOf(file: string, raw: unknown): Result<Registry> {
  const found = pluginsOf(file, raw);
  if (found.kind === "failed") {
    return found;
  }
  const read = Object.entries(found.value).map(([name, value]) => [name, entryOf(name, value)] as const);
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

// locked : the change, while no other plugin change runs; the lock file is the guard
async function locked<T>(home: string, change: () => Promise<Result<T>>): Promise<Result<T>> {
  const lock = `${registryPath(home)}.lock`;
  const took = await attempt(async () => {
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  }, `another plugin change is running (${lock}); remove that file if none is`);
  if (took.kind === "failed") {
    return took;
  }
  try {
    return await change();
  } finally {
    await rm(lock, { force: true }).catch(() => undefined);
  }
}

async function writeRegistry(home: string, registry: Registry): Promise<Done> {
  const file = registryPath(home);
  const temp = `${file}.${randomBytes(6).toString("hex")}`;
  return attempt(async () => {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(temp, `${JSON.stringify({ plugins: registry }, null, 2)}\n`, { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, file);
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

export function ranReason(ran: Ran): string {
  return reasonAs(ran.kind, ran);
}

// stdoutOf : what the plugin printed when it exited 0, or why it gave nothing usable
export function stdoutOf(ran: Ran): Result<string> {
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

// trustworthy : the plugin's real file and folder, when they are executable, ours and writable by no one else
async function trustworthy(path: string): Promise<Result<Source>> {
  if (!isAbsolute(path)) {
    return failed(`a plugin is named by its absolute path, got ${JSON.stringify(path)}`);
  }
  const file = await executable(path);
  return file.kind === "ok" ? sourceOf(path) : file;
}

// inspect : what a plugin says about itself and the hash of its folder; nothing is recorded or copied
export async function inspect(setup: Setup, path: string): Promise<Result<Entry>> {
  const source = await trustworthy(path);
  if (source.kind === "failed") {
    return source;
  }
  const sha = await treeHash(source.value.dir);
  return sha.kind === "ok" ? describedAt(setup, source.value.file, sha.value) : sha;
}

async function describedAt(setup: Setup, file: string, sha256: string): Promise<Result<Entry>> {
  const d = await describeAt(setup, file);
  return d.kind === "ok" ? { kind: "ok", value: { ...d.value, source: file, path: file, sha256 } } : d;
}

// pinned : the entry, with its folder copied into the store; the copy's hash must be the one inspected
async function pinned(setup: Setup, entry: Entry): Promise<Result<Entry>> {
  const copy = await store(setup.home, { file: entry.source, dir: dirname(entry.source) });
  if (copy.kind === "failed") {
    return copy;
  }
  return copy.value.sha256 === entry.sha256
    ? { kind: "ok", value: { ...entry, path: copy.value.entry } }
    : failed(`${dirname(entry.source)} changed since it was inspected; run it again`);
}

function has(registry: Registry, name: string): boolean {
  return Object.hasOwn(registry, name);
}

async function addLocked(setup: Setup, path: string): Promise<Result<Entry>> {
  const registry = await readRegistry(setup.home);
  if (registry.kind === "failed") {
    return registry;
  }
  const entry = await inspect(setup, path);
  return entry.kind === "ok" ? addNew(setup, registry.value, entry.value) : entry;
}

function addNew(setup: Setup, registry: Registry, entry: Entry): Promise<Result<Entry>> | Result<Entry> {
  return has(registry, entry.name)
    ? failed(`${entry.name} is added already; plugin update ${entry.name} to change it`)
    : recorded(setup, registry, entry);
}

async function recorded(setup: Setup, registry: Registry, entry: Entry): Promise<Result<Entry>> {
  const copy = await pinned(setup, entry);
  if (copy.kind === "failed") {
    return copy;
  }
  const written = await writeRegistry(setup.home, { ...registry, [entry.name]: copy.value });
  return written.kind === "ok" ? copy : written;
}

// addPlugin : a new plugin, pinned and copied; a name already added is refused, so nothing is replaced unseen
export function addPlugin(setup: Setup, path: string): Promise<Result<Entry>> {
  return locked(setup.home, () => addLocked(setup, path));
}

export type Change = { readonly before: Entry; readonly after: Entry; readonly writesAdded: readonly string[] };

// registered : one plugin's entry, or why there is none
export async function registered(home: string, name: string): Promise<Result<Entry>> {
  const registry = await readRegistry(home);
  if (registry.kind === "failed") {
    return registry;
  }
  const entry = has(registry.value, name) ? registry.value[name] : undefined;
  return entry === undefined ? failed(`no plugin named ${name}; plugin add it first`) : { kind: "ok", value: entry };
}

function changeOf(name: string, before: Entry, after: Entry): Result<Change> {
  const writesAdded = after.writes.filter((w) => !before.writes.includes(w));
  return after.name === name
    ? { kind: "ok", value: { before, after, writesAdded } }
    : failed(`${before.source} now calls itself ${after.name}, not ${name}`);
}

// planUpdate : what an update would record, and the writes it would add; nothing is written yet
export async function planUpdate(setup: Setup, name: string): Promise<Result<Change>> {
  const before = await registered(setup.home, name);
  if (before.kind === "failed") {
    return before;
  }
  const after = await inspect(setup, before.value.source);
  return after.kind === "ok" ? changeOf(name, before.value, after.value) : after;
}

function seen(change: Change, name: string, sha256: string): Done {
  const now = change.after.sha256;
  return now === sha256
    ? { kind: "ok" }
    : failed(
        `${name} is now ${now.slice(0, 12)}, not the ${sha256.slice(0, 12)} you saw; run plugin update ${name} again`,
      );
}

async function applyLocked(setup: Setup, name: string, sha256: string): Promise<Result<Entry>> {
  const change = await planUpdate(setup, name);
  if (change.kind === "failed") {
    return change;
  }
  const same = seen(change.value, name, sha256);
  return same.kind === "ok" ? recordedNow(setup, change.value.after) : same;
}

async function recordedNow(setup: Setup, entry: Entry): Promise<Result<Entry>> {
  const registry = await readRegistry(setup.home);
  return registry.kind === "ok" ? recorded(setup, registry.value, entry) : registry;
}

// applyUpdate : the new version, recorded only when its hash is the one the person was shown
export function applyUpdate(setup: Setup, name: string, sha256: string): Promise<Result<Entry>> {
  return locked(setup.home, () => applyLocked(setup, name, sha256));
}

export type Call = {
  readonly plugin: string;
  readonly capability: ExtensionPoint;
  readonly op: string;
  readonly input: unknown;
};

async function unchanged(entry: Entry, name: string): Promise<Done> {
  const sha = await treeHash(dirname(entry.path));
  return sha.kind === "ok" && sha.value === entry.sha256
    ? { kind: "ok" }
    : failed(`the plugin ${name} changed since it was added (${entry.path}); review it, then plugin update`);
}

// checked : the plugin's entry, when its pinned copy is unchanged and it declares the capability
async function checked(setup: Setup, call: Call): Promise<Result<Entry>> {
  const entry = await registered(setup.home, call.plugin);
  if (entry.kind === "failed") {
    return entry;
  }
  const same = await unchanged(entry.value, call.plugin);
  return same.kind === "ok" ? declares(entry.value, call) : same;
}

// declares : the capability is the plugin's, and a write is one it declared (ADR-0014 P5)
function declares(entry: Entry, call: Call): Result<Entry> {
  if (!entry.capabilities.some((c) => c.name === call.capability)) {
    return failed(`the plugin ${call.plugin} does not declare ${call.capability}`);
  }
  return WRITE_POINTS.includes(call.capability) && !entry.writes.includes(call.capability)
    ? failed(`the plugin ${call.plugin} did not declare the write ${call.capability}; it may not perform it`)
    : { kind: "ok", value: entry };
}

// callPlugin : one call of a registered plugin; a changed copy, an undeclared capability or a broken answer is refused
export async function callPlugin(setup: Setup, call: Call): Promise<Result<PluginResult>> {
  const entry = isPoint(call.capability)
    ? await checked(setup, call)
    : failed(`${String(call.capability)} is not an extension point`);
  if (entry.kind === "failed") {
    return entry;
  }
  const result = await answered(setup, entry.value, call);
  return result.kind === "ok" ? result : failed(`the plugin ${call.plugin}: ${result.reason}`);
}

// answered : the call, with its secrets, run and read
async function answered(setup: Setup, entry: Entry, call: Call): Promise<Result<PluginResult>> {
  const input = await withSecrets(setup, call);
  const ran = input.kind === "ok" ? stdoutOf(await runCall(setup, entry, { ...call, input: input.value })) : input;
  return ran.kind === "ok" ? readResult(ran.value) : ran;
}

// withSecrets : the call's input with the secrets its plugin and capability carry, revealed only here, into the request
async function withSecrets(setup: Setup, call: Call): Promise<Result<unknown>> {
  if (setup.secrets === undefined) {
    return { kind: "ok", value: call.input };
  }
  const secrets = await setup.secrets(call.plugin, call.capability);
  return secrets.kind === "ok" ? { kind: "ok", value: merged(call.input, secrets.value) } : secrets;
}

function merged(input: unknown, secrets: Readonly<Record<string, Secret>>): unknown {
  const revealed = Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, v.reveal()]));
  return Object.keys(revealed).length === 0 ? input : { ...Object(input), ...revealed };
}

// runCall : the request in the plugin's own protocol major, so a plugin on N−1 is spoken to as it expects
function runCall(setup: Setup, entry: Entry, call: Call): Promise<Ran> {
  const request = { protocol: entry.protocol, capability: call.capability, op: call.op, input: call.input };
  return (setup.exec ?? runPlugin)({
    path: entry.path,
    args: ["call"],
    stdin: JSON.stringify(request),
    env: pluginEnv(setup.env, entry.env, setup.path),
    limits: setup.limits ?? DEFAULT_LIMITS,
  });
}
