// settings — the onboarder's setup, from the settings the automated review already reads (#235): the project's clone
// (FACTORY_REPO), the project's plugins whose process may hold the role card (process/use.ts, #232), the per-run cap,
// and the logic model, a full id (review/pinned.ts, #213). The claude CLI gets only the environment it needs: no forge
// token, no FACTORY_* (review/settings.ts claudeEnv).

import { join } from "node:path";
import type { Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
import type { PluginDir } from "../process/read.js";
import { claudeModel, runInFolder, type Model } from "../review/model.js";
import { REVIEW_MODELS } from "../review/pinned.js";
import { claudeEnv, paths } from "../review/settings.js";
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
