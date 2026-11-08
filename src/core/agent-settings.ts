// agent-settings — the files that set up an agent's session in a checkout: its settings, hooks, skills and
// instructions (#110; ADR-0012 S12). The writer may read them and never change them. One list serves both walls:
//   in the box   the clone mounts each one the branch has read-only (writer/clone.ts)
//   at the push  the host refuses a commit that adds or changes one, so a file the branch did not have yet cannot be
//                planted for the next session either (protected.ts)
// A person changes them in their own commit. The writer's own claude never loads the branch's settings
// (--setting-sources user, writer/run.ts); the rulebook and the host's settings come from .factory.

import { protectedFiles, treesOf, type ProtectedSetup } from "./protected.js";
import type { Guard } from "./push.js";

export const AGENT_SETTINGS = [".claude", ".agents", "AGENTS.md", "CLAUDE.md"] as const;

// isAgentSetting : the path is one of the list, or inside one of its folders, in any letter case. Pure.
export function isAgentSetting(path: string): boolean {
  const lower = path.toLowerCase();
  return AGENT_SETTINGS.some((s) => {
    const name = s.toLowerCase();
    return lower === name || lower.startsWith(`${name}/`);
  });
}

// noAgentSettings : refuses a push that adds or changes an agent setting; the work is then blocked with the files named
export function noAgentSettings(setup: ProtectedSetup): Guard {
  return protectedFiles(setup, {
    name: "settings",
    what: "the agent settings",
    filesIn: async (h) => ({ kind: "ok", value: treesOf(h).flatMap((t) => [...t.keys()].filter(isAgentSetting)) }),
    refusal: (changed) =>
      `touches the agent's settings (${changed.join(", ")}): the writer never changes ${AGENT_SETTINGS.join(", ")}; a person makes that change in their own commit`,
  });
}
