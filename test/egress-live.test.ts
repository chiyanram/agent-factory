import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Call, Exit, Runner } from "../src/core/forge/api.js";
import type { Ran } from "../src/core/box/types.js";
import { checkEgress } from "../src/core/egress/live.js";
import type { BoxSetup } from "../src/core/ready/boxrun.js";
import type { PlanRead } from "../src/core/ready/plan.js";
import { egressCommand, parseEgressArgs, type EgressDeps } from "../src/egress-cli.js";
import { fakeBox } from "./fake-box.js";
import { tempDir } from "./temp.js";

const exited = (stdout: string, code = 0): Ran => ({ kind: "exited", code, stdout, stderr: "" });
const json = (value: object): Ran => exited(`${JSON.stringify(value)}\n`);

describe("checkEgress", () => {
  let dir = "";
  beforeEach(() => {
    dir = tempDir("egress-check-");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const answers: readonly Ran[] = [
    json({ proxy: 403 }),
    json({ proxy: 200, server: "HTTP/1.1 404 Not Found" }),
    json({ proxy: 403 }),
    json({ error: "ENETUNREACH" }),
    json({ error: "EAI_AGAIN" }),
    json({ open: [] }),
    exited("pulled"),
  ];
  const docker = (calls: Call[]): { run: Runner; bin: string; env: NodeJS.ProcessEnv } => ({
    run: async (c): Promise<Exit> => {
      calls.push(c);
      return { code: 0, stdout: "172.20.0.1 ", stderr: "" };
    },
    bin: "docker",
    env: {},
  });

  it("starts the proxy once, runs every check behind it in one runner, and stops the runner", async () => {
    const fake = fakeBox({ runs: answers });
    let egressStarts = 0;
    const setup: BoxSetup = {
      box: fake.box,
      image: { kind: "pinned", ref: `sha256:${"1".repeat(64)}` },
      egress: async () => {
        egressStarts += 1;
        return { kind: "started", proxy: { host: "factory-egress-ledger", port: 3128 }, network: "factory-int-ledger" };
      },
      repo: dir,
      env: {},
      runsDir: join(dir, "runs"),
    };
    const calls: Call[] = [];
    const rows = await checkEgress({
      setup,
      gitHosts: [],
      allowlist: ["api.anthropic.com", ".docker.io"],
      docker: docker(calls),
      ports: [],
      modelHost: "api.anthropic.com",
      pullImage: "hello-world",
    });
    expect(rows.kind).toBe("ok");
    if (rows.kind !== "ok") return;
    expect(rows.value.map((r) => r.verdict.kind)).toEqual(Array(7).fill("pass"));
    expect(egressStarts).toBe(1);
    const start = fake.calls.find((c) => c.op === "start");
    expect(start).toMatchObject({
      spec: { network: "factory-int-ledger", proxy: "http://factory-egress-ledger:3128" },
    });
    expect(calls.map((c) => c.args.at(-1))).toEqual(["factory-int-ledger"]);
    expect(fake.calls.at(-1)?.op).toBe("stop");
    expect(existsSync(join(dir, "runs")) && readdirSync(join(dir, "runs"))).toEqual([]);
  });

  it("starts no runner when the proxy does not start", async () => {
    const fake = fakeBox({});
    const rows = await checkEgress({
      setup: {
        box: fake.box,
        image: { kind: "pinned", ref: `sha256:${"1".repeat(64)}` },
        egress: async () => ({ kind: "failed", reason: "docker create: no such image" }),
        repo: dir,
        env: {},
        runsDir: join(dir, "runs"),
      },
      gitHosts: [],
      allowlist: ["api.anthropic.com"],
      docker: docker([]),
      ports: [],
      modelHost: "api.anthropic.com",
      pullImage: "hello-world",
    });
    expect(rows).toEqual({ kind: "failed", reason: "the egress proxy did not start: docker create: no such image" });
    expect(fake.calls).toEqual([]);
  });
});

describe("parseEgressArgs", () => {
  it("reads the project, the named ports and the overrides", () => {
    expect(parseEgressArgs(["check", "ledger", "--port", "22", "--port", "443"])).toEqual({
      project: "ledger",
      ports: [22, 443],
      modelHost: "api.anthropic.com",
      pullImage: "hello-world",
    });
    expect(
      parseEgressArgs(["check", "ledger", "--model-host", "api.githubcopilot.com", "--pull", "redis:7"]),
    ).toMatchObject({ modelHost: "api.githubcopilot.com", pullImage: "redis:7" });
  });

  it("refuses a missing project, another word, a bad port and an unknown option", () => {
    for (const argv of [["check"], ["run", "ledger"], ["check", "ledger", "--port", "0"], ["check", "ledger", "-x"]]) {
      expect(parseEgressArgs(argv)).toBe("usage");
    }
  });
});

describe("egressCommand", () => {
  const deps = (plan: PlanRead) => {
    const err: string[] = [];
    return {
      err,
      deps: {
        out: () => undefined,
        err: (t: string) => err.push(t),
        resolved: (_p: string, go: Parameters<EgressDeps["resolved"]>[1]) =>
          go({
            docker: { run: async () => ({ code: 0, stdout: "", stderr: "" }), bin: "docker", env: {} },
            plan: async () => plan,
          }),
      },
    };
  };

  it("prints the usage on bad words, and the missing piece when no runner can start", async () => {
    const none = deps({
      kind: "ok",
      value: { gate: "local", plan: { kind: "unavailable", reason: "FACTORY_BOX is not set" } },
    });
    expect(await egressCommand(["check"], none.deps)).toBe(64);
    expect(await egressCommand(["check", "ledger"], none.deps)).toBe(1);
    expect(none.err.at(-1)).toBe("agent-factory egress: no runner for ledger: FACTORY_BOX is not set\n");
  });
});
