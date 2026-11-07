import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Call, Exit, Runner } from "../src/core/forge/api.js";
import type { PinnedImage } from "../src/core/box/types.js";
import { openEgress, planNetwork, readNetwork, startEgress } from "../src/core/egress/index.js";

const IMAGE: PinnedImage = { kind: "pinned", ref: `ubuntu/squid@sha256:${"b".repeat(64)}` };
const OK: Exit = { code: 0, stdout: "", stderr: "" };
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
    const fake = fakeDocker({ "network inspect factory-int": NO_NETWORK, "network inspect factory-ext": NO_NETWORK });
    const started = await startEgress({ docker: fake.docker, image: IMAGE, confFile: "/h/egress/squid.conf" });
    expect(started).toEqual({ kind: "started", proxy: { host: "factory-egress", port: 3128 }, network: "factory-int" });
    expect(argv(fake.calls)).toEqual([
      "network inspect --format {{.Internal}} factory-int",
      "network create --internal factory-int",
      "network inspect --format {{.Internal}} factory-ext",
      "network create factory-ext",
      "rm --force factory-egress",
      `create --name factory-egress --network factory-ext --restart unless-stopped ${IMAGE.ref}`,
      "cp /h/egress/squid.conf factory-egress:/etc/squid/squid.conf",
      "network connect factory-int factory-egress",
      "start factory-egress",
    ]);
  });

  it("keeps networks that exist and are right", async () => {
    const fake = fakeDocker({
      "network inspect factory-int": { code: 0, stdout: "true\n", stderr: "" },
      "network inspect factory-ext": { code: 0, stdout: "false\n", stderr: "" },
    });
    expect((await startEgress({ docker: fake.docker, image: IMAGE, confFile: "/c" })).kind).toBe("started");
    expect(argv(fake.calls).filter((a) => a.startsWith("network create"))).toEqual([]);
  });

  it("stops at an internal network that is open, and starts no proxy", async () => {
    const fake = fakeDocker({ "network inspect factory-int": { code: 0, stdout: "false\n", stderr: "" } });
    const started = await startEgress({ docker: fake.docker, image: IMAGE, confFile: "/c" });
    expect(started.kind).toBe("failed");
    expect(argv(fake.calls)).toEqual(["network inspect --format {{.Internal}} factory-int"]);
  });

  it("goes on when there was no old proxy to remove", async () => {
    const fake = fakeDocker({
      "rm --force factory-egress": {
        code: 1,
        stdout: "",
        stderr: "Error response from daemon: No such container: factory-egress",
      },
    });
    expect((await startEgress({ docker: fake.docker, image: IMAGE, confFile: "/c" })).kind).toBe("started");
  });

  it("stops at the first failed step and names it", async () => {
    const fake = fakeDocker({ cp: { code: 1, stdout: "", stderr: "no such file" } });
    expect(await startEgress({ docker: fake.docker, image: IMAGE, confFile: "/c" })).toEqual({
      kind: "failed",
      reason: "docker cp /c: no such file",
    });
    expect(argv(fake.calls).some((a) => a.startsWith("start"))).toBe(false);
  });
});

describe("openEgress", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "egress-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the config from the allowlist and starts the proxy with it", async () => {
    const fake = fakeDocker({});
    const started = await openEgress({
      allowlist: ["api.anthropic.com"],
      upstream: { kind: "none" },
      image: IMAGE,
      dir: join(dir, "egress"),
      docker: fake.docker,
    });
    expect(started.kind).toBe("started");
    expect(readFileSync(join(dir, "egress", "squid.conf"), "utf8")).toContain(
      "acl allowed dstdomain -n api.anthropic.com\n",
    );
    expect(argv(fake.calls)).toContain(`cp ${join(dir, "egress", "squid.conf")} factory-egress:/etc/squid/squid.conf`);
  });

  it("refuses a bad allowlist before it calls docker", async () => {
    const fake = fakeDocker({});
    const started = await openEgress({
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
