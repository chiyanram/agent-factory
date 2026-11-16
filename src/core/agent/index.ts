// agent — the agent CLI seam (ADR-0022): every model run the factory starts goes through one adapter, as every git
// host call goes through the Forge seam. The adapter owns the trust boundary: the argv, the environment the CLI gets,
// and the run's time limit. Claude Code is the adapter every run uses; Copilot's read-only kind is built beside it
// (copilot.ts, #690) and off (switch.ts).
//
//   FACTORY_CLAUDE   the claude CLI (default: claude); a writer run in a vm starts the image's own, which it pins
//   FACTORY_COPILOT  the copilot CLI (default: copilot)
//
// **Today:** the coordinator still builds its own argv (#691). No call site opens Copilot: #697 picks the CLI per role
// from the project file, and Copilot writer runs are #698.

import { tmpdir } from "node:os";
import type { Sessions } from "../review/live.js";
import type { Model } from "../review/model.js";
import { claudeEnv, claudeModel, claudeSessions } from "./claude.js";
import { claudeWriter, type ClaudeWriter } from "./claude-writer.js";
import { copilotModel, type CopilotModel } from "./copilot.js";
import type { BoxToken } from "../token/index.js";
import { runInFolder, type FolderRunner } from "./folder.js";

export type AgentCli = {
  readonly name: "claude";
  // one fresh, read-only run, stopped at its limit
  readonly readOnly: Model;
  // the CLI's live background sessions
  readonly sessions: Sessions;
  // the writer run's argv and settings file, built from its role card; the box runs them (writer/run.ts)
  readonly writer: ClaudeWriter;
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
  return {
    name: "claude",
    readOnly: claudeModel(setup),
    sessions: claudeSessions(setup),
    writer: claudeWriter(setup.bin),
  };
}

// the Copilot adapter: its read-only kind only; it has no writer kind and no sessions list (-p runs end)
export type CopilotCli = {
  readonly name: "copilot";
  readonly readOnly: CopilotModel;
};

// openCopilotCli : the copilot CLI from the settings, with the run's login read before each run
export function openCopilotCli(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly login: () => Promise<BoxToken>;
  readonly aiCredits: string;
  readonly run?: FolderRunner;
  readonly minuteMs?: number;
}): CopilotCli {
  return {
    name: "copilot",
    readOnly: copilotModel({
      bin: input.env.FACTORY_COPILOT ?? "copilot",
      env: input.env,
      run: input.run ?? runInFolder,
      minuteMs: input.minuteMs ?? 60_000,
      login: input.login,
      aiCredits: input.aiCredits,
      tempRoot: tmpdir(),
    }),
  };
}
