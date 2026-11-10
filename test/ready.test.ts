import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { Box, PinnedImage, Ran } from "../src/core/box/types.js";
import type { Started as EgressStarted } from "../src/core/egress/start.js";
import type { SrtEgress } from "../src/core/box/srt-plan.js";
import type { ReadyFacts, RunInput } from "../src/core/dispatch/tick.js";
import type { CommitStatus, Forge } from "../src/core/forge/types.js";
import type { ProjectFile } from "../src/core/project.js";
import type { Evidence } from "../src/core/report.js";
import { boxPlan } from "../src/core/ready/plan.js";
import { MAX_LOG_CHARS, MAX_LOG_LINES, recordsDirOf, readKept, tailOf } from "../src/core/kept.js";
import { TEST_FILES } from "../src/core/ready/floor.js";
import { capped, MAX_TASK_CHARS } from "../src/core/writer/task.js";
import {
  READY_FILE,
  readyOutput,
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
  // a branch whose Makefile would write outside the folder if anything ran it on the host. The Makefile comes from
  // main, so the change itself touches no judge file (#231)
  p.write("Makefile", `test:\n\ttouch ${join(p.root, "planted")}\n`);
  p.commitAll("planted target");
  p.git("push", "-q", "origin", "main");
  p.git("checkout", "-q", "feat/x");
  p.git("merge", "-q", "--no-edit", "main");
  p.write("svc/Extra.java", "class Extra {}\n");
  head = p.commitAll("a change");
  p.git("push", "-q", "origin", "feat/x");
  p.git("checkout", "-q", "main");
});
afterEach(() => rmSync(p.root, { recursive: true, force: true }));
beforeEach(() => {
  egressStarts = 0;
});

const NO_WAIVER = async () => ({ kind: "ok", value: "none" }) as const;

const exited = (code: number): Ran => ({ kind: "exited", code, stdout: "", stderr: "" });

const PROJECT: ProjectFile = {
  gate: { kind: "local", verify: ["make", "verify"] },
  ready: { programs: ["make", "./gradlew"], timeoutSeconds: 60, testFiles: TEST_FILES, judgeFiles: [] },
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

function input(
  evidence: readonly Evidence[],
  at = head,
  facts: ReadyFacts = { criteria: [], oneWayDoor: [] },
): RunInput & { readonly evidence: readonly Evidence[] } & ReadyFacts {
  return {
    ticket: "PROJ-12",
    head: at,
    evidence,
    ...facts,
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
        mergeable: "clean",
      },
    },
  };
}

const row = (command: string, criterion = "AC1"): Evidence => ({ criterion, command, result: "ok" });

async function ready(box: Box, evidence: readonly Evidence[], at = head) {
  const step = readyStep(plan(box), statusForge([]), NO_WAIVER);
  return step.kind === "available" ? step.run(input(evidence, at)) : step;
}

describe("the ready check (#91, #138)", () => {
  it("runs each evidence row in a fresh box at the head, never on the host, and passes when all exit 0", async () => {
    const fake = fakeBox({ runs: [exited(0), exited(0)] });
    const seen: string[][] = [];
    const out = await ready(watched(fake, seen), [row("make test"), row("./gradlew check --tests 'A*'", "AC2")]);
    // the branch changes svc/Main.java: a code change, so the diff needs the bug lane (#230)
    expect(out).toEqual({ kind: "ok", value: { passed: true, why: "", human: false, lane: "bug" } });
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
      value: { passed: false, why: "row 2 (AC2): make b exited 2", human: false, lane: "bug" },
    });
    expect(fake.calls.filter((c) => c.op === "run")).toHaveLength(2);
    const slow = fakeBox({ runs: [{ kind: "timedOut", seconds: 60 }] });
    expect(await ready(slow.box, [row("make a")])).toEqual({
      kind: "ok",
      value: { passed: false, why: "row 1 (AC1): make a ran out of time (60s)", human: false, lane: "bug" },
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
      value: { passed: false, why: "the writer gave no evidence rows to run again", human: false },
    });
  });

  it("fails when an acceptance criterion has no evidence row, before any box starts (#230)", async () => {
    const fake = fakeBox({});
    const step = readyStep(plan(fake.box), statusForge([]), NO_WAIVER);
    const facts = { criteria: ["one", "two", "three"], oneWayDoor: [] };
    const out =
      step.kind === "available"
        ? await step.run(input([row("make a", "AC-1"), row("make b", "AC-2")], head, facts))
        : step;
    expect(out).toEqual({
      kind: "ok",
      value: {
        passed: false,
        why: "no evidence row for AC-3: give each acceptance criterion a row whose criterion starts with its id",
        human: false,
        lane: "bug",
      },
    });
    expect(fake.calls).toEqual([]);
  });

  it("reads the one-way door from a diff that touches one of the project's one-way-door paths (#230)", async () => {
    const fake = fakeBox({ runs: [exited(0)] });
    const step = readyStep(plan(fake.box), statusForge([]), NO_WAIVER);
    const facts = { criteria: ["one"], oneWayDoor: ["svc/**"] };
    const out = step.kind === "available" ? await step.run(input([row("make a", "AC-1")], head, facts)) : step;
    expect(out).toEqual({ kind: "ok", value: { passed: true, why: "", human: false, lane: "one-way door" } });
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
    issueBody: notUsed,
    openChange: notUsed,
    addLabel: notUsed,
    removeLabel: notUsed,
    note: notUsed,
    setBody: notUsed,
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
    expect(out).toEqual({
      kind: "ok",
      value: { passed: false, why: "row 2 (AC2): make b exited 1", human: false, lane: "bug" },
    });
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

  it("fits the writer's task cap when both streams are long, keeping the last line of each and saying what it cut", async () => {
    const long = (name: string) =>
      `${Array.from({ length: 150 }, (_, i) => `${name} ${i} ${"z".repeat(120)}`).join("\n")}\n${name}: the last line\n`;
    const ran: Ran = { kind: "exited", code: 1, stdout: long("out"), stderr: long("err") };
    const why = `row 1 (${"a criterion ".repeat(400)}): make test exited 1`;
    const kept = readyOutput(why, { argv: ["make", "test"], ran });
    expect(kept.length).toBeLessThanOrEqual(MAX_TASK_CHARS);
    expect(capped(kept)).toBe(kept);
    expect(kept).toContain("out: the last line\n```");
    expect(kept).toContain("err: the last line\n```");
    expect(kept).toContain("make test exited 1");
    expect(kept.match(/\(…\d+ earlier characters cut\)/g)).toHaveLength(3);
    const out = await ready(fakeBox({ runs: [ran] }).box, [row("make test")]);
    expect(out).toMatchObject({ value: { passed: false } });
    const read = await keptAt();
    expect(read.kind === "ok" ? read.value.length : Infinity).toBeLessThanOrEqual(MAX_TASK_CHARS);
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

describe("the test checks in the ready check (#231)", () => {
  // a change on feat/x that touches one file, pushed; its head
  function changed(path: string, text: string): string {
    p.git("checkout", "-q", "feat/x");
    p.write(path, text);
    const at = p.commitAll(`touch ${path}`);
    p.git("push", "-q", "origin", "feat/x");
    p.git("checkout", "-q", "main");
    return at;
  }

  async function readyWith(waived: string, at: string) {
    const fake = fakeBox({ runs: [exited(0)] });
    const step = readyStep(plan(fake.box), statusForge([]), async (ticket) => {
      expect(ticket).toBe("PROJ-12");
      return { kind: "ok", value: waived };
    });
    const out = step.kind === "available" ? await step.run(input([row("make test")], at)) : step;
    return { out, calls: fake.calls };
  }

  it("stops a planted build-file edit for a person, the hit listed, and runs no box", async () => {
    const at = changed("build.gradle", "plugins { id 'java' }\n");
    const { out, calls } = await readyWith("none", at);
    expect(out).toMatchObject({
      kind: "ok",
      value: { passed: false, human: true, why: expect.stringContaining("build.gradle adds a judge file") },
    });
    expect(calls).toEqual([]);
  });

  it("stops a planted test-config edit, and the verify command's own Makefile", async () => {
    const config = changed("vitest.config.ts", "export default {};\n");
    expect((await readyWith("none", config)).out).toMatchObject({
      value: { human: true, why: expect.stringContaining("vitest.config.ts adds a judge file") },
    });
    const make = changed("Makefile", "test:\n\ttrue\n");
    expect((await readyWith("none", make)).out).toMatchObject({
      value: { human: true, why: expect.stringContaining("Makefile changes a judge file") },
    });
  });

  it("passes at the waiver's head; a new head that changes the same file is stopped again", async () => {
    const first = changed("build.gradle", "plugins { id 'java' }\n");
    expect((await readyWith(first, first)).out).toEqual({
      kind: "ok",
      value: { passed: true, why: "", human: false, lane: "bug" },
    });
    const second = changed("build.gradle", "plugins { id 'groovy' }\n");
    expect((await readyWith(first, second)).out).toMatchObject({
      value: { passed: false, human: true, why: expect.stringContaining("build.gradle") },
    });
  });

  it("fails the step when the waiver cannot be read, so a person looks", async () => {
    const step = readyStep(plan(fakeBox({}).box), statusForge([]), async () => ({
      kind: "failed",
      reason: "waivers/ledger/PROJ-12.json is not a waiver record",
    }));
    const out = step.kind === "available" ? await step.run(input([row("make test")])) : step;
    expect(out).toMatchObject({ kind: "failed", reason: expect.stringContaining("not a waiver record") });
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
      NO_WAIVER,
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
  const gitHosts: (readonly string[])[] = [];
  const openEgress = async (o: {
    readonly project: string;
    readonly gitHosts: readonly string[];
  }): Promise<EgressStarted> => {
    opens.push(o.project);
    gitHosts.push(o.gitHosts);
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
  const srtEgresses: SrtEgress[] = [];
  let srtRunner: Box = fakeBox({ place: "srt" }).box;
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
      srtFor: (egress) => {
        srtEgresses.push(egress);
        return Promise.resolve(srtRunner);
      },
    });
  const reason = (text: string) => ({
    value: { plan: { kind: "unavailable", reason: expect.stringContaining(text) } },
  });

  beforeEach(() => {
    home = join(p.root, "home-f");
    images = [];
    opens.length = 0;
    gitHosts.length = 0;
    srtEgresses.length = 0;
    srtRunner = fakeBox({ place: "srt" }).box;
  });

  it("opens the srt runner with no image and no Squid: it keeps its own proxy, from the checked allowlist (#114)", async () => {
    write("ledger.json", { ...LOCAL, egress: { allow: ["repo.maven.apache.org", ".npmjs.org"] } });
    const ok = await planFor([], {
      FACTORY_BOX: "srt",
      FACTORY_UPSTREAM_PROXY: "proxy.corp.example:8080",
      NODE_EXTRA_CA_CERTS: "/etc/corp/ca.pem",
    });
    expect(ok).toMatchObject({ value: { plan: { kind: "ready", setup: { image: { kind: "none" } } } } });
    expect(srtEgresses).toEqual([
      {
        hosts: [".npmjs.org", "repo.maven.apache.org"],
        upstream: { kind: "proxy", host: "proxy.corp.example", port: 8080 },
        caCerts: "/etc/corp/ca.pem",
      },
    ]);
    // no box.json is read, no vm box is asked for, and no egress container starts
    expect(images).toEqual([]);
    if (ok.kind !== "ok" || ok.value.plan.kind !== "ready") throw new Error("no plan");
    expect(await ok.value.plan.setup.egress()).toEqual({ kind: "own" });
    expect(opens).toEqual([]);
  });

  it("refuses the srt runner on an empty allowlist, the project's git host on it, a relative CA path, or a runner that does not answer", async () => {
    // the project's own git host is refused on the list too, as the Squid proxy refuses it
    write("ledger.json", { ...LOCAL, egress: { allow: ["gitlab.corp.example"] } });
    expect(await planFor([], { FACTORY_BOX: "srt", FACTORY_FORGE_HOST: "gitlab.corp.example" })).toMatchObject(
      reason("a git host"),
    );
    write("ledger.json", LOCAL);
    expect(await planFor([], { FACTORY_BOX: "srt" })).toMatchObject(reason('no "egress.allow"'));
    write("ledger.json", { ...LOCAL, egress: { allow: ["api.anthropic.com"] } });
    expect(await planFor([], { FACTORY_BOX: "srt", NODE_EXTRA_CA_CERTS: "ca.pem" })).toMatchObject(
      reason("NODE_EXTRA_CA_CERTS must be an absolute path"),
    );
    srtRunner = fakeBox({ place: "srt", probe: { kind: "missing", reason: "srt is not installed" } }).box;
    expect(await planFor([], { FACTORY_BOX: "srt" })).toMatchObject(
      reason("the srt box is not working: srt is not installed"),
    );
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

  it("hands the proxy the project's own git host, so the allowlist refuses it too", async () => {
    write("ledger.json", { ...LOCAL, egress: { allow: ["repo.maven.apache.org"] } });
    write("ledger/box.json", { image: ID });
    for (const more of [{}, { FACTORY_FORGE_HOST: "gitlab.corp.example" }]) {
      const ok = await planFor([fakeBox({}).box], more);
      if (ok.kind !== "ok" || ok.value.plan.kind !== "ready") throw new Error("no plan");
      await ok.value.plan.setup.egress();
    }
    expect(gitHosts).toEqual([[], ["gitlab.corp.example"]]);
  });

  it("stops the pass on a project file that is there but refused, so a local project never reads as forge CI", async () => {
    write("ledger.json", { gate: "locl", ready: { programs: ["make"] } });
    expect(await planFor([fakeBox({}).box])).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining('"gate" must be'),
    });
  });
});

describe("evidence that can prove its criterion (#444)", () => {
  const printed = (stdout: string, code = 0): Ran => ({ kind: "exited", code, stdout, stderr: "" });
  const said = (command: string, result: string, criterion = "AC-1"): Evidence => ({ criterion, command, result });

  it("runs grep, test, wc and git's reads with no ready.programs entry for them; refuses git's writes", async () => {
    const fake = fakeBox({ runs: [printed("1\n"), printed(""), printed("3 README.md\n")] });
    const out = await ready(fake.box, [
      said('grep -c "records each" README.md', "1"),
      said("test -f README.md", "exit 0", "AC-2"),
      said("wc -l README.md", "3 README.md", "AC-3"),
    ]);
    expect(out).toMatchObject({ kind: "ok", value: { passed: true } });
    const refused = fakeBox({});
    expect(await ready(refused.box, [said("git commit -m x", "")])).toMatchObject({
      kind: "ok",
      value: { passed: false, why: expect.stringContaining('"git commit" is not a read') },
    });
    expect(await ready(refused.box, [said("curl x", "")])).toMatchObject({
      kind: "ok",
      value: { passed: false, why: expect.stringContaining("grep, test, wc, ls, cat, head, tail, git (only diff") },
    });
    expect(refused.calls.filter((c) => c.op === "start")).toEqual([]);
  });

  it("refuses one gate command given for several criteria, before any box starts", async () => {
    const fake = fakeBox({});
    const prose = "I read it by hand: line 3 is the paragraph. The gate still passes.";
    const out = await ready(fake.box, [said("./gradlew check", prose), said("./gradlew check", prose, "AC-2")]);
    expect(out).toMatchObject({
      kind: "ok",
      value: {
        passed: false,
        why: expect.stringMatching(/^rows 1 \(AC-1\), 2 \(AC-2\) all give "\.\/gradlew check": a gate run is never/),
      },
    });
    expect(fake.calls.filter((c) => c.op === "start")).toEqual([]);
    // the local gate's verify command counts as a gate run too; a targeted test run for two criteria does not
    expect(await ready(fakeBox({}).box, [said("make verify", "ok"), said("make verify", "ok", "AC-2")])).toMatchObject({
      kind: "ok",
      value: { passed: false },
    });
    const targeted = fakeBox({ runs: [exited(0), exited(0)] });
    const tests = "./gradlew test --tests 'OrderSpec'";
    expect(await ready(targeted.box, [said(tests, "ok"), said(tests, "ok", "AC-2")])).toMatchObject({
      kind: "ok",
      value: { passed: true },
    });
  });

  it("refuses a result that quotes nothing its command printed, after the rows ran", async () => {
    const gradle = "> Task :check\n\nBUILD SUCCESSFUL in 58s\n5 actionable tasks: 5 executed\n";
    const prose = fakeBox({ runs: [printed(gradle)] });
    expect(
      await ready(prose.box, [said("./gradlew check", "I read it by hand: line 3 is the paragraph. The gate passes.")]),
    ).toMatchObject({
      kind: "ok",
      value: {
        passed: false,
        why: 'row 1 (AC-1): its result does not quote what "./gradlew check" printed: copy a line of the command\'s own output into the result, never a description of it',
      },
    });
    // the writer's rework reads what the command did print, to quote it
    const kept = await readKept({ recordsDir: recordsDirOf(p.clone), change: 12, head }, READY_FILE);
    expect(kept).toMatchObject({ kind: "ok", value: expect.stringContaining("BUILD SUCCESSFUL in 58s") });
    // a fragment, a whole line, or the same words with another time all quote it
    for (const result of ["BUILD SUCCESSFUL", "5 actionable tasks: 5 executed", "BUILD SUCCESSFUL in 1m 2s"]) {
      const quoted = fakeBox({ runs: [printed(gradle)] });
      expect(await ready(quoted.box, [said("./gradlew check", result)])).toMatchObject({ value: { passed: true } });
    }
  });

  it("gives a git row the branch's history in the box: the head checked out, the default branch to diff against", async () => {
    // a box that runs each row in its copy, as a runner would; the host's git config does not reach it
    const fake = fakeBox({});
    const outputs: string[] = [];
    const box: Box = {
      ...fake.box,
      run: async (call) => {
        const start = fake.calls.findLast((c) => c.op === "start");
        const spec = start?.op === "start" ? start.spec : undefined;
        const [program, ...args] = call.command.argv;
        const stdout = execFileSync(program, args, {
          cwd: spec?.worktree,
          env: { PATH: process.env.PATH, HOME: p.root, GIT_CONFIG_NOSYSTEM: "1", ...spec?.env },
          encoding: "utf8",
        });
        outputs.push(stdout);
        return { kind: "exited", code: 0, stdout, stderr: "" };
      },
    };
    const out = await ready(box, [
      said("git diff --name-only main...HEAD", "svc/Extra.java"),
      said("git status --porcelain", "", "AC-2"),
      said("git rev-parse HEAD", head, "AC-3"),
    ]);
    expect(out).toMatchObject({ kind: "ok", value: { passed: true } });
    // the branch's own files, not main's Makefile, which the branch merged in
    expect(outputs[0]?.split("\n")).toContain("svc/Extra.java");
    expect(outputs[0]?.split("\n")).not.toContain("Makefile");
    expect(outputs.slice(1)).toEqual(["", `${head}\n`]);
    const start = fake.calls.find((c) => c.op === "start");
    expect(start?.op === "start" ? start.spec.env : {}).toMatchObject({ GIT_CONFIG_KEY_0: "safe.directory" });
    // a check with no git row gets no repository
    const plain = fakeBox({ runs: [exited(0)] });
    const seen: string[][] = [];
    await ready(watched(plain, seen), [row("make test")]);
    expect(seen[0]).not.toContain(".git");
  });
});
