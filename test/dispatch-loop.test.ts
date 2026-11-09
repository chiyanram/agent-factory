import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { approve } from "../src/core/approval.js";
import { DEFAULT_LANES } from "../src/core/lane.js";
import { NO_CAPS, type Caps } from "../src/core/dispatch/caps.js";
import { headed } from "../src/core/dispatch/last-poll.js";
import { record } from "../src/core/dispatch/records.js";
import {
  heldBack,
  LOOP_GUARD,
  loopFile,
  MAX_FAILED_PASSES,
  orchestratorLoop,
} from "../src/core/dispatch/orchestrator-loop.js";
import { lock, STEPS_TODAY, type Steps, type TickSetup } from "../src/core/dispatch/tick.js";
import type { Changes, Forge, OpenChange } from "../src/core/forge/types.js";
import { NO_NOTIFY } from "../src/core/notify.js";
import { specHash } from "../src/core/spec.js";
import { start } from "../src/core/start.js";
import { tempDir } from "./temp.js";

const SPEC = [
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
  "feature",
  "",
].join("\n");
const H = "1".repeat(40);
const team = [{ name: "ram", level: "maintainer", bot: false }] as const;

let home = "";
beforeEach(() => {
  home = tempDir("factory-loop-");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

// a ticket a human STARTed and approved: the only way into the loop's ticket list (P8)
async function approved(): Promise<void> {
  const where = { home, project: "ledger", ticket: "PROJ-1" };
  await start({ where, by: "ram", via: "terminal", at: "2026-11-07T07:00:00Z", branch: "absent", confirmed: false });
  mkdirSync(join(home, "specs", "ledger", "PROJ-1"), { recursive: true });
  writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), SPEC);
  const done = await approve({ where, seenHash: specHash(SPEC), by: "ram", at: "2026-11-07T08:00:00Z" });
  expect(done.kind).toBe("approved");
}

const open = (over: Partial<OpenChange> = {}): OpenChange => ({
  number: 12,
  branch: "factory/PROJ-1",
  fork: false,
  head: H,
  draft: true,
  labels: [],
  pipeline: { kind: "running" },
  mergeable: "clean",
  comments: [],
  ...over,
});

const notUsed = async (): Promise<{ readonly kind: "failed"; readonly reason: string }> => ({
  kind: "failed",
  reason: "not used in these tests",
});

// a git host whose changes are what `now()` says at each poll, so a test moves a ticket on between passes
function forge(now: () => Changes | "down"): Forge {
  return {
    name: "github",
    mark: "#",
    me: async () => ({ kind: "ok", value: "ram" }),
    change: notUsed,
    defaultBranch: notUsed,
    branchExists: async () => ({ kind: "ok", value: false }),
    openChange: notUsed,
    notes: notUsed,
    setBody: notUsed,
    lineFinding: notUsed,
    status: notUsed,
    ciConfig: notUsed,
    claimed: notUsed,
    changes: async () => {
      const c = now();
      return c === "down" ? { kind: "failed", reason: "the git host is down" } : { kind: "ok", value: c };
    },
    failedJobs: notUsed,
    addLabel: async () => ({ kind: "ok" }),
    removeLabel: async () => ({ kind: "ok" }),
    note: async () => ({ kind: "ok" }),
  };
}

// a writer that ends with this outcome, and runs counted
function writer(outcome: "done" | "asked", runs: string[]): Steps {
  return {
    ...STEPS_TODAY,
    writer: {
      kind: "available",
      run: async (input) => (
        runs.push(input.ticket), { kind: "ok", value: { head: H, outcome, patch: "p1", evidence: [], hung: false } }
      ),
    },
  };
}

type Loop = { readonly slept: number[]; readonly lines: string[] };

function loopWith(
  changes: () => Changes | "down",
  steps: Steps = STEPS_TODAY,
  caps: Caps = NO_CAPS,
): Loop & { readonly run: () => ReturnType<typeof orchestratorLoop> } {
  const slept: number[] = [];
  const lines: string[] = [];
  const setup: TickSetup = {
    home,
    project: "ledger",
    gate: "forge-ci",
    forge: forge(changes),
    label: "agent::claimed",
    steps,
    now: () => Date.parse("2026-11-07T10:00:00Z"),
    quietMinutes: 30,
    caps,
    pollMinutes: 7,
    repo: "chiyanram/ledger",
    notify: NO_NOTIFY,
    dryRun: false,
    log: (l) => lines.push(l),
    // these tests carry the build: a lanes file may leave the design review out (#236), which has its own tests
    lanes: DEFAULT_LANES.map((l) => ({ name: l.name, approval: l.approval, lenses: l.lenses, designReview: false })),
  };
  const run = () =>
    orchestratorLoop({
      home,
      project: "ledger",
      pollMinutes: 7,
      setup: async () => ({ kind: "ok", value: setup }),
      // the fake clock: a wait returns at once, and is counted
      sleep: async (ms) => {
        slept.push(ms);
      },
      log: (l) => lines.push(l),
      now: () => Date.parse("2026-11-07T10:00:00Z"),
    });
  return { slept, lines, run };
}

describe("the orchestrator loop (#305)", () => {
  it("with no ticket in flight, ends after its first pass, with no wait, and leaves no loop file", async () => {
    const loop = loopWith(() => ({ team, open: [], merged: [] }));
    expect(await loop.run()).toEqual({ kind: "ok", value: { passes: 1, failedActions: false, held: [] } });
    expect(loop.slept).toEqual([]);
    expect(loop.lines).toContain("no ticket is in flight; the orchestrator loop ends");
    expect(existsSync(loopFile(home, "ledger"))).toBe(false);
  });

  it("never opens a ticket: a change on factory/<ticket> with no START or approval is not in flight (P8)", async () => {
    const loop = loopWith(() => ({ team, open: [open()], merged: [] }));
    expect(await loop.run()).toMatchObject({ kind: "ok", value: { passes: 1 } });
    expect(loop.slept).toEqual([]);
  });

  it("waits the poll interval while a run is due, then ends after the pass that sees the change merged", async () => {
    await approved();
    const runs: string[] = [];
    let pass = 0;
    const loop = loopWith(
      () => {
        pass += 1;
        // each pass polls twice: once to act, once to look; the change is merged from the second pass on
        return pass <= 2
          ? { team, open: [open({ labels: ["agent::claimed"] })], merged: [] }
          : {
              team,
              open: [],
              merged: [{ number: 12, branch: "factory/PROJ-1", fork: false }],
            };
      },
      writer("done", runs),
    );
    // the writer ends done, so the ready check is due after the first pass
    const ended = await loop.run();
    expect(ended).toMatchObject({ kind: "ok" });
    expect(loop.slept.every((ms) => ms === 7 * 60_000)).toBe(true);
    expect(loop.slept.length).toBe((ended.kind === "ok" ? ended.value.passes : 0) - 1);
    expect(loop.lines.some((l) => l.startsWith("in flight: PROJ-1; next pass in 7 min"))).toBe(true);
  });

  it("ends after the pass whose writer asked a person", async () => {
    await approved();
    const runs: string[] = [];
    const asked = { body: "[writer] OPEN: which port?", author: { name: "ram" }, at: "2026-11-07T09:30:00Z" };
    const loop = loopWith(
      () => ({ team, open: [open({ comments: runs.length > 0 ? [asked] : [] })], merged: [] }),
      writer("asked", runs),
    );
    expect(await loop.run()).toEqual({ kind: "ok", value: { passes: 1, failedActions: false, held: [] } });
    expect(runs).toEqual(["PROJ-1"]);
    expect(loop.slept).toEqual([]);
  });

  it("ends after the pass that stops the ticket at needs-human, and on a ticket waiting for its approval", async () => {
    await approved();
    const loop = loopWith(() => ({ team, open: [open({ labels: ["needs-human"] })], merged: [] }));
    expect(await loop.run()).toMatchObject({ kind: "ok", value: { passes: 1 } });
    // a spec edited after its approval: the approval is stale, and the ticket waits for a human's approval
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), SPEC.replace("409", "423"));
    const waiting = loopWith(() => ({ team, open: [open()], merged: [] }));
    expect(await waiting.run()).toMatchObject({ kind: "ok", value: { passes: 1 } });
    expect(waiting.slept).toEqual([]);
  });

  it("refuses a second loop for the project while one runs; takes over the file of a loop that died", async () => {
    const held = await lock({ home, project: "ledger", guard: LOOP_GUARD });
    expect(held.kind).toBe("held");
    const loop = loopWith(() => ({ team, open: [], merged: [] }));
    expect(await loop.run()).toEqual({
      kind: "failed",
      reason: `another orchestrator loop (pid ${process.pid}) is running for ledger`,
    });
    expect(loop.lines).toEqual([]);
    if (held.kind === "held") {
      await held.release();
    }
    writeFileSync(loopFile(home, "ledger"), "999999999:dead");
    expect(await loop.run()).toMatchObject({ kind: "ok" });
  });

  it(`tries a failed pass again, and ends after ${MAX_FAILED_PASSES} in a row`, async () => {
    await approved();
    const loop = loopWith(() => "down");
    expect(await loop.run()).toEqual({
      kind: "failed",
      reason: `${MAX_FAILED_PASSES} passes in a row failed; the orchestrator loop ends`,
    });
    expect(loop.slept.length).toBe(MAX_FAILED_PASSES - 1);
    expect(existsSync(loopFile(home, "ledger"))).toBe(false);
  });

  it("ends after a pass whose run's step is not set up, saying which and what to do, in its log and in status", async () => {
    await approved();
    const loop = loopWith(() => ({ team, open: [open()], merged: [] }));
    const why =
      "the writer is not set up: the writer's box is not built yet (#113); set it up, then run `agent-factory dispatch ledger` again";
    expect(await loop.run()).toEqual({ kind: "ok", value: { passes: 1, failedActions: false, held: [why] } });
    expect(loop.slept).toEqual([]);
    expect(loop.lines).toContain(`no run could start; the orchestrator loop ends: ${why}`);
    expect(await statusLine()).toBe(
      `no orchestrator loop running; the last loop ended at 2026-11-07T10:00:00.000Z: ${why}; posted #12`,
    );
  });

  it("ends after a pass the project-day cap holds, to run again tomorrow", async () => {
    await approved();
    await spent("2026-11-07T09:00:00Z", 2, 10);
    const runs: string[] = [];
    const caps = { ...NO_CAPS, day: { usd: 1, tokens: "none" as const } };
    const loop = loopWith(() => ({ team, open: [open()], merged: [] }), writer("done", runs), caps);
    const ended = await loop.run();
    expect(runs).toEqual([]);
    expect(loop.slept).toEqual([]);
    expect(ended).toMatchObject({
      kind: "ok",
      value: {
        passes: 1,
        held: [expect.stringMatching(/^the project-day cap is reached: today \(2026-11-07, UTC\) /)],
      },
    });
    expect(ended.kind === "ok" ? ended.value.held[0] : "").toMatch(
      /; run `agent-factory dispatch ledger` again tomorrow$/,
    );
    expect(await statusLine()).toMatch(
      /^no orchestrator loop running; the last loop ended at .*: the project-day cap /,
    );
  });

  it("ends after a pass the window's share holds, naming when the window has room", async () => {
    await approved();
    await spent("2026-11-07T06:30:00Z", 0, 700);
    const caps = { ...NO_CAPS, window: { tokens: 500, machineTokens: "none" as const } };
    const loop = loopWith(() => ({ team, open: [open()], merged: [] }), writer("done", []), caps);
    const ended = await loop.run();
    expect(ended).toMatchObject({
      kind: "ok",
      value: { passes: 1, held: [expect.stringMatching(/^the window is full until 11:30 UTC: in the last 5 h /)] },
    });
    expect(loop.lines.some((l) => l.includes("run `agent-factory dispatch ledger` again then"))).toBe(true);
  });

  it("ends after a pass outside the run hours, saying when they are (#299)", async () => {
    await approved();
    const runs: string[] = [];
    // the loop's clock says 10:00 UTC; the run hours are the night
    const caps = { ...NO_CAPS, runHours: { from: 22, to: 6, text: "22-06" } };
    const loop = loopWith(() => ({ team, open: [open()], merged: [] }), writer("done", runs), caps);
    const why = "run hours are 22-06 UTC; run `agent-factory dispatch ledger` again then";
    expect(await loop.run()).toEqual({ kind: "ok", value: { passes: 1, failedActions: false, held: [why] } });
    expect(runs).toEqual([]);
    expect(loop.slept).toEqual([]);
    expect(loop.lines).toContain(`no run could start; the orchestrator loop ends: ${why}`);
    expect(await statusLine()).toBe(
      `no orchestrator loop running; the last loop ended at 2026-11-07T10:00:00.000Z: ${why}; posted #12`,
    );
  });

  it("goes on when one run is held and another starts; a later clean end clears status's stopped line", async () => {
    const writerRun = { kind: "writer", task: { kind: "fix" }, why: "x" } as const;
    const unset = { kind: "unavailable", reason: "no runner" } as const;
    expect(
      heldBack({ project: "ledger", caps: NO_CAPS }, [
        { ticket: "PROJ-1", action: { kind: "ready", head: H }, result: unset },
        { ticket: "PROJ-2", action: writerRun, result: { kind: "ok" } },
      ]),
    ).toEqual([]);
    expect(
      heldBack({ project: "ledger", caps: NO_CAPS }, [
        { ticket: "PROJ-1", action: { kind: "wait", why: "CI" }, result: unset },
      ]),
    ).toEqual([]);
    await approved();
    expect(await loopWith(() => ({ team, open: [open()], merged: [] })).run()).toMatchObject({
      value: { held: [expect.any(String)] },
    });
    expect(await statusLine()).toMatch(/^no orchestrator loop running; the last loop ended at /);
    const merged = loopWith(() => ({
      team,
      open: [],
      merged: [{ number: 12, branch: "factory/PROJ-1", fork: false }],
    }));
    expect(await merged.run()).toMatchObject({ kind: "ok", value: { held: [] } });
    expect(await statusLine()).toBe("no orchestrator loop running; run `agent-factory dispatch ledger`; posted #12");
  });
});

// a ticket's earlier runs spent this much, in the project's run records (#131)
function spent(at: string, usd: number, tokens: number): ReturnType<typeof record> {
  return record({
    where: { home, project: "ledger", ticket: "PROJ-9" },
    event: { at, kind: "review-ended", head: H, actOn: 0, spend: { usd, tokens } },
  });
}

// status's line for change 12, claimed, after the loop
function statusLine(): Promise<string> {
  return headed({
    home: { kind: "ok", value: home },
    forge: { ...forge(() => ({ team, open: [], merged: [] })), claimed: async () => ({ kind: "ok", value: [12] }) },
    label: "agent::claimed",
    repo: "chiyanram/ledger",
    now: Date.parse("2026-11-07T10:05:00Z"),
    line: "posted #12",
  });
}
