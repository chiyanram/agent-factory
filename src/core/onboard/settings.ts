// settings — the onboarder's setup, from the settings the automated review already reads (#235): the project's clone
// (FACTORY_REPO), the project's plugins whose process may hold the role card (process/use.ts, #232), the per-run cap,
// the logic model, a full id (review/pinned.ts), and the run's time limit, FACTORY_ONBOARD_MINUTES
// (agent/limits.ts). The run goes through the agent seam, which gives the CLI no forge token and no FACTORY_*
// (agent/claude.ts).

import { join } from "node:path";
import type { Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
import type { PluginDir } from "../process/read.js";
import { openAgentCli } from "../agent/index.js";
import { limitOf } from "../agent/limits.js";
import type { Model } from "../review/model.js";
import { REVIEW_MODELS } from "../review/pinned.js";
import { paths } from "../review/settings.js";
import { settingOf } from "../settings/machine.js";
import type { OnboardSetup } from "./run.js";

export function onboardSetup(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly forge: Pick<Forge, "defaultBranch">;
  readonly home: string;
  readonly project: string;
  readonly now: () => number;
  readonly plugins: readonly PluginDir[];
  readonly model?: Model;
}): Result<OnboardSetup> {
  const p = paths(input.env);
  if (p.kind === "failed") {
    return { kind: "failed", reason: `the onboarder is not set up: ${p.reason}` };
  }
  const limit = limitOf(input.env, "onboard.minutes");
  if (limit.kind === "failed") {
    return { kind: "failed", reason: `the onboarder is not set up: ${limit.reason}` };
  }
  const model = input.model ?? openAgentCli({ env: input.env }).readOnly;
  return {
    kind: "ok",
    value: {
      home: input.home,
      project: input.project,
      repo: p.value.repo,
      env: input.env,
      forge: input.forge,
      model,
      modelName: settingOf(input.env, "review.logicModel") ?? REVIEW_MODELS.logic,
      maxUsd: p.value.maxUsd,
      limit: limit.value,
      plugins: input.plugins,
      runsDir: join(input.home, "onboard-runs"),
      now: input.now,
    },
  };
}
