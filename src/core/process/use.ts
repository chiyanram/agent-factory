// use — the plugins one dispatcher pass hands its runs (#232; docs/DESIGN.md section 5 "Plugins"): every plugin the
// project lists, each checked against its pin (pins.ts), in the project's order. With none listed, the rulebook folder
// setting is still read for one release, as a deprecated stand-in, with a warning; with neither, the engine runs alone.
// Each plugin's hash goes into the run records, so a person can tell which versions a run used.

import type { Result } from "../forge/api.js";
import { settingName, settingOf } from "../settings/machine.js";
import { pinnedPlugins, treeHash } from "./pins.js";
import type { PluginDir } from "./read.js";

// one plugin a run uses: its folder, and what the run records name it by
export type Used = PluginDir & { readonly ref: string; readonly sha256: string };

export type RunPlugins = { readonly plugins: readonly Used[]; readonly warnings: readonly string[] };

// the hash of each plugin, as a run record keeps it
export type PluginHash = { readonly ref: string; readonly sha256: string };

export function hashesOf(plugins: readonly Used[]): readonly PluginHash[] {
  return plugins.map((p) => ({ ref: p.ref, sha256: p.sha256 }));
}

function deprecated(name: string): string {
  return `${name} is deprecated and is read for one release: list the plugin in the project's "plugins" and pin it with agent-factory plugin update <project> <name@marketplace>`;
}

// fallback : the rulebook folder setting as the one plugin, when it is set; its hash is taken now
async function fallback(env: NodeJS.ProcessEnv): Promise<Result<RunPlugins>> {
  const name = settingName("rulebook");
  const dir = settingOf(env, "rulebook") ?? "";
  if (dir === "") {
    return { kind: "ok", value: { plugins: [], warnings: [] } };
  }
  const hash = await treeHash(dir);
  return hash.kind === "ok"
    ? {
        kind: "ok",
        value: { plugins: [{ label: name, dir, ref: name, sha256: hash.value.sha256 }], warnings: [deprecated(name)] },
      }
    : hash;
}

// runPlugins : the pinned plugins, or the deprecated folder setting when the project lists none
export async function runPlugins(input: {
  readonly home: string;
  readonly project: string;
  readonly env: NodeJS.ProcessEnv;
}): Promise<Result<RunPlugins>> {
  const pinned = await pinnedPlugins(input);
  if (pinned.kind === "failed") {
    return pinned;
  }
  if (pinned.value.length === 0) {
    return fallback(input.env);
  }
  const ignored =
    settingOf(input.env, "rulebook") === undefined
      ? []
      : [`${settingName("rulebook")} is ignored: the project lists its plugins`];
  return {
    kind: "ok",
    value: {
      plugins: pinned.value.map((p) => ({ label: p.label, dir: p.dir, ref: p.ref, sha256: p.pin.sha256 })),
      warnings: ignored,
    },
  };
}
