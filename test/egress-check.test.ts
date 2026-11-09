import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:net";
import { promisify } from "node:util";
import type { Ran } from "../src/core/box/types.js";
import {
  allows,
  answerOf,
  liveChecks,
  readGateway,
  report,
  type CheckInput,
  type LiveCheck,
} from "../src/core/egress/check.js";
import { PROBE } from "../src/core/egress/probe.js";

const INPUT: CheckInput = {
  proxy: { host: "factory-egress-ledger", port: 3128 },
  hosts: ["api.anthropic.com", "registry-1.docker.io"],
  gateway: "172.20.0.1",
  ports: [22],
  modelHost: "api.anthropic.com",
  pullImage: "hello-world",
};

const exited = (stdout: string, code = 0): Ran => ({ kind: "exited", code, stdout, stderr: "" });
const json = (value: object): Ran => exited(`${JSON.stringify(value)}\n`);
const run = (checks: readonly LiveCheck[], name: string) => {
  const found = checks.find((c) => c.name.startsWith(name));
  if (found?.kind !== "run") throw new Error(`no run check ${name}`);
  return found;
};

describe("liveChecks", () => {
  const checks = liveChecks(INPUT);

  it("covers every live test of #130's Done when, each as one command in the runner, with no shell", () => {
    expect(checks.map((c) => c.name)).toEqual([
      "a host off the allowlist is refused",
      "a model call reaches api.anthropic.com through the proxy",
      "api.anthropic.com on port 80 is refused",
      "a direct connection that skips the proxy is refused",
      "an outside name does not resolve in the runner",
      "on the host's gateway, only the ports setup names are open",
      "the inner Docker pulls hello-world, as Testcontainers does",
    ]);
    expect(run(checks, "a host off").argv).toEqual([
      "node",
      "-e",
      PROBE,
      "via",
      "factory-egress-ledger",
      "3128",
      "example.com",
      "443",
    ]);
    expect(run(checks, "on the host's gateway").argv.slice(3)).toEqual(["scan", "172.20.0.1", "1", "65535"]);
    expect(run(checks, "the inner Docker").argv).toEqual(["docker", "pull", "hello-world"]);
  });

  it("passes a refusal only on the proxy's 403, and a model call only when the host answered over TLS", () => {
    const off = run(checks, "a host off");
    expect(off.read(answerOf(json({ proxy: 403 }))).kind).toBe("pass");
    expect(off.read(answerOf(json({ proxy: 200, server: "HTTP/1.1 200 OK" }))).kind).toBe("fail");
    expect(off.read(answerOf({ kind: "timedOut", seconds: 25 })).kind).toBe("fail");
    const model = run(checks, "a model call");
    expect(model.read(answerOf(json({ proxy: 200, server: "HTTP/1.1 404 Not Found" }))).kind).toBe("pass");
    expect(model.read(answerOf(json({ proxy: 403 }))).kind).toBe("fail");
  });

  it("passes a direct connection and a DNS lookup only when they fail", () => {
    for (const name of ["a direct connection", "an outside name"]) {
      const check = run(checks, name);
      expect(check.read(answerOf(json({ error: "ENETUNREACH" }))).kind).toBe("pass");
      expect(check.read(answerOf(json({ connected: true }))).kind).toBe("fail");
      expect(check.read(answerOf(exited("node: not found", 127))).kind).toBe("fail");
    }
  });

  it("fails the gateway on an open port setup did not name, and names it", () => {
    const gateway = run(checks, "on the host's gateway");
    expect(gateway.read(answerOf(json({ open: [22] }))).kind).toBe("pass");
    expect(gateway.read(answerOf(json({ open: [22, 5432] })))).toEqual({
      kind: "fail",
      detail: expect.stringContaining("not named by setup: 5432"),
    });
  });

  it("passes the pull on docker's exit 0 only", () => {
    const pull = run(checks, "the inner Docker");
    expect(pull.read(answerOf(exited("Status: Downloaded newer image"))).kind).toBe("pass");
    expect(pull.read(answerOf({ kind: "exited", code: 1, stdout: "", stderr: "proxyconnect tcp: 403" }))).toEqual({
      kind: "fail",
      detail: "exit 1: proxyconnect tcp: 403",
    });
  });

  it("skips what this project's list cannot test, and says why", () => {
    const listed = liveChecks({ ...INPUT, hosts: [".example.com"], gateway: "" });
    expect(listed.filter((c) => c.kind === "skipped").map((c) => c.name)).toEqual([
      "a host off the allowlist is refused",
      "a model call reaches api.anthropic.com through the proxy",
      "on the host's gateway, only the ports setup names are open",
    ]);
  });
});

describe("allows and readGateway", () => {
  it("reads the list as Squid's dstdomain does", () => {
    expect(allows([".docker.io"], "registry-1.docker.io")).toBe(true);
    expect(allows([".docker.io"], "docker.io")).toBe(true);
    expect(allows(["docker.io"], "registry-1.docker.io")).toBe(false);
  });

  it("takes the first IPv4 gateway docker names", () => {
    expect(readGateway("fd00::1 172.20.0.1 \n")).toBe("172.20.0.1");
    expect(readGateway(" \n")).toBe("");
  });
});

describe("report", () => {
  it("fails when one check fails, and not on a skip", () => {
    const pass = { kind: "pass", detail: "ok" } as const;
    const skip = { kind: "skipped", detail: "n/a" } as const;
    expect(
      report([
        { name: "a", verdict: pass },
        { name: "b", verdict: skip },
      ]).ok,
    ).toBe(true);
    const failed = report([{ name: "a", verdict: { kind: "fail", detail: "open" } }]);
    expect(failed).toEqual({ text: "fail    a: open\n", ok: false });
  });
});

// the probe itself, run by this machine's node against local servers: no Docker and no network needed
describe("the probe", () => {
  const servers: Server[] = [];
  const probe = async (...args: string[]): Promise<unknown> => {
    const { stdout } = await promisify(execFile)(process.execPath, ["-e", PROBE, ...args]);
    return JSON.parse(stdout);
  };
  const listen = (answer: string): Promise<number> =>
    new Promise((done) => {
      const server = createServer((s) => s.once("data", () => s.end(answer)));
      servers.push(server);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        done(typeof address === "object" && address !== null ? address.port : 0);
      });
    });

  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });

  it("reads a proxy's refusal of a CONNECT", async () => {
    const port = await listen("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    expect(await probe("via", "127.0.0.1", String(port), "example.com", "443")).toEqual({ proxy: 403 });
  });

  it("tells a connection from a refused one, and finds the open port in a scan", async () => {
    const port = await listen("");
    expect(await probe("direct", "127.0.0.1", String(port))).toEqual({ connected: true });
    servers[0]?.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(await probe("direct", "127.0.0.1", String(port))).toEqual({ error: "ECONNREFUSED" });
    const open = await listen("");
    expect(await probe("scan", "127.0.0.1", String(open - 2), String(open + 2))).toEqual({ open: [open] });
  });

  it("answers a lookup", async () => {
    expect(await probe("dns", "localhost")).toEqual({ address: expect.any(String) });
  });
});
