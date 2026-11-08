import { describe, expect, it } from "vitest";
import type { Call, Exit, Runner } from "../src/core/forge/api.js";
import type { BoxSpec, PinnedImage } from "../src/core/box/types.js";
import { hostDocker } from "../src/core/box/docker.js";
import { vmBox } from "../src/core/box/vm.js";
import { checkSpec, readRan } from "../src/core/box/vm-plan.js";
import { boxContract } from "./box-contract.js";

const IMAGE: PinnedImage = { kind: "pinned", ref: `factory-box@sha256:${"c".repeat(64)}` };
const OWNER = { uid: 1001, gid: 1002 };
const TOKEN = "sk-ant-oat01-not-a-real-token";
const SPEC: BoxSpec = {
  image: IMAGE,
  worktree: "/home/op/.factory/runs/7/repo",
  readOnly: [".claude", "AGENTS.md"],
  env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN },
  proxy: "http://factory-egress-ledger:3128",
  network: "factory-int-ledger",
};
const OK: Exit = { code: 0, stdout: "", stderr: "" };
const RUNTIMES: Exit = { code: 0, stdout: "io.containerd.runc.v2\nrunc\nsysbox-runc\n", stderr: "" };

// a fake docker that keeps the containers it started: exec in a missing one fails as docker does; `answers` overrides
// an answer by its first two arguments, and `command` is the exit of every command a run starts
function fakeDocker(
  answers: Readonly<Record<string, Exit>> = {},
  command: Exit = OK,
): { readonly calls: Call[]; readonly run: Runner } {
  const calls: Call[] = [];
  const live = new Set<string>();
  const gone = (name: string): Exit => ({
    code: 1,
    stdout: "",
    stderr: `Error response from daemon: No such container: ${name}`,
  });
  const container = (c: Call): string => c.args[c.args.indexOf("--name") + 1] ?? "";
  const execTarget = (c: Call): string => c.args.find((a) => a.startsWith("factory-box-")) ?? "";
  const fallback: Readonly<Record<string, (c: Call) => Exit>> = {
    "info --format": () => RUNTIMES,
    run: (c) => (live.add(container(c)), OK),
    exec: (c) => (live.has(execTarget(c)) ? (c.args.includes("--workdir") ? command : OK) : gone(execTarget(c))),
    rm: (c) => (live.delete(c.args.at(-1) ?? "") ? OK : gone(c.args.at(-1) ?? "")),
  };
  // the answer under the first two arguments, else under the first one
  const pick = <T>(table: Readonly<Record<string, T>>, c: Call): T | undefined =>
    table[c.args.slice(0, 2).join(" ")] ?? table[c.args[0] ?? ""];
  const run: Runner = async (c) => {
    calls.push(c);
    return pick(answers, c) ?? pick(fallback, c)?.(c) ?? OK;
  };
  return { calls, run };
}

function box(fake: { readonly run: Runner }, now: () => number = () => 0) {
  let n = 0;
  return vmBox({
    docker: { run: fake.run, bin: "docker", env: { PATH: "/usr/bin" } },
    image: IMAGE.ref,
    owner: OWNER,
    newName: () => `factory-box-${++n}`,
    now,
  });
}

const argv = (calls: readonly Call[]): string[] => calls.map((c) => c.args.join(" "));
const TRUE = { argv: ["true"], stdin: { kind: "none" }, timeoutSeconds: 30 } as const;

// the docker CLI as app.ts makes it, from the host's environment, on a fake docker that records each call
boxContract("vm on a fake docker", (host) => {
  const fake = fakeDocker();
  let n = 0;
  const made = vmBox({
    docker: hostDocker(host, fake.run),
    image: IMAGE.ref,
    owner: OWNER,
    newName: () => `factory-box-${++n}`,
  });
  return { box: made, handed: () => fake.calls.map((c) => ({ argv: c.args, env: c.env })) };
});

describe("vm box: probe", () => {
  it("is ready when docker answers, Sysbox is installed and the image is here", async () => {
    expect(await box(fakeDocker()).probe()).toEqual({ kind: "ready" });
  });

  it("refuses a host with no Sysbox, so the box never falls back to --privileged", async () => {
    const fake = fakeDocker({ "info --format": { code: 0, stdout: "io.containerd.runc.v2\nrunc\n", stderr: "" } });
    expect(await box(fake).probe()).toEqual({
      kind: "missing",
      reason: expect.stringContaining("no sysbox-runc runtime; install Sysbox on this host (#158)"),
    });
  });

  it("refuses when docker does not answer, or the image is not here", async () => {
    const down = fakeDocker({
      "info --format": { code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" },
    });
    expect(await box(down).probe()).toEqual({
      kind: "missing",
      reason: "docker does not answer: Cannot connect to the Docker daemon",
    });
    const noImage = fakeDocker({ "image inspect": { code: 1, stdout: "", stderr: "No such image" } });
    expect(await box(noImage).probe()).toEqual({
      kind: "missing",
      reason: `image ${IMAGE.ref} is not on this host: No such image`,
    });
  });

  it("refuses a root owner, because the agent would run as root", async () => {
    const fake = fakeDocker();
    const root = vmBox({
      docker: { run: fake.run, bin: "docker", env: {} },
      image: IMAGE.ref,
      owner: { uid: 0, gid: 0 },
    });
    expect((await root.probe()).kind).toBe("missing");
  });
});

describe("vm box: start", () => {
  it("runs the box under Sysbox on its project's internal network, then gives the box user the owner's ids", async () => {
    const fake = fakeDocker();
    const started = await box(fake).start(SPEC);
    expect(started).toEqual({ kind: "started", session: { id: "factory-box-1", place: "vm" } });
    expect(argv(fake.calls)).toEqual([
      [
        "run --detach --name factory-box-1 --runtime sysbox-runc --init --network factory-int-ledger",
        "--mount type=bind,src=/home/op/.factory/runs/7/repo,dst=/work",
        "--mount type=bind,src=/home/op/.factory/runs/7/repo/.claude,dst=/work/.claude,readonly",
        "--mount type=bind,src=/home/op/.factory/runs/7/repo/AGENTS.md,dst=/work/AGENTS.md,readonly",
        "--mount type=volume,dst=/var/lib/docker",
        "--tmpfs /home/box:rw,nosuid,nodev,mode=0700",
        "--env HTTP_PROXY=http://factory-egress-ledger:3128 --env HTTPS_PROXY=http://factory-egress-ledger:3128",
        `--env NO_PROXY=localhost,127.0.0.1,::1 ${IMAGE.ref}`,
      ].join(" "),
      "exec --user 0 factory-box-1 groupmod --non-unique --gid 1002 box",
      "exec --user 0 factory-box-1 usermod --non-unique --uid 1001 --gid 1002 box",
      "exec --user 0 factory-box-1 chown box:box /home/box",
      "exec --user 0 factory-box-1 timeout 60 sh -c until docker info >/dev/null 2>&1; do sleep 1; done",
    ]);
  });

  it("never runs a box --privileged and never puts a variable's value on the command line", async () => {
    const fake = fakeDocker();
    const vm = box(fake);
    const started = await vm.start(SPEC);
    if (started.kind !== "started") throw new Error("start failed");
    await vm.run({ session: started.session, command: TRUE });
    const all = argv(fake.calls).join("\n");
    expect(all).not.toContain("--privileged");
    expect(all).not.toContain(TOKEN);
  });

  it("removes the box when a step after `docker run` fails", async () => {
    const fake = fakeDocker({ "exec --user": { code: 1, stdout: "", stderr: "groupmod: not found" } });
    expect(await box(fake).start(SPEC)).toEqual({ kind: "failed", reason: "docker exec --user: groupmod: not found" });
    expect(argv(fake.calls).at(-1)).toBe("rm --force --volumes factory-box-1");
  });

  it.each([
    [{ worktree: "repo" }, "must be an absolute path"],
    [{ worktree: "/a,b" }, "must be an absolute path with no comma"],
    [{ readOnly: ["../etc"] }, "is not inside the worktree"],
    [{ readOnly: ["/etc"] }, "is not inside the worktree"],
    [{ env: { DOCKER_HOST: "tcp://evil:2375" } }, '"DOCKER_HOST" is not allowed'],
    [{ env: { HOME: "/root" } }, '"HOME" is not allowed'],
    [{ env: { "A B": "x" } }, '"A B" is not allowed'],
    [{ proxy: "https://p:3128" }, "is not an http:// URL"],
    [{ network: "host" }, '"host" is not a docker network name'],
    [{ network: "factory-int-a --privileged" }, "is not a docker network name"],
  ] as const)("refuses %o before any docker call", async (change, reason) => {
    const fake = fakeDocker();
    expect(await box(fake).start({ ...SPEC, ...change })).toEqual({
      kind: "failed",
      reason: expect.stringContaining(reason),
    });
    expect(fake.calls).toEqual([]);
  });
});

describe("vm box: run", () => {
  it("runs as the box user in /work under timeout, the value in docker's environment only", async () => {
    const fake = fakeDocker();
    const vm = box(fake);
    const started = await vm.start(SPEC);
    if (started.kind !== "started") throw new Error("start failed");
    await vm.run({
      session: started.session,
      command: { argv: ["claude", "-p"], stdin: { kind: "text", text: "the task" }, timeoutSeconds: 900 },
    });
    const last = fake.calls.at(-1);
    expect(last?.args.join(" ")).toBe(
      "exec --interactive --user box --workdir /work --env HOME=/home/box --env CLAUDE_CODE_OAUTH_TOKEN factory-box-1 timeout --kill-after=10 900 claude -p",
    );
    expect(last?.stdin).toBe("the task");
    expect(last?.env).toEqual({ PATH: "/usr/bin", CLAUDE_CODE_OAUTH_TOKEN: TOKEN });
  });

  it("reads a `timeout` exit as a timeout only when the time ran out", async () => {
    const TIMED_OUT: Exit = { code: 124, stdout: "", stderr: "" };
    const clock = [0, 31_000, 0, 2_000];
    const vm = box(fakeDocker({}, TIMED_OUT), () => clock.shift() ?? 0);
    const started = await vm.start(SPEC);
    if (started.kind !== "started") throw new Error("start failed");
    expect(await vm.run({ session: started.session, command: TRUE })).toEqual({ kind: "timedOut", seconds: 30 });
    expect(await vm.run({ session: started.session, command: TRUE })).toEqual({ kind: "exited", ...TIMED_OUT });
  });

  it("reads a box that docker no longer has as failed, not as the command's exit", () => {
    const exit = { code: 1, stdout: "", stderr: "Error response from daemon: No such container: factory-box-1" };
    expect(readRan({ exit, timeoutSeconds: 30, elapsedSeconds: 0 }).kind).toBe("failed");
  });
});

describe("vm box: copy and stop", () => {
  it("copies into and out of /work only", async () => {
    const fake = fakeDocker();
    const vm = box(fake);
    const started = await vm.start(SPEC);
    if (started.kind !== "started") throw new Error("start failed");
    const session = started.session;
    expect(await vm.copyIn({ session, host: "/h/report.json", box: ".factory/task.md" })).toEqual({ kind: "ok" });
    expect(await vm.copyOut({ session, host: "/h/out", box: "report.json" })).toEqual({ kind: "ok" });
    expect(argv(fake.calls).slice(-2)).toEqual([
      "cp --archive /h/report.json factory-box-1:/work/.factory/task.md",
      "cp factory-box-1:/work/report.json /h/out",
    ]);
    expect((await vm.copyOut({ session, host: "/h/x", box: "../../etc/shadow" })).kind).toBe("failed");
  });

  it("leaves alone a box it did not start", async () => {
    const fake = fakeDocker();
    const stranger = { id: "someone-else", place: "vm" } as const;
    expect(await box(fake).stop(stranger)).toEqual({ kind: "ok" });
    expect((await box(fake).run({ session: stranger, command: TRUE })).kind).toBe("failed");
    expect(fake.calls).toEqual([]);
  });
});

describe("checkSpec", () => {
  it("accepts the spec a run builds", () => {
    expect(checkSpec(SPEC)).toEqual({ kind: "ok" });
  });
});
