// settings — the onboarder's setup, from the settings the automated review already reads (#235): the project's clone
// (FACTORY_REPO), the project's plugins whose process may hold the role card, the per-run cap, and the logic model. The
// claude CLI gets only the environment it needs: no forge token, no FACTORY_* (review/settings.ts claudeEnv).

import { join } from "node:path";
import type { Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
import { claudeModel, runInFolder, type Model } from "../review/model.js";
import { claudeEnv, paths, REVIEW_MODELS } from "../review/settings.js";
import { settingOf } from "../settings/machine.js";
import type { PluginDir } from "../process/read.js";
import type { OnboardSetup } from "./run.js";

export function onboardSetup(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly forge: Pick<Forge, "defaultBranch">;
  readonly home: string;
  readonly project: string;
  // the project's plugins, in order (process/use.ts runPlugins)
  readonly plugins: readonly PluginDir[];
  readonly now: () => number;
  readonly model?: Model;
}): Result<OnboardSetup> {
  const p = paths(input.env);
  if (p.kind === "failed") {
    return { kind: "failed", reason: `the onboarder is not set up: ${p.reason}` };
  }
  const model =
    input.model ??
    claudeModel({ bin: input.env.FACTORY_CLAUDE ?? "claude", env: claudeEnv(input.env), run: runInFolder });
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
      plugins: input.plugins,
      runsDir: join(input.home, "onboard-runs"),
      now: input.now,
    },
  };
}
