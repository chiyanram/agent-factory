// plan — what the dispatcher's ready check and local verifier need, read once per pass (#91, #113): the project file
// (its gate and egress allowlist too), the project's box image (box build), a box that answers (openBox, S7), and the
// project's clone. Anything missing leaves both steps unavailable with the reason, and the gate is read as forge CI
// only when the file says so or there is no file to say otherwise.
//
//   <home>/projects/<p>/box.json   the box image, sha256:<id> (S7: pinned), written by agent-factory box build <p>
//   FACTORY_REPO                   the project's clone; only git reads it, through hostGit
//   FACTORY_EGRESS_IMAGE           the Squid image, name@sha256:<digest> (default: egress/index.ts)
//   FACTORY_UPSTREAM_PROXY         at work, the corporate proxy host:port the egress proxy leaves through
//
// The plan starts nothing. Each box run starts the project's egress proxy (egress below) inside the project's dispatch
// lock, so a pass that finds the lock taken never recreates the proxy under a box that is running.

import { isAbsolute, join } from "node:path";
import { openBox, pinImage, type Box, type PinnedImage } from "../box/index.js";
import { readBoxFile } from "../box/built.js";
import type { Gate } from "../dispatch/table.js";
import { DEFAULT_EGRESS_IMAGE, upstreamOf, type Started, type Upstream } from "../egress/index.js";
import type { Result } from "../forge/api.js";
import { readProjectFile, type ProjectFile } from "../project.js";
import { settingOf } from "../settings/machine.js";
import type { BoxSetup } from "./boxrun.js";
import type { BoxPlan } from "./steps.js";

export type Plan = { readonly gate: Gate; readonly plan: BoxPlan };

// a project file that is there but refused stops the pass: read as forge CI, a local project would lose its gate
export type PlanRead =
  | { readonly kind: "ok"; readonly value: Plan }
  | { readonly kind: "failed"; readonly reason: string };

// what starts the project's egress proxy: openEgress with this host's docker, or a test's own
export type EgressOpener = (input: {
  readonly project: string;
  readonly allowlist: readonly string[];
  readonly upstream: Upstream;
  readonly image: PinnedImage;
}) => Promise<Started>;

export type PlanInput = {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly project: string;
  // this host's boxes, for the project's image
  readonly boxesFor: (image: PinnedImage) => readonly Box[];
  readonly openEgress: EgressOpener;
};

type Egress = { readonly upstream: Upstream; readonly image: PinnedImage };

// egressOf : the settings the project's proxy starts with. Pure.
function egressOf(env: NodeJS.ProcessEnv, project: ProjectFile): Result<Egress> {
  if (project.egress.allow.length === 0) {
    return { kind: "failed", reason: 'the project file has no "egress.allow": name the hosts its boxes may reach' };
  }
  const upstream = upstreamOf(env);
  if (upstream.kind === "refused") {
    return { kind: "failed", reason: upstream.reason };
  }
  const image = pinImage(settingOf(env, "egress.image") ?? DEFAULT_EGRESS_IMAGE);
  return image.kind === "pinned"
    ? { kind: "ok", value: { upstream, image } }
    : { kind: "failed", reason: `FACTORY_EGRESS_IMAGE: ${image.reason}` };
}

function repoOf(env: NodeJS.ProcessEnv): Result<string> {
  const repo = env.FACTORY_REPO ?? "";
  return isAbsolute(repo)
    ? { kind: "ok", value: repo }
    : { kind: "failed", reason: `FACTORY_REPO must be an absolute path, got ${JSON.stringify(repo)}` };
}

type Placed = { readonly box: Box; readonly image: PinnedImage };

// placed : the project's image, and a box for it that answers its probe
async function placed(input: PlanInput): Promise<Result<Placed>> {
  const file = await readBoxFile({ home: input.home, project: input.project });
  if (file.kind !== "ok") {
    return { kind: "failed", reason: file.reason };
  }
  const opened = await openBox({ env: input.env, boxes: input.boxesFor(file.image) });
  return opened.kind === "ready"
    ? { kind: "ok", value: { box: opened.box, image: file.image } }
    : { kind: "failed", reason: opened.reason };
}

// readied : the setup a box run needs; the first thing missing is the reason there is none
async function readied(input: PlanInput, project: ProjectFile): Promise<Result<BoxSetup>> {
  const egress = egressOf(input.env, project);
  if (egress.kind === "failed") {
    return egress;
  }
  const repo = repoOf(input.env);
  if (repo.kind === "failed") {
    return repo;
  }
  const where = await placed(input);
  if (where.kind === "failed") {
    return where;
  }
  const open = { project: input.project, allowlist: project.egress.allow, ...egress.value };
  return {
    kind: "ok",
    value: {
      box: where.value.box,
      image: where.value.image,
      egress: () => input.openEgress(open),
      repo: repo.value,
      env: input.env,
      runsDir: join(input.home, "box-runs"),
    },
  };
}

async function setupFor(input: PlanInput, project: ProjectFile): Promise<BoxPlan> {
  const setup = await readied(input, project);
  return setup.kind === "ok"
    ? { kind: "ready", project, setup: setup.value }
    : { kind: "unavailable", reason: setup.reason };
}

// boxPlan : the gate and the box plan for one pass over `project`
export async function boxPlan(input: PlanInput): Promise<PlanRead> {
  const file = await readProjectFile({ home: input.home, project: input.project });
  if (file.kind !== "ok") {
    return file.kind === "missing"
      ? { kind: "ok", value: { gate: "forge-ci", plan: { kind: "unavailable", reason: file.reason } } }
      : file;
  }
  return { kind: "ok", value: { gate: file.value.gate.kind, plan: await setupFor(input, file.value) } };
}
