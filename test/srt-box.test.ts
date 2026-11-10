// The srt runner (#114) on a fake srt: the policy it generates, the arguments and variables it hands srt, its refusals
// (missing srt, the wrong version, a platform srt does not sandbox), its timeout and its stop. No srt is needed: the
// real one is checked on the laptop by test/srt-box-real.test.ts (GUIDE.md "Check the srt runner").

import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Call, Exit, Runner } from "../src/core/forge/api.js";
import { srtBox } from "../src/core/box/srt.js";
import {
  CREDENTIAL_PATHS,
  readSrtProbe,
  tmpTooLong,
  SRT_VERSION,
  srtDomains,
  srtEnv,
  srtPolicy,
  type SrtEgress,
  type SrtHost,
} from "../src/core/box/srt-plan.js";
import { NO_IMAGE, type BoxSpec } from "../src/core/box/types.js";
import { boxContract } from "./box-contract.js";
import { tempDir } from "./temp.js";

const RUNS = tempDir("srt-runs-");
const TMPS = tempDir("srt-tmps-");
afterAll(() => {
  rmSync(RUNS, { recursive: true, force: true });
  rmSync(TMPS, { recursive: true, force: true });
});

const PROGRAMS = [
  "/Users/op/.local/bin",
  "/Users/op/.local/share/claude/versions",
  "/Users/op/.nvm/versions/node/v22.12.0",
];
const TOOLCHAINS = ["/Users/op/.local/share/mise/installs", "/Users/op/.cargo"];
const HOST: SrtHost = {
  platform: "darwin",
  home: "/Users/op",
  factoryHome: "/Users/op/.factory",
  programs: { kind: "ok", value: PROGRAMS },
  toolchains: {
    allowed: [
      { dir: TOOLCHAINS[0] ?? "", from: "mise" },
      { dir: TOOLCHAINS[1] ?? "", from: "srt.readOnly" },
    ],
    refused: [],
    warnings: [],
  },
};
const EGRESS: SrtEgress = { hosts: [".npmjs.org", "api.anthropic.com"], upstream: { kind: "none" }, caCerts: "" };
const WORKTREE = "/Users/op/.factory/box-runs/run-1/repo";
const TOKEN = "sk-ant-oat01-not-a-real-token";
const SPEC: BoxSpec = {
  image: NO_IMAGE,
  worktree: WORKTREE,
  readOnly: [".git/config", ".factory/settings.json"],
  env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN },
  proxy: "",
  network: "",
};
const VERSION: Exit = { code: 0, stdout: `${SRT_VERSION}\n`, stderr: "" };
const OK: Exit = { code: 0, stdout: "", stderr: "" };

// a fake srt: `--version` answers the version, every command answers `command`, or hangs until its stop when `hang`
function fakeSrt(input: { readonly version?: Exit; readonly command?: Exit; readonly hang?: boolean } = {}): {
  readonly calls: Call[];
  readonly run: Runner;
} {
  const calls: Call[] = [];
  const hung = (c: Call): Promise<Exit> =>
    new Promise((resolve) => {
      c.stop?.addEventListener("abort", () => resolve({ code: 143, stdout: "", stderr: "" }), { once: true });
    });
  const answered = (c: Call): Promise<Exit> => {
    const exit = input.command ?? OK;
    c.watch?.(exit.stdout);
    return Promise.resolve(exit);
  };
  const run: Runner = (c) => {
    calls.push(c);
    if (c.args[0] === "--version") {
      return Promise.resolve(input.version ?? VERSION);
    }
    return input.hang === true ? hung(c) : answered(c);
  };
  return { calls, run };
}

function box(fake: { readonly run: Runner }, host: SrtHost = HOST, egress: SrtEgress = EGRESS) {
  let n = 0;
  return srtBox({
    run: fake.run,
    bin: "srt",
    env: { PATH: "/usr/bin:/bin", HOME: "/Users/op", GH_TOKEN: "ghp_x", HTTPS_PROXY: "http://corp:8080" },
    host,
    egress,
    caName: "NODE_EXTRA_CA_CERTS",
    runsDir: RUNS,
    tmpRoot: TMPS,
    newName: () => `srt-test-${++n}-${Math.random().toString(36).slice(2, 8)}`,
  });
}

const TRUE = { argv: ["true"], stdin: { kind: "none" }, timeoutSeconds: 30 } as const;

// the runner as app.ts makes it, from the host's environment, on a fake srt that records each call
boxContract(
  "srt on a fake srt",
  (host) => {
    const fake = fakeSrt({ command: { code: 0, stdout: "streamed\n", stderr: "" } });
    let n = 0;
    const made = srtBox({
      run: fake.run,
      bin: "srt",
      env: host,
      host: HOST,
      egress: EGRESS,
      caName: "NODE_EXTRA_CA_CERTS",
      runsDir: RUNS,
      newName: () => `srt-contract-${++n}-${Math.random().toString(36).slice(2, 8)}`,
    });
    return { box: made, handed: () => fake.calls.map((c) => ({ argv: c.args, env: c.env })) };
  },
  { image: NO_IMAGE, proxy: "", network: "" },
);

describe("srt runner: the policy (#114)", () => {
  const policy = srtPolicy({
    host: HOST,
    egress: EGRESS,
    run: {
      worktree: WORKTREE,
      readOnly: [".git/config"],
      home: "/Users/op/.factory/srt-runs/r/home",
      tmp: "/private/tmp/af-Xy12Ab",
    },
  });

  it("lets the run write only in its clone and its private HOME, and keeps the read-only paths read-only", () => {
    expect(policy.filesystem.allowWrite).toEqual([
      WORKTREE,
      "/Users/op/.factory/srt-runs/r/home",
      "/private/tmp/af-Xy12Ab",
    ]);
    expect(policy.filesystem.denyWrite).toEqual([`${WORKTREE}/.git/config`]);
  });

  it("hides the whole home, and denies the credential paths, the factory home and the Docker sockets by name too", () => {
    const deny = policy.filesystem.denyRead;
    expect(deny[0]).toBe("/Users/op");
    for (const path of [
      "/Users/op/.ssh",
      "/Users/op/.config/gh",
      "/Users/op/.config/glab-cli",
      "/Users/op/.git-credentials",
      "/Users/op/.netrc",
      "/Users/op/.aws",
      "/Users/op/.azure",
      "/Users/op/.config/gcloud",
      "/Users/op/.factory",
      "/var/run/docker.sock",
      "/Users/op/.rd/docker.sock",
    ]) {
      expect(deny).toContain(path);
    }
    expect(deny.length).toBeGreaterThanOrEqual(CREDENTIAL_PATHS.length);
    // the clone and the private HOME come back writable; the agent CLI's install, its Node and the toolchains (#371)
    // come back read-only
    expect(policy.filesystem.allowRead).toEqual([
      WORKTREE,
      "/Users/op/.factory/srt-runs/r/home",
      "/private/tmp/af-Xy12Ab",
      ...PROGRAMS,
      ...TOOLCHAINS,
    ]);
    expect(policy.filesystem.allowWrite.filter((w) => [...PROGRAMS, ...TOOLCHAINS].includes(w))).toEqual([]);
    expect(policy.filesystem.allowWrite.some((w) => TOOLCHAINS.some((t) => t.startsWith(w)))).toBe(false);
  });

  it("allows only the checked allowlist, on port 443, no local binding and no Unix socket, and no weaker mode", () => {
    expect(policy.network).toEqual({
      allowedDomains: ["npmjs.org:443", "*.npmjs.org:443", "api.anthropic.com:443"],
      deniedDomains: [],
      allowLocalBinding: false,
      allowAllUnixSockets: false,
    });
    expect(policy).toMatchObject({
      enableWeakerNestedSandbox: false,
      enableWeakerNetworkIsolation: false,
      allowNestedUserNamespaces: false,
      allowAppleEvents: false,
    });
    expect(srtDomains([])).toEqual([]);
  });

  it("chains to the company proxy at work, and reads the company CA inside the factory home", () => {
    const work = srtPolicy({
      host: HOST,
      egress: {
        ...EGRESS,
        upstream: { kind: "proxy", host: "proxy.corp.example", port: 8080 },
        caCerts: "/etc/ca.pem",
      },
      run: { worktree: WORKTREE, readOnly: [], home: "/h", tmp: "/private/tmp/af-a" },
    });
    expect(work.network.parentProxy).toEqual({
      http: "http://proxy.corp.example:8080",
      https: "http://proxy.corp.example:8080",
    });
    expect(work.filesystem.allowRead).toContain("/etc/ca.pem");
  });

  it("hands srt the host's PATH and locale, the private HOME, its temp folder and the CA, and no other host variable", () => {
    const env = srtEnv({
      host: {
        PATH: "/bin",
        LANG: "C",
        HOME: "/Users/op",
        GH_TOKEN: "x",
        HTTPS_PROXY: "http://corp:8080",
        TMPDIR: "/var/folders/xy/T/",
        TMP: "/tmp",
        TEMP: "/tmp",
        CLAUDE_CODE_TMPDIR: "/tmp",
      },
      home: "/h",
      tmp: "/private/tmp/af-Xy12Ab",
      ca: { name: "NODE_EXTRA_CA_CERTS", file: "/etc/ca.pem" },
      spec: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN },
    });
    expect(env).toEqual({
      PATH: "/bin",
      LANG: "C",
      HOME: "/h",
      CLAUDE_CODE_TMPDIR: "/private/tmp/af-Xy12Ab",
      TMP: "/private/tmp/af-Xy12Ab",
      TEMP: "/private/tmp/af-Xy12Ab",
      NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
      CLAUDE_CODE_OAUTH_TOKEN: TOKEN,
    });
  });

  // ledger/4 (#62): with no writable temp folder, Claude Code's Bash tool failed every call with EPERM on
  // /private/tmp/claude-501/...; srt sets the run's TMPDIR to CLAUDE_CODE_TMPDIR. A folder inside the private HOME then
  // failed every command with "listen EINVAL" on macOS: srt makes its sockets in it, and their paths are capped at 104
  // bytes
  it("gives the run its own short temp folder, writable, and never /tmp itself (#62)", () => {
    const tmp = "/private/tmp/af-Xy12Ab";
    const env = srtEnv({ host: { PATH: "/bin" }, home: "/h", tmp, ca: { name: "X", file: "" }, spec: {} });
    expect([env.CLAUDE_CODE_TMPDIR, env.TMP, env.TEMP]).toEqual([tmp, tmp, tmp]);
    // srt sets TMPDIR in the run itself
    expect(env.TMPDIR).toBeUndefined();
    expect(policy.filesystem.allowWrite).toContain("/private/tmp/af-Xy12Ab");
    const roots = new Set(["/tmp", "/private/tmp", "/var/tmp", "/tmp/claude"]);
    expect([...policy.filesystem.allowWrite, ...policy.filesystem.allowRead].filter((p) => roots.has(p))).toEqual([]);
  });

  it("refuses a temp folder too long for srt's sockets", () => {
    expect(tmpTooLong("/private/tmp/af-Xy12Ab")).toBe("");
    const long = "/Users/someone/.factory/srt-runs/factory-srt-a74b9ea0-0e56-4017-8926-a249b211b387/home/tmp";
    expect(tmpTooLong(long)).toMatch(/too long for srt's sockets/);
  });
});

describe("srt runner: the probe refuses to start without the pinned srt (S7)", () => {
  it("is ready with the pinned version on macOS and Linux", async () => {
    expect(await box(fakeSrt()).probe()).toEqual({ kind: "ready" });
    expect(await box(fakeSrt(), { ...HOST, platform: "linux" }).probe()).toEqual({ kind: "ready" });
  });

  it("refuses a missing srt, another version, and Windows", async () => {
    const missing = await box(fakeSrt({ version: { code: 127, stdout: "", stderr: "spawn srt ENOENT" } })).probe();
    expect(missing).toEqual({
      kind: "missing",
      reason: `srt does not answer (spawn srt ENOENT); install it: npm install --global --omit=optional @anthropic-ai/sandbox-runtime@${SRT_VERSION}`,
    });
    const other = await box(fakeSrt({ version: { code: 0, stdout: "0.0.81\n", stderr: "" } })).probe();
    expect(other).toMatchObject({ kind: "missing", reason: expect.stringContaining(`not the pinned ${SRT_VERSION}`) });
    expect(readSrtProbe({ platform: "win32", programs: HOST.programs, refused: [], version: VERSION })).toMatchObject({
      kind: "missing",
    });
    // an agent CLI that cannot be found is refused before srt is asked
    const noCli = { ...HOST, programs: { kind: "failed", reason: "claude is not on PATH" } } as const;
    expect(await box(fakeSrt(), noCli).probe()).toEqual({ kind: "missing", reason: "claude is not on PATH" });
  });

  it("refuses to start while a srt.readOnly entry is refused, and says why (#371)", async () => {
    const reason = 'srt.readOnly "~/.ssh" is or holds ~/.ssh, a credential path, which no run may read';
    const refused = { ...HOST, toolchains: { ...HOST.toolchains, refused: [reason] } };
    expect(await box(fakeSrt(), refused).probe()).toEqual({ kind: "missing", reason });
  });
});

describe("srt runner: start, run and stop (#114)", () => {
  it("writes the policy outside the clone, runs the command in the clone through srt, and removes its folder on stop", async () => {
    const fake = fakeSrt();
    const runner = box(fake);
    const started = await runner.start(SPEC);
    if (started.kind !== "started") throw new Error(started.reason);
    expect(started.session.place).toBe("srt");
    const ran = await runner.run({
      session: started.session,
      command: { argv: ["claude", "-p", "--verbose"], stdin: { kind: "text", text: "the prompt" }, timeoutSeconds: 30 },
    });
    expect(ran).toEqual({ kind: "exited", code: 0, stdout: "", stderr: "" });
    const call = fake.calls.at(-1);
    if (call === undefined) throw new Error("no call");
    const policyFile = join(RUNS, started.session.id, "policy.json");
    expect(call.args).toEqual(["--settings", policyFile, "--", "claude", "-p", "--verbose"]);
    expect(call.cwd).toBe(WORKTREE);
    expect(call.stdin).toBe("the prompt");
    const tmp = call.env?.CLAUDE_CODE_TMPDIR ?? "";
    expect(tmp.startsWith(join(TMPS, "af-"))).toBe(true);
    expect(call.env).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: join(RUNS, started.session.id, "home"),
      CLAUDE_CODE_TMPDIR: tmp,
      TMP: tmp,
      TEMP: tmp,
      CLAUDE_CODE_OAUTH_TOKEN: TOKEN,
    });
    // the run's temp folder is made before the run, private to it (#62)
    expect(statSync(tmp).isDirectory()).toBe(true);
    expect(statSync(tmp).mode & 0o777).toBe(0o700);
    const policy: unknown = JSON.parse(readFileSync(policyFile, "utf8"));
    expect(policy).toMatchObject({
      filesystem: { allowWrite: [WORKTREE, join(RUNS, started.session.id, "home"), tmp] },
    });
    expect(await runner.stop(started.session)).toEqual({ kind: "ok" });
    expect(existsSync(join(RUNS, started.session.id))).toBe(false);
    expect(existsSync(tmp)).toBe(false);
  });

  it("stops a command at its timeout, and reads it as timed out", async () => {
    const fake = fakeSrt({ hang: true });
    const runner = box(fake);
    const started = await runner.start(SPEC);
    if (started.kind !== "started") throw new Error(started.reason);
    const ran = await runner.run({ session: started.session, command: { ...TRUE, timeoutSeconds: 0.05 } });
    expect(ran).toEqual({ kind: "timedOut", seconds: 0.05 });
    await runner.stop(started.session);
  });

  it("stops a running command when the runner stops", async () => {
    const fake = fakeSrt({ hang: true });
    const runner = box(fake);
    const started = await runner.start(SPEC);
    if (started.kind !== "started") throw new Error(started.reason);
    const running = runner.run({ session: started.session, command: TRUE });
    await runner.stop(started.session);
    expect(await running).toMatchObject({ kind: "exited", code: 143 });
    expect(fake.calls.at(-1)?.stop?.aborted).toBe(true);
  });

  it("refuses a relative clone, a read-only path outside it, and a variable srt or the runner sets", async () => {
    const runner = box(fakeSrt());
    expect(await runner.start({ ...SPEC, worktree: "repo" })).toMatchObject({ kind: "failed" });
    expect(await runner.start({ ...SPEC, readOnly: ["../x"] })).toMatchObject({ kind: "failed" });
    for (const name of ["HOME", "HTTPS_PROXY", "SRT_DEBUG", "TMPDIR", "TMP", "TEMP", "CLAUDE_CODE_TMPDIR"]) {
      expect(await runner.start({ ...SPEC, env: { [name]: "x" } })).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining(name),
      });
    }
  });
});
