// claude-plugins — whether a Claude Code plugin is really enabled, read back from Claude Code's own files, because an
// install can exit 0 and leave the plugin off, or enabled at the wrong scope (#555). It writes nothing and runs no
// program. Checked on Claude Code 2.1.326:
//
//   <config>/settings.json                         enabledPlugins["<name>@<marketplace>"]: true or false (user scope)
//   <config>/plugins/installed_plugins.json        plugins["<id>"]: one entry per install, each with its scope
//   <folder>/.claude/settings.json, settings.local.json   the same key at project and local scope
//
// <config> is $CLAUDE_CONFIG_DIR, else ~/.claude. The plugin must be on at user scope and nowhere at project or local
// scope: a folder's entry writes into the clone and overrides the user's choice either way.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { codeOf } from "../dispatch/records.js";

export const DISCORD_PLUGIN = "discord@claude-plugins-official";

export const KNOWN_PLUGINS: readonly string[] = [DISCORD_PLUGIN];

export type PluginPlaces = { readonly env: NodeJS.ProcessEnv; readonly folders: readonly string[] };

export type PluginState =
  | { readonly kind: "on"; readonly file: string }
  | {
      readonly kind: "off" | "missing" | "project" | "unreadable";
      readonly file: string;
      readonly reason: string;
      readonly fix: string;
    };

export function claudeConfigDir(env: NodeJS.ProcessEnv): string {
  const set = env.CLAUDE_CONFIG_DIR ?? "";
  return set !== "" ? set : join(env.HOME ?? homedir(), ".claude");
}

type Json =
  | { readonly kind: "absent" }
  | { readonly kind: "bad" }
  | { readonly kind: "denied"; readonly code: string }
  | { readonly kind: "ok"; readonly value: unknown };

async function readJson(file: string): Promise<Json> {
  const text = await readFile(file, "utf8").catch((e: unknown): Json => {
    const code = codeOf(e);
    return code === "ENOENT" ? { kind: "absent" } : { kind: "denied", code: code === "" ? String(e) : code };
  });
  if (typeof text !== "string") {
    return text;
  }
  try {
    return { kind: "ok", value: JSON.parse(text) as unknown };
  } catch {
    return { kind: "bad" };
  }
}

function at(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (v, k) => (typeof v === "object" && v !== null && Object.hasOwn(v, k) ? Reflect.get(v, k) : undefined),
    value,
  );
}

function unreadable(file: string, got: Json): PluginState | undefined {
  if (got.kind === "denied") {
    return { kind: "unreadable", file, reason: `cannot read ${file} (${got.code})`, fix: `let this user read ${file}` };
  }
  return got.kind === "bad"
    ? { kind: "unreadable", file, reason: `${file} is not valid JSON`, fix: `fix the JSON in ${file}` }
    : undefined;
}

function missing(id: string, file: string, why: string): PluginState {
  return {
    kind: "missing",
    file,
    reason: `not installed at user scope: ${why}`,
    fix: `claude plugin install ${id} --scope user`,
  };
}

function folderStep(id: string, file: string, got: Json): PluginState | undefined {
  const cannot = unreadable(file, got);
  if (cannot !== undefined) {
    return cannot;
  }
  return got.kind === "ok" && at(got.value, ["enabledPlugins", id]) !== undefined
    ? {
        kind: "project",
        file,
        reason: `set at project scope in ${file}, which writes into the folder and overrides the user's choice`,
        fix: `remove enabledPlugins.${id} from ${file}, then claude plugin enable ${id} --scope user`,
      }
    : undefined;
}

async function folderEntry(id: string, folders: readonly string[]): Promise<PluginState | undefined> {
  const files = folders.flatMap((f) => ["settings.json", "settings.local.json"].map((n) => join(f, ".claude", n)));
  for (const file of files) {
    const found = folderStep(id, file, await readJson(file));
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function notEnabled(id: string, file: string, enabled: unknown, absent: boolean): PluginState {
  if (enabled === false) {
    return { kind: "off", file, reason: `disabled in ${file}`, fix: `claude plugin enable ${id} --scope user` };
  }
  return missing(id, file, absent ? `no ${file}` : `${file} does not enable it`);
}

function enabledStep(id: string, file: string, got: Json): PluginState | undefined {
  const cannot = unreadable(file, got);
  if (cannot !== undefined) {
    return cannot;
  }
  const enabled = got.kind === "ok" ? at(got.value, ["enabledPlugins", id]) : undefined;
  return enabled === true ? undefined : notEnabled(id, file, enabled, got.kind === "absent");
}

function installStep(id: string, file: string, got: Json): PluginState | undefined {
  const cannot = unreadable(file, got);
  if (cannot !== undefined) {
    return cannot;
  }
  const entries = got.kind === "ok" ? at(got.value, ["plugins", id]) : undefined;
  return Array.isArray(entries) && entries.some((e: unknown) => at(e, ["scope"]) === "user")
    ? undefined
    : missing(id, file, `${file} has no user install`);
}

async function userState(id: string, config: string): Promise<PluginState> {
  const file = join(config, "settings.json");
  const record = join(config, "plugins", "installed_plugins.json");
  return (
    enabledStep(id, file, await readJson(file)) ??
    installStep(id, record, await readJson(record)) ?? { kind: "on", file }
  );
}

export async function pluginState(id: string, places: PluginPlaces): Promise<PluginState> {
  return (await folderEntry(id, places.folders)) ?? userState(id, claudeConfigDir(places.env));
}

export function pluginProblem(id: string, state: PluginState): string {
  return state.kind === "on" ? "" : `claude plugin ${id}: ${state.reason}; fix: ${state.fix}`;
}

export function stateLine(id: string, state: PluginState): string {
  return state.kind === "on" ? `claude plugin ${id}: on (user, ${state.file})` : pluginProblem(id, state);
}
