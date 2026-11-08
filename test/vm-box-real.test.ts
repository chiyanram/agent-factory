// The vm box on a real docker (#181; ADR-0012 S6, S15): the box-contract canary proves what the box hands the docker
// CLI; this proves what the process inside the box actually sees. It needs Sysbox and a built box image, so it runs on
// the VM and is skipped elsewhere, always with the reason:
//
//   FACTORY_TEST_BOX_IMAGE=<the image ID from agent-factory box build> npx vitest run test/vm-box-real.test.ts

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { pinImage } from "../src/core/box/choose.js";
import { hostDocker } from "../src/core/box/docker.js";
import type { Box, BoxSpec, PinnedImage } from "../src/core/box/types.js";
import { vmBox } from "../src/core/box/vm.js";
import { runProcess } from "../src/core/forge/api.js";

// a name that looks like a secret: one of these in the box must be one the spec declared
const SECRET_LIKE = /TOKEN|KEY|SECRET|PASSWORD/i;

const network = `factory-canary-${randomUUID().slice(0, 8)}`;
const docker = hostDocker(process.env, runProcess);
const dockerCli = (args: readonly string[]) => docker.run({ bin: docker.bin, args, stdin: "", env: docker.env });

afterEach(async () => {
  await dockerCli(["network", "rm", network]);
});

// the host the dispatcher runs on, with a canary and a forge token planted in it
const planted = { canary: `canary-${randomUUID()}`, ghToken: `ghp_${randomUUID().replaceAll("-", "")}` };
const host = { ...process.env, FACTORY_CANARY: planted.canary, GH_TOKEN: planted.ghToken };

type Opened =
  | { readonly kind: "ready"; readonly box: Box; readonly image: PinnedImage }
  | { readonly kind: "skip"; readonly why: string };

// the box user takes the ids of the user running this test, as the dispatcher's own
const OWNER = { uid: process.getuid?.() ?? -1, gid: process.getgid?.() ?? -1 };

// pinned : the image named, which must be pinned: a typo fails the run, never skips it
function pinned(ref: string): PinnedImage {
  const image = pinImage(ref);
  if (image.kind === "refused") {
    throw new Error(image.reason);
  }
  return image;
}

// opened : the vm box over the real docker, or why there is none here
async function opened(ref: string): Promise<Opened> {
  if (ref === "") {
    return { kind: "skip", why: "set FACTORY_TEST_BOX_IMAGE to an image ID from agent-factory box build to run this" };
  }
  const image = pinned(ref);
  const box = vmBox({ docker: hostDocker(host, runProcess), image: image.ref, owner: OWNER });
  const probe = await box.probe();
  return probe.kind === "ready"
    ? { kind: "ready", box, image }
    : { kind: "skip", why: `no vm box here: ${probe.reason}` };
}

// envIn : what `env` prints in a fresh box with this spec
async function envIn(box: Box, spec: BoxSpec): Promise<string> {
  const started = await box.start(spec);
  if (started.kind !== "started") {
    throw new Error(started.reason);
  }
  const ran = await box.run({
    session: started.session,
    command: { argv: ["env"], stdin: { kind: "none" }, timeoutSeconds: 60 },
  });
  await box.stop(started.session);
  if (ran.kind !== "exited") {
    throw new Error(`env did not run: ${JSON.stringify(ran)}`);
  }
  return ran.stdout;
}

// the names in the output of `env`, one variable a line
function namesOf(stdout: string): readonly string[] {
  return stdout
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.slice(0, l.indexOf("=")));
}

describe("the vm box on a real docker (#181)", () => {
  it("shows the run no host variable: not the canary, not GH_TOKEN, no undeclared secret-like name", async (ctx) => {
    const found = await opened(process.env.FACTORY_TEST_BOX_IMAGE ?? "");
    if (found.kind === "skip") {
      ctx.skip(found.why);
    }
    if (found.kind !== "ready") return;
    const made = await dockerCli(["network", "create", "--internal", network]);
    expect(made).toMatchObject({ code: 0 });
    const spec: BoxSpec = {
      image: found.image,
      worktree: process.cwd(),
      readOnly: [],
      env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-declared" },
      proxy: "http://factory-egress-canary:3128",
      network,
    };
    const stdout = await envIn(found.box, spec);
    const names = namesOf(stdout);
    // the declared variable is there, so this is the run's real environment
    expect(names).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(names.filter((n) => n === "FACTORY_CANARY" || n === "GH_TOKEN")).toEqual([]);
    expect([planted.canary, planted.ghToken].filter((v) => stdout.includes(v))).toEqual([]);
    expect(names.filter((n) => SECRET_LIKE.test(n) && !Object.hasOwn(spec.env, n))).toEqual([]);
  });
});
