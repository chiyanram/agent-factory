// agent — the agent CLI seam (ADR-0022): every model run the factory starts goes through one adapter, as every git
// host call goes through the Forge seam. The adapter owns the trust boundary: the argv, the environment the CLI gets,
// and the run's time limit. Claude Code is the one adapter so far.
//
//   FACTORY_CLAUDE   the claude CLI (default: claude)
//
// **Today:** only the read-only runs and the sessions list go through it; the writer runs and the coordinator still
// build their own argv (#688, #691).

import type { Sessions } from "../review/live.js";
import type { Model } from "../review/model.js";
import { claudeEnv, claudeModel, claudeSessions } from "./claude.js";
import { runInFolder, type FolderRunner } from "./folder.js";

export type AgentCli = {
  readonly name: "claude";
  // one fresh, read-only run, stopped at its limit
  readonly readOnly: Model;
  // the CLI's live background sessions
  readonly sessions: Sessions;
};

// how long `claude agents --json` may take before the list is read as unknown
export const SESSIONS_MS = 60_000;

// openAgentCli : the agent CLI from the settings; a test passes its own runner and shorter times
export function openAgentCli(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly run?: FolderRunner;
  readonly minuteMs?: number;
  readonly sessionsMs?: number;
}): AgentCli {
  const setup = {
    bin: input.env.FACTORY_CLAUDE ?? "claude",
    env: claudeEnv(input.env),
    run: input.run ?? runInFolder,
    minuteMs: input.minuteMs ?? 60_000,
    sessionsMs: input.sessionsMs ?? SESSIONS_MS,
  };
  return { name: "claude", readOnly: claudeModel(setup), sessions: claudeSessions(setup) };
}
