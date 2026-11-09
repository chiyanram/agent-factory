import { describe, expect, it } from "vitest";
import { backoffMs, EMPTY, type Summary } from "../src/core/dispatch/records.js";
import { NO_CAPS } from "../src/core/dispatch/caps.js";
import {
  decide,
  MAX_CI_ROUNDS,
  MAX_CONFLICT_RUNS,
  MAX_READY_FAILURES,
  MAX_REVIEW_ROUNDS,
  type TicketState,
} from "../src/core/dispatch/table.js";
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
  lastWriter: { kind: "ended", mode: "fix", head: H, outcome: "done", patch: "p1", evidence: [] },
  lastAt: "2026-11-07T09:50:00Z",
  ...over,
});
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
    approval: { kind: "approved", at: APPROVED_AT, lane: "feature" },
    change: { kind: "open", line: line() },
    runs: wrote({ ...reviewed(0) }),
    now: NOW,
    quietMinutes: 30,
    waiver: { kind: "none" },
    caps: NO_CAPS,
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
    expect(decide(state({ approval: { kind: "stale" } }))).toMatchObject({
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
            approval: { kind: "approved", at: "2026-11-05T08:00:00Z", lane: "feature" },
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
      why: "claimed, but not by this dispatcher",
    });
    expect(decide(state({ runs: EMPTY }))).toMatchObject({
      kind: "release",
      why: expect.stringContaining("not by this dispatcher"),
    });
  });

  it("a stop handed to a person once is not handed over again; approving again is the way on", () => {
    const runs = wrote({ previousPatch: "p1", blocked: ["the writer made the same patch twice"] });
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
    const bug = { kind: "approved", at: APPROVED_AT, lane: "bug" } as const;
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

  it("a bug's test-first run that asked or was blocked runs as test-first again, never as the fix", () => {
    const bug = { kind: "approved", at: APPROVED_AT, lane: "bug" } as const;
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
    expect(decide(state({ runs: wrote({ previousPatch: "p1" }) }))).toMatchObject({
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
  });

  it("a change that conflicts with its target sends the implementer to merge the default branch in (#103)", () => {
    const conflicting = { kind: "open", line: line({ mergeable: "conflict" }) } as const;
    // after any run but a merge run, and before the ready check, the review or the gate: they read a change that
    // cannot merge
    expect(decide(state({ change: conflicting, runs: wrote() }))).toEqual({
      kind: "writer",
      task: { kind: "conflict", head: H },
      why: expect.stringContaining("merge the default branch in"),
    });
    expect(decide(state({ change: conflicting }))).toMatchObject({ kind: "writer", task: { kind: "conflict" } });
    // a git host that has not checked yet, or a clean change, has no row of its own
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
    // a merge run that cleared the conflict goes on: the ready check at its new head
    expect(decide(state({ runs: merged }))).toEqual({ kind: "ready", head: H });
  });

  it("a conflict keeps the order of the rows above it: a person's push, the same patch twice, a question (#103)", () => {
    const at = (over: Partial<OpenLine>) => ({ kind: "open", line: line({ mergeable: "conflict", ...over }) }) as const;
    expect(decide(state({ change: at({ head: "2".repeat(40) }) }))).toMatchObject({
      kind: "wait",
      why: expect.stringContaining("a person pushed"),
    });
    expect(decide(state({ change: at({}), runs: wrote({ previousPatch: "p1" }) }))).toMatchObject({
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
    // a waiver at another head, or one older than the check, does not
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
    // no verifier run at this head: run it, even when some other check on the forge is green
    expect(decide(state({ gate: "local", change: none }))).toEqual({ kind: "verify", head: H });
    expect(decide(state({ gate: "local" }))).toEqual({ kind: "verify", head: H });
    // a new push: the verifier's run was at another head
    const old = wrote({ ...reviewed(0), lastVerify: { kind: "ended", head: "9".repeat(40), passed: true } });
    expect(decide(state({ gate: "local", runs: old }))).toEqual({ kind: "verify", head: H });
    // passed here: ping, whatever the forge shows, unless a check on it is red
    const passed = wrote({ ...reviewed(0), lastVerify: { kind: "ended", head: H, passed: true } });
    expect(decide(state({ gate: "local", change: none, runs: passed }))).toEqual({ kind: "ping", head: H });
    const red = { kind: "open", line: line({ pipeline: { kind: "failed" } }) } as const;
    expect(decide(state({ gate: "local", change: red, runs: passed }))).toMatchObject({
      kind: "writer",
      task: { kind: "ci-red", head: H },
    });
    // failed here: the writer goes back, and after 2 CI rounds a person decides
    const failed = wrote({ ...reviewed(0), lastVerify: { kind: "ended", head: H, passed: false } });
    expect(decide(state({ gate: "local", runs: failed }))).toEqual({
      kind: "writer",
      task: { kind: "verify-failed", head: H },
      why: "the local verifier failed at this head",
    });
    expect(decide(state({ gate: "local", runs: { ...failed, ciRounds: MAX_CI_ROUNDS } }))).toMatchObject({
      kind: "needs-human",
    });
    // with forge CI as the gate, no CI result yet is a wait, never the verifier
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
  const tinyStart = { kind: "started", at: APPROVED_AT, lane: "tiny" } as const;

  it("a START in the tiny lane whose diff changes code stops for a person, whatever else the check found", () => {
    for (const passed of [true, false]) {
      expect(
        decide(state({ approval: { kind: "started", at: APPROVED_AT, lane: "tiny" }, runs: readAs("bug", passed) })),
      ).toEqual({
        kind: "needs-human",
        why: "the lane is raised from tiny to bug (the ready check read the real diff): the coordinator raises the spec's lane, and a human approves it",
      });
    }
  });

  it("an approved lane is raised to the one-way door, and never lowered by a lighter diff", () => {
    const bug = { kind: "approved", at: APPROVED_AT, lane: "bug" } as const;
    expect(decide(state({ approval: bug, runs: readAs("one-way door") }))).toMatchObject({
      kind: "needs-human",
      why: expect.stringContaining("raised from bug to one-way door"),
    });
    // a feature whose diff only needs tiny or bug keeps its lane and goes on
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
    // a test check's stop alone keeps its own note
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
    // another step's next try holds nothing back
    const other = wrote({ ...reviewed(2), nextTry: { kind: "set", step: "ready", at: at(60_000) } });
    expect(decide(state({ runs: other }))).toMatchObject({ kind: "writer" });
  });

  it("keeps the caps: a step that is out of tries goes to a person, whatever its next try", () => {
    const runs = failedReady({ kind: "set", step: "ready", at: at(60_000) }, MAX_READY_FAILURES);
    expect(decide(state({ runs }))).toMatchObject({ kind: "needs-human" });
  });
});
