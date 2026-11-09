import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Call, Exit, Runner } from "../src/core/forge/api.js";
import type { PinnedImage } from "../src/core/box/types.js";
import {
  egressNames,
  openEgress,
  planNetwork,
  readNetwork,
  startEgress,
  upstreamOf,
} from "../src/core/egress/index.js";
import { tempDir } from "./temp.js";

const IMAGE: PinnedImage = { kind: "pinned", ref: `ubuntu/squid@sha256:${"b".repeat(64)}` };
const OK: Exit = { code: 0, stdout: "", stderr: "" };
const NAMES = egressNames("ledger");
const NO_NETWORK: Exit = { code: 1, stdout: "", stderr: "Error response from daemon: network factory-int not found" };

// a fake docker: answers by the first two arguments and the last, records every call; a network it is not told about
// is missing
function fakeDocker(answers: Readonly<Record<string, Exit>>): {
  readonly calls: Call[];
  readonly docker: { run: Runner; bin: string; env: NodeJS.ProcessEnv };
} {
  const calls: Call[] = [];
  const run: Runner = async (c) => {
    calls.push(c);
    const first = c.args.slice(0, 2).join(" ");
    const keys = [`${first} ${c.args.at(-1) ?? ""}`, first, c.args[0] ?? ""];
    const hit = keys.map((k) => answers[k]).find((e) => e !== undefined);
    return hit ?? (c.args[1] === "inspect" ? NO_NETWORK : OK);
  };
  return { calls, docker: { run, bin: "docker", env: {} } };
}

const argv = (calls: readonly Call[]): string[] => calls.map((c) => c.args.join(" "));

describe("planNetwork", () => {
  it("creates a missing network and keeps one that matches", () => {
    expect(planNetwork({ name: "n", state: { kind: "absent" }, internal: true })).toEqual({ kind: "create" });
    expect(planNetwork({ name: "n", state: { kind: "present", internal: true }, internal: true })).toEqual({
      kind: "keep",
    });
  });

  it("refuses an internal network that is not --internal, so no box joins an open network", () => {
    expect(planNetwork({ name: "factory-int", state: { kind: "present", internal: false }, internal: true })).toEqual({
      kind: "refused",
      reason: expect.stringContaining("docker network rm factory-int"),
    });
  });
});

describe("readNetwork", () => {
  it("reads internal true and false", () => {
    expect(readNetwork({ code: 0, stdout: "true\n", stderr: "" })).toEqual({ kind: "present", internal: true });
    expect(readNetwork({ code: 0, stdout: "false\n", stderr: "" })).toEqual({ kind: "present", internal: false });
  });

  it("reads a missing network as absent, from docker and from podman wording", () => {
    expect(readNetwork(NO_NETWORK)).toEqual({ kind: "absent" });
    expect(readNetwork({ code: 1, stdout: "", stderr: "Error: No such network: factory-int" })).toEqual({
      kind: "absent",
    });
  });

  it("never reads a broken docker as a network to create", () => {
    expect(readNetwork({ code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" }).kind).toBe("failed");
  });
});

describe("startEgress", () => {
  it("creates both networks, then a fresh proxy on both, with the config copied in", async () => {
    const fake = fakeDocker({
      "network inspect factory-int-ledger": NO_NETWORK,
      "network inspect factory-ext": NO_NETWORK,
    });
    const started = await startEgress({
      docker: fake.docker,
      image: IMAGE,
      confFile: "/h/egress/squid.conf",
      names: NAMES,
    });
    expect(started).toEqual({
      kind: "started",
      proxy: { host: "factory-egress-ledger", port: 3128 },
      network: "factory-int-ledger",
    });
    expect(argv(fake.calls)).toEqual([
      "network inspect --format {{.Internal}} factory-int-ledger",
      "network create --internal factory-int-ledger",
      "network inspect --format {{.Internal}} factory-ext",
      "network create factory-ext",
      "rm --force factory-egress-ledger",
      `create --name factory-egress-ledger --network factory-ext --restart unless-stopped ${IMAGE.ref}`,
      "cp /h/egress/squid.conf factory-egress-ledger:/etc/squid/squid.conf",
      "network connect factory-int-ledger factory-egress-ledger",
      "start factory-egress-ledger",
    ]);
  });

  it("keeps networks that exist and are right", async () => {
    const fake = fakeDocker({
      "network inspect factory-int-ledger": { code: 0, stdout: "true\n", stderr: "" },
      "network inspect factory-ext": { code: 0, stdout: "false\n", stderr: "" },
    });
    expect((await startEgress({ docker: fake.docker, image: IMAGE, confFile: "/c", names: NAMES })).kind).toBe(
      "started",
    );
    expect(argv(fake.calls).filter((a) => a.startsWith("network create"))).toEqual([]);
  });

  it("stops at an internal network that is open, and starts no proxy", async () => {
    const fake = fakeDocker({ "network inspect factory-int-ledger": { code: 0, stdout: "false\n", stderr: "" } });
    const started = await startEgress({ docker: fake.docker, image: IMAGE, confFile: "/c", names: NAMES });
    expect(started.kind).toBe("failed");
    expect(argv(fake.calls)).toEqual(["network inspect --format {{.Internal}} factory-int-ledger"]);
  });

  it("goes on when there was no old proxy to remove", async () => {
    const fake = fakeDocker({
      "rm --force factory-egress-ledger": {
        code: 1,
        stdout: "",
        stderr: "Error response from daemon: No such container: factory-egress-ledger",
      },
    });
    expect((await startEgress({ docker: fake.docker, image: IMAGE, confFile: "/c", names: NAMES })).kind).toBe(
      "started",
    );
  });

  it("stops at the first failed step and names it", async () => {
    const fake = fakeDocker({ cp: { code: 1, stdout: "", stderr: "no such file" } });
    expect(await startEgress({ docker: fake.docker, image: IMAGE, confFile: "/c", names: NAMES })).toEqual({
      kind: "failed",
      reason: "docker cp /c: no such file",
    });
    expect(argv(fake.calls).some((a) => a.startsWith("start"))).toBe(false);
  });
});

describe("openEgress", () => {
  let dir = "";
  beforeEach(() => {
    dir = tempDir("egress-");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the config from the allowlist and starts the proxy with it", async () => {
    const fake = fakeDocker({});
    const started = await openEgress({
      project: "ledger",
      allowlist: ["api.anthropic.com"],
      upstream: { kind: "none" },
      image: IMAGE,
      dir: join(dir, "egress"),
      docker: fake.docker,
    });
    expect(started.kind).toBe("started");
    expect(readFileSync(join(dir, "egress", "ledger", "squid.conf"), "utf8")).toContain(
      "acl allowed dstdomain -n api.anthropic.com\n",
    );
    expect(argv(fake.calls)).toContain(
      `cp ${join(dir, "egress", "ledger", "squid.conf")} factory-egress-ledger:/etc/squid/squid.conf`,
    );
  });

  it("refuses a bad allowlist before it calls docker", async () => {
    const fake = fakeDocker({});
    const started = await openEgress({
      project: "ledger",
      allowlist: ["*.evil.com"],
      upstream: { kind: "none" },
      image: IMAGE,
      dir,
      docker: fake.docker,
    });
    expect(started.kind).toBe("failed");
    expect(fake.calls).toEqual([]);
  });
});

describe("egressNames", () => {
  it("gives each project its own proxy and internal network, so no pass swaps another project's allowlist", () => {
    expect(egressNames("ledger")).toEqual({ proxy: "factory-egress-ledger", network: "factory-int-ledger" });
    expect(egressNames("app2")).not.toEqual(egressNames("ledger"));
  });
});

describe("openEgress for two projects", () => {
  let dir = "";
  beforeEach(() => {
    dir = tempDir("egress-");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps each project's config in its own file, so one project's list never reaches the other's proxy", async () => {
    const open = (project: string, host: string) =>
      openEgress({
        project,
        allowlist: [host],
        upstream: { kind: "none" },
        image: IMAGE,
        dir,
        docker: fakeDocker({}).docker,
      });
    await open("ledger", "ledger.example.com");
    await open("app2", "app2.example.com");
    expect(readFileSync(join(dir, "ledger", "squid.conf"), "utf8")).not.toContain("app2.example.com");
    expect(readFileSync(join(dir, "app2", "squid.conf"), "utf8")).not.toContain("ledger.example.com");
  });
});

describe("upstreamOf", () => {
  it("goes direct when FACTORY_UPSTREAM_PROXY is unset or empty", () => {
    expect(upstreamOf({})).toEqual({ kind: "none" });
    expect(upstreamOf({ FACTORY_UPSTREAM_PROXY: " " })).toEqual({ kind: "none" });
  });

  it("reads host:port", () => {
    expect(upstreamOf({ FACTORY_UPSTREAM_PROXY: "proxy.corp.example:8080" })).toEqual({
      kind: "proxy",
      host: "proxy.corp.example",
      port: 8080,
    });
  });

  it("refuses a scheme, a user, a missing port and a port out of range", () => {
    for (const set of ["http://proxy:8080", "user:pw@proxy:8080", "proxy", "proxy:0", "proxy:70000", "pro xy:80"]) {
      expect(upstreamOf({ FACTORY_UPSTREAM_PROXY: set }).kind).toBe("refused");
    }
  });
});
