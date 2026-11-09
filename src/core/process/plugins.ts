// plugins — the project's plugin list (#232; docs/DESIGN.md section 5 "Plugins"): the normal Claude Code plugins a
// project installs, each named `name@marketplace`, in the order the project lists them. A locked settings key (#229),
// so a user layer cannot drop or swap the process plugin. Read from the settings layers, never a repo file.
//
//   "plugins": ["rulebook@chiyanram", "team-rules@acme"]
//
// None listed is a good value: the engine runs alone, on its built-in process. A "plugins" that holds a map is the old
// name of "connectors" (plugin/config.ts reads it); it lists no plugin.

import type { Result } from "../forge/api.js";
import { prop } from "../dispatch/records.js";

// isOldConnectors : a "plugins" value in the old shape, a map of connectors rather than a list of plugins
export function isOldConnectors(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const OLD_CONNECTORS =
  '"plugins" holds a map of connectors, the old name of "connectors": rename it (read for one release, then an error)';

export type PluginRef = { readonly name: string; readonly marketplace: string };

// a plugin's name and its marketplace's, as Claude Code names them: lower-case words joined by - . or _
const PART = "[a-z0-9][a-z0-9._-]{0,63}";
const REF = new RegExp(`^${PART}@${PART}$`);

export const PLUGIN_LIST_HINT = 'a list of plugins, each name@marketplace, such as ["rulebook@chiyanram"]';

function refOf(value: unknown): PluginRef | undefined {
  const text = typeof value === "string" && !value.includes("..") ? value : "";
  return REF.test(text) ? partsOf(text) : undefined;
}

function partsOf(text: string): PluginRef {
  const at = text.indexOf("@");
  return { name: text.slice(0, at), marketplace: text.slice(at + 1) };
}

export function refText(ref: PluginRef): string {
  return `${ref.name}@${ref.marketplace}`;
}

function refsOf(value: unknown): readonly PluginRef[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const refs = value.map(refOf);
  const good = refs.filter((r): r is PluginRef => r !== undefined);
  const names = new Set(good.map((r) => r.name));
  return good.length === refs.length && names.size === good.length ? good : undefined;
}

// checkPluginList : "" when a settings value is a good plugin list, or the old connector map; else what it must be
export function checkPluginList(value: unknown): string {
  return isOldConnectors(value) || refsOf(value) !== undefined ? "" : `${PLUGIN_LIST_HINT}, no name twice`;
}

// pluginListOf : the plugins one project file's JSON lists, in order; none when it lists none
export function pluginListOf(path: string, raw: object): Result<readonly PluginRef[]> {
  const value = prop(raw, "plugins");
  if (value === undefined || isOldConnectors(value)) {
    return { kind: "ok", value: [] };
  }
  const refs = refsOf(value);
  return refs === undefined
    ? { kind: "failed", reason: `${path}: "plugins" must be ${PLUGIN_LIST_HINT}, no name twice` }
    : { kind: "ok", value: refs };
}
