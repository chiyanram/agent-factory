import { describe, expect, it } from "vitest";
import {
  backoffMs,
  EMPTY,
  summarize,
  type Event,
  type Summary,
  type WriterMode,
} from "../src/core/dispatch/records.js";
import type { Evidence } from "../src/core/report.js";
import { NO_CAPS } from "../src/core/dispatch/caps.js";
import {
  decide,
  inFlight,
  MAX_CI_ROUNDS,
  MAX_CONFLICT_RUNS,
  MAX_READY_FAILURES,
  MAX_REVIEW_ROUNDS,
  type Action,
  type TicketState,
  MAX_UNREAD_PASSES,
} from "../src/core/dispatch/table.js";
import { LANES, nextStep, whoseTurn, type Lane, type NextStep } from "../src/core/dispatch/next-step.js";
import type { OpenLine } from "../src/core/poll.js";

const H = "1".repeat(40);
const APPROVED_AT = "2026-11-07T08:00:00Z";
const NOW = Date.parse("2026-11-07T10:00:00Z");

function line(over: Partial<OpenLine> = {}): OpenLine {
  return {
    kind: "open",
    number: 12,
    branch: "factory/PROJ-1",
    fork: false,
    lastNoteAt: "",
    head: H,
    draft: true,
    claimed: true,
    pipeline: { kind: "success" },
    needsHuman: false,
    stop: { kind: "none" },
    asks: 0,
    mergeable: "clean",
    ...over,
  };
}

const wrote = (over: Partial<Summary> = {}): Summary => ({
  ...EMPTY,
  lastWriter: { kind: "ended", mode: "cleanup", head: H, outcome: "done", patch: "p1", evidence: [] },
  lastAt: "2026-11-07T09:50:00Z",
  ...over,
});
const fixDone = { kind: "ended", mode: "fix", head: H, outcome: "done", patch: "p1", evidence: [] } as const;
const readyOk: Partial<Summary> = {
  lastReady: { kind: "ended", at: "2026-11-07T09:55:00Z", human: false, head: H, passed: true, why: "x" },
};
const reviewed = (actOn: number, rounds = 1): Partial<Summary> => ({
  ...readyOk,
  lastReview: { kind: "ended", head: H, actOn },
  reviewRounds: rounds,
});

function state(over: Partial<TicketState> = {}): TicketState {
  return {
    ticket: "PROJ-1",
    gate: "forge-ci",
    approval: { kind: "approved", at: APPROVED_AT, lane: "feature", testFirst: false },
    change: { kind: "open", line: line() },
    runs: wrote({ ...reviewed(0) }),
    now: NOW,
    quietMinutes: 30,
    waiver: { kind: "none" },
    caps: NO_CAPS,
    design: { kind: "off" },
    ...over,
  };
}

describe("decide: one row each", () => {
  it("a merged change that is still claimed is reconciled", () => {
    expect(
      decide(
        state({
          change: { kind: "merged", line: { kind: "merged", number: 12, branch: "factory/PROJ-1", fork: false } },
        }),
      ),
    ).toEqual({ kind: "reconcile" });
  });

  it("needs-human on the change: a person decides, nothing runs", () => {
    expect(decide(state({ change: { kind: "open", line: line({ needsHuman: true }) } }))).toMatchObject({
      kind: "wait",
    });
  });

  it("a run that started and never ended is handed to a person (a restart in the middle loses nothing)", () => {
    const runs = wrote({ interrupted: { kind: "interrupted", phase: "writer", at: "2026-11-07T09:00:00Z" } });
    expect(decide(state({ runs }))).toMatchObject({ kind: "needs-human", why: expect.stringContaining("never ended") });
  });

  it("no approval or a stale one: a claim is released, an unclaimed change waits", () => {
    expect(decide(state({ approval: { kind: "stale", started: true } }))).toMatchObject({
      kind: "release",
      why: expect.stringContaining("changed after"),
    });
    expect(
      decide(state({ approval: { kind: "missing" }, change: { kind: "open", line: line({ claimed: false }) } })),
    ).toMatchObject({ kind: "wait" });
    expect(decide(state({ approval: { kind: "missing" }, change: { kind: "none" } }))).toMatchObject({ kind: "wait" });
  });

  it("a maintainer's /stop newer than the approval holds the change; an older one does not; an undated one does", () => {
    expect(
      decide(
        state({ change: { kind: "open", line: line({ stop: { kind: "stopped", at: "2026-11-07T09:00:00.000Z" } }) } }),
      ),
    ).toMatchObject({ kind: "wait", why: expect.stringContaining("/stop") });
    expect(
      decide(
        state({ change: { kind: "open", line: line({ stop: { kind: "stopped", at: "2026-11-07T07:00:00.000Z" } }) } }),
      ),
    ).toMatchObject({ kind: "ping" });
    expect(decide(state({ change: { kind: "open", line: line({ stop: { kind: "undated" } }) } }))).toMatchObject({
      kind: "wait",
    });
  });

  it("an open question waits, and the claim is released once the change has been quiet too long", () => {
    expect(
      decide(state({ change: { kind: "open", line: line({ asks: 1, lastNoteAt: "2026-11-07T09:55:00Z" }) } })),
    ).toMatchObject({ kind: "wait", why: expect.stringContaining("question") });
    const quiet = wrote({ lastAt: "2026-11-07T09:00:00Z" });
    expect(decide(state({ runs: quiet, change: { kind: "open", line: line({ asks: 1 }) } }))).toMatchObject({
      kind: "release",
      why: expect.stringContaining("30 minutes"),
    });
  });

  it("any wait on a claimed change releases the claim once the change is quiet: a person's push, a /stop, CI", () => {
    const quiet = wrote({ ...reviewed(0), lastAt: "2026-11-05T09:00:00Z" });
    for (const over of [
      { head: "2".repeat(40) },
      { pipeline: { kind: "running" } as const },
      { stop: { kind: "undated" } as const },
    ]) {
      expect(
        decide(
          state({
            runs: quiet,
            approval: { kind: "approved", at: "2026-11-05T08:00:00Z", lane: "feature", testFirst: false },
            change: { kind: "open", line: line(over) },
          }),
        ),
      ).toMatchObject({ kind: "release" });
    }
    expect(
      decide(state({ runs: quiet, change: { kind: "open", line: line({ head: "2".repeat(40), claimed: false }) } })),
    ).toMatchObject({ kind: "wait" });
  });

  it("two changes on the ticket's branch go to a person", () => {
    expect(decide(state({ change: { kind: "many", numbers: [12, 15] } }))).toMatchObject({
      kind: "needs-human",
      why: "2 changes use factory/PROJ-1",
    });
  });

  it("a change someone else claimed, with no run of ours, is left alone", () => {
    const busy = { kind: "open", line: line({ lastNoteAt: "2026-11-07T09:55:00Z" }) } as const;
    expect(decide(state({ runs: EMPTY, change: busy }))).toMatchObject({
      kind: "wait",
      wait: "claimed-elsewhere",
      why: "claimed, but not by this dispatcher",
    });
    expect(decide(state({ runs: EMPTY }))).toMatchObject({
      kind: "release",
      why: expect.stringContaining("not by this dispatcher"),
    });
  });

  it("a stop handed to a person once is not handed over again; approving again is the way on", () => {
    const runs = wrote({ lastWriter: fixDone, previousPatch: "p1", blocked: ["the writer made the same patch twice"] });
    expect(decide(state({ runs }))).toMatchObject({ kind: "wait", why: expect.stringContaining("approve again") });
  });

  it("a pipeline state the factory does not know goes to a person", () => {
    expect(
      decide(state({ change: { kind: "open", line: line({ pipeline: { kind: "unknown", raw: "WEIRD" } }) } })),
    ).toMatchObject({ kind: "needs-human", why: expect.stringContaining("WEIRD") });
  });

  it("approved with no run yet starts the writer; a bug starts the test-first writer first, then the fix", () => {
    expect(decide(state({ change: { kind: "none" }, runs: EMPTY }))).toEqual({
      kind: "writer",
      task: { kind: "fix" },
      why: "approved; no run yet",
    });
    const bug = { kind: "approved", at: APPROVED_AT, lane: "bug", testFirst: true } as const;
    expect(decide(state({ approval: bug, change: { kind: "none" }, runs: EMPTY }))).toMatchObject({
      kind: "writer",
      task: { kind: "test-first" },
    });
    const testIn = wrote({
      lastWriter: { kind: "ended", mode: "test-first", head: H, outcome: "done", patch: "t1", evidence: [] },
    });
    expect(decide(state({ approval: bug, runs: testIn }))).toMatchObject({ kind: "writer", task: { kind: "fix" } });
  });

  it("the writer again once a person answered its question, or removed needs-human after it was blocked", () => {
    expect(
      decide(
        state({
          runs: wrote({
            lastWriter: { kind: "ended", mode: "fix", head: H, outcome: "asked", patch: "p1", evidence: [] },
          }),
        }),
      ),
    ).toMatchObject({ kind: "writer", why: "the question was answered" });
    expect(
      decide(
        state({
          runs: wrote({
            lastWriter: { kind: "ended", mode: "fix", head: H, outcome: "blocked", patch: "p1", evidence: [] },
          }),
        }),
      ),
    ).toMatchObject({ kind: "writer", why: "a person removed needs-human" });
  });

  it("the answers ride on every run until one finishes done: an answered run that is blocked loses none (#486)", () => {
    const answers = [{ question: 1, choice: "A", text: "", asked: "which store?", chosen: "a file" }];
    const change = { kind: "open", line: line({ answers }) } as const;
    const ended = (outcome: "asked" | "blocked" | "done") =>
      wrote({ lastWriter: { kind: "ended", mode: "fix", head: H, outcome, patch: "p1", evidence: [] } });
    for (const outcome of ["asked", "blocked"] as const) {
      expect(decide(state({ change, runs: ended(outcome) }))).toMatchObject({
        kind: "writer",
        task: { kind: "fix", answers },
      });
    }
    expect(decide(state({ change, runs: ended("done") }))).not.toMatchObject({ task: { answers } });
  });

  it("a bug-lane test-first run that asked, was answered and ended done hands the answers to the fix run (#486)", () => {
    const answers = [{ question: 1, choice: "A", text: "", asked: "which store?", chosen: "a file" }];
    const bug = { kind: "approved", at: APPROVED_AT, lane: "bug", testFirst: true } as const;
    const testIn = wrote({
      lastWriter: { kind: "ended", mode: "test-first", head: H, outcome: "done", patch: "t1", evidence: [] },
      testFirstDone: true,
    });
    expect(
      decide(state({ approval: bug, change: { kind: "open", line: line({ answers }) }, runs: testIn })),
    ).toMatchObject({
      kind: "writer",
      task: { kind: "fix", answers },
    });
  });

  it("a run that ended with no change open goes to a person, never back to the writer (a closed change)", () => {
    expect(decide(state({ change: { kind: "none" } }))).toMatchObject({
      kind: "needs-human",
      why: expect.stringContaining("no change is open"),
    });
    const blocked = wrote({
      lastWriter: { kind: "ended", mode: "fix", head: H, outcome: "blocked", patch: "p1", evidence: [] },
    });
    expect(decide(state({ change: { kind: "none" }, runs: blocked }))).toMatchObject({ kind: "needs-human" });
  });

  it("test-first follows the lane's testFirst property, never its name (#417)", () => {
    const featureFirst = { kind: "approved", at: APPROVED_AT, lane: "feature", testFirst: true } as const;
    expect(decide(state({ approval: featureFirst, change: { kind: "none" }, runs: EMPTY }))).toMatchObject({
      kind: "writer",
      task: { kind: "test-first" },
    });
    const bugNoTest = { kind: "approved", at: APPROVED_AT, lane: "bug", testFirst: false } as const;
    expect(decide(state({ approval: bugNoTest, change: { kind: "none" }, runs: EMPTY }))).toMatchObject({
      kind: "writer",
      task: { kind: "fix" },
    });
    const tinyFirst = { kind: "started", at: APPROVED_AT, lane: "tiny", testFirst: true } as const;
    expect(decide(state({ approval: tinyFirst, change: { kind: "none" }, runs: EMPTY }))).toMatchObject({
      kind: "writer",
      task: { kind: "test-first" },
    });
  });

  it("a bug's test-first run that asked or was blocked runs as test-first again, never as the fix", () => {
    const bug = { kind: "approved", at: APPROVED_AT, lane: "bug", testFirst: true } as const;
    const asked = wrote({
      lastWriter: { kind: "ended", mode: "test-first", head: H, outcome: "asked", patch: "t", evidence: [] },
    });
    expect(decide(state({ approval: bug, runs: asked }))).toMatchObject({
      kind: "writer",
      task: { kind: "test-first" },
    });
  });

  it("a head that is not the writer's means a person pushed: stand off", () => {
    expect(decide(state({ change: { kind: "open", line: line({ head: "2".repeat(40) }) } }))).toMatchObject({
      kind: "wait",
      why: expect.stringContaining("a person pushed"),
    });
  });

  it("the same patch twice, or a run that changed nothing, goes to a person at once", () => {
    expect(decide(state({ runs: wrote({ lastWriter: fixDone, previousPatch: "p1" }) }))).toMatchObject({
      kind: "needs-human",
      why: expect.stringContaining("same patch"),
    });
    expect(
      decide(
        state({
          runs: wrote({
            lastWriter: { kind: "ended", mode: "fix", head: H, outcome: "done", patch: "", evidence: [] },
          }),
        }),
      ),
    ).toMatchObject({ kind: "needs-human", why: expect.stringContaining("changed nothing") });
    const ciNothing = { kind: "ended", mode: "ci", head: H, outcome: "done", patch: "", evidence: [] } as const;
    expect(decide(state({ runs: wrote({ lastWriter: ciNothing, ciRounds: 1 }) }))).toEqual({
      kind: "needs-human",
      why: "the writer's run changed nothing",
    });
  });

  it("a change that conflicts with its target sends the implementer to merge the default branch in (#103)", () => {
    const conflicting = { kind: "open", line: line({ mergeable: "conflict" }) } as const;
    expect(decide(state({ change: conflicting, runs: wrote() }))).toEqual({
      kind: "writer",
      task: { kind: "conflict", head: H },
      why: expect.stringContaining("merge the default branch in"),
    });
    expect(decide(state({ change: conflicting }))).toMatchObject({ kind: "writer", task: { kind: "conflict" } });
    expect(decide(state({ change: { kind: "open", line: line({ mergeable: "unknown" }) } }))).toEqual({
      kind: "ping",
      head: H,
    });
  });

  it("a change that still conflicts after one merge run goes to a person: 1 failure → needs-human (#103)", () => {
    const merged = wrote({
      lastWriter: { kind: "ended", mode: "rebase", head: H, outcome: "done", patch: "p2", evidence: [] },
      previousPatch: "p1",
    });
    expect(decide(state({ change: { kind: "open", line: line({ mergeable: "conflict" }) }, runs: merged }))).toEqual({
      kind: "needs-human",
      why: expect.stringContaining(`still conflicts with its target after ${MAX_CONFLICT_RUNS} merge run`),
    });
    expect(decide(state({ runs: merged }))).toEqual({ kind: "ready", head: H });
  });

  it("a conflict keeps the order of the rows above it: a person's push, the same patch twice, a question (#103)", () => {
    const at = (over: Partial<OpenLine>) => ({ kind: "open", line: line({ mergeable: "conflict", ...over }) }) as const;
    expect(decide(state({ change: at({ head: "2".repeat(40) }) }))).toMatchObject({
      kind: "wait",
      why: expect.stringContaining("a person pushed"),
    });
    expect(decide(state({ change: at({}), runs: wrote({ lastWriter: fixDone, previousPatch: "p1" }) }))).toMatchObject({
      kind: "needs-human",
      why: expect.stringContaining("same patch"),
    });
    expect(decide(state({ change: at({ asks: 1, lastNoteAt: "2026-11-07T09:55:00Z" }) }))).toMatchObject({
      kind: "wait",
      why: expect.stringContaining("question"),
    });
  });

  it("writer done with no ready check at this head: the ready check", () => {
    expect(decide(state({ runs: wrote() }))).toEqual({ kind: "ready", head: H });
    expect(
      decide(
        state({
          runs: wrote({
            lastReady: {
              kind: "ended",
              at: "2026-11-07T09:55:00Z",
              human: false,
              head: "9".repeat(40),
              passed: true,
              why: "x",
            },
          }),
        }),
      ),
    ).toEqual({ kind: "ready", head: H });
  });

  it("a failed ready check sends the writer back, and stops after 3", () => {
    const failed = {
      lastReady: { kind: "ended", at: "2026-11-07T09:55:00Z", human: false, head: H, passed: false, why: "x" },
    } as const;
    expect(decide(state({ runs: wrote({ ...failed, readyFailures: 1 }) }))).toMatchObject({
      kind: "writer",
      task: { kind: "ready-failed", head: H },
    });
    expect(decide(state({ runs: wrote({ ...failed, readyFailures: MAX_READY_FAILURES }) }))).toMatchObject({
      kind: "needs-human",
      why: expect.stringContaining("3 times"),
    });
  });

  it("a test check stops the change for a person with the hits; a waiver at this head, given after, runs it again", () => {
    const stopped = {
      lastReady: {
        kind: "ended",
        at: "2026-11-07T09:55:00Z",
        human: true,
        head: H,
        passed: false,
        why: "the floor guard: build.gradle changes a judge file",
      },
      readyFailures: 1,
    } as const;
    expect(decide(state({ runs: wrote(stopped) }))).toEqual({
      kind: "needs-human",
      why: `the test checks stopped the change at ${H.slice(0, 8)}: the floor guard: build.gradle changes a judge file`,
    });
    const waived = (head: string, at: string) => state({ runs: wrote(stopped), waiver: { kind: "waived", head, at } });
    expect(decide(waived(H, "2026-11-07T09:58:00Z"))).toEqual({ kind: "ready", head: H });
    expect(decide(waived("9".repeat(40), "2026-11-07T09:58:00Z"))).toMatchObject({ kind: "needs-human" });
    expect(decide(waived(H, "2026-11-07T09:50:00Z"))).toMatchObject({ kind: "needs-human" });
  });

  it("a passed ready check with no review at this head: the reviewer, and no 4th round", () => {
    expect(decide(state({ runs: wrote(readyOk) }))).toEqual({ kind: "review", head: H });
    expect(decide(state({ runs: wrote({ ...readyOk, reviewRounds: MAX_REVIEW_ROUNDS }) }))).toMatchObject({
      kind: "needs-human",
    });
  });

  it("Act on findings send the writer back, and stop after 3 rounds", () => {
    expect(decide(state({ runs: wrote(reviewed(2, 1)) }))).toEqual({
      kind: "writer",
      task: { kind: "act-on", head: H },
      why: "2 Act on finding(s)",
    });
    expect(decide(state({ runs: wrote(reviewed(1, MAX_REVIEW_ROUNDS)) }))).toMatchObject({
      kind: "needs-human",
      why: expect.stringContaining("Act on"),
    });
  });

  it("CI red sends the writer back, and stops after 2 CI rounds", () => {
    const red = { kind: "open", line: line({ pipeline: { kind: "failed" } }) } as const;
    expect(decide(state({ change: red }))).toMatchObject({ kind: "writer", task: { kind: "ci-red", head: H } });
    expect(decide(state({ change: red, runs: wrote({ ...reviewed(0), ciRounds: MAX_CI_ROUNDS }) }))).toMatchObject({
      kind: "needs-human",
      why: expect.stringContaining("CI rounds"),
    });
    expect(decide(state({ change: { kind: "open", line: line({ pipeline: { kind: "canceled" } }) } }))).toMatchObject({
      kind: "writer",
      task: { kind: "ci-red", head: H },
    });
  });

  it("CI running, not there yet, or a manual job: wait", () => {
    for (const kind of ["running", "none", "manual", "skipped"] as const) {
      expect(decide(state({ change: { kind: "open", line: line({ pipeline: { kind } }) } }))).toMatchObject({
        kind: "wait",
      });
    }
  });

  it("a local gate decides from the verifier's own run, never from a check on the forge (#91)", () => {
    const none = { kind: "open", line: line({ pipeline: { kind: "none" } }) } as const;
    expect(decide(state({ gate: "local", change: none }))).toEqual({ kind: "verify", head: H });
    expect(decide(state({ gate: "local" }))).toEqual({ kind: "verify", head: H });
    const old = wrote({ ...reviewed(0), lastVerify: { kind: "ended", head: "9".repeat(40), passed: true } });
    expect(decide(state({ gate: "local", runs: old }))).toEqual({ kind: "verify", head: H });
    const passed = wrote({ ...reviewed(0), lastVerify: { kind: "ended", head: H, passed: true } });
    expect(decide(state({ gate: "local", change: none, runs: passed }))).toEqual({ kind: "ping", head: H });
    const red = { kind: "open", line: line({ pipeline: { kind: "failed" } }) } as const;
    expect(decide(state({ gate: "local", change: red, runs: passed }))).toMatchObject({
      kind: "writer",
      task: { kind: "ci-red", head: H },
    });
    const failed = wrote({ ...reviewed(0), lastVerify: { kind: "ended", head: H, passed: false } });
    expect(decide(state({ gate: "local", runs: failed }))).toEqual({
      kind: "writer",
      task: { kind: "verify-failed", head: H },
      why: "the local verifier failed at this head",
    });
    expect(decide(state({ gate: "local", runs: { ...failed, ciRounds: MAX_CI_ROUNDS } }))).toMatchObject({
      kind: "needs-human",
    });
    expect(decide(state({ change: none }))).toMatchObject({ kind: "wait" });
  });

  it("the writer goes back with the ready check's reason", () => {
    const failed = {
      lastReady: {
        kind: "ended",
        at: "2026-11-07T09:55:00Z",
        human: false,
        head: H,
        passed: false,
        why: "row 1 (AC1): make test exited 2",
      },
    } as const;
    expect(decide(state({ runs: wrote({ ...failed, readyFailures: 1 }) }))).toMatchObject({
      why: "the ready check failed at this head: row 1 (AC1): make test exited 2",
    });
  });

  it("the gate green pings the human once, then waits: never undrafts", () => {
    expect(decide(state())).toEqual({ kind: "ping", head: H });
    expect(decide(state({ runs: wrote({ ...reviewed(0), pingedAt: H }) }))).toMatchObject({
      kind: "wait",
      why: expect.stringContaining("human reviews and merges"),
    });
  });
});

describe("the lane the diff needs: raise only (#230)", () => {
  const READ_AT = "2026-11-07T09:55:00Z";
  const readAs = (lane: "tiny" | "bug" | "feature" | "one-way door", passed = true, human = false) =>
    wrote({
      ...reviewed(0),
      lastReady: { kind: "ended", at: READ_AT, head: H, passed, why: passed ? "" : "row 1", human, lane },
    });
  const RAISED =
    "the lane is raised from tiny to bug (the ready check read the real diff): the coordinator raises the spec's lane, and a human approves it";
  const tinyStart = { kind: "started", at: APPROVED_AT, lane: "tiny", testFirst: false } as const;

  it("a START in the tiny lane whose diff changes code stops for a person, whatever else the check found", () => {
    for (const passed of [true, false]) {
      expect(
        decide(
          state({
            approval: { kind: "started", at: APPROVED_AT, lane: "tiny", testFirst: false },
            runs: readAs("bug", passed),
          }),
        ),
      ).toEqual({
        kind: "needs-human",
        why: "the lane is raised from tiny to bug (the ready check read the real diff): the coordinator raises the spec's lane, and a human approves it",
      });
    }
  });

  it("an approved lane is raised to the one-way door, and never lowered by a lighter diff", () => {
    const bug = { kind: "approved", at: APPROVED_AT, lane: "bug", testFirst: true } as const;
    expect(decide(state({ approval: bug, runs: readAs("one-way door") }))).toMatchObject({
      kind: "needs-human",
      why: expect.stringContaining("raised from bug to one-way door"),
    });
    expect(decide(state({ runs: readAs("tiny") }))).toEqual(decide(state()));
    expect(decide(state({ runs: readAs("bug") }))).toEqual(decide(state()));
  });

  it("a lane read at an older head does not stop the new one", () => {
    const old = wrote({
      lastReady: {
        kind: "ended",
        at: "2026-11-07T09:55:00Z",
        head: "9".repeat(40),
        passed: true,
        why: "",
        human: false,
        lane: "one-way door",
      },
    });
    expect(decide(state({ runs: old }))).toEqual({ kind: "ready", head: H });
  });

  it("a lane raise and a test check's stop at the same check go to a person in one note that names both (#231)", () => {
    expect(decide(state({ approval: tinyStart, runs: readAs("bug", false, true) }))).toEqual({
      kind: "needs-human",
      why: `${RAISED}; and the test checks stopped the change at ${H.slice(0, 8)}: row 1`,
    });
    expect(decide(state({ runs: readAs("bug", false, true) }))).toEqual({
      kind: "needs-human",
      why: `the test checks stopped the change at ${H.slice(0, 8)}: row 1`,
    });
  });

  it("a waiver lifts the test checks' stop, never the lane raise", () => {
    const waiver = { kind: "waived", head: H, at: "2026-11-07T09:58:00Z" } as const;
    expect(decide(state({ approval: tinyStart, waiver, runs: readAs("bug", false, true) }))).toEqual({
      kind: "needs-human",
      why: RAISED,
    });
    expect(decide(state({ waiver, runs: readAs("bug", false, true) }))).toEqual({ kind: "ready", head: H });
  });
});

describe("backoff (#228)", () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString();
  const failedReady = (nextTry: Summary["nextTry"], readyFailures = 1): Summary =>
    wrote({
      lastReady: { kind: "ended", at: "2026-11-07T09:55:00Z", human: false, head: H, passed: false, why: "row 1" },
      readyFailures,
      nextTry,
    });

  it("waits 10 s after the first failure, doubling each time, never more than 5 minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs)).toEqual([
      10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000,
    ]);
  });

  it("skips the writer's retry of a failed step until its next try, then runs it", () => {
    const runs = failedReady({ kind: "set", step: "ready", at: at(10_000) });
    expect(decide(state({ runs }))).toMatchObject({
      kind: "wait",
      wait: "retry",
      why: expect.stringContaining(`the ready check failed; the next try is at ${at(10_000)}`),
    });
    expect(decide(state({ runs, now: NOW + 10_000 }))).toMatchObject({
      kind: "writer",
      task: { kind: "ready-failed" },
    });
  });

  it("backs off a review with Act on findings and a failed local verifier, each by its own step", () => {
    const review = wrote({ ...reviewed(2), nextTry: { kind: "set", step: "review", at: at(20_000) } });
    expect(decide(state({ runs: review }))).toMatchObject({ kind: "wait" });
    expect(decide(state({ runs: review, now: NOW + 20_000 }))).toMatchObject({ kind: "writer" });
    const verify = wrote({
      ...reviewed(0),
      lastVerify: { kind: "ended", head: H, passed: false },
      nextTry: { kind: "set", step: "verify", at: at(10_000) },
    });
    expect(decide(state({ gate: "local", runs: verify }))).toMatchObject({ kind: "wait" });
    const other = wrote({ ...reviewed(2), nextTry: { kind: "set", step: "ready", at: at(60_000) } });
    expect(decide(state({ runs: other }))).toMatchObject({ kind: "writer" });
  });

  it("keeps the caps: a step that is out of tries goes to a person, whatever its next try", () => {
    const runs = failedReady({ kind: "set", step: "ready", at: at(60_000) }, MAX_READY_FAILURES);
    expect(decide(state({ runs }))).toMatchObject({ kind: "needs-human" });
  });
});

describe("the design review before the approval, and no cleanup run after the implementer (#236)", () => {
  const SPEC_H = "a".repeat(64);
  const unapproved = { kind: "unapproved", lane: "feature" } as const;
  const before = { approval: unapproved, change: { kind: "none" }, runs: EMPTY } as const;

  it.each([
    {
      design: {
        kind: "stopped",
        step: "review",
        why: "a cite in the spec or design does not hold: src/a.ts:9 names no `x`",
      },
      does: "reads the design run's log, or edits the spec or design, which reviews it afresh",
    },
    {
      design: {
        kind: "held",
        wait: "lane-check-failed",
        why: "the lane check failed, so no design review runs: no lanes file",
      },
      does: "reads why the lane check failed, fixes the spec's planned files or the lanes, then the design review runs",
    },
  ] as const)(
    "should give each wait the next step of its kind when the wait comes from a design cite that does not hold or from a failed lane check: $design.kind",
    ({ design, does }) => {
      expect(whoseTurn(decide(state({ ...before, design })))).toEqual({
        lane: "needs-you",
        step: { who: "person", does },
      });
    },
  );

  it("a design review due runs the design-reviewer, then the verify pass, before the approval rule waits", () => {
    expect(decide(state({ ...before, design: { kind: "run", step: "review", spec: SPEC_H } }))).toEqual({
      kind: "design",
      step: "review",
      spec: SPEC_H,
    });
    expect(decide(state({ ...before, design: { kind: "run", step: "verify", spec: SPEC_H } }))).toEqual({
      kind: "design",
      step: "verify",
      spec: SPEC_H,
    });
    expect(decide(state({ ...before, design: { kind: "done" } }))).toEqual({
      kind: "wait",
      wait: "start-only",
      why: "the feature lane needs a human's approval; the ticket has a START only",
    });
  });

  it("a failed design run waits for its next try; one out of tries waits for a person; an early approval waits", () => {
    expect(
      decide(state({ ...before, design: { kind: "later", step: "verify", at: "2026-11-07T10:00:20.000Z" } })),
    ).toEqual({
      kind: "wait",
      wait: "design-retry",
      why: "the design verify pass failed; the next try is at 2026-11-07T10:00:20.000Z",
    });
    expect(decide(state({ ...before, design: { kind: "stopped", step: "review", why: "failed 3 times" } }))).toEqual({
      kind: "wait",
      wait: "design-failed",
      why: "failed 3 times",
    });
    expect(decide(state({ design: { kind: "early", at: "2026-11-07T09:00:00Z" } }))).toMatchObject({
      kind: "wait",
      why: expect.stringContaining("approve again"),
    });
  });

  it("a design run is a run: a ticket at its cap goes to a person instead", () => {
    const caps = { ...NO_CAPS, ticket: { usd: 1, tokens: "none" } } as const;
    const runs = { ...EMPTY, spent: { usd: 2, tokens: 10 } };
    expect(
      decide(state({ ...before, runs, caps, design: { kind: "run", step: "review", spec: SPEC_H } })),
    ).toMatchObject({ kind: "needs-human" });
  });

  it("a design run that never ended is a failed try, never a person's to check", () => {
    const runs = { ...EMPTY, interrupted: { kind: "interrupted", phase: "design-review", at: APPROVED_AT } } as const;
    expect(decide(state({ ...before, runs, design: { kind: "run", step: "review", spec: SPEC_H } }))).toMatchObject({
      kind: "design",
      step: "review",
    });
  });

  it("the implementer's done run goes straight to the ready check, then the review; no cleanup task is chosen", () => {
    const row = { criterion: "AC-1 it answers 409", command: "npm test", result: "1 passed" };
    const fix = { ...fixDone, evidence: [row] };
    for (const mode of ["fix", "rework", "ci", "rebase"] as const) {
      const lastWriter = { ...fix, mode };
      expect(decide(state({ runs: wrote({ lastWriter }) }))).toEqual({ kind: "ready", head: H });
      expect(decide(state({ runs: wrote({ lastWriter, ...readyOk }) }))).toEqual({ kind: "review", head: H });
    }
    for (const patch of ["", "p2"]) {
      expect(decide(state({ runs: wrote({ lastWriter: { ...fix, mode: "cleanup", patch } }) }))).toEqual({
        kind: "ready",
        head: H,
      });
    }
  });

  it("an older ledger with a cleanup run still reads: the run is the last writer, and leaves the patches alone", () => {
    const row = { criterion: "AC-1 it answers 409", command: "npm test", result: "1 passed" };
    const ended = (at: string, mode: "fix" | "cleanup", patch: string): Event => ({
      at,
      kind: "writer-ended",
      mode,
      head: H,
      outcome: "done",
      reason: "done",
      patch,
      evidence: [row],
      hung: false,
      ...(mode === "cleanup" ? { deferred: ["a guard that hides a failure"] } : {}),
    });
    const events = [ended("2026-11-07T09:10:00Z", "fix", "p1"), ended("2026-11-07T09:20:00Z", "cleanup", "")];
    const runs = summarize({ events, since: APPROVED_AT });
    expect(runs.lastWriter).toMatchObject({ kind: "ended", mode: "cleanup", patch: "" });
    expect(runs.implementerPatch).toBe("p1");
    expect(decide(state({ runs }))).toEqual({ kind: "ready", head: H });
  });

  it("the same patch twice is still caught across a cleanup run, and a cleanup that ended blocked goes back", () => {
    expect(decide(state({ runs: wrote({ lastWriter: fixDone, previousPatch: "p1" }) }))).toMatchObject({
      kind: "needs-human",
      why: expect.stringContaining("same patch"),
    });
    const blocked = wrote({ lastWriter: { ...fixDone, mode: "cleanup", outcome: "blocked" } });
    expect(decide(state({ runs: blocked }))).toMatchObject({ kind: "writer", task: { kind: "fix" } });
  });

  it("the orchestrator loop carries a design run and its backoff, and stops when the review waits on a person (#305)", () => {
    const run = { kind: "run", step: "review", spec: SPEC_H } as const;
    expect(inFlight(state({ ...before, design: run }))).toBe(true);
    expect(
      inFlight(state({ ...before, design: { kind: "later", step: "review", at: "2026-11-07T10:00:20.000Z" } })),
    ).toBe(true);
    expect(inFlight(state({ ...before, design: { kind: "stopped", step: "review", why: "failed 3 times" } }))).toBe(
      false,
    );
    expect(inFlight(state({ ...before, design: { kind: "done" } }))).toBe(false);
  });
});

function parkedAt(until: string): Extract<Summary["parked"], { kind: "parked" }> {
  return {
    kind: "parked",
    phase: "writer",
    at: "2026-11-07T09:30:00Z",
    head: H,
    until,
    said: "You've hit your limit · resets 2pm (UTC)",
    task: { kind: "act-on", head: H },
    repeated: false,
  };
}

describe("a provider's usage limit parks the ticket until its reset", () => {
  it("waits in the factory lane until the reset, with no ping, and carries the ticket on", () => {
    const runs = wrote({ ...reviewed(1), parked: parkedAt("2026-11-07T14:00:00Z") });
    const action = decide(state({ runs }));
    expect(action).toEqual({
      kind: "wait",
      wait: "usage-limit",
      why: "the provider's usage limit lasts until 2026-11-07T14:00:00Z",
    });
    expect(whoseTurn(action)).toMatchObject({ lane: "factory", on: "gate" });
    expect(inFlight(state({ runs }))).toBe(true);
  });

  it("runs the parked step again once the reset has passed, though the parked run moved the head", () => {
    const runs = wrote({ ...reviewed(1), parked: parkedAt("2026-11-07T09:45:00Z") });
    const moved = { kind: "open", line: line({ head: "2".repeat(40) }) } as const;
    expect(decide(state({ runs, change: moved }))).toEqual({
      kind: "writer",
      task: { kind: "act-on", head: H },
      why: "the provider's usage limit reset at 2026-11-07T09:45:00Z",
    });
  });

  it("goes to a person when the reset time is unknown, or the provider refused again at a reset no later", () => {
    const unknown = decide(state({ runs: wrote({ parked: parkedAt("unknown") }) }));
    expect(unknown).toEqual({
      kind: "needs-human",
      why: "the provider's usage limit; its reset time is unknown: You've hit your limit · resets 2pm (UTC)",
    });
    expect(whoseTurn(unknown).lane).toBe("needs-you");
    const again = decide(state({ runs: wrote({ parked: { ...parkedAt("2026-11-07T09:00:00Z"), repeated: true } }) }));
    expect(again).toMatchObject({
      kind: "needs-human",
      why: "the provider refused again after its usage limit reset at 2026-11-07T09:00:00Z: You've hit your limit · resets 2pm (UTC)",
    });
  });

  it("keeps the claim through a park longer than the quiet time, so no release note goes out", () => {
    const runs = wrote({ ...reviewed(1), parked: parkedAt("2026-11-07T14:00:00Z"), lastAt: "2026-11-07T09:00:00Z" });
    expect(decide(state({ runs }))).toEqual({
      kind: "wait",
      wait: "usage-limit",
      why: "the provider's usage limit lasts until 2026-11-07T14:00:00Z",
    });
  });

  it("still waits on needs-human and a /stop first", () => {
    const runs = wrote({ parked: parkedAt("2026-11-07T09:00:00Z") });
    expect(decide(state({ runs, change: { kind: "open", line: line({ needsHuman: true }) } }))).toMatchObject({
      kind: "wait",
    });
    const stopped = { kind: "open", line: line({ stop: { kind: "stopped", at: "2026-11-07T09:40:00Z" } }) } as const;
    expect(decide(state({ runs, change: stopped }))).toMatchObject({ kind: "wait" });
  });
});

describe("inFlight: whether the orchestrator loop carries the ticket on (#305)", () => {
  const merged = {
    kind: "merged",
    line: { kind: "merged", number: 12, branch: "factory/PROJ-1", fork: false },
  } as const;

  it("is in flight with a run due, a ping to send, CI running, or a run backing off", () => {
    expect(inFlight(state({ runs: EMPTY, change: { kind: "none" } }))).toBe(true);
    expect(inFlight(state({ runs: EMPTY }))).toBe(false);
    expect(inFlight(state())).toBe(true);
    const pinged = wrote({ ...reviewed(0), pingedAt: H });
    expect(
      inFlight(state({ runs: pinged, change: { kind: "open", line: line({ pipeline: { kind: "running" } }) } })),
    ).toBe(true);
    expect(
      inFlight(state({ runs: pinged, change: { kind: "open", line: line({ pipeline: { kind: "none" } }) } })),
    ).toBe(true);
    const failedReady = wrote({
      lastReady: { kind: "ended", at: "2026-11-07T09:55:00Z", human: false, head: H, passed: false, why: "red" },
      readyFailures: 1,
      nextTry: { kind: "set", step: "ready", at: "2026-11-07T10:05:00Z" },
    });
    expect(decide(state({ runs: failedReady }))).toMatchObject({ kind: "wait" });
    expect(inFlight(state({ runs: failedReady }))).toBe(true);
  });

  it("is not in flight once finished, asked, at needs-human, or waiting on a person", () => {
    const pinged = wrote({ ...reviewed(0), pingedAt: H });
    expect(inFlight(state({ change: merged }))).toBe(false);
    expect(inFlight(state({ change: { kind: "open", line: line({ asks: 1 }) } }))).toBe(false);
    expect(inFlight(state({ change: { kind: "open", line: line({ needsHuman: true }) } }))).toBe(false);
    expect(inFlight(state({ change: { kind: "none" } }))).toBe(false);
    expect(inFlight(state({ approval: { kind: "stale", started: true } }))).toBe(false);
    expect(inFlight(state({ approval: { kind: "unapproved", lane: "feature" } }))).toBe(false);
    expect(inFlight(state({ approval: { kind: "unstarted" } }))).toBe(false);
    expect(inFlight(state({ approval: { kind: "missing" } }))).toBe(false);
    expect(inFlight(state({ runs: pinged }))).toBe(false);
    expect(
      inFlight(state({ runs: pinged, change: { kind: "open", line: line({ pipeline: { kind: "manual" } }) } })),
    ).toBe(false);
    const blocked = wrote({
      ...reviewed(1, MAX_REVIEW_ROUNDS),
      blocked: [`Act on findings after ${MAX_REVIEW_ROUNDS} review rounds`],
    });
    expect(inFlight(state({ runs: blocked }))).toBe(false);
  });
});

describe("a rework at the same head after a failed ready check (#444)", () => {
  const AC = (n: number, command: string, result = "1"): Evidence => ({
    criterion: `AC-${n}: README.md says it`,
    command,
    result,
  });
  const GREP = [AC(1, 'grep -c "records each factory ticket" README.md')];
  const GATE = [AC(1, "./gradlew check", "I read it by hand: line 3 is the paragraph. The gate still passes.")];
  const BEFORE = ["./gradlew"];
  const AFTER = ["grep", "test", "wc", "ls", "cat", "head", "tail", "git", "./gradlew"];
  const t = (minute: number): string => `2026-11-07T09:${String(minute).padStart(2, "0")}:00Z`;
  const ended = (minute: number, mode: WriterMode, patch: string, evidence: readonly Evidence[]): Event => ({
    at: t(minute),
    kind: "writer-ended",
    mode,
    head: H,
    outcome: "done",
    reason: "done",
    patch,
    evidence,
    hung: false,
  });
  const readyEnded = (minute: number, passed: boolean, programs?: readonly string[]): Event => ({
    at: t(minute),
    kind: "ready-ended",
    reason: "done",
    head: H,
    passed,
    why: passed ? "" : 'row 1 (AC-1): "grep" is not a program a ready check may run (./gradlew)',
    ...(programs === undefined ? {} : { programs }),
    ...(passed ? {} : { nextTry: { step: "ready", at: t(minute) } }),
  });
  const FAILED: readonly Event[] = [
    ended(10, "fix", "p1", GREP),
    ended(20, "cleanup", "", GREP),
    readyEnded(21, false, BEFORE),
  ];
  const runsOf = (events: readonly Event[]): Summary => summarize({ events, since: APPROVED_AT }) satisfies Summary;
  const at = (events: readonly Event[], programs: readonly string[], over: Partial<TicketState> = {}) =>
    state({ runs: runsOf(events), programs, ...over });

  it("ready failed → rework done at the same head with other rows → the ready check runs the new rows, in flight", () => {
    const events = [...FAILED, ended(30, "rework", "", GATE)];
    expect(decide(at(events, BEFORE))).toEqual({ kind: "ready", head: H });
    expect(inFlight(at(events, BEFORE))).toBe(true);
  });

  it("ready failed → the project file allows more programs → the ready check runs again, before any writer run", () => {
    expect(decide(at(FAILED, BEFORE))).toMatchObject({ kind: "writer", task: { kind: "ready-failed" } });
    expect(decide(at(FAILED, AFTER))).toEqual({ kind: "ready", head: H });
    const same = [...FAILED, ended(30, "rework", "", GREP)];
    expect(decide(at(same, AFTER))).toEqual({ kind: "ready", head: H });
  });

  it("ready failed → rework done at the same head, same rows, same programs → needs-human: it changed nothing", () => {
    const same = [...FAILED, ended(30, "rework", "", GREP)];
    expect(decide(at(same, BEFORE))).toEqual({ kind: "needs-human", why: "the writer's run changed nothing" });
    expect(inFlight(at(same, BEFORE))).toBe(false);
  });

  it("the re-run that fails again sends the writer back, and the third failure goes to a person", () => {
    const again = [...FAILED, ended(30, "rework", "", GATE), readyEnded(31, false, AFTER)];
    expect(decide(at(again, AFTER))).toMatchObject({ kind: "writer", task: { kind: "ready-failed", head: H } });
    const third = [...again, ended(40, "rework", "", GREP), readyEnded(41, false, AFTER)];
    expect(decide(at(third, AFTER))).toEqual({
      kind: "needs-human",
      why: `the ready check failed ${MAX_READY_FAILURES} times`,
    });
  });

  it("the re-run that passes goes on to the review, with no cleanup run for a rework that changed no code", () => {
    const passed = [...FAILED, ended(30, "rework", "", GREP), readyEnded(31, true, AFTER)];
    expect(decide(at(passed, AFTER))).toEqual({ kind: "review", head: H });
  });

  it("a ready line older than #444 names no programs: the rows decide, so no check runs again on its own", () => {
    const old = [ended(10, "fix", "p1", GREP), ended(20, "cleanup", "", GREP), readyEnded(21, false)];
    expect(decide(at(old, AFTER))).toMatchObject({ kind: "writer", task: { kind: "ready-failed" } });
    expect(decide(at([...old, ended(30, "rework", "", GATE)], AFTER))).toEqual({ kind: "ready", head: H });
  });

  it("a new START → the fix run changes no code but gives rows → the ready check judges them, in flight", () => {
    const blocked: Event = { at: t(41), kind: "blocked", why: `the ready check failed ${MAX_READY_FAILURES} times` };
    const quoted = [AC(1, "grep -n 'records each factory ticket' README.md", "3:ledger records each factory ticket")];
    const events = [...FAILED, ended(30, "rework", "", GATE), blocked, ended(50, "fix", "", quoted)];
    const restart = { kind: "approved" as const, at: t(45), lane: "tiny" as const, testFirst: false };
    const fresh = state({ runs: summarize({ events, since: restart.at }), approval: restart, programs: AFTER });
    expect(decide(fresh)).toEqual({ kind: "ready", head: H });
    expect(inFlight(fresh)).toBe(true);
    const empty = [...events.slice(0, -1), ended(50, "fix", "", [])];
    const none = state({ runs: summarize({ events: empty, since: restart.at }), approval: restart, programs: AFTER });
    expect(decide(none)).toEqual({ kind: "needs-human", why: "the writer's run changed nothing" });
  });

  it("a person clears the hold: with the label gone the ticket goes on; a stop already handed over waits for a new START", () => {
    const blocked: Event = { at: t(31), kind: "blocked", why: "the writer's run changed nothing" };
    const ledger = [...FAILED, ended(30, "rework", "", GATE), blocked];
    const labelled = { change: { kind: "open" as const, line: line({ needsHuman: true, claimed: false }) } };
    const cleared = { change: { kind: "open" as const, line: line({ claimed: false }) } };
    expect(decide(at(ledger, AFTER, labelled))).toMatchObject({
      kind: "wait",
      why: expect.stringContaining("needs-human"),
    });
    expect(decide(at(ledger, AFTER, cleared))).toEqual({ kind: "ready", head: H });
    expect(inFlight(at(ledger, AFTER, cleared))).toBe(true);
    const same = [...FAILED, ended(30, "rework", "", GREP), blocked];
    expect(decide(at(same, BEFORE, cleared))).toMatchObject({
      kind: "wait",
      wait: "handed-over",
      why: expect.stringContaining("handed to a person earlier: the writer's run changed nothing; START again"),
    });
    const restarted = { kind: "approved" as const, at: t(45), lane: "feature" as const, testFirst: false };
    const fresh = state({ runs: summarize({ events: same, since: restarted.at }), approval: restarted, ...cleared });
    expect(decide(fresh)).toMatchObject({ kind: "writer", task: { kind: "fix" } });
    expect(inFlight(fresh)).toBe(true);
  });
});

const NOTICE: Partial<Record<Action["kind"], Lane>> = { ping: "ready-to-merge", "design-note": "needs-you" };
const BY_WHO: Readonly<Record<NextStep["who"], Lane>> = { factory: "factory", person: "needs-you" };

function laneOf(action: Action, step: NextStep): Lane {
  return NOTICE[action.kind] ?? (step.does === "reviews and merges the change" ? "ready-to-merge" : BY_WHO[step.who]);
}

describe("can it get stuck? (#485)", () => {
  const lines: readonly OpenLine[] = [
    line(),
    line({ pipeline: { kind: "failed" } }),
    line({ pipeline: { kind: "running" } }),
    line({ pipeline: { kind: "none" } }),
    line({ pipeline: { kind: "manual" } }),
    line({ pipeline: { kind: "skipped" } }),
    line({ pipeline: { kind: "canceled" } }),
    line({ pipeline: { kind: "unknown", raw: "weird" } }),
    line({ needsHuman: true }),
    line({ mergeable: "conflict" }),
    line({ head: "2".repeat(40) }),
    line({ asks: 1 }),
    line({ stop: { kind: "stopped", at: "2026-11-07T09:30:00Z" } }),
    line({ claimed: false }),
  ];
  const runs: readonly Summary[] = [
    EMPTY,
    wrote(),
    wrote({ ...readyOk }),
    wrote({ ...reviewed(0) }),
    wrote({ ...reviewed(2) }),
    wrote({ ...reviewed(2, MAX_REVIEW_ROUNDS) }),
    wrote({ ciRounds: MAX_CI_ROUNDS, ...reviewed(0) }),
    wrote({
      readyFailures: MAX_READY_FAILURES,
      lastReady: { kind: "ended", at: "2026-11-07T09:55:00Z", human: false, head: H, passed: false, why: "x" },
    }),
    { ...EMPTY, lastWriter: fixDone },
    { ...EMPTY, interrupted: { kind: "interrupted", phase: "writer", at: "2026-11-07T09:00:00Z" } },
    wrote({ parked: parkedAt("2026-11-07T14:00:00Z") }),
    wrote({ parked: parkedAt("2026-11-07T09:00:00Z") }),
    wrote({ parked: parkedAt("unknown") }),
    wrote({ parked: { ...parkedAt("2026-11-07T09:00:00Z"), repeated: true } }),
  ];
  const approvals: readonly TicketState["approval"][] = [
    { kind: "approved", at: APPROVED_AT, lane: "feature", testFirst: false },
    { kind: "started", at: APPROVED_AT, lane: "tiny", testFirst: false },
    { kind: "stale", started: true },
    { kind: "missing" },
    { kind: "unapproved", lane: "feature" },
    { kind: "unwritten" },
    { kind: "raised", from: "tiny", to: "feature", why: "a planned file needs it" },
  ];
  const designs: readonly TicketState["design"][] = [
    { kind: "off" },
    { kind: "run", step: "review", spec: "a".repeat(64) },
    { kind: "later", step: "verify", at: "2026-11-07T11:00:00Z" },
    {
      kind: "stopped",
      step: "review",
      why: "the design review failed 3 times at this spec and design; a person looks",
    },
    { kind: "early", at: "2026-11-07T09:00:00Z" },
    {
      kind: "note",
      spec: "a".repeat(64),
      why: "no further design review (round cap): the person decides",
    },
    {
      kind: "held",
      wait: "lane-raised",
      why: "the lane is raised from feature to one-way door (db/V2.sql is under a one-way-door path): x",
    },
  ];
  const opened = approvals.flatMap((approval) =>
    lines.flatMap((l) =>
      runs.flatMap((r) =>
        designs.map((design) => state({ approval, change: { kind: "open", line: l }, runs: r, design })),
      ),
    ),
  );
  const merged = approvals.flatMap((approval) => [
    state({
      approval,
      change: { kind: "merged", line: { kind: "merged", number: 12, branch: "factory/PROJ-1", fork: false } },
    }),
    state({ approval, change: { kind: "none" }, runs: wrote() }),
  ]);
  const blockers: readonly NonNullable<TicketState["blockers"]>[] = [
    { kind: "waiting", on: [{ ticket: "PROJ-0", state: "opened" }] },
    { kind: "waiting", on: [{ ticket: "12", state: "none" }] },
    { kind: "broken", why: "blocked by 12, closed, no merge seen" },
    { kind: "unread", why: "12: github: 502" },
  ];
  const held = approvals.flatMap((approval) =>
    blockers.flatMap((b) =>
      [EMPTY, wrote(), { ...EMPTY, heldWhy: "x" }, { ...EMPTY, unreadPasses: 2, unreadFirst: "y" }].map((r) =>
        state({ approval, change: { kind: "none" }, runs: r, blockers: b }),
      ),
    ),
  );
  const all = [...opened, ...merged, ...held];

  it("each state is carried on, or hands the ticket to a person with a named next step", () => {
    const stuck = all.filter((s) => {
      const step = nextStep(decide(s));
      return step === undefined || (!inFlight(s) && step.who === "person" && step.does.trim() === "");
    });
    expect(all.length).toBeGreaterThan(2000);
    expect(stuck.map((s) => [s.approval.kind, s.change.kind, s.design.kind, decide(s)])).toEqual([]);
  });

  it("gives every state exactly one lane, from its next step, and reaches each lane (#671)", () => {
    const reached = new Set<Lane>();
    const off = all.flatMap((s) => {
      const action = decide(s);
      const turn = whoseTurn(action);
      reached.add(turn.lane);
      const expected = laneOf(action, nextStep(action) ?? { who: "person", does: "" });
      return LANES.filter((l) => l === turn.lane).length === 1 && turn.lane === expected ? [] : [[action, turn]];
    });
    expect(off).toEqual([]);
    expect([...reached].toSorted()).toEqual([...LANES].toSorted());
  });

  it("says whether a factory turn waits on a run or the gate (#671)", () => {
    expect(whoseTurn({ kind: "review", head: H })).toMatchObject({ lane: "factory", on: "run" });
    expect(whoseTurn({ kind: "wait", wait: "ci", why: "CI is running at this head" })).toMatchObject({
      lane: "factory",
      on: "gate",
    });
    expect(whoseTurn({ kind: "held", why: "blocked by PROJ-0", ping: true })).toMatchObject({
      lane: "factory",
      on: "gate",
    });
    expect(whoseTurn({ kind: "ping", head: H })).toEqual({
      lane: "ready-to-merge",
      step: { who: "person", does: "reviews and merges the change" },
    });
  });

  it("names what the person does for a pushed head and a change someone else claimed", () => {
    expect(
      nextStep({ kind: "wait", wait: "head-moved", why: "the head is not the writer's: a person pushed; stand off" }),
    ).toEqual({
      who: "person",
      does: "the person who pushed finishes, then STARTs the ticket again (tiny) or approves its spec again: agent-factory start | approve",
    });
    expect(
      nextStep({
        kind: "release",
        wait: "claimed-elsewhere",
        why: "quiet for over 30 minutes: claimed, but not by this dispatcher",
      }),
    ).toEqual({
      who: "person",
      does: "whoever claimed it finishes it, or gives it back by removing the claim label on the git host",
    });
    const unanswered =
      "the git host did not answer for the ticket's blockers on 3 passes in a row since t: PROJ-0: 502";
    expect(nextStep({ kind: "needs-human", why: unanswered })).toEqual({
      who: "person",
      does: "checks the git host's login and the tickets the spec is blocked by; the ticket goes on by itself once the git host answers",
    });
  });
});

describe("blocked by (#494)", () => {
  const unbuilt = { runs: EMPTY, change: { kind: "none" } } as const;

  it("AC-2, AC-3: a held ticket waits on its blockers, and starts once the last one merges", () => {
    const waiting = { kind: "waiting", on: [{ ticket: "PROJ-0", state: "opened" }] } as const;
    const why = "blocked by PROJ-0 (open, not merged): the build starts once each is merged";
    expect(decide(state({ ...unbuilt, blockers: waiting }))).toEqual({ kind: "held", why, ping: true });
    const told = { ...unbuilt, runs: { ...EMPTY, heldWhy: why } };
    expect(decide(state({ ...told, blockers: waiting }))).toEqual({ kind: "wait", wait: "blocked", why });
    expect(decide(state({ ...unbuilt, blockers: { kind: "none" } }))).toMatchObject({ kind: "writer" });
  });

  it("AC-10: a change in what it waits on tells the person again; a hold recorded again after unread passes does not", () => {
    const waiting = { kind: "waiting", on: [{ ticket: "PROJ-0", state: "opened" }] } as const;
    const was = { ...EMPTY, heldWhy: "blocked by PROJ-0 (not started): the build starts once each is merged" };
    expect(decide(state({ ...unbuilt, runs: was, blockers: waiting }))).toMatchObject({ kind: "held", ping: true });
    const why = "blocked by PROJ-0 (open, not merged): the build starts once each is merged";
    const afterUnread = { ...EMPTY, heldWhy: why, unreadPasses: 1, unreadFirst: "x" };
    expect(decide(state({ ...unbuilt, runs: afterUnread, blockers: waiting }))).toEqual({
      kind: "held",
      why,
      ping: false,
    });
  });

  it("a held ticket and one counting unread passes are in flight: the loop goes on, so the count builds", () => {
    const waiting = { kind: "waiting", on: [{ ticket: "PROJ-0", state: "opened" }] } as const;
    expect(inFlight(state({ ...unbuilt, blockers: waiting }))).toBe(true);
    const unread = { kind: "unread", why: "PROJ-0: github: 502" } as const;
    expect(inFlight(state({ ...unbuilt, blockers: unread }))).toBe(true);
  });

  it("AC-7: an unread blocker is counted, and on the third pass in a row goes to a person with the first error", () => {
    const unread = { kind: "unread", why: "PROJ-0: github: 504" } as const;
    expect(decide(state({ ...unbuilt, blockers: unread }))).toEqual({ kind: "blockers-unread", why: unread.why });
    const twice = { ...EMPTY, unreadPasses: MAX_UNREAD_PASSES - 1, unreadFirst: "PROJ-0: github: 502" };
    expect(decide(state({ ...unbuilt, runs: twice, blockers: unread }))).toEqual({
      kind: "needs-human",
      why: "the git host did not answer for the ticket's blockers on 3 passes in a row: PROJ-0: github: 502",
    });
  });

  it("AC-4, AC-5: a blocker closed with no merge, or a cycle, goes to a person", () => {
    const broken = { kind: "broken", why: "blocked by PROJ-0, closed without a merge" } as const;
    expect(decide(state({ ...unbuilt, blockers: broken }))).toEqual({ kind: "needs-human", why: broken.why });
  });

  it("AC-6: holds only a ticket whose build has not begun", () => {
    const waiting = { kind: "waiting", on: [{ ticket: "PROJ-0", state: "opened" }] } as const;
    expect(decide(state({ blockers: waiting })).kind).not.toBe("wait");
    const opened = { kind: "open", line: line({ claimed: false }) } as const;
    expect(decide(state({ runs: EMPTY, change: opened, blockers: waiting }))).not.toMatchObject({
      kind: "wait",
      why: expect.stringContaining("blocked by"),
    });
  });
});
