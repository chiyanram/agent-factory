// plugin-cli — `agent-factory plugin add | update | test | list` (#134; ADR-0014 P2, P8, P10). A plugin is named by its
// absolute path, or by the name of one bundled with the package (<package>/plugins/<name>/plugin). Nothing is fetched
// from the network. `update` shows the writes a new version adds and records it only with --yes.

import { access } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Result } from "./core/forge/api.js";
import { trustedPath } from "./core/git.js";
import { testPlugin } from "./core/plugin/kit.js";
import { addPlugin, applyUpdate, planUpdate, readRegistry, type Entry, type Setup } from "./core/plugin/registry.js";

export type PluginIo = {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly home: string;
  readonly pkg: string;
  readonly yes: boolean;
};

function setupOf(io: PluginIo): Setup {
  return { home: io.home, env: io.env, path: trustedPath(io.env.PATH ?? "", { kind: "none" }) };
}

// located : the plugin file a word names: an absolute path, or a bundled plugin's name
async function located(io: PluginIo, word: string): Promise<Result<string>> {
  if (isAbsolute(word)) {
    return { kind: "ok", value: word };
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
  const entry = path.kind === "ok" ? await addPlugin(setupOf(io), path.value) : path;
  if (entry.kind === "failed") {
    return fail(io, "add", entry.reason);
  }
  io.out(`added ${line(entry.value)}\n`);
  return 0;
}

async function update(io: PluginIo, name: string): Promise<number> {
  const change = await planUpdate(setupOf(io), name);
  if (change.kind === "failed") {
    return fail(io, "update", change.reason);
  }
  const { after, writesAdded } = change.value;
  io.out(`${line(after)}\n${writesAdded.length === 0 ? "no new writes" : `new writes: ${writesAdded.join(", ")}`}\n`);
  if (!io.yes) {
    io.out("nothing recorded; run it again with --yes to record this version\n");
    return 3;
  }
  const done = await applyUpdate(setupOf(io), change.value);
  return done.kind === "ok" ? (io.out(`updated ${name}\n`), 0) : fail(io, "update", done.reason);
}

async function test(io: PluginIo, word: string): Promise<number> {
  const path = await located(io, word);
  if (path.kind === "failed") {
    return fail(io, "test", path.reason);
  }
  const checks = await testPlugin(setupOf(io), path.value);
  io.out(checks.map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}\n`).join(""));
  return checks.every((c) => c.ok) ? 0 : 2;
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

const USAGE = "usage: agent-factory plugin add <path|bundled name> | update <name> [--yes] | test <path|name> | list\n";

type Verb = (io: PluginIo, arg: string) => Promise<number>;

// each subcommand and how many words it takes after it
const VERBS: Readonly<Record<string, { readonly words: number; readonly run: Verb }>> = {
  add: { words: 1, run: add },
  update: { words: 1, run: update },
  test: { words: 1, run: test },
  list: { words: 0, run: (io) => list(io) },
};

// pluginCommand : one plugin subcommand; exit 0 done, 1 refused, 2 a test check failed, 3 an update not recorded
export function pluginCommand(positionals: readonly string[], io: PluginIo): Promise<number> | number {
  const [verb = "", arg = ""] = positionals;
  const chosen = VERBS[verb];
  if (chosen === undefined || positionals.length !== chosen.words + 1) {
    io.err(USAGE);
    return 64;
  }
  return chosen.run(io, arg);
}
