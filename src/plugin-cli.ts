// plugin-cli — `agent-factory plugin add | update | test | list` (#134; ADR-0014 P2, P8, P10). A plugin is named by its
// absolute path, or by the name of one bundled with the package (<package>/plugins/<name>/plugin). Nothing is fetched
// from the network. `update <name>` runs the test kit and shows the new version's hash and the writes it adds;
// `update <name> <sha256>` records it, only when that is still the hash.

import { access, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Result } from "./core/forge/api.js";
import { PLUGIN_NAME } from "./core/plugin/contract.js";
import { testPlugin, type Check } from "./core/plugin/kit.js";
import { addPlugin, applyUpdate, planUpdate, readRegistry, type Entry, type Setup } from "./core/plugin/registry.js";

export type PluginIo = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly home: string;
  readonly pkg: string;
};

// pluginPath : the PATH a plugin runs with: absolute folders that are there and that no one but their owner can write
export async function pluginPath(path: string): Promise<string> {
  const dirs = [...new Set(path.split(":").filter((d) => isAbsolute(d)))];
  const kept = await Promise.all(dirs.map(async (dir) => ((await ownersOnly(dir)) ? dir : "")));
  return kept.filter((d) => d !== "").join(":");
}

async function ownersOnly(dir: string): Promise<boolean> {
  const s = await stat(dir).catch(() => undefined);
  return s !== undefined && s.isDirectory() && (s.mode & 0o022) === 0;
}

// pluginSetup : what a plugin runs with: the factory's home, the environment it picks from, and the trusted PATH
export async function pluginSetup(home: string, env: NodeJS.ProcessEnv): Promise<Setup> {
  return { home, env, path: await pluginPath(env.PATH ?? "") };
}

function setupOf(io: PluginIo): Promise<Setup> {
  return pluginSetup(io.home, io.env);
}

// located : the plugin file a word names: an absolute path, or a bundled plugin's name
async function located(io: PluginIo, word: string): Promise<Result<string>> {
  if (isAbsolute(word)) {
    return { kind: "ok", value: word };
  }
  if (!PLUGIN_NAME.test(word)) {
    return { kind: "failed", reason: `${JSON.stringify(word)} is neither an absolute path nor a plugin name` };
  }
  const bundled = join(io.pkg, "plugins", word, "plugin");
  return access(bundled).then(
    (): Result<string> => ({ kind: "ok", value: bundled }),
    (): Result<string> => ({
      kind: "failed",
      reason: `${JSON.stringify(word)} is neither an absolute path nor a bundled plugin (${join(io.pkg, "plugins")})`,
    }),
  );
}

function line(e: Entry): string {
  const caps = e.capabilities.map((c) => (c.mandatory ? `${c.name}!` : c.name)).join(", ");
  return `${e.name} ${e.version} (protocol ${e.protocol}): ${caps}; writes ${e.writes.join(", ") || "none"}; env ${e.env.join(", ") || "none"}; ${e.path} sha256:${e.sha256.slice(0, 12)}`;
}

function fail(io: PluginIo, what: string, reason: string): number {
  io.err(`agent-factory plugin ${what}: ${reason}\n`);
  return 1;
}

async function add(io: PluginIo, word: string): Promise<number> {
  const path = await located(io, word);
  const entry = path.kind === "ok" ? await addPlugin(await setupOf(io), path.value) : path;
  if (entry.kind === "failed") {
    return fail(io, "add", entry.reason);
  }
  io.out(`added ${line(entry.value)}\n`);
  return 0;
}

function report(io: PluginIo, checks: readonly Check[]): boolean {
  io.out(checks.map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}\n`).join(""));
  return checks.every((c) => c.ok);
}

// update <name> : the test kit on the new version, then its hash and the writes it adds; nothing is recorded
async function showUpdate(io: PluginIo, name: string): Promise<number> {
  const setup = await setupOf(io);
  const change = await planUpdate(setup, name);
  if (change.kind === "failed") {
    return fail(io, "update", change.reason);
  }
  const { after, writesAdded } = change.value;
  const passed = report(io, await testPlugin(setup, after.source));
  io.out(`${line(after)}\n${writesAdded.length === 0 ? "no new writes" : `new writes: ${writesAdded.join(", ")}`}\n`);
  if (!passed) {
    return fail(io, "update", "the new version fails the test kit; nothing recorded");
  }
  io.out(`nothing recorded; to record this version: agent-factory plugin update ${name} ${after.sha256}\n`);
  return 3;
}

// update <name> <sha256> : the version with that hash, after the test kit passes again
async function recordUpdate(io: PluginIo, name: string, sha256: string): Promise<number> {
  const setup = await setupOf(io);
  const change = await planUpdate(setup, name);
  if (change.kind === "failed") {
    return fail(io, "update", change.reason);
  }
  if (!report(io, await testPlugin(setup, change.value.after.source))) {
    return fail(io, "update", "the new version fails the test kit; nothing recorded");
  }
  const done = await applyUpdate(setup, name, sha256);
  return done.kind === "ok" ? (io.out(`updated ${line(done.value)}\n`), 0) : fail(io, "update", done.reason);
}

async function test(io: PluginIo, word: string): Promise<number> {
  const path = await located(io, word);
  if (path.kind === "failed") {
    return fail(io, "test", path.reason);
  }
  return report(io, await testPlugin(await setupOf(io), path.value)) ? 0 : 2;
}

async function list(io: PluginIo): Promise<number> {
  const registry = await readRegistry(io.home);
  if (registry.kind === "failed") {
    return fail(io, "list", registry.reason);
  }
  const entries = Object.values(registry.value);
  io.out(entries.length === 0 ? "no plugins\n" : entries.map((e) => `${line(e)}\n`).join(""));
  return 0;
}

const USAGE =
  "usage: agent-factory plugin add <path|bundled name> | update <name> [<sha256>] | test <path|name> | list\n";

type Verb = (io: PluginIo, args: readonly string[]) => Promise<number>;

// each subcommand and the numbers of words it takes after it
const VERBS: Readonly<Record<string, { readonly words: readonly number[]; readonly run: Verb }>> = {
  add: { words: [1], run: (io, [path = ""]) => add(io, path) },
  update: {
    words: [1, 2],
    run: (io, [name = "", sha]) => (sha === undefined ? showUpdate(io, name) : recordUpdate(io, name, sha)),
  },
  test: { words: [1], run: (io, [word = ""]) => test(io, word) },
  list: { words: [0], run: (io) => list(io) },
};

// pluginCommand : one plugin subcommand; exit 0 done, 1 refused, 2 a test check failed, 3 an update not recorded
export function pluginCommand(positionals: readonly string[], io: PluginIo): Promise<number> | number {
  const [verb = "", ...args] = positionals;
  const chosen = Object.hasOwn(VERBS, verb) ? VERBS[verb] : undefined;
  if (chosen === undefined || !chosen.words.includes(args.length)) {
    io.err(USAGE);
    return 64;
  }
  return chosen.run(io, args);
}
