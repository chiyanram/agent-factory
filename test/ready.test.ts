import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Box, Ran } from "../src/core/box/types.js";
import type { RunInput } from "../src/core/dispatch/tick.js";
import type { CommitStatus, Forge } from "../src/core/forge/types.js";
import type { ProjectFile } from "../src/core/project.js";
import type { Evidence } from "../src/core/report.js";
import { boxPlan } from "../src/core/ready/plan.js";
import { readyStep, verifyStep, VERIFY_CONTEXT, type BoxPlan } from "../src/core/ready/steps.js";
import { fakeBox, type FakeBox } from "./fake-box.js";
import { project, type Project } from "./review-repo.js";

let p: Project;
let head = "";
beforeEach(() => {
  p = project();
  // a branch whose own Makefile would write outside the folder if anything ran it on the host
  p.git("checkout", "-q", "feat/x");
  p.write("Makefile", `test:\n\ttouch ${join(p.root, "planted")}\n`);
  head = p.commitAll("planted target");
  p.git("push", "-q", "origin", "feat/x");
  p.git("checkout", "-q", "main");
});
afterEach(() => rmSync(p.root, { recursive: true, force: true }));

const exited = (code: number): Ran => ({ kind: "exited", code, stdout: "", stderr: "" });

const PROJECT: ProjectFile = {
  gate: { kind: "local", verify: ["make", "verify"] },
  ready: { programs: ["make", "./gradlew"], timeoutSeconds: 60 },
};

// the box sees the worktree only while it runs: record what is in it at each run
function watched(fake: FakeBox, seen: string[][]): Box {
  return {
    ...fake.box,
    run: async (call) => {
      const start = fake.calls.findLast((c) => c.op === "start");
      seen.push(start?.op === "start" ? readdirSync(start.spec.worktree).toSorted() : []);
      return fake.box.run(call);
    },
  };
}

function plan(box: Box, file: ProjectFile = PROJECT): BoxPlan {
  return {
    kind: "ready",
    project: file,
    setup: {
      box,
      image: { kind: "pinned", ref: `factory/box@sha256:${"0".repeat(64)}` },
      proxy: { host: "factory-egress", port: 3128 },
      repo: p.clone,
      env: { ...p.env, GITHUB_TOKEN: "host-only" },
      runsDir: join(p.root, "box-runs"),
    },
  };
}

function input(evidence: readonly Evidence[], at = head): RunInput & { readonly evidence: readonly Evidence[] } {
  return {
    ticket: "PROJ-12",
    head: at,
    evidence,
    change: {
      kind: "open",
      line: {
        kind: "open",
        number: 12,
        branch: "feat/x",
        fork: false,
        lastNoteAt: "",
        head: at,
        draft: false,
        claimed: true,
        pipeline: { kind: "none" },
        needsHuman: false,
        stop: { kind: "none" },
        asks: 0,
      },
    },
  };
}

const row = (command: string, criterion = "AC1"): Evidence => ({ criterion, command, result: "ok" });

async function ready(box: Box, evidence: readonly Evidence[], at = head) {
  const step = readyStep(plan(box));
  return step.kind === "available" ? step.run(input(evidence, at)) : step;
}

describe("the ready check (#91, #138)", () => {
  it("runs each evidence row in a fresh box at the head, never on the host, and passes when all exit 0", async () => {
    const fake = fakeBox({ runs: [exited(0), exited(0)] });
    const seen: string[][] = [];
    const out = await ready(watched(fake, seen), [row("make test"), row("./gradlew check --tests 'A*'", "AC2")]);
    expect(out).toEqual({ kind: "ok", value: { passed: true, why: "" } });
    expect(existsSync(join(p.root, "planted"))).toBe(false);
    const runs = fake.calls.flatMap((c) => (c.op === "run" ? [c.command] : []));
    expect(runs.map((c) => c.argv)).toEqual([
      ["make", "test"],
      ["./gradlew", "check", "--tests", "A*"],
    ]);
    expect(runs.every((c) => c.timeoutSeconds === 60 && c.stdin.kind === "none")).toBe(true);
    // the box held the tree at the head, and nothing of the host's environment
    expect(seen[0]).toContain("Makefile");
    const start = fake.calls.find((c) => c.op === "start");
    expect(start?.op === "start" ? start.spec : undefined).toMatchObject({
      image: { kind: "pinned" },
      proxy: "http://factory-egress:3128",
    });
    const env = start?.op === "start" ? start.spec.env : {};
    expect(Object.keys(env)).not.toContain("GITHUB_TOKEN");
    expect(Object.keys(env)).not.toContain("PATH");
    expect(env.HTTPS_PROXY).toBe("http://factory-egress:3128");
    // the box is stopped and the copy is gone
    expect(fake.live.size).toBe(0);
    expect(readdirSync(join(p.root, "box-runs"))).toEqual([]);
  });

  it("fails at the first row that fails or runs out of time, naming it, and runs no row after it", async () => {
    const fake = fakeBox({ runs: [exited(0), exited(2), exited(0)] });
    expect(await ready(fake.box, [row("make a"), row("make b", "AC2"), row("make c", "AC3")])).toEqual({
      kind: "ok",
      value: { passed: false, why: "row 2 (AC2): make b exited 2" },
    });
    expect(fake.calls.filter((c) => c.op === "run")).toHaveLength(2);
    const slow = fakeBox({ runs: [{ kind: "timedOut", seconds: 60 }] });
    expect(await ready(slow.box, [row("make a")])).toEqual({
      kind: "ok",
      value: { passed: false, why: "row 1 (AC1): make a ran out of time (60s)" },
    });
  });

  it("fails a row that needs a shell or a program not on the list, before any box starts", async () => {
    for (const command of ["make test && curl x", "bash -c 'make test'"]) {
      const fake = fakeBox({});
      const out = await ready(fake.box, [row("make ok"), row(command, "AC2")]);
      expect(out).toMatchObject({ kind: "ok", value: { passed: false, why: expect.stringContaining("row 2 (AC2)") } });
      expect(fake.calls.filter((c) => c.op === "start")).toEqual([]);
    }
    const none = fakeBox({});
    expect(await ready(none.box, [])).toEqual({
      kind: "ok",
      value: { passed: false, why: "the writer gave no evidence rows to run again" },
    });
  });

  it("a box that will not stop fails the run, so it is seen", async () => {
    const fake = fakeBox({ runs: [exited(0)] });
    const stuck: Box = { ...fake.box, stop: async () => ({ kind: "failed", reason: "container still running" }) };
    expect(await ready(stuck, [row("make test")])).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("did not stop: container still running"),
    });
  });

  it("gives no verdict when the head moved or the box fails: the run fails, so a person looks", async () => {
    const fake = fakeBox({ runs: [exited(0)] });
    expect(await ready(fake.box, [row("make test")], p.head1)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("the head moved"),
    });
    expect(fake.calls.filter((c) => c.op === "start")).toEqual([]);
    const broken = fakeBox({ runs: [{ kind: "failed", reason: "docker is gone" }] });
    expect(await ready(broken.box, [row("make test")])).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("docker is gone"),
    });
    expect(broken.live.size).toBe(0);
    const noStart: Box = { ...fakeBox({}).box, start: async () => ({ kind: "failed", reason: "no image" }) };
    expect(await ready(noStart, [row("make test")])).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("the box did not start: no image"),
    });
  });
});

function statusForge(posted: CommitStatus[]): Forge {
  const notUsed = async () => ({ kind: "failed" as const, reason: "not used" });
  return {
    name: "github",
    mark: "#",
    me: notUsed,
    change: notUsed,
    defaultBranch: notUsed,
    addLabel: notUsed,
    removeLabel: notUsed,
    note: notUsed,
    notes: notUsed,
    lineFinding: notUsed,
    claimed: notUsed,
    changes: notUsed,
    status: async (s) => (posted.push(s), { kind: "ok" }),
  };
}

describe("the local verifier (#91)", () => {
  it("runs the project file's verify command in a box and posts pending, then its result, at the head", async () => {
    const posted: CommitStatus[] = [];
    const fake = fakeBox({ runs: [exited(0)] });
    const step = verifyStep(plan(fake.box), statusForge(posted));
    expect(step.kind === "available" ? await step.run(input([])) : step).toEqual({
      kind: "ok",
      value: { passed: true },
    });
    expect(posted.map((s) => [s.state, s.context, s.sha, s.ref])).toEqual([
      ["pending", VERIFY_CONTEXT, head, "feat/x"],
      ["success", VERIFY_CONTEXT, head, "feat/x"],
    ]);
    expect(fake.calls.flatMap((c) => (c.op === "run" ? [c.command.argv] : []))).toEqual([["make", "verify"]]);
    expect(existsSync(join(p.root, "planted"))).toBe(false);
  });

  it("posts failed with how it ended; a box that cannot run fails the run and leaves the status pending", async () => {
    const posted: CommitStatus[] = [];
    const red = verifyStep(plan(fakeBox({ runs: [exited(1)] }).box), statusForge(posted));
    expect(red.kind === "available" ? await red.run(input([])) : red).toEqual({ kind: "ok", value: { passed: false } });
    expect(posted.at(-1)).toMatchObject({ state: "failed", description: "make verify exited 1" });
    const broken = verifyStep(
      plan(fakeBox({ runs: [{ kind: "failed", reason: "docker is gone" }] }).box),
      statusForge(posted),
    );
    expect(broken.kind === "available" ? await broken.run(input([])) : broken).toMatchObject({ kind: "failed" });
    expect(posted.at(-1)).toMatchObject({ state: "pending", description: expect.stringContaining("could not run") });
  });

  it("is unavailable when the project's gate is forge CI, or when there is no box", () => {
    const forgeCi = verifyStep(plan(fakeBox({}).box, { ...PROJECT, gate: { kind: "forge-ci" } }), statusForge([]));
    expect(forgeCi).toEqual({ kind: "unavailable", reason: "the project's gate is forge-ci" });
    expect(verifyStep({ kind: "unavailable", reason: "no box" }, statusForge([]))).toEqual({
      kind: "unavailable",
      reason: "no box",
    });
  });
});

describe("boxPlan", () => {
  it("reads the gate from the project file, and leaves both steps unavailable with no box, no pin or no file", async () => {
    const home = join(p.root, "home-f");
    const none = await boxPlan({ env: {}, home, project: "ledger", boxes: [] });
    expect(none).toMatchObject({
      kind: "ok",
      value: { gate: "forge-ci", plan: { kind: "unavailable", reason: expect.stringContaining("no project file") } },
    });
    mkdirSync(join(home, "projects"), { recursive: true });
    writeFileSync(
      join(home, "projects", "ledger.json"),
      JSON.stringify({ gate: "local", verify: ["make", "verify"], ready: { programs: ["make"] } }),
    );
    const env = { FACTORY_BOX: "vm", FACTORY_REPO: p.clone, FACTORY_BOX_IMAGE: `b@sha256:${"1".repeat(64)}` };
    expect(await boxPlan({ env, home, project: "ledger", boxes: [] })).toMatchObject({
      value: { gate: "local", plan: { kind: "unavailable", reason: expect.stringContaining("not built yet (#113)") } },
    });
    const box = fakeBox({}).box;
    expect(
      await boxPlan({ env: { ...env, FACTORY_BOX_IMAGE: "b:latest" }, home, project: "ledger", boxes: [box] }),
    ).toMatchObject({
      value: { plan: { kind: "unavailable", reason: expect.stringContaining("not pinned") } },
    });
    const ok = await boxPlan({ env, home, project: "ledger", boxes: [box] });
    expect(ok).toMatchObject({
      value: { gate: "local", plan: { kind: "ready", setup: { runsDir: join(home, "box-runs") } } },
    });
    // a file that is there but refused stops the pass: read as forge CI, the project would lose its local gate
    writeFileSync(
      join(home, "projects", "ledger.json"),
      JSON.stringify({ gate: "locl", ready: { programs: ["make"] } }),
    );
    expect(await boxPlan({ env, home, project: "ledger", boxes: [box] })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining('"gate" must be'),
    });
  });
});
