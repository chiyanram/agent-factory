import { describe, expect, it } from "vitest";
import { EMPTY, type Summary } from "../src/core/dispatch/records.js";
import { decide, MAX_CI_ROUNDS, MAX_READY_FAILURES, MAX_REVIEW_ROUNDS, type TicketState } from "../src/core/dispatch/table.js";
import type { OpenLine } from "../src/core/poll.js";

const H = "1".repeat(40);
const APPROVED_AT = "2026-11-07T08:00:00Z";
const NOW = Date.parse("2026-11-07T10:00:00Z");

function line(over: Partial<OpenLine> = {}): OpenLine {
  return { kind: "open", number: 12, branch: "factory/PROJ-1", head: H, draft: true, claimed: true, pipeline: { kind: "success" }, needsHuman: false, stop: { kind: "none" }, asks: 0, ...over };
}

const wrote = (over: Partial<Summary> = {}): Summary => ({
  ...EMPTY,
  lastWriter: { kind: "ended", mode: "fix", head: H, outcome: "done", patch: "p1" },
  lastAt: "2026-11-07T09:50:00Z",
  ...over,
});
const readyOk: Partial<Summary> = { lastReady: { kind: "ended", head: H, passed: true } };
const reviewed = (actOn: number, rounds = 1): Partial<Summary> => ({ ...readyOk, lastReview: { kind: "ended", head: H, actOn }, reviewRounds: rounds });

function state(over: Partial<TicketState> = {}): TicketState {
  return {
    ticket: "PROJ-1",
    approval: { kind: "approved", at: APPROVED_AT, lane: "feature" },
    change: { kind: "open", line: line() },
    runs: wrote({ ...reviewed(0) }),
    now: NOW,
    quietMinutes: 30,
    ...over,
  };
}

describe("decide: one row each", () => {
  it("a merged change that is still claimed is reconciled", () => {
    expect(decide(state({ change: { kind: "merged", line: { kind: "merged", number: 12, branch: "factory/PROJ-1" } } }))).toEqual({ kind: "reconcile" });
  });

  it("needs-human on the change: a person decides, nothing runs", () => {
    expect(decide(state({ change: { kind: "open", line: line({ needsHuman: true }) } }))).toMatchObject({ kind: "wait" });
  });

  it("a run that started and never ended is handed to a person (a restart in the middle loses nothing)", () => {
    const runs = wrote({ interrupted: { kind: "interrupted", phase: "writer", at: "2026-11-07T09:00:00Z" } });
    expect(decide(state({ runs }))).toMatchObject({ kind: "needs-human", why: expect.stringContaining("never ended") });
  });

  it("no approval or a stale one: a claim is released, an unclaimed change waits", () => {
    expect(decide(state({ approval: { kind: "stale" } }))).toMatchObject({ kind: "release", why: expect.stringContaining("changed after") });
    expect(decide(state({ approval: { kind: "missing" }, change: { kind: "open", line: line({ claimed: false }) } }))).toMatchObject({ kind: "wait" });
    expect(decide(state({ approval: { kind: "missing" }, change: { kind: "none" } }))).toMatchObject({ kind: "wait" });
  });

  it("a maintainer's /stop newer than the approval holds the change; an older one does not; an undated one does", () => {
    expect(decide(state({ change: { kind: "open", line: line({ stop: { kind: "stopped", at: "2026-11-07T09:00:00.000Z" } }) } }))).toMatchObject({ kind: "wait", why: expect.stringContaining("/stop") });
    expect(decide(state({ change: { kind: "open", line: line({ stop: { kind: "stopped", at: "2026-11-07T07:00:00.000Z" } }) } }))).toMatchObject({ kind: "ping" });
    expect(decide(state({ change: { kind: "open", line: line({ stop: { kind: "undated" } }) } }))).toMatchObject({ kind: "wait" });
  });

  it("an open question waits, and the claim is released once it has been quiet too long", () => {
    expect(decide(state({ change: { kind: "open", line: line({ asks: 1 }) } }))).toMatchObject({ kind: "wait", why: expect.stringContaining("question") });
    const quiet = wrote({ lastAt: "2026-11-07T09:00:00Z" });
    expect(decide(state({ runs: quiet, change: { kind: "open", line: line({ asks: 1 }) } }))).toMatchObject({ kind: "release", why: expect.stringContaining("30 minutes") });
  });

  it("a pipeline state the factory does not know goes to a person", () => {
    expect(decide(state({ change: { kind: "open", line: line({ pipeline: { kind: "unknown", raw: "WEIRD" } }) } }))).toMatchObject({ kind: "needs-human", why: expect.stringContaining("WEIRD") });
  });

  it("approved with no run yet starts the writer; a bug starts the test-first writer first, then the fix", () => {
    expect(decide(state({ change: { kind: "none" }, runs: EMPTY }))).toEqual({ kind: "writer", mode: "fix", why: "approved; no run yet" });
    const bug = { kind: "approved", at: APPROVED_AT, lane: "bug" } as const;
    expect(decide(state({ approval: bug, change: { kind: "none" }, runs: EMPTY }))).toMatchObject({ kind: "writer", mode: "test-first" });
    const testIn = wrote({ lastWriter: { kind: "ended", mode: "test-first", head: H, outcome: "done", patch: "t1" } });
    expect(decide(state({ approval: bug, runs: testIn }))).toMatchObject({ kind: "writer", mode: "fix" });
  });

  it("the writer again once a person answered its question, or removed needs-human after it was blocked", () => {
    expect(decide(state({ runs: wrote({ lastWriter: { kind: "ended", mode: "fix", head: H, outcome: "asked", patch: "p1" } }) }))).toMatchObject({ kind: "writer", why: "the question was answered" });
    expect(decide(state({ runs: wrote({ lastWriter: { kind: "ended", mode: "fix", head: H, outcome: "blocked", patch: "p1" } }) }))).toMatchObject({ kind: "writer", why: "a person removed needs-human" });
  });

  it("a run that ended with no change open waits for a person", () => {
    expect(decide(state({ change: { kind: "none" } }))).toMatchObject({ kind: "wait", why: expect.stringContaining("no change is open") });
  });

  it("a head that is not the writer's means a person pushed: stand off", () => {
    expect(decide(state({ change: { kind: "open", line: line({ head: "2".repeat(40) }) } }))).toMatchObject({ kind: "wait", why: expect.stringContaining("a person pushed") });
  });

  it("the same patch twice, or a run that changed nothing, goes to a person at once", () => {
    expect(decide(state({ runs: wrote({ previousPatch: "p1" }) }))).toMatchObject({ kind: "needs-human", why: expect.stringContaining("same patch") });
    expect(decide(state({ runs: wrote({ lastWriter: { kind: "ended", mode: "fix", head: H, outcome: "done", patch: "" } }) }))).toMatchObject({ kind: "needs-human", why: expect.stringContaining("changed nothing") });
  });

  it("writer done with no ready check at this head: the ready check", () => {
    expect(decide(state({ runs: wrote() }))).toEqual({ kind: "ready", head: H });
    expect(decide(state({ runs: wrote({ lastReady: { kind: "ended", head: "9".repeat(40), passed: true } }) }))).toEqual({ kind: "ready", head: H });
  });

  it("a failed ready check sends the writer back, and stops after 3", () => {
    const failed = { lastReady: { kind: "ended", head: H, passed: false } } as const;
    expect(decide(state({ runs: wrote({ ...failed, readyFailures: 1 }) }))).toMatchObject({ kind: "writer", mode: "rework" });
    expect(decide(state({ runs: wrote({ ...failed, readyFailures: MAX_READY_FAILURES }) }))).toMatchObject({ kind: "needs-human", why: expect.stringContaining("3 times") });
  });

  it("a passed ready check with no review at this head: the reviewer, and no 4th round", () => {
    expect(decide(state({ runs: wrote(readyOk) }))).toEqual({ kind: "review", head: H });
    expect(decide(state({ runs: wrote({ ...readyOk, reviewRounds: MAX_REVIEW_ROUNDS }) }))).toMatchObject({ kind: "needs-human" });
  });

  it("Act on findings send the writer back, and stop after 3 rounds", () => {
    expect(decide(state({ runs: wrote(reviewed(2, 1)) }))).toEqual({ kind: "writer", mode: "rework", why: "2 Act on finding(s)" });
    expect(decide(state({ runs: wrote(reviewed(1, MAX_REVIEW_ROUNDS)) }))).toMatchObject({ kind: "needs-human", why: expect.stringContaining("Act on") });
  });

  it("CI red sends the writer back, and stops after 2 CI rounds", () => {
    const red = { kind: "open", line: line({ pipeline: { kind: "failed" } }) } as const;
    expect(decide(state({ change: red }))).toMatchObject({ kind: "writer", mode: "ci" });
    expect(decide(state({ change: red, runs: wrote({ ...reviewed(0), ciRounds: MAX_CI_ROUNDS }) }))).toMatchObject({ kind: "needs-human", why: expect.stringContaining("CI rounds") });
    expect(decide(state({ change: { kind: "open", line: line({ pipeline: { kind: "canceled" } }) } }))).toMatchObject({ kind: "writer", mode: "ci" });
  });

  it("CI running, not there yet, or a manual job: wait", () => {
    for (const kind of ["running", "none", "manual", "skipped"] as const) {
      expect(decide(state({ change: { kind: "open", line: line({ pipeline: { kind } }) } }))).toMatchObject({ kind: "wait" });
    }
  });

  it("the gate green pings the human once, then waits: never undrafts", () => {
    expect(decide(state())).toEqual({ kind: "ping", head: H });
    expect(decide(state({ runs: wrote({ ...reviewed(0), pingedAt: H }) }))).toMatchObject({ kind: "wait", why: expect.stringContaining("human reviews and merges") });
  });
});
