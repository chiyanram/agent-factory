// plan — what the dispatcher's ready check and local verifier need, read once per pass (#91): the project file (its gate
// too), a box that answers (openBox, S7), the box image pinned by digest, and the project's clone. Anything missing
// leaves both steps unavailable with the reason, and the gate is read as forge CI only when the file says so or there
// is no file to say otherwise.
//
//   FACTORY_BOX_IMAGE   the box image, name@sha256:<digest> (S7: pinned); the box seam's own setting may replace it (#113)
//   FACTORY_REPO        the project's clone; only git reads it, through hostGit

import { isAbsolute, join } from "node:path";
import { openBox, pinImage, type Box } from "../box/index.js";
import type { Gate } from "../dispatch/table.js";
import { PROXY_CONTAINER, PROXY_PORT } from "../egress/index.js";
import { readProjectFile, type ProjectFile } from "../project.js";
import type { BoxPlan } from "./steps.js";

export type Plan = { readonly gate: Gate; readonly plan: BoxPlan };

// a project file that is there but refused stops the pass: read as forge CI, a local project would lose its gate
export type PlanRead =
  | { readonly kind: "ok"; readonly value: Plan }
  | { readonly kind: "failed"; readonly reason: string };

type Placed = { readonly kind: "placed"; readonly box: Box; readonly image: string; readonly repo: string };

async function placed(env: NodeJS.ProcessEnv, boxes: readonly Box[]): Promise<Placed | BoxPlan> {
  const opened = await openBox({ env, boxes });
  if (opened.kind === "refused") {
    return { kind: "unavailable", reason: opened.reason };
  }
  return withImage(env, opened.box);
}

function withImage(env: NodeJS.ProcessEnv, box: Box): Placed | BoxPlan {
  const image = pinImage(env.FACTORY_BOX_IMAGE ?? "");
  if (image.kind === "refused") {
    return { kind: "unavailable", reason: `FACTORY_BOX_IMAGE: ${image.reason}` };
  }
  const repo = env.FACTORY_REPO ?? "";
  return isAbsolute(repo)
    ? { kind: "placed", box, image: image.ref, repo }
    : { kind: "unavailable", reason: `FACTORY_REPO must be an absolute path, got ${JSON.stringify(repo)}` };
}

// boxPlan : the gate and the box plan for one pass over `project`
export async function boxPlan(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly project: string;
  readonly boxes: readonly Box[];
}): Promise<PlanRead> {
  const file = await readProjectFile({ home: input.home, project: input.project });
  if (file.kind !== "ok") {
    return file.kind === "missing"
      ? { kind: "ok", value: { gate: "forge-ci", plan: { kind: "unavailable", reason: file.reason } } }
      : file;
  }
  return { kind: "ok", value: await planned(input, file.value) };
}

async function planned(
  input: { readonly env: NodeJS.ProcessEnv; readonly home: string; readonly boxes: readonly Box[] },
  project: ProjectFile,
): Promise<Plan> {
  const gate = project.gate.kind;
  const where = await placed(input.env, input.boxes);
  if (where.kind !== "placed") {
    return { gate, plan: where };
  }
  return {
    gate,
    plan: {
      kind: "ready",
      project,
      setup: {
        box: where.box,
        image: { kind: "pinned", ref: where.image },
        proxy: { host: PROXY_CONTAINER, port: PROXY_PORT },
        repo: where.repo,
        env: input.env,
        runsDir: join(input.home, "box-runs"),
      },
    },
  };
}
