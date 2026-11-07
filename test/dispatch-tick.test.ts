import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approve } from "../src/core/approval.js";
import { readRecords, record, summarize, type Event } from "../src/core/dispatch/records.js";
import { lock, STEPS_TODAY, tick, type Steps, type TickSetup } from "../src/core/dispatch/tick.js";
import type { Changes, Forge, OpenChange } from "../src/core/forge/types.js";
import { renderPost } from "../src/core/post.js";
import { specHash } from "../src/core/spec.js";

const SPEC = (lane: string) =>
  ["# PROJ-1: renewals refuse a reserved loan", "", "## Intent", "", "A member cannot renew a reserved loan.", "", "## Acceptance criteria", "", "1. It answers 409.", "", "## Design", "", "none", "", "## Lane", "", lane, ""].join("\n");

const H = "1".repeat(40);
let home = "";

async function approved(ticket = "PROJ-1", lane = "feature"): Promise<void> {
  mkdirSync(join(home, "specs", "ledger", ticket), { recursive: true });
  const text = SPEC(lane).replace("PROJ-1", ticket);
  writeFileSync(join(home, "specs", "ledger", ticket, "spec.md"), text);
  const done = await approve({ where: { home, project: "ledger", ticket }, seenHash: specHash(text), by: "ram", at: "2026-11-07T08:00:00Z" });
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

// A forge that answers poll from `changes` and records every write.
function forge(changes: Changes, log: string[]): Forge {
  return {
    name: "github",
    mark: "#",
    me: async () => ({ kind: "ok", value: "ram" }),
    changes: async () => ({ kind: "ok", value: changes }),
    addLabel: async ({ number, label }: { number: number; label: string }) => (log.push(`label +${label} #${number}`), { kind: "ok" }),
    removeLabel: async ({ number, label }: { number: number; label: string }) => (log.push(`label -${label} #${number}`), { kind: "ok" }),
    note: async ({ number, post }: { number: number; post: Parameters<typeof renderPost>[0] }) => {
      const r = renderPost(post);
      log.push(`note #${number} ${r.kind === "ok" ? r.text : r.reason}`);
      return { kind: "ok" };
    },
  } as unknown as Forge;
}

const team = [{ name: "ram", level: "maintainer", bot: false }] as const;

function setup(changes: Changes, log: string[], over: Partial<TickSetup> = {}): TickSetup {
  return { home, project: "ledger", forge: forge(changes, log), label: "agent::claimed", steps: STEPS_TODAY, now: () => Date.parse("2026-11-07T10:00:00Z"), quietMinutes: 30, dryRun: false, log: (l) => log.push(`log ${l}`), ...over };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "factory-dispatch-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("records", () => {
  const where = () => ({ home, project: "ledger", ticket: "PROJ-1" });

  it("appends one line per event, and counts only what came after the approval", async () => {
    const events: Event[] = [
      { at: "2026-11-06T09:00:00Z", kind: "ready-ended", head: H, passed: false },
      { at: "2026-11-07T09:00:00Z", kind: "ready-ended", head: H, passed: false },
      { at: "2026-11-07T09:10:00Z", kind: "started", phase: "writer", mode: "ci", head: H },
      { at: "2026-11-07T09:20:00Z", kind: "writer-ended", mode: "ci", head: H, outcome: "done", patch: "p" },
    ];
    for (const event of events) {
      expect(await record({ where: where(), event })).toEqual({ kind: "ok" });
    }
    const read = await readRecords(where());
    expect(read.kind === "ok" ? read.value : []).toEqual(events);
    const s = summarize({ events: read.kind === "ok" ? read.value : [], since: "2026-11-07T08:00:00Z" });
    expect(s).toMatchObject({ readyFailures: 1, ciRounds: 1, interrupted: { kind: "none" }, lastAt: "2026-11-07T09:20:00Z" });
  });

  it("a start with no end is an interrupted run; a line that is not a record fails the read", async () => {
    await record({ where: where(), event: { at: "2026-11-07T09:00:00Z", kind: "started", phase: "review", mode: "none", head: H } });
    const read = await readRecords(where());
    expect(summarize({ events: read.kind === "ok" ? read.value : [], since: "2026-11-07T08:00:00Z" }).interrupted).toEqual({ kind: "interrupted", phase: "review", at: "2026-11-07T09:00:00Z" });
    writeFileSync(join(home, "runs", "ledger", "PROJ-1.jsonl"), "{\"kind\":\"started\"}\n", { flag: "a" });
    expect(await readRecords(where())).toMatchObject({ kind: "failed", reason: expect.stringContaining("line 2") });
    expect(await record({ where: { ...where(), ticket: "../x" }, event: { at: "t", kind: "pinged", head: H } })).toMatchObject({ kind: "failed" });
  });
});

describe("tick", () => {
  it("today the writer's step is not built: the pass says so and records nothing, so the next pass decides the same", async () => {
    await approved();
    const log: string[] = [];
    expect(await tick(setup({ team, open: [], merged: [] }, log))).toMatchObject({ kind: "ok" });
    expect(log).toEqual(["log PROJ-1: writer (fix): approved; no run yet", "log PROJ-1: unavailable: the writer's box is not built yet (#113)"]);
    expect(await readRecords({ home, project: "ledger", ticket: "PROJ-1" })).toEqual({ kind: "ok", value: [] });
  });

  it("an available writer: claims the change, records the start and the end; one run per pass", async () => {
    await approved("PROJ-1");
    await approved("PROJ-2");
    const log: string[] = [];
    const runs: string[] = [];
    const steps: Steps = {
      ...STEPS_TODAY,
      writer: { kind: "available", run: async (input) => (runs.push(input.ticket), { kind: "ok", value: { head: H, outcome: "done", patch: "p1" } }) },
    };
    const changes = { team, open: [open({ labels: [] }), open({ number: 13, branch: "factory/PROJ-2", labels: [] })], merged: [] };
    expect(await tick(setup(changes, log, { steps }))).toMatchObject({ kind: "ok" });
    expect(runs).toEqual(["PROJ-1"]);
    expect(log).toContain("label +agent::claimed #12");
    const read = await readRecords({ home, project: "ledger", ticket: "PROJ-1" });
    expect(read.kind === "ok" ? read.value.map((e) => e.kind) : []).toEqual(["started", "writer-ended"]);
  });

  it("a writer step that fails leaves its start: the next pass hands the ticket to a person", async () => {
    await approved();
    const steps: Steps = { ...STEPS_TODAY, writer: { kind: "available", run: async () => ({ kind: "failed", reason: "the box died" }) } };
    const changes = { team, open: [open({ labels: [] })], merged: [] };
    const first: string[] = [];
    await tick(setup(changes, first, { steps }));
    expect(first).toContain("log PROJ-1: failed: the box died");
    const second: string[] = [];
    await tick(setup(changes, second, { steps }));
    expect(second).toContain("label +needs-human #12");
    expect(second.find((l) => l.startsWith("note #12"))).toMatch(/^note #12 \[coordinator\] blocked: the writer run started at .* never ended/);
  });

  it("a stale approval releases the claim; a merged change is reconciled; a green gate is pinged once", async () => {
    await approved("PROJ-1");
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), SPEC("feature").replace("409", "423"));
    await approved("PROJ-3");
    await record({ where: { home, project: "ledger", ticket: "PROJ-3" }, event: { at: "2026-11-07T09:00:00Z", kind: "writer-ended", mode: "fix", head: H, outcome: "done", patch: "p" } });
    await record({ where: { home, project: "ledger", ticket: "PROJ-3" }, event: { at: "2026-11-07T09:05:00Z", kind: "ready-ended", head: H, passed: true } });
    await record({ where: { home, project: "ledger", ticket: "PROJ-3" }, event: { at: "2026-11-07T09:10:00Z", kind: "review-ended", head: H, actOn: 0 } });
    const changes = { team, open: [open(), open({ number: 14, branch: "factory/PROJ-3" })], merged: [{ number: 9, branch: "factory/PROJ-9", fork: false }] };
    const log: string[] = [];
    await tick(setup(changes, log));
    expect(log).toContain("label -agent::claimed #12");
    expect(log).toContain("label -agent::claimed #9");
    expect(log.filter((l) => l.startsWith("note #14"))).toEqual(["note #14 [coordinator] ready for you at 11111111: the gate is green; review and merge"]);
    const again: string[] = [];
    await tick(setup(changes, again));
    expect(again.filter((l) => l.startsWith("note #14"))).toEqual([]);
  });

  it("a dry run decides every ticket and acts on none", async () => {
    await approved();
    const log: string[] = [];
    await tick(setup({ team, open: [open()], merged: [{ number: 9, branch: "factory/PROJ-9", fork: false }] }, log, { dryRun: true }));
    expect(log.every((l) => l.startsWith("log ") && l.endsWith("(dry run)"))).toBe(true);
    expect(log).toHaveLength(2);
  });

  it("a fork's branch named factory/<ticket> is never the ticket's change", async () => {
    await approved();
    const log: string[] = [];
    const steps: Steps = { ...STEPS_TODAY, writer: { kind: "available", run: async (input) => (log.push(`writer on ${input.change.kind}`), { kind: "failed", reason: "stop here" }) } };
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
    const passed = await tick(setup({ team, open: [], merged: [{ number: 9, branch: "factory/PROJ-2", fork: false }] }, log));
    expect(log).toContain("log PROJ-1: broken: " + join(home, "runs", "ledger", "PROJ-1.jsonl") + " line 1 is not a record; fix or remove it");
    expect(log).toContain("label -agent::claimed #9");
    expect(passed.kind === "ok" ? passed.value.some((r) => r.result.kind === "failed") : false).toBe(true);
  });

  it("a stop is handed to a person once: needs-human, the claim released, one note; a person removing the label does not repost it", async () => {
    await approved();
    await record({ where: { home, project: "ledger", ticket: "PROJ-1" }, event: { at: "2026-11-07T09:00:00Z", kind: "writer-ended", mode: "fix", head: H, outcome: "done", patch: "" } });
    const changes = { team, open: [open()], merged: [] };
    const first: string[] = [];
    await tick(setup(changes, first));
    expect(first.filter((l) => !l.startsWith("log"))).toEqual(["label +needs-human #12", "label -agent::claimed #12", "note #12 [coordinator] blocked: the writer's run changed nothing"]);
    const second: string[] = [];
    await tick(setup(changes, second));
    expect(second.filter((l) => !l.startsWith("log"))).toEqual([]);
    expect(second.join(" ")).toContain("approve again");
  });

  it("forge-only actions come before the one run, so no ping waits behind an hour-long writer", async () => {
    await approved("PROJ-1");
    await approved("PROJ-3");
    for (const event of [
      { at: "2026-11-07T09:00:00Z", kind: "writer-ended", mode: "fix", head: H, outcome: "done", patch: "p" },
      { at: "2026-11-07T09:05:00Z", kind: "ready-ended", head: H, passed: true },
      { at: "2026-11-07T09:10:00Z", kind: "review-ended", head: H, actOn: 0 },
    ] as const) {
      await record({ where: { home, project: "ledger", ticket: "PROJ-3" }, event });
    }
    const log: string[] = [];
    const steps: Steps = { ...STEPS_TODAY, writer: { kind: "available", run: async () => (log.push("writer runs"), { kind: "ok", value: { head: H, outcome: "done", patch: "p1" } }) } };
    await tick(setup({ team, open: [open({ labels: [] }), open({ number: 14, branch: "factory/PROJ-3" })], merged: [] }, log, { steps }));
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
    expect(await tick(setup({ team, open: [], merged: [] }, []))).toMatchObject({ kind: "failed", reason: expect.stringContaining("another pass") });
    if (held.kind === "held") {
      await held.release();
    }
    writeFileSync(join(home, "runs", "ledger", ".lock"), "999999999");
    expect(await tick(setup({ team, open: [], merged: [] }, []))).toMatchObject({ kind: "ok" });
    expect(() => readFileSync(join(home, "runs", "ledger", ".lock"))).toThrow();
  });
});
