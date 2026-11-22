// plugins — the project's plugin list (#232; docs/DESIGN.md section 5 "Plugins"): the normal Claude Code plugins a
// project installs, each named `name@marketplace`, in the order the project lists them. A locked settings key (#229),
// so a user layer cannot drop or swap the process plugin. Read from the settings layers, never a repo file.
//
//   "plugins": ["rulebook@chiyanram", "team-rules@acme"]
//
// None listed is a good value: the engine runs alone, on its built-in process. A "plugins" that holds a map is refused
// with a message to rename it to "connectors", its old name.

import type { Result } from "../forge/api.js";
import { prop } from "../field.js";

function isMap(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const OLD_CONNECTORS = 'a map of connectors is no longer read under "plugins": rename the key to "connectors"';

export type PluginRef = { readonly name: string; readonly marketplace: string };

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

export function checkPluginList(value: unknown): string {
  if (isMap(value)) {
    return OLD_CONNECTORS;
  }
  return refsOf(value) !== undefined ? "" : `${PLUGIN_LIST_HINT}, no name twice`;
}

export function pluginListOf(path: string, raw: object): Result<readonly PluginRef[]> {
  const value = prop(raw, "plugins");
  if (value === undefined) {
    return { kind: "ok", value: [] };
  }
  const refs = refsOf(value);
  if (refs !== undefined) {
    return { kind: "ok", value: refs };
  }
  const why = isMap(value) ? OLD_CONNECTORS : `"plugins" must be ${PLUGIN_LIST_HINT}, no name twice`;
  return { kind: "failed", reason: `${path}: ${why}` };
}
