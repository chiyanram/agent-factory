// plan — what the dispatcher's ready check and local verifier need, read once per pass (#91, #113): the project file
// (its gate and egress allowlist too), the project's box image (box build), a box that answers (openBox, S7), and the
// project's clone. Anything missing leaves both steps unavailable with the reason, and the gate is read as forge CI
// only when the file says so or there is no file to say otherwise.
//
//   <home>/projects/<p>/box.json   the box image, sha256:<id> (S7: pinned), written by agent-factory box build <p>
//   FACTORY_REPO                   the project's clone; only git reads it, through hostGit
//   FACTORY_EGRESS_IMAGE           the Squid image, name@sha256:<digest> (default: egress/index.ts)
//   FACTORY_UPSTREAM_PROXY         at work, the corporate proxy host:port the egress proxy leaves through
//   NODE_EXTRA_CA_CERTS            at work, the company CA the srt runner and its agent trust (egress.caCerts)
//
// With FACTORY_BOX=srt (#114) there is no image and no Squid container: the srt runner is made here from the same
// checked allowlist, and keeps its own proxy.
//
// The plan starts nothing. Each box run starts the project's egress proxy (egress below) inside the project's dispatch
// lock, so a pass that finds the lock taken never recreates the proxy under a box that is running.

import { isAbsolute, join } from "node:path";
import {
  chooseBox,
  NO_IMAGE,
  openBox,
  pinImage,
  type Box,
  type NoImage,
  type PinnedImage,
  type SrtEgress,
} from "../box/index.js";
import { readBoxFile } from "../box/built.js";
import type { Gate } from "../dispatch/table.js";
import { DEFAULT_EGRESS_IMAGE, parseAllowlist, upstreamOf, type Started, type Upstream } from "../egress/index.js";
import type { Result } from "../forge/api.js";
import { readProjectFile, type ProjectFile } from "../project.js";
import { settingName, settingOf } from "../settings/machine.js";
import type { BoxSetup, Egress as RunEgress } from "./boxrun.js";
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
  readonly gitHosts: readonly string[];
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
  // this host's srt runner, for the project's egress (#114)
  readonly srtFor: (egress: SrtEgress) => Promise<Box>;
};

type Egress = { readonly upstream: Upstream; readonly image: PinnedImage; readonly gitHosts: readonly string[] };

// ownGitHost : the project's own git host, such as a company GitLab, which the allowlist refuses too
function ownGitHost(env: NodeJS.ProcessEnv): readonly string[] {
  const host = (settingOf(env, "gitHostName") ?? "").trim();
  return host === "" ? [] : [host];
}

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
    ? { kind: "ok", value: { upstream, image, gitHosts: ownGitHost(env) } }
    : { kind: "failed", reason: `FACTORY_EGRESS_IMAGE: ${image.reason}` };
}

function repoOf(env: NodeJS.ProcessEnv): Result<string> {
  const repo = env.FACTORY_REPO ?? "";
  return isAbsolute(repo)
    ? { kind: "ok", value: repo }
    : { kind: "failed", reason: `FACTORY_REPO must be an absolute path, got ${JSON.stringify(repo)}` };
}

type Placed = {
  readonly box: Box;
  readonly image: PinnedImage | NoImage;
  readonly egress: () => Promise<RunEgress>;
};

// placedVm : the project's image, a vm box for it that answers its probe, and the project's Squid proxy
async function placedVm(input: PlanInput, project: ProjectFile): Promise<Result<Placed>> {
  const egress = egressOf(input.env, project);
  if (egress.kind === "failed") {
    return egress;
  }
  const file = await readBoxFile({ home: input.home, project: input.project });
  if (file.kind !== "ok") {
    return { kind: "failed", reason: file.reason };
  }
  const opened = await openBox({ env: input.env, boxes: input.boxesFor(file.image) });
  const open = { project: input.project, allowlist: project.egress.allow, ...egress.value };
  return opened.kind === "ready"
    ? { kind: "ok", value: { box: opened.box, image: file.image, egress: () => input.openEgress(open) } }
    : { kind: "failed", reason: opened.reason };
}

// caCertsOf : the company CA's file, or "" for none; a relative path is refused. Pure.
function caCertsOf(env: NodeJS.ProcessEnv): Result<string> {
  const set = (settingOf(env, "egress.caCerts") ?? "").trim();
  return set === "" || isAbsolute(set)
    ? { kind: "ok", value: set }
    : {
        kind: "failed",
        reason: `${settingName("egress.caCerts")} must be an absolute path, got ${JSON.stringify(set)}`,
      };
}

// srtEgressOf : the srt runner's egress: the allowlist checked as the Squid proxy checks it, the company proxy and CA.
// Pure.
function srtEgressOf(env: NodeJS.ProcessEnv, project: ProjectFile): Result<SrtEgress> {
  if (project.egress.allow.length === 0) {
    return { kind: "failed", reason: 'the project file has no "egress.allow": name the hosts its runners may reach' };
  }
  const list = parseAllowlist(project.egress.allow, ownGitHost(env));
  if (list.kind === "refused") {
    return { kind: "failed", reason: list.reason };
  }
  const upstream = upstreamOf(env);
  if (upstream.kind === "refused") {
    return { kind: "failed", reason: upstream.reason };
  }
  const ca = caCertsOf(env);
  return ca.kind === "ok" ? { kind: "ok", value: { hosts: list.hosts, upstream, caCerts: ca.value } } : ca;
}

// placedSrt : the srt runner, made for the project's egress, when it answers its probe (#114)
async function placedSrt(input: PlanInput, project: ProjectFile): Promise<Result<Placed>> {
  const egress = srtEgressOf(input.env, project);
  if (egress.kind === "failed") {
    return egress;
  }
  const opened = await openBox({ env: input.env, boxes: [await input.srtFor(egress.value)] });
  return opened.kind === "ready"
    ? {
        kind: "ok",
        value: { box: opened.box, image: NO_IMAGE, egress: () => Promise.resolve({ kind: "own" } as const) },
      }
    : { kind: "failed", reason: opened.reason };
}

// placed : the runner FACTORY_BOX names, ready for the project
function placed(input: PlanInput, project: ProjectFile): Promise<Result<Placed>> {
  const choice = chooseBox(input.env);
  return choice.kind === "chosen" && choice.place === "srt" ? placedSrt(input, project) : placedVm(input, project);
}

// readied : the setup a box run needs; the first thing missing is the reason there is none
async function readied(input: PlanInput, project: ProjectFile): Promise<Result<BoxSetup>> {
  const repo = repoOf(input.env);
  if (repo.kind === "failed") {
    return repo;
  }
  const where = await placed(input, project);
  if (where.kind === "failed") {
    return where;
  }
  return {
    kind: "ok",
    value: {
      box: where.value.box,
      image: where.value.image,
      egress: where.value.egress,
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
