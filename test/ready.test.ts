import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Box, PinnedImage, Ran } from "../src/core/box/types.js";
import type { Started as EgressStarted } from "../src/core/egress/start.js";
import type { RunInput } from "../src/core/dispatch/tick.js";
import type { CommitStatus, Forge } from "../src/core/forge/types.js";
import type { ProjectFile } from "../src/core/project.js";
import type { Evidence } from "../src/core/report.js";
import { boxPlan } from "../src/core/ready/plan.js";
import { MAX_LOG_CHARS, MAX_LOG_LINES, recordsDirOf, readKept, tailOf } from "../src/core/kept.js";
import { TEST_FILES } from "../src/core/ready/floor.js";
import {
  READY_FILE,
  readyStep,
  verifyStep,
  VERIFY_CONTEXT,
  VERIFY_FILE,
  type BoxPlan,
} from "../src/core/ready/steps.js";
import { fakeBox, type FakeBox } from "./fake-box.js";
import { project, type Project } from "./review-repo.js";

let p: Project;
let head = "";
beforeEach(() => {
  p = project("feat/x");
  // a branch whose own Makefile would write outside the folder if anything ran it on the host
  p.git("checkout", "-q", "feat/x");
  p.write("Makefile", `test:\n\ttouch ${join(p.root, "planted")}\n`);
  head = p.commitAll("planted target");
  p.git("push", "-q", "origin", "feat/x");
  p.git("checkout", "-q", "main");
});
afterEach(() => rmSync(p.root, { recursive: true, force: true }));
beforeEach(() => {
  egressStarts = 0;
});

const exited = (code: number): Ran => ({ kind: "exited", code, stdout: "", stderr: "" });

const PROJECT: ProjectFile = {
  gate: { kind: "local", verify: ["make", "verify"] },
  ready: { programs: ["make", "./gradlew"], timeoutSeconds: 60, testFiles: TEST_FILES },
  egress: { allow: ["repo.maven.apache.org"] },
};

const EGRESS: EgressStarted = {
  kind: "started",
  proxy: { host: "factory-egress-ledger", port: 3128 },
  network: "factory-int-ledger",
};

// how many times a box run started the project's egress proxy
let egressStarts = 0;

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

function plan(box: Box, file: ProjectFile = PROJECT, egress: EgressStarted = EGRESS): BoxPlan {
  return {
    kind: "ready",
    project: file,
    setup: {
      box,
      image: { kind: "pinned", ref: `factory/box@sha256:${"0".repeat(64)}` },
      egress: async () => {
        egressStarts += 1;
        return egress;
      },
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
  const step = readyStep(plan(box), statusForge([]));
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
      proxy: "http://factory-egress-ledger:3128",
      network: "factory-int-ledger",
    });
    const env = start?.op === "start" ? start.spec.env : {};
    expect(Object.keys(env)).not.toContain("GITHUB_TOKEN");
    expect(Object.keys(env)).not.toContain("PATH");
    expect(env.HTTPS_PROXY).toBe("http://factory-egress-ledger:3128");
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
    defaultBranch: async () => ({ kind: "ok", value: "main" }),
    branchExists: async () => ({ kind: "ok", value: false }),
    openChange: notUsed,
    addLabel: notUsed,
    removeLabel: notUsed,
    note: notUsed,
    notes: notUsed,
    lineFinding: notUsed,
    ciConfig: notUsed,
    claimed: notUsed,
    changes: notUsed,
    failedJobs: notUsed,
    status: async (s) => (posted.push(s), { kind: "ok" }),
  };
}

describe("the ready check's kept output (#199)", () => {
  const keptAt = (at = head) => readKept({ recordsDir: recordsDirOf(p.clone), change: 12, head: at }, READY_FILE);

  it("keeps the failed row's line and its stdout and stderr tails with the head; a pass keeps nothing", async () => {
    expect(await ready(fakeBox({ runs: [exited(0)] }).box, [row("make a")])).toMatchObject({ value: { passed: true } });
    expect(existsSync(join(recordsDirOf(p.clone), "12", head))).toBe(false);
    const ran: Ran = {
      kind: "exited",
      code: 1,
      stdout: "> Task :test\nOrderTest > total FAILED\n```\n",
      stderr: "\u001b[31mBUILD FAILED\u001b[0m\n",
    };
    const out = await ready(fakeBox({ runs: [exited(0), ran] }).box, [row("make a"), row("make b", "AC2")]);
    expect(out).toEqual({ kind: "ok", value: { passed: false, why: "row 2 (AC2): make b exited 1" } });
    expect(await keptAt()).toEqual({
      kind: "ok",
      value: [
        "# The ready check failed",
        "",
        "The host checked your head, and ran your evidence rows again there in a fresh box. It failed:",
        "",
        "row 2 (AC2): make b exited 1",
        "",
        "stdout, its last lines:",
        "",
        "```text",
        "> Task :test\nOrderTest > total FAILED\n` ` `",
        "```",
        "",
        "stderr, its last lines:",
        "",
        "```text",
        "BUILD FAILED",
        "```",
        "",
      ].join("\n"),
    });
  });

  it("keeps why a check failed with no row output: a row that cannot run, or no rows", async () => {
    await ready(fakeBox({}).box, [row("bash -c 'make test'")]);
    expect(await keptAt()).toMatchObject({ kind: "ok", value: expect.stringContaining("row 1 (AC1): ") });
    await ready(fakeBox({}).box, []);
    const kept = await keptAt();
    expect(kept).toMatchObject({ kind: "ok", value: expect.stringContaining("no evidence rows") });
    expect(kept.kind === "ok" ? kept.value : "").not.toContain("last lines");
  });

  it("records nothing when it cannot keep the output: the step fails, so a person looks", async () => {
    mkdirSync(join(p.clone, ".claude"), { recursive: true });
    writeFileSync(recordsDirOf(p.clone), "not a folder");
    const out = await ready(fakeBox({ runs: [exited(2)] }).box, [row("make test")]);
    expect(out).toMatchObject({ kind: "failed", reason: expect.stringContaining("cannot keep") });
  });

  it("bounds a tail by lines and by characters, however long its lines", () => {
    const many = Array.from({ length: MAX_LOG_LINES + 50 }, (_, i) => `line ${i}`).join("\n");
    expect(tailOf(many).split("\n")).toHaveLength(MAX_LOG_LINES);
    const wide = `${"a".repeat(MAX_LOG_CHARS)}\n${"b".repeat(MAX_LOG_CHARS)}`;
    expect(tailOf(wide)).toBe("b".repeat(MAX_LOG_CHARS));
  });
});

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

  it("keeps a failed run's output with the head before it posts, for the writer's CI run (#171)", async () => {
    const posted: CommitStatus[] = [];
    const ran: Ran = {
      kind: "exited",
      code: 2,
      stdout: "> Task :test\nRenewalTest > refuses a reserved loan FAILED\n",
      stderr: "\u001b[31mBUILD FAILED\u001b[0m\n",
    };
    const step = verifyStep(plan(fakeBox({ runs: [ran] }).box), statusForge(posted));
    if (step.kind !== "available") throw new Error(step.reason);
    expect(await step.run(input([]))).toEqual({ kind: "ok", value: { passed: false } });
    const kept = await readKept({ recordsDir: recordsDirOf(p.clone), change: 12, head }, VERIFY_FILE);
    expect(kept).toEqual({
      kind: "ok",
      value: [
        "# The local verifier failed",
        "",
        "`make verify exited 2` at your head, in a fresh box.",
        "",
        "stdout, its last lines:",
        "",
        "```text",
        "> Task :test\nRenewalTest > refuses a reserved loan FAILED",
        "```",
        "",
        "stderr, its last lines:",
        "",
        "```text",
        "BUILD FAILED",
        "```",
        "",
      ].join("\n"),
    });
    const passing = verifyStep(plan(fakeBox({ runs: [exited(0)] }).box), statusForge([]));
    if (passing.kind !== "available") throw new Error(passing.reason);
    await passing.run(input([], "f".repeat(40)));
    expect(existsSync(join(recordsDirOf(p.clone), "12", "f".repeat(40)))).toBe(false);
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

describe("the floor guard in the ready check (#190)", () => {
  it("fails the check before any box runs when the diff adds a skip, with its file:line", async () => {
    p.git("checkout", "-q", "feat/x");
    p.write("src/test/OrderTest.java", "class OrderTest {\n  @Disabled\n  void total() {}\n}\n");
    const skipped = p.commitAll("skip the failing test");
    p.git("push", "-q", "origin", "feat/x");
    p.git("checkout", "-q", "main");
    const fake = fakeBox({ runs: [exited(0)] });
    const out = await ready(fake.box, [row("make test")], skipped);
    expect(out).toMatchObject({
      kind: "ok",
      value: { passed: false, why: expect.stringContaining("src/test/OrderTest.java:2 adds a skip marker") },
    });
    expect(fake.calls).toEqual([]);
    const kept = await readKept({ recordsDir: recordsDirOf(p.clone), change: 12, head: skipped }, READY_FILE);
    expect(kept).toMatchObject({ kind: "ok", value: expect.stringContaining("src/test/OrderTest.java:2") });
  });

  it("fails the step, never passes, when the guard cannot read the diff", async () => {
    const fake = fakeBox({ runs: [exited(0)] });
    const out = await ready(fake.box, [row("make test")], "0".repeat(40));
    expect(out).toMatchObject({ kind: "failed", reason: expect.stringContaining("the head moved") });
    expect(fake.calls).toEqual([]);
  });
});

describe("the box run's egress", () => {
  it("starts the project's proxy before the box, once per run, and puts the box on the project's network", async () => {
    const fake = fakeBox({ runs: [exited(0)] });
    await ready(fake.box, [row("make test")]);
    expect(egressStarts).toBe(1);
    expect(fake.calls.map((c) => c.op)).toEqual(["start", "run", "stop"]);
  });

  it("starts no box when the proxy does not start, and fails the run rather than give a verdict", async () => {
    const fake = fakeBox({ runs: [exited(0)] });
    const step = readyStep(
      plan(fake.box, PROJECT, { kind: "failed", reason: "docker create: no such image" }),
      statusForge([]),
    );
    const out = step.kind === "available" ? await step.run(input([row("make test")])) : step;
    expect(out).toEqual({
      kind: "failed",
      reason: "the egress proxy did not start: docker create: no such image",
    });
    expect(fake.calls.filter((c) => c.op === "start")).toEqual([]);
  });
});

describe("boxPlan", () => {
  const ID = `sha256:${"1".repeat(64)}`;
  const opens: string[] = [];
  const openEgress = async (o: { readonly project: string }): Promise<EgressStarted> => {
    opens.push(o.project);
    return EGRESS;
  };
  let home = "";
  let images: PinnedImage[] = [];
  const write = (name: string, value: unknown): void => {
    mkdirSync(join(home, "projects", "ledger"), { recursive: true });
    writeFileSync(join(home, "projects", name), JSON.stringify(value));
  };
  const LOCAL = { gate: "local", verify: ["make", "verify"], ready: { programs: ["make"] } };
  const env = { FACTORY_BOX: "vm", FACTORY_REPO: "" };
  const planFor = (boxes: readonly Box[], more: NodeJS.ProcessEnv = {}) =>
    boxPlan({
      env: { ...env, FACTORY_REPO: p.clone, ...more },
      home,
      project: "ledger",
      boxesFor: (image) => {
        images.push(image);
        return boxes;
      },
      openEgress,
    });
  const reason = (text: string) => ({
    value: { plan: { kind: "unavailable", reason: expect.stringContaining(text) } },
  });

  beforeEach(() => {
    home = join(p.root, "home-f");
    images = [];
    opens.length = 0;
  });

  it("reads the gate from the project file, and is unavailable with no file", async () => {
    expect(await planFor([])).toMatchObject({
      kind: "ok",
      value: { gate: "forge-ci", plan: { kind: "unavailable", reason: expect.stringContaining("no project file") } },
    });
  });

  it("is unavailable with no egress list, no box image, no box, or an unpinned egress image", async () => {
    const box = fakeBox({}).box;
    write("ledger.json", LOCAL);
    expect(await planFor([box])).toMatchObject({ value: { gate: "local", ...reason('no "egress.allow"').value } });
    write("ledger.json", { ...LOCAL, egress: { allow: ["repo.maven.apache.org"] } });
    expect(await planFor([box])).toMatchObject(reason("run agent-factory box build ledger"));
    write("ledger/box.json", { image: ID });
    expect(await planFor([])).toMatchObject(reason("not built yet (#113)"));
    expect(await planFor([box], { FACTORY_EGRESS_IMAGE: "ubuntu/squid:latest" })).toMatchObject(
      reason("FACTORY_EGRESS_IMAGE"),
    );
    expect(await planFor([box], { FACTORY_UPSTREAM_PROXY: "http://proxy" })).toMatchObject(
      reason("FACTORY_UPSTREAM_PROXY"),
    );
    write("ledger/box.json", { image: "factory-box:latest" });
    expect(await planFor([box])).toMatchObject(reason("is not pinned"));
  });

  it("opens the box for the image box build recorded, and starts no proxy until a box runs", async () => {
    const box = fakeBox({}).box;
    write("ledger.json", { ...LOCAL, egress: { allow: ["repo.maven.apache.org"] } });
    write("ledger/box.json", { image: ID });
    const ok = await planFor([box], { FACTORY_UPSTREAM_PROXY: "proxy.corp.example:8080" });
    expect(ok).toMatchObject({
      value: { gate: "local", plan: { kind: "ready", setup: { image: { ref: ID }, runsDir: join(home, "box-runs") } } },
    });
    expect(images).toEqual([{ kind: "pinned", ref: ID }]);
    expect(opens).toEqual([]);
    if (ok.kind !== "ok" || ok.value.plan.kind !== "ready") throw new Error("no plan");
    await ok.value.plan.setup.egress();
    expect(opens).toEqual(["ledger"]);
  });

  it("stops the pass on a project file that is there but refused, so a local project never reads as forge CI", async () => {
    write("ledger.json", { gate: "locl", ready: { programs: ["make"] } });
    expect(await planFor([fakeBox({}).box])).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining('"gate" must be'),
    });
  });
});
