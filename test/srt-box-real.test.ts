// The srt runner on the real srt (#114 "Done when"): inside srt, reading ~/.ssh/canary and a direct connection off the
// allowlist both fail. It needs the pinned srt on this machine, so it runs on the work laptop and is skipped elsewhere,
// always with the reason (GUIDE.md "Check the srt runner"):
//
//   echo canary > ~/.ssh/canary && FACTORY_TEST_SRT=1 npx vitest run test/srt-box-real.test.ts
//
// Each check runs one plain command inside a fresh srt runner on an empty clone, with the egress allowlist
// api.anthropic.com alone, the same policy a writer run gets.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { srtBox } from "../src/core/box/srt.js";
import { locatePrograms } from "../src/core/box/srt-programs.js";
import { NO_IMAGE, type Box, type Ran } from "../src/core/box/types.js";
import { runProcess } from "../src/core/forge/api.js";
import { tempDir } from "./temp.js";

const ROOT = tempDir("srt-real-");
const FACTORY = join(ROOT, "factory");
const CLONE = join(FACTORY, "box-runs", "run-1", "repo");
mkdirSync(CLONE, { recursive: true });
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const HOME = homedir();
const CANARY = join(HOME, ".ssh", "canary");
const OFF_LIST = "https://example.com";

// the runner as app.ts makes it: the whole home hidden, the agent CLI's install and its Node allowed back read-only
async function makeBox(): Promise<Box> {
  const programs = await locatePrograms({
    env: process.env,
    home: HOME,
    cli: "claude",
    execPath: process.execPath,
    packageDir: join(import.meta.dirname, ".."),
  });
  return srtBox({
    run: runProcess,
    bin: "srt",
    env: process.env,
    host: { platform: process.platform, home: HOME, factoryHome: FACTORY, programs },
    egress: { hosts: ["api.anthropic.com"], upstream: { kind: "none" }, caCerts: "" },
    caName: "NODE_EXTRA_CA_CERTS",
    runsDir: join(FACTORY, "srt-runs"),
  });
}

// why : the reason this machine cannot run the check, or "" when it can
async function why(box: Box): Promise<string> {
  if (process.env.FACTORY_TEST_SRT !== "1") {
    return "set FACTORY_TEST_SRT=1 on the work laptop to run this";
  }
  const probe = await box.probe();
  return probe.kind === "ready" ? "" : `no srt runner here: ${probe.reason}`;
}

const box = await makeBox();
const skip = await why(box);

// inSrt : one command in a fresh runner on the clone
async function inSrt(argv: readonly [string, ...string[]]): Promise<Ran> {
  const started = await box.start({ image: NO_IMAGE, worktree: CLONE, readOnly: [], env: {}, proxy: "", network: "" });
  if (started.kind !== "started") {
    throw new Error(started.reason);
  }
  const ran = await box.run({
    session: started.session,
    command: { argv, stdin: { kind: "none" }, timeoutSeconds: 60 },
  });
  await box.stop(started.session);
  return ran;
}

function failed(ran: Ran): boolean {
  return ran.kind === "exited" && ran.code !== 0;
}

describe.skipIf(skip !== "")(`srt runner on the real srt${skip === "" ? "" : ` (skipped: ${skip})`}`, () => {
  it("cannot read ~/.ssh/canary", async () => {
    expect(existsSync(CANARY), `plant it first: echo canary > ${CANARY}`).toBe(true);
    const ran = await inSrt(["cat", CANARY]);
    expect(failed(ran)).toBe(true);
    expect(ran.kind === "exited" ? ran.stdout : "").not.toContain("canary");
  });

  it("cannot read a file in ~/Documents: the whole home is hidden", async () => {
    const documents = join(HOME, "Documents");
    mkdirSync(documents, { recursive: true });
    const file = join(documents, `srt-canary-${randomUUID()}.txt`);
    writeFileSync(file, "documents-canary\n");
    try {
      const ran = await inSrt(["cat", file]);
      expect(failed(ran)).toBe(true);
      expect(ran.kind === "exited" ? ran.stdout : "").not.toContain("documents-canary");
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("still runs the agent CLI and its Node when they are installed under the home", async () => {
    expect(await inSrt(["claude", "--version"])).toMatchObject({ kind: "exited", code: 0 });
    expect(await inSrt(["node", "-e", "process.exit(0)"])).toMatchObject({ kind: "exited", code: 0 });
  });

  it("cannot connect direct, skipping the proxy, nor reach a host off the allowlist through it", async () => {
    expect(failed(await inSrt(["curl", "-sS", "--max-time", "20", "--noproxy", "*", "https://1.1.1.1"]))).toBe(true);
    expect(failed(await inSrt(["curl", "-sS", "--max-time", "20", OFF_LIST]))).toBe(true);
  });

  it("reaches the model API through the proxy: any HTTP answer from it", async () => {
    const ran = await inSrt([
      "curl",
      "-sS",
      "--max-time",
      "20",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "https://api.anthropic.com",
    ]);
    expect(ran).toMatchObject({ kind: "exited", code: 0 });
    expect(ran.kind === "exited" ? ran.stdout : "").toMatch(/^[1-5]\d\d$/);
  });

  it("writes in the clone, and nowhere else in the home", async () => {
    expect(await inSrt(["sh", "-c", "echo ok > written.txt"])).toMatchObject({ kind: "exited", code: 0 });
    expect(existsSync(join(CLONE, "written.txt"))).toBe(true);
    const outside = join(HOME, `srt-write-${randomUUID()}`);
    expect(failed(await inSrt(["sh", "-c", `echo no > '${outside}'`]))).toBe(true);
    expect(existsSync(outside)).toBe(false);
  });

  it("reads none of the git host logins nor the factory home's secrets", async () => {
    mkdirSync(join(FACTORY, "secrets"), { recursive: true });
    writeFileSync(join(FACTORY, "secrets", "token"), "factory-secret\n");
    const read = await inSrt(["cat", join(FACTORY, "secrets", "token")]);
    expect(failed(read)).toBe(true);
    const present = [".config/gh/hosts.yml", ".config/glab-cli/config.yml", ".netrc", ".git-credentials"]
      .map((p) => join(HOME, p))
      .filter((p) => existsSync(p));
    const readable: string[] = [];
    for (const path of present) {
      readable.push(...(failed(await inSrt(["cat", path])) ? [] : [path]));
    }
    expect(readable).toEqual([]);
  });

  it("reaches no Docker socket", async () => {
    const sockets = [
      "/var/run/docker.sock",
      join(HOME, ".docker", "run", "docker.sock"),
      join(HOME, ".rd", "docker.sock"),
    ].filter((s) => existsSync(s));
    const reached: string[] = [];
    for (const socket of sockets) {
      reached.push(
        ...(failed(await inSrt(["curl", "-sS", "--max-time", "10", "--unix-socket", socket, "http://localhost/_ping"]))
          ? []
          : [socket]),
      );
    }
    expect(reached).toEqual([]);
  });
});
