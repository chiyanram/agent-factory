// settings — the design review's setup, from the settings the automated review already reads (#236): the project's
// clone (FACTORY_REPO), the project's plugins whose process may hold the role cards (process/use.ts, #232), the per-run
// cap, the logic model the review's verify pass uses, a full id (review/pinned.ts), and the time limits:
// FACTORY_DESIGN_MINUTES for the design-reviewer, FACTORY_VERIFY_MINUTES for its verify pass (agent/limits.ts). The
// runs go through the agent seam, which gives the CLI no forge token and no FACTORY_* (agent/claude.ts; ADR-0012 S2).

import { join } from "node:path";
import type { Result } from "../forge/api.js";
import { openAgentCli } from "../agent/index.js";
import { limitOf } from "../agent/limits.js";
import type { Model } from "../review/model.js";
import { paths } from "../review/settings.js";
import { settingOf } from "../settings/machine.js";
import type { PluginDir } from "../process/read.js";
import { REVIEW_MODELS } from "../review/pinned.js";
import type { DesignSetup } from "./step.js";

export function designSetup(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly forge: DesignSetup["forge"];
  readonly home: string;
  readonly project: string;
  readonly plugins: readonly PluginDir[];
  readonly model?: Model;
}): Result<DesignSetup> {
  const p = paths(input.env);
  if (p.kind === "failed") {
    return { kind: "failed", reason: `the design review is not set up: ${p.reason}` };
  }
  const review = limitOf(input.env, "design.minutes");
  if (review.kind === "failed") {
    return { kind: "failed", reason: `the design review is not set up: ${review.reason}` };
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
      limits: { review: review.value, verify: p.value.limits.verify },
      plugins: input.plugins,
      runsDir: join(input.home, "design-runs"),
    },
  };
}
