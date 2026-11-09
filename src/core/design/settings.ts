// settings — the design review's setup, from the settings the automated review already reads (#236): the project's
// clone (FACTORY_REPO), the rulebook folder whose process may hold the role cards, the per-run cap, and the logic
// model the review's verify pass uses. The claude CLI gets only the environment it needs: no forge token, no FACTORY_*
// (review/settings.ts claudeEnv; ADR-0012 S2).

import { join } from "node:path";
import type { Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
import { claudeModel, runInFolder, type Model } from "../review/model.js";
import { claudeEnv, paths } from "../review/settings.js";
import { settingName, settingOf } from "../settings/machine.js";
import type { DesignSetup } from "./step.js";

export function designSetup(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly forge: Forge;
  readonly home: string;
  readonly project: string;
  readonly model?: Model;
}): Result<DesignSetup> {
  const p = paths(input.env);
  if (p.kind === "failed") {
    return { kind: "failed", reason: `the design review is not set up: ${p.reason}` };
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
      modelName: settingOf(input.env, "review.logicModel") ?? "opus",
      maxUsd: p.value.maxUsd,
      plugins: [{ label: settingName("rulebook"), dir: p.value.rulebook }],
      runsDir: join(input.home, "design-runs"),
    },
  };
}
