import { NO_NOTIFY, type Notify, type Ping } from "../src/core/notify.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { approve } from "../src/core/approval.js";
import { readRecords, record, summarize, type Event } from "../src/core/dispatch/records.js";
import { lock, STEPS_TODAY, tick, type Steps, type TickSetup } from "../src/core/dispatch/tick.js";
import type { Changes, Forge, OpenChange } from "../src/core/forge/types.js";
import { renderPost } from "../src/core/post.js";
import { goAhead, start } from "../src/core/start.js";
import { specHash } from "../src/core/spec.js";
import { tempDir } from "./temp.js";

const SPEC = (lane: string) =>
  [
    "# PROJ-1: renewals refuse a reserved loan",
    "",
    "## Intent",
    "",
    "A member cannot renew a reserved loan.",
    "",
    "## Acceptance criteria",
    "",
    "1. It answers 409.",
    "",
    "## Design",
    "",
    "none",
    "",
    "## Lane",
    "",
    lane,
    "",
  ].join("\n");

const H = "1".repeat(40);
// the shared copy of the approval approved() gives (#227)
const COPY = (ticket: string, lane = "feature") =>
  `[coordinator] approved by ram via terminal, spec ${specHash(SPEC(lane).replace("PROJ-1", ticket))}, design none`;
let home = "";

// a ticket a human STARTed and then approved: both records, since nothing runs without a START (#227)
async function approved(ticket = "PROJ-1", lane = "feature"): Promise<void> {
  const started = await start({
    where: { home, project: "ledger", ticket },
    by: "ram",
    via: "terminal",
    at: "2026-11-07T07:00:00Z",
    branch: "absent",
    confirmed: false,
  });
  expect(started.kind).toBe("started");
  mkdirSync(join(home, "specs", "ledger", ticket), { recursive: true });
  const text = SPEC(lane).replace("PROJ-1", ticket);
  writeFileSync(join(home, "specs", "ledger", ticket, "spec.md"), text);
  const done = await approve({
    where: { home, project: "ledger", ticket },
    seenHash: specHash(text),
    by: "ram",
    at: "2026-11-07T08:00:00Z",
  });
  expect(done.kind).toBe("approved");
}

const open = (over: Partial<OpenChange> = {}): OpenChange => ({
  number: 12,
  branch: "factory/PROJ-1",
  fork: false,
  head: H,
  draft: true,
  labels: ["agent::claimed"],
  pipeline: { kind: "success" },
  comments: [],
  ...over,
});

const notUsed = async (): Promise<{ readonly kind: "failed"; readonly reason: string }> => ({
  kind: "failed",
  reason: "not used in these tests",
});

// A forge that answers poll from `changes` and records every write.
function forge(changes: Changes, log: string[]): Forge {
  return {
    name: "github",
    mark: "#",
    me: async () => ({ kind: "ok", value: "ram" }),
    change: notUsed,
    defaultBranch: notUsed,
    branchExists: async () => ({ kind: "ok", value: false }),
    openChange: notUsed,
    notes: notUsed,
    lineFinding: notUsed,
    status: notUsed,
    ciConfig: notUsed,
    claimed: notUsed,
    changes: async () => ({ kind: "ok", value: changes }),
    failedJobs: notUsed,
    addLabel: async ({ number, label }) => {
      log.push(`label +${label} #${number}`);
      return { kind: "ok" };
    },
    removeLabel: async ({ number, label }) => {
      log.push(`label -${label} #${number}`);
      return { kind: "ok" };
    },
    note: async ({ number, post }) => {
      const r = renderPost(post);
      log.push(`note #${number} ${r.kind === "ok" ? r.text : r.reason}`);
      return { kind: "ok" };
    },
  };
}

const team = [{ name: "ram", level: "maintainer", bot: false }] as const;

// a notifier that keeps each ping, or fails every one when told to
function pinger(pings: Ping[], fail = false): Notify {
  return async (ping) => {
    pings.push(ping);
    return fail ? { kind: "failed", reason: "discord is down" } : { kind: "ok" };
  };
}

function setup(changes: Changes, log: string[], over: Partial<TickSetup> = {}): TickSetup {
  return {
    home,
    project: "ledger",
    gate: "forge-ci",
    forge: forge(changes, log),
    label: "agent::claimed",
    steps: STEPS_TODAY,
    now: () => Date.parse("2026-11-07T10:00:00Z"),
    quietMinutes: 30,
    notify: NO_NOTIFY,
    dryRun: false,
    log: (l) => log.push(`log ${l}`),
    ...over,
  };
}

beforeEach(() => {
  home = tempDir("factory-dispatch-");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("records", () => {
  const where = () => ({ home, project: "ledger", ticket: "PROJ-1" });

  it("appends one line per event, and counts only what came after the approval", async () => {
    const events: Event[] = [
      { at: "2026-11-06T09:00:00Z", kind: "ready-ended", head: H, passed: false, why: "" },
      { at: "2026-11-07T09:00:00Z", kind: "ready-ended", head: H, passed: false, why: "" },
      { at: "2026-11-07T09:10:00Z", kind: "started", phase: "writer", mode: "ci", head: H },
      {
        at: "2026-11-07T09:20:00Z",
        kind: "writer-ended",
        mode: "ci",
        head: H,
        outcome: "done",
        patch: "p",
        evidence: [],
        hung: false,
      },
    ];
    for (const event of events) {
      expect(await record({ where: where(), event })).toEqual({ kind: "ok" });
    }
    const read = await readRecords(where());
    expect(read.kind === "ok" ? read.value : []).toEqual(events);
    const s = summarize({ events: read.kind === "ok" ? read.value : [], since: "2026-11-07T08:00:00Z" });
    expect(s).toMatchObject({
      readyFailures: 1,
      ciRounds: 1,
      interrupted: { kind: "none" },
      lastAt: "2026-11-07T09:20:00Z",
    });
  });

  it("a start with no end is an interrupted run; a line that is not a record fails the read", async () => {
    await record({
      where: where(),
      event: { at: "2026-11-07T09:00:00Z", kind: "started", phase: "review", mode: "none", head: H },
    });
    const read = await readRecords(where());
    expect(
      summarize({ events: read.kind === "ok" ? read.value : [], since: "2026-11-07T08:00:00Z" }).interrupted,
    ).toEqual({ kind: "interrupted", phase: "review", at: "2026-11-07T09:00:00Z" });
    writeFileSync(join(home, "runs", "ledger", "PROJ-1.jsonl"), '{"kind":"started"}\n', { flag: "a" });
    expect(await readRecords(where())).toMatchObject({ kind: "failed", reason: expect.stringContaining("line 2") });
    expect(
      await record({ where: { ...where(), ticket: "../x" }, event: { at: "t", kind: "pinged", head: H } }),
    ).toMatchObject({ kind: "failed" });
  });
});

describe("records: evidence", () => {
  it("keeps the writer's evidence rows; a line from before the rows has none; a bad row fails the read", async () => {
    const file = join(home, "runs", "ledger", "PROJ-1.jsonl");
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({ at: "2026-11-07T09:00:00Z", kind: "writer-ended", mode: "fix", head: H, outcome: "done", patch: "p" })}\n${JSON.stringify({ at: "2026-11-07T09:01:00Z", kind: "ready-ended", head: H, passed: true })}\n`,
    );
    const read = await readRecords({ home, project: "ledger", ticket: "PROJ-1" });
    expect(read).toMatchObject({ kind: "ok", value: [{ evidence: [] }, { why: "" }] });
    writeFileSync(
      file,
      `${JSON.stringify({ at: "2026-11-07T09:02:00Z", kind: "writer-ended", mode: "fix", head: H, outcome: "done", patch: "p", evidence: [{ criterion: "AC1" }] })}\n`,
      { flag: "a" },
    );
    expect(await readRecords({ home, project: "ledger", ticket: "PROJ-1" })).toMatchObject({ kind: "failed" });
  });
});

describe("tick", () => {
  it("today the writer's step is not built: the pass says so and records nothing, so the next pass decides the same", async () => {
    await approved();
    const log: string[] = [];
    expect(await tick(setup({ team, open: [], merged: [] }, log))).toMatchObject({ kind: "ok" });
    expect(log).toEqual([
      "log PROJ-1: writer (fix): approved; no run yet",
      "log PROJ-1: unavailable: the writer's box is not built yet (#113)",
    ]);
    expect(await readRecords({ home, project: "ledger", ticket: "PROJ-1" })).toEqual({ kind: "ok", value: [] });
  });

  it("an available writer: claims the change, records the start and the end; one run per pass", async () => {
    await approved("PROJ-1");
    await approved("PROJ-2");
    const log: string[] = [];
    const runs: string[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: {
        kind: "available",
        run: async (input) => (
          runs.push(input.ticket),
          { kind: "ok", value: { head: H, outcome: "done", patch: "p1", evidence: [], hung: false } }
        ),
      },
    };
    const changes = {
      team,
      open: [open({ labels: [] }), open({ number: 13, branch: "factory/PROJ-2", labels: [] })],
      merged: [],
    };
    expect(await tick(setup(changes, log, { steps }))).toMatchObject({ kind: "ok" });
    expect(runs).toEqual(["PROJ-1"]);
    expect(log).toContain("label +agent::claimed #12");
    const read = await readRecords({ home, project: "ledger", ticket: "PROJ-1" });
    // the approval's shared copy goes on the PR first, once (#227)
    expect(read.kind === "ok" ? read.value.map((e) => e.kind) : []).toEqual(["shared", "started", "writer-ended"]);
  });

  it("a writer step that fails leaves its start: the next pass hands the ticket to a person", async () => {
    await approved();
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: { kind: "available", run: async () => ({ kind: "failed", reason: "the box died" }) },
    };
    const changes = { team, open: [open({ labels: [] })], merged: [] };
    const first: string[] = [];
    await tick(setup(changes, first, { steps }));
    expect(first).toContain("log PROJ-1: failed: the box died");
    const second: string[] = [];
    await tick(setup(changes, second, { steps }));
    expect(second).toContain("label +needs-human #12");
    expect(second.find((l) => l.startsWith("note #12"))).toMatch(
      /^note #12 \[coordinator\] blocked: the writer run started at .* never ended/,
    );
  });

  it("two failures in a row skip the step until each nextTry (#228)", async () => {
    await approved();
    const H2 = "2".repeat(40);
    const where = { home, project: "ledger", ticket: "PROJ-1" };
    await record({
      where,
      event: {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "fix",
        head: H,
        outcome: "done",
        patch: "p1",
        evidence: [],
        hung: false,
      },
    });
    const wrote: string[] = [];
    let head = H;
    const steps: Steps = {
      ...STEPS_TODAY,
      ready: { kind: "available", run: async () => ({ kind: "ok", value: { passed: false, why: "row 1" } }) },
      writer: {
        kind: "available",
        run: async (input) => {
          wrote.push(input.task.kind);
          head = H2;
          return { kind: "ok", value: { head: H2, outcome: "done", patch: "p2", evidence: [], hung: false } };
        },
      },
    };
    const pass = async (time: string) => {
      const changes = { team, open: [open({ head })], merged: [] };
      await tick(setup(changes, [], { steps, now: () => Date.parse(time) }));
    };
    const nextTry = async () => {
      const read = await readRecords(where);
      const last = read.kind === "ok" ? read.value.at(-1) : undefined;
      return last?.kind === "ready-ended" ? last.nextTry : undefined;
    };
    // the first failure: the writer's retry waits 10 s
    await pass("2026-11-07T10:00:00Z");
    expect(await nextTry()).toEqual({ step: "ready", at: "2026-11-07T10:00:10.000Z" });
    await pass("2026-11-07T10:00:09Z");
    expect(wrote).toEqual([]);
    await pass("2026-11-07T10:00:10Z");
    expect(wrote).toEqual(["ready-failed"]);
    // the second failure: 20 s
    await pass("2026-11-07T10:01:00Z");
    expect(await nextTry()).toEqual({ step: "ready", at: "2026-11-07T10:01:20.000Z" });
    await pass("2026-11-07T10:01:19Z");
    expect(wrote).toEqual(["ready-failed"]);
    await pass("2026-11-07T10:01:20Z");
    expect(wrote).toEqual(["ready-failed", "ready-failed"]);
  });

  it("a stale approval releases the claim; a merged change is reconciled; a green gate is pinged once", async () => {
    await approved("PROJ-1");
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), SPEC("feature").replace("409", "423"));
    await approved("PROJ-3");
    await record({
      where: { home, project: "ledger", ticket: "PROJ-3" },
      event: {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "fix",
        head: H,
        outcome: "done",
        patch: "p",
        evidence: [],
        hung: false,
      },
    });
    await record({
      where: { home, project: "ledger", ticket: "PROJ-3" },
      event: { at: "2026-11-07T09:05:00Z", kind: "ready-ended", head: H, passed: true, why: "" },
    });
    await record({
      where: { home, project: "ledger", ticket: "PROJ-3" },
      event: { at: "2026-11-07T09:10:00Z", kind: "review-ended", head: H, actOn: 0 },
    });
    const changes = {
      team,
      open: [open(), open({ number: 14, branch: "factory/PROJ-3" })],
      merged: [{ number: 9, branch: "factory/PROJ-9", fork: false }],
    };
    const log: string[] = [];
    const pings: Ping[] = [];
    await tick(setup(changes, log, { notify: pinger(pings) }));
    expect(log).toContain("label -agent::claimed #12");
    expect(log).toContain("label -agent::claimed #9");
    expect(log.filter((l) => l.startsWith("note #14"))).toEqual([
      `note #14 ${COPY("PROJ-3")}`,
      "note #14 [coordinator] ready for you at 11111111: the gate is green; review and merge",
    ]);
    expect(pings).toEqual([{ kind: "ready", ticket: "PROJ-3", change: 14, head: H }]);
    const again: string[] = [];
    await tick(setup(changes, again, { notify: pinger(pings) }));
    expect(again.filter((l) => l.startsWith("note #14"))).toEqual([]);
    // pinged once, as the note
    expect(pings).toHaveLength(1);
  });

  it("the ready check gets the writer's evidence rows and records its reason; a local gate runs the verifier (#91)", async () => {
    await approved();
    const evidence = [{ criterion: "AC1", command: "make test", result: "passed" }];
    await record({
      where: { home, project: "ledger", ticket: "PROJ-1" },
      event: {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "fix",
        head: H,
        outcome: "done",
        patch: "p",
        evidence,
        hung: false,
      },
    });
    const given: unknown[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      ready: {
        kind: "available",
        run: async (input) => (
          given.push(input.evidence), { kind: "ok", value: { passed: false, why: "row 1 (AC1): make test exited 2" } }
        ),
      },
    };
    const changes = { team, open: [open()], merged: [] };
    await tick(setup(changes, [], { steps }));
    expect(given).toEqual([evidence]);
    const read = await readRecords({ home, project: "ledger", ticket: "PROJ-1" });
    expect(read.kind === "ok" ? read.value.at(-1) : undefined).toMatchObject({
      kind: "ready-ended",
      passed: false,
      why: "row 1 (AC1): make test exited 2",
    });
    // the ready check passed and the review found nothing: with a local gate and no status, the verifier runs
    await record({
      where: { home, project: "ledger", ticket: "PROJ-1" },
      event: { at: "2026-11-07T09:10:00Z", kind: "ready-ended", head: H, passed: true, why: "" },
    });
    await record({
      where: { home, project: "ledger", ticket: "PROJ-1" },
      event: { at: "2026-11-07T09:20:00Z", kind: "review-ended", head: H, actOn: 0 },
    });
    const verified: string[] = [];
    const local: Steps = {
      ...STEPS_TODAY,
      verify: {
        kind: "available",
        run: async (input) => (verified.push(input.head), { kind: "ok", value: { passed: true } }),
      },
    };
    const noCi = { team, open: [open({ pipeline: { kind: "none" } })], merged: [] };
    await tick(setup(noCi, [], { steps: local, gate: "local" }));
    expect(verified).toEqual([H]);
    const after = await readRecords({ home, project: "ledger", ticket: "PROJ-1" });
    expect(after.kind === "ok" ? after.value.slice(-2).map((e) => e.kind) : []).toEqual(["started", "verify-ended"]);
  });

  it("a dry run decides every ticket and acts on none", async () => {
    await approved();
    const log: string[] = [];
    await tick(
      setup({ team, open: [open()], merged: [{ number: 9, branch: "factory/PROJ-9", fork: false }] }, log, {
        dryRun: true,
      }),
    );
    expect(log.every((l) => l.startsWith("log ") && l.endsWith("(dry run)"))).toBe(true);
    expect(log).toHaveLength(2);
  });

  it("a fork's branch named factory/<ticket> is never the ticket's change", async () => {
    await approved();
    const log: string[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: {
        kind: "available",
        run: async (input) => (log.push(`writer on ${input.change.kind}`), { kind: "failed", reason: "stop here" }),
      },
    };
    await tick(setup({ team, open: [open({ fork: true, labels: [] })], merged: [] }, log, { steps }));
    expect(log).toContain("writer on none");
    expect(log.some((l) => l.includes("#12"))).toBe(false);
  });

  it("a broken ticket fails on its own; every other ticket is still decided and acted on", async () => {
    await approved("PROJ-1");
    await approved("PROJ-2");
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    writeFileSync(join(home, "runs", "ledger", "PROJ-1.jsonl"), "not a record\n", { flag: "a" });
    const log: string[] = [];
    const passed = await tick(
      setup({ team, open: [], merged: [{ number: 9, branch: "factory/PROJ-2", fork: false }] }, log),
    );
    expect(log).toContain(
      "log PROJ-1: broken: " +
        join(home, "runs", "ledger", "PROJ-1.jsonl") +
        " line 1 is not a record; fix or remove it",
    );
    expect(log).toContain("label -agent::claimed #9");
    expect(passed.kind === "ok" ? passed.value.some((r) => r.result.kind === "failed") : false).toBe(true);
  });

  it("a stop is handed to a person once: needs-human, the claim released, one note; a person removing the label does not repost it", async () => {
    await approved();
    await record({
      where: { home, project: "ledger", ticket: "PROJ-1" },
      event: {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "fix",
        head: H,
        outcome: "done",
        patch: "",
        evidence: [],
        hung: false,
      },
    });
    const changes = { team, open: [open()], merged: [] };
    const first: string[] = [];
    const pings: Ping[] = [];
    await tick(setup(changes, first, { notify: pinger(pings) }));
    expect(first.filter((l) => !l.startsWith("log"))).toEqual([
      `note #12 ${COPY("PROJ-1")}`,
      "label +needs-human #12",
      "label -agent::claimed #12",
      "note #12 [coordinator] blocked: the writer's run changed nothing",
    ]);
    expect(pings).toEqual([
      { kind: "needs-you", ticket: "PROJ-1", change: 12, why: "the writer's run changed nothing" },
    ]);
    const second: string[] = [];
    await tick(setup(changes, second, { notify: pinger(pings) }));
    expect(pings).toHaveLength(1);
    expect(second.filter((l) => !l.startsWith("log"))).toEqual([]);
    expect(second.join(" ")).toContain("approve again");
  });

  it("pings when the writer asked or was blocked; a ping that fails is printed and never stops the pass (#119)", async () => {
    await approved();
    const changes = { team, open: [open({ labels: [] })], merged: [] };
    for (const [outcome, kind] of [
      ["asked", "asked"],
      ["blocked", "needs-you"],
    ] as const) {
      const log: string[] = [];
      const pings: Ping[] = [];
      const steps: Steps = {
        ...STEPS_TODAY,
        writer: {
          kind: "available",
          run: async () => ({ kind: "ok", value: { head: H, outcome, patch: "p1", evidence: [], hung: false } }),
        },
      };
      const ran = await tick(setup(changes, log, { steps, notify: pinger(pings, true) }));
      expect(ran).toMatchObject({ kind: "ok" });
      expect(pings.map((p) => p.kind)).toEqual([kind]);
      expect(log.join("\n")).toContain(
        "PROJ-1: the ping did not go out (the forge note is the record): discord is down",
      );
      rmSync(join(home, "runs"), { recursive: true, force: true });
    }
  });

  it("forge-only actions come before the one run, so no ping waits behind an hour-long writer", async () => {
    await approved("PROJ-1");
    await approved("PROJ-3");
    for (const event of [
      {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "fix",
        head: H,
        outcome: "done",
        patch: "p",
        evidence: [],
        hung: false,
      },
      { at: "2026-11-07T09:05:00Z", kind: "ready-ended", head: H, passed: true, why: "" },
      { at: "2026-11-07T09:10:00Z", kind: "review-ended", head: H, actOn: 0 },
    ] as const) {
      await record({ where: { home, project: "ledger", ticket: "PROJ-3" }, event });
    }
    const log: string[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: {
        kind: "available",
        run: async () => (
          log.push("writer runs"),
          { kind: "ok", value: { head: H, outcome: "done", patch: "p1", evidence: [], hung: false } }
        ),
      },
    };
    await tick(
      setup({ team, open: [open({ labels: [] }), open({ number: 14, branch: "factory/PROJ-3" })], merged: [] }, log, {
        steps,
      }),
    );
    expect(log.findIndex((l) => l.startsWith("note #14"))).toBeLessThan(log.indexOf("writer runs"));
  });

  it("a lock just made and not yet written is busy, and a pass never removes a lock that is not its own", async () => {
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    writeFileSync(join(home, "runs", "ledger", ".lock"), "");
    expect(await lock({ home, project: "ledger" })).toMatchObject({ kind: "busy" });
    rmSync(join(home, "runs", "ledger", ".lock"));
    const a = await lock({ home, project: "ledger" });
    expect(a.kind).toBe("held");
    writeFileSync(join(home, "runs", "ledger", ".lock"), `${process.pid}:someone-else`);
    if (a.kind === "held") {
      await a.release();
    }
    expect(readFileSync(join(home, "runs", "ledger", ".lock"), "utf8")).toBe(`${process.pid}:someone-else`);
  });

  it("one pass at a time: a live lock refuses, a dead one is taken over", async () => {
    const held = await lock({ home, project: "ledger" });
    expect(held.kind).toBe("held");
    expect(await tick(setup({ team, open: [], merged: [] }, []))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("another pass"),
    });
    if (held.kind === "held") {
      await held.release();
    }
    writeFileSync(join(home, "runs", "ledger", ".lock"), "999999999");
    expect(await tick(setup({ team, open: [], merged: [] }, []))).toMatchObject({ kind: "ok" });
    expect(() => readFileSync(join(home, "runs", "ledger", ".lock"))).toThrow(/ENOENT/);
  });
});

describe("START and approval (#227)", () => {
  const where = (ticket = "PROJ-1") => ({ home, project: "ledger", ticket });

  function spec(lane: string, ticket = "PROJ-1"): string {
    const text = SPEC(lane).replace("PROJ-1", ticket);
    mkdirSync(join(home, "specs", "ledger", ticket), { recursive: true });
    writeFileSync(join(home, "specs", "ledger", ticket, "spec.md"), text);
    return text;
  }

  async function started(at: string, ticket = "PROJ-1"): Promise<void> {
    const done = await start({
      where: where(ticket),
      by: "ram",
      via: "terminal",
      at,
      branch: "absent",
      confirmed: false,
    });
    expect(done.kind).toBe("started");
  }

  async function approvedAt(text: string, at: string): Promise<void> {
    const done = await approve({ where: where(), seenHash: specHash(text), by: "ram", at });
    expect(done.kind).toBe("approved");
  }

  const decisions = async (changes: Changes = { team, open: [], merged: [] }): Promise<readonly string[]> => {
    const log: string[] = [];
    await tick(setup(changes, log, { dryRun: true }));
    return log;
  };

  it("a tiny ticket's START lets its build begin; nothing else is needed", async () => {
    spec("tiny");
    expect(await decisions()).toEqual([]);
    await started("2026-11-07T08:00:00Z");
    expect(await decisions()).toEqual(["log PROJ-1: writer (fix): started; no run yet (dry run)"]);
  });

  it("a START in a lane that needs an approval waits for one; the approval lets the build begin", async () => {
    const text = spec("feature");
    await started("2026-11-07T08:00:00Z");
    expect(await decisions()).toEqual([
      "log PROJ-1: wait: the feature lane needs a human's approval; the ticket has a START only (dry run)",
    ]);
    await approvedAt(text, "2026-11-07T09:00:00Z");
    expect(await decisions()).toEqual(["log PROJ-1: writer (fix): approved; no run yet (dry run)"]);
  });

  it("a START whose spec is not written yet waits for the coordinator", async () => {
    await started("2026-11-07T08:00:00Z");
    expect(await decisions()).toEqual([
      "log PROJ-1: wait: the ticket has a START; its spec is not written yet (dry run)",
    ]);
  });

  it("a stale approval stops a START from building in an approval lane, and a bad START record breaks only its ticket", async () => {
    const text = spec("bug");
    await started("2026-11-07T08:00:00Z");
    await approvedAt(text, "2026-11-07T09:00:00Z");
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), text.replace("409", "423"));
    expect(await decisions()).toEqual([
      "log PROJ-1: wait: the spec or its design changed after its approval (dry run)",
    ]);
    mkdirSync(join(home, "starts", "ledger"), { recursive: true });
    writeFileSync(join(home, "starts", "ledger", "PROJ-2.json"), JSON.stringify({ kind: "start", ticket: "PROJ-2" }));
    expect((await decisions()).find((l) => l.includes("PROJ-2"))).toContain("broken");
  });

  // a ticket handed to a person: the writer's run changed nothing, and its PR carries needs-human
  async function handedOver(): Promise<void> {
    await record({
      where: where(),
      event: {
        at: "2026-11-07T09:30:00Z",
        kind: "writer-ended",
        mode: "fix",
        head: H,
        outcome: "done",
        patch: "",
        evidence: [],
        hung: false,
      },
    });
    await tick(setup({ team, open: [open()], merged: [] }, []));
    const read = await readRecords(where());
    expect(read.kind === "ok" ? read.value.map((e) => e.kind) : []).toContain("blocked");
  }

  const cleared = { team, open: [open({ labels: [] })], merged: [] };

  it("the way back from needs-human, tiny: the label removed, the ticket waits; a new START picks it up", async () => {
    spec("tiny");
    await started("2026-11-07T09:00:00Z");
    await handedOver();
    expect(await decisions({ team, open: [open({ labels: ["needs-human"] })], merged: [] })).toEqual([
      "log PROJ-1: wait: needs-human: a person decides (dry run)",
    ]);
    const held = await decisions(cleared);
    expect(held.join(" ")).toContain("handed to a person earlier: the writer's run changed nothing; START again");
    await started("2026-11-07T09:45:00Z");
    expect(await decisions(cleared)).toEqual(["log PROJ-1: writer (fix): started; no run yet (dry run)"]);
  });

  it("the way back from needs-human, an approval lane: approving again picks it up, with the START it has", async () => {
    const text = spec("feature");
    await started("2026-11-07T08:00:00Z");
    await approvedAt(text, "2026-11-07T09:00:00Z");
    await handedOver();
    expect((await decisions(cleared)).join(" ")).toContain("handed to a person earlier");
    await approvedAt(text, "2026-11-07T09:50:00Z");
    expect(await decisions(cleared)).toEqual(["log PROJ-1: writer (fix): approved; no run yet (dry run)"]);
  });

  it("the way back from needs-human, an approval lane: a new START also restarts the counts, the approval still current", async () => {
    const text = spec("feature");
    await started("2026-11-07T08:00:00Z");
    await approvedAt(text, "2026-11-07T09:00:00Z");
    await handedOver();
    await started("2026-11-07T09:45:00Z");
    expect(await decisions(cleared)).toEqual(["log PROJ-1: writer (fix): approved; no run yet (dry run)"]);
  });

  it("an approval with no START waits: nothing runs without one; the START then lets the build begin", async () => {
    const text = spec("bug");
    await approvedAt(text, "2026-11-07T08:00:00Z");
    expect(await decisions()).toEqual([
      "log PROJ-1: wait: approved, no START: a human STARTs the ticket first (dry run)",
    ]);
    const log: string[] = [];
    const runs: string[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: {
        kind: "available",
        run: async (input) => (
          runs.push(input.task.kind),
          { kind: "ok", value: { head: H, outcome: "done", patch: "p1", evidence: [], hung: false } }
        ),
      },
    };
    await tick(setup({ team, open: [open({ labels: [] })], merged: [] }, log, { steps }));
    expect(runs).toEqual([]);
    await started("2026-11-07T09:00:00Z");
    await tick(setup({ team, open: [open({ labels: [] })], merged: [] }, log, { steps }));
    expect(runs).toEqual(["test-first"]);
  });

  it("posts the shared copy of each approval once, through the posting template; a new approval posts again", async () => {
    const text = spec("feature");
    await approvedAt(text, "2026-11-07T08:00:00Z");
    const changes = { team, open: [open({ labels: [] })], merged: [] };
    const notes = async (): Promise<readonly string[]> => {
      const log: string[] = [];
      await tick(setup(changes, log));
      return log.filter((l) => l.startsWith("note"));
    };
    expect(await notes()).toEqual([`note #12 ${COPY("PROJ-1")}`]);
    expect(await notes()).toEqual([]);
    await approvedAt(text, "2026-11-07T09:00:00Z");
    expect(await notes()).toEqual([`note #12 ${COPY("PROJ-1")}`]);
  });

  it("a shared copy that fails to post is printed, and the pass goes on", async () => {
    await approvedAt(spec("feature"), "2026-11-07T08:00:00Z");
    const log: string[] = [];
    const base = setup({ team, open: [open({ labels: [] })], merged: [] }, log);
    const failing: Forge = { ...base.forge, note: async () => ({ kind: "failed", reason: "HTTP 502" }) };
    expect(await tick({ ...base, forge: failing })).toMatchObject({ kind: "ok" });
    expect(log).toContain("log PROJ-1: the shared copy of the approval did not go out: HTTP 502");
    const read = await readRecords(where());
    expect(read.kind === "ok" ? read.value.map((e) => e.kind) : []).not.toContain("shared");
  });
});

describe("the lane set by code, raise only (#230)", () => {
  const where = () => ({ home, project: "ledger", ticket: "PROJ-1" });
  const LONG = "the coordinator raises the spec's lane, and a human approves it";

  function specWith(lane: string, planned: readonly string[] = []): string {
    const text = `${SPEC(lane)}\n## Planned files\n\n${planned.map((p) => `- ${p}`).join("\n")}\n`;
    mkdirSync(join(home, "specs", "ledger", "PROJ-1"), { recursive: true });
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), text);
    return text;
  }

  function oneWayDoor(globs: readonly string[]): void {
    mkdirSync(join(home, "projects"), { recursive: true });
    writeFileSync(join(home, "projects", "ledger.json"), JSON.stringify({ oneWayDoorPaths: globs }));
  }

  async function startedTiny(): Promise<void> {
    const done = await start({
      where: where(),
      by: "ram",
      via: "terminal",
      at: "2026-11-07T08:00:00Z",
      branch: "absent",
      confirmed: false,
    });
    expect(done.kind).toBe("started");
  }

  const dry = async (changes: Changes = { team, open: [], merged: [] }): Promise<readonly string[]> => {
    const log: string[] = [];
    await tick(setup(changes, log, { dryRun: true }));
    return log;
  };

  it("before the build: a planned file under a one-way-door path raises the lane, and the ticket waits for approval", async () => {
    oneWayDoor(["db/migrations/**"]);
    specWith("tiny", ["db/migrations/V7__loans.sql"]);
    await startedTiny();
    expect(await dry()).toEqual([
      `log PROJ-1: wait: the lane is raised from tiny to one-way door (db/migrations/V7__loans.sql is under a one-way-door path): ${LONG} (dry run)`,
    ]);
    // the writer's own check holds it too
    expect(await goAhead(where())).toMatchObject({
      kind: "held",
      why: expect.stringContaining("raised from tiny to one-way door"),
    });
    // raised in the spec and approved, the build begins
    const text = specWith("one-way door", ["db/migrations/V7__loans.sql"]);
    const done = await approve({ where: where(), seenHash: specHash(text), by: "ram", at: "2026-11-07T09:00:00Z" });
    expect(done.kind).toBe("approved");
    expect(await dry()).toEqual(["log PROJ-1: writer (fix): approved; no run yet (dry run)"]);
  });

  it("a one-way-door paths key that is not a list breaks the ticket rather than drop the check", async () => {
    mkdirSync(join(home, "projects"), { recursive: true });
    writeFileSync(join(home, "projects", "ledger.json"), JSON.stringify({ oneWayDoorPaths: "db/**" }));
    specWith("tiny", ["db/x.sql"]);
    await startedTiny();
    expect((await dry()).join(" ")).toContain("broken");
  });

  it("the ready check: a tiny spec whose diff changes code is raised to bug, and stops for approval", async () => {
    oneWayDoor(["db/migrations/**"]);
    specWith("tiny");
    await startedTiny();
    await record({
      where: where(),
      event: {
        at: "2026-11-07T09:00:00Z",
        kind: "writer-ended",
        mode: "fix",
        head: H,
        outcome: "done",
        patch: "p1",
        evidence: [{ criterion: "AC-1", command: "make test", result: "ok" }],
        hung: false,
      },
    });
    const seen: unknown[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      ready: {
        kind: "available",
        run: async (input) => (
          seen.push({ criteria: input.criteria, oneWayDoor: input.oneWayDoor }),
          { kind: "ok", value: { passed: true, why: "", lane: "bug" } }
        ),
      },
    };
    const changes = { team, open: [open()], merged: [] };
    await tick(setup(changes, [], { steps }));
    expect(seen).toEqual([{ criteria: ["It answers 409."], oneWayDoor: ["db/migrations/**"] }]);
    const read = await readRecords(where());
    expect(read.kind === "ok" ? read.value.at(-1) : undefined).toMatchObject({ kind: "ready-ended", lane: "bug" });
    const log: string[] = [];
    await tick(setup(changes, log, { steps }));
    expect(log).toContain("label +needs-human #12");
    expect(log.find((l) => l.startsWith("note #12"))).toBe(
      `note #12 [coordinator] blocked: the lane is raised from tiny to bug (the ready check read the real diff): ${LONG}`,
    );
  });
});
