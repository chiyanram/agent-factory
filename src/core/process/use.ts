// use — the plugins one dispatcher pass hands its runs (docs/explanation/architecture.md section 5 "Plugins"): every plugin the
// project lists, each checked against its pin (pins.ts), in the project's order. With none listed, the engine runs
// alone; the rulebook folder setting is read only by `eval reviewer`, so a run that finds it set warns.
// Each plugin's hash goes into the run records, so a person can tell which versions a run used.

import type { Result } from "../forge/api.js";
import { settingName, settingOf } from "../settings/machine.js";
import { pinnedPlugins } from "./pins.js";
import type { PluginDir } from "./read.js";

export type Used = PluginDir & { readonly ref: string; readonly sha256: string };

export type RunPlugins = { readonly plugins: readonly Used[]; readonly warnings: readonly string[] };

export type PluginHash = { readonly ref: string; readonly sha256: string };

export function hashesOf(plugins: readonly Used[]): readonly PluginHash[] {
  return plugins.map((p) => ({ ref: p.ref, sha256: p.sha256 }));
}

export async function runPlugins(input: {
  readonly home: string;
  readonly project: string;
  readonly env: NodeJS.ProcessEnv;
}): Promise<Result<RunPlugins>> {
  const pinned = await pinnedPlugins(input);
  if (pinned.kind === "failed") {
    return pinned;
  }
  const ignored =
    settingOf(input.env, "rulebook") === undefined
      ? []
      : [
          `${settingName("rulebook")} is read only by agent-factory eval reviewer: a run uses the plugins the project lists`,
        ];
  return {
    kind: "ok",
    value: {
      plugins: pinned.value.map((p) => ({ label: p.label, dir: p.dir, ref: p.ref, sha256: p.pin.sha256 })),
      warnings: ignored,
    },
  };
}
