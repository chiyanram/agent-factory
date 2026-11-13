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
  failureOf,
  MAX_FAILED_PASSES,
  orchestratorLoop,
  pace,
} from "../src/core/dispatch/orchestrator-loop.js";
import { STEPS_TODAY, type Steps } from "../src/core/dispatch/steps.js";
import { lock, type TickSetup } from "../src/core/dispatch/tick.js";
import { NO_SPEND } from "../src/core/dispatch/spend.js";
import type { Call, Runner } from "../src/core/forge/api.js";
import { github } from "../src/core/forge/github.js";
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
    landed: notUsed,
    defaultBranch: notUsed,
    branchExists: async () => ({ kind: "ok", value: false }),
    branchState: async () => ({ kind: "ok", value: "none" }),
    issueState: async () => ({ kind: "ok", value: "open" }),
    issueBody: notUsed,
    setIssueBody: notUsed,
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
  gitHost: Forge = forge(changes),
  onSleep: () => void = () => undefined,
): Loop & { readonly run: () => ReturnType<typeof orchestratorLoop> } {
  const slept: number[] = [];
  const lines: string[] = [];
  const setup: TickSetup = {
    home,
    project: "ledger",
    gate: "forge-ci",
    forge: gitHost,
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
        onSleep();
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

  it("runs the next pass at once after a run it started, then ends after the pass that sees the change merged", async () => {
    await approved();
    const runs: string[] = [];
    let pass = 0;
    const loop = loopWith(
      () => {
        pass += 1;
        // each pass polls twice: once to act, once to look; the change is merged from the second pass on
        return pass <= 2
          ? { team, open: [open()], merged: [] }
          : {
              team,
              open: [],
              merged: [{ number: 12, branch: "factory/PROJ-1", fork: false }],
            };
      },
      writer("done", runs),
    );
    // the writer ends done, so the next step is due after the first pass, and the loop does not sleep on it (#445)
    expect(await loop.run()).toMatchObject({ kind: "ok", value: { passes: 2 } });
    expect(runs).toEqual(["PROJ-1"]);
    expect(loop.slept).toEqual([]);
    expect(loop.lines).toContain("in flight: PROJ-1; next pass now");
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

// the writer's cleanup, the ready check and the review all ended at the head H
async function doneAtHead(): Promise<void> {
  const where = { home, project: "ledger", ticket: "PROJ-1" };
  await record({
    where,
    event: {
      at: "2026-11-07T09:00:00Z",
      kind: "writer-ended",
      mode: "cleanup",
      head: H,
      outcome: "done",
      patch: "p",
      evidence: [],
      hung: false,
    },
  });
  await record({ where, event: { at: "2026-11-07T09:05:00Z", kind: "ready-ended", head: H, passed: true, why: "" } });
  await record({ where, event: { at: "2026-11-07T09:10:00Z", kind: "review-ended", head: H, actOn: 0 } });
}

// the ledger's steps (#445): a writer that ends done at the head, a ready check that passes, a review with nothing
// to act on, each run counted by its kind
function ledgerSteps(runs: string[], ready: () => boolean = () => true): Steps {
  return {
    ...writer("done", runs),
    writer: {
      kind: "available",
      run: async (input) => (
        runs.push(`writer ${input.task.kind}`),
        { kind: "ok", value: { head: H, outcome: "done", patch: "p1", evidence: [], hung: false } }
      ),
    },
    ready: {
      kind: "available",
      run: async () => (runs.push("ready"), { kind: "ok", value: { passed: ready(), why: "e1 failed", human: false } }),
    },
    review: {
      kind: "available",
      run: async () => (runs.push("review"), { kind: "ok", value: { actOn: 0, spend: NO_SPEND } }),
    },
  };
}

describe("the orchestrator loop never sleeps after a step it ran itself (#445)", () => {
  it("runs the ledger's writer, cleanup, ready check and review with no sleep, then sleeps on CI", async () => {
    await approved();
    const runs: string[] = [];
    let merged = false;
    const loop = loopWith(
      () =>
        merged
          ? { team, open: [], merged: [{ number: 12, branch: "factory/PROJ-1", fork: false }] }
          : { team, open: [open()], merged: [] },
      ledgerSteps(runs),
      NO_CAPS,
      undefined,
      () => {
        merged = true;
      },
    );
    expect(await loop.run()).toMatchObject({ kind: "ok", value: { failedActions: false } });
    expect(runs.slice(-2)).toEqual(["ready", "review"]);
    expect(runs[0]).toMatch(/^writer /);
    // one sleep only: after the review, when the ticket waits on CI, outside the factory
    expect(loop.slept).toEqual([7 * 60_000]);
    expect(loop.lines.filter((l) => l === "in flight: PROJ-1; next pass now")).toHaveLength(runs.length);
    expect(loop.lines).toContain("in flight: PROJ-1 (waiting on CI); next pass in 7 min");
  });

  // #494 review: a pass that only recorded a hold or an unanswered blocker read waits the poll interval, so three
  // unanswered passes are a poll interval apart, never a few seconds of git host errors back to back
  it("waits the poll interval after a pass that only recorded a hold or an unread blocker", () => {
    for (const action of [
      { kind: "blockers-unread", why: "PROJ-0: github: 502" },
      { kind: "held", why: "blocked by PROJ-0 (open, not merged)", ping: true },
    ] as const) {
      expect(pace([{ ticket: "PROJ-1", action, result: { kind: "ok" } }], new Set())).toMatchObject({ kind: "sleep" });
    }
  });

  it("falls back to the poll interval when a step fails the same way twice in a row", async () => {
    const step = { kind: "ready", head: H } as const;
    const failed = { ticket: "PROJ-1", action: step, result: { kind: "failed", reason: "no box" } } as const;
    expect(pace([failed], new Set())).toEqual({ kind: "now" });
    expect(pace([failed], new Set([failureOf(failed)]))).toEqual({ kind: "sleep", repeated: new Set(["PROJ-1"]) });
    // another failure, or another step that ended, still runs the next pass at once
    expect(pace([failed], new Set(["PROJ-1 ready: the runner died"]))).toEqual({ kind: "now" });
    const ok = { ticket: "PROJ-2", action: { kind: "review", head: H }, result: { kind: "ok" } } as const;
    expect(pace([failed, ok], new Set([failureOf(failed)]))).toEqual({ kind: "now" });
    // a wait and a run that did not start are not steps the factory ran
    const unset = { kind: "unavailable", reason: "no runner" } as const;
    expect(
      pace(
        [{ ticket: "PROJ-1", action: { kind: "wait", why: "CI is running at this head" }, result: { kind: "ok" } }],
        new Set(),
      ),
    ).toEqual({
      kind: "sleep",
      repeated: new Set(),
    });
    expect(pace([{ ticket: "PROJ-1", action: step, result: unset }], new Set())).toMatchObject({ kind: "sleep" });
  });

  it("an action that fails the same way twice in a row sleeps the poll interval, never spins", async () => {
    await approved();
    await doneAtHead();
    let tries = 0;
    let merged = false;
    const changes = (): Changes =>
      merged
        ? { team, open: [], merged: [{ number: 12, branch: "factory/PROJ-1", fork: false }] }
        : { team, open: [open({ pipeline: { kind: "success" } })], merged: [] };
    // the gate is green, so the human is pinged; the git host refuses the note the same way each pass
    const refusing: Forge = {
      ...forge(changes),
      note: async () => ((tries += 1), { kind: "failed", reason: "the git host refused the note" }),
    };
    const loop = loopWith(changes, STEPS_TODAY, NO_CAPS, refusing, () => {
      merged = true;
    });
    expect(await loop.run()).toMatchObject({ kind: "ok", value: { failedActions: true } });
    expect(tries).toBeGreaterThanOrEqual(2);
    expect(loop.slept).toEqual([7 * 60_000]);
    expect(loop.lines).toContain("in flight: PROJ-1; next pass now");
    expect(loop.lines).toContain("in flight: PROJ-1 (its step failed the same way twice in a row); next pass in 7 min");
  });

  it("an action that meets the git host's rate limit waits until the limit is over, not now (#62)", async () => {
    const reset = Date.parse("2026-11-07T10:40:00Z");
    const limited = {
      ticket: "PROJ-1",
      action: { kind: "review", head: H },
      result: { kind: "failed", reason: "github: rate limited until 2026-11-07T10:40:00Z: HTTP 403 after 1 try" },
    } as const;
    const ok = {
      ticket: "PROJ-2",
      action: { kind: "writer", task: { kind: "fix" }, why: "x" },
      result: { kind: "ok" },
    } as const;
    expect(pace([ok, limited], new Set())).toEqual({ kind: "limited", until: reset });
  });
});

// the loop's clock in these tests, and the reset of the rate limit the fake gh meets: 40 minutes on
const NOW = Date.parse("2026-11-07T10:00:00Z");
const RESET = Date.parse("2026-11-07T10:40:00Z");

// a fake gh behind the real GitHub adapter (#62): the user is ram, each GraphQL list answers from `now()`, a write
// answers 200, and a limit, while set, answers every call with GitHub's "already exceeded" error, no requests left
// and the reset at RESET; every call is counted
function gh(now: () => Changes, limit: () => boolean): { readonly calls: Call[]; readonly forge: Forge } {
  const calls: Call[] = [];
  const run: Runner = async (call) => {
    calls.push(call);
    return limit() ? LIMITED : answered(bodyOf(call, now()));
  };
  const client = {
    name: "github",
    bin: "gh",
    env: {},
    run,
    sleep: async () => undefined,
    maxTries: 4,
    now: () => NOW / 1000,
  };
  return { calls, forge: github(client, { owner: "chiyanram", name: "ledger" }) };
}

const answered = (body: unknown, head = "") => ({
  code: 0,
  stdout: `HTTP/2.0 200 OK\r\n${head}\r\n${JSON.stringify(body)}`,
  stderr: "",
});

const LIMITED = answered(
  { errors: [{ message: "API rate limit already exceeded for user ID 15411573." }] },
  `x-ratelimit-remaining: 0\r\nx-ratelimit-reset: ${RESET / 1000}\r\n`,
);

const PAGE = { hasNextPage: false, endCursor: null };
const pulls = (nodes: readonly unknown[]) => ({ data: { repository: { pullRequests: { pageInfo: PAGE, nodes } } } });

const openNode = (o: OpenChange) => ({
  number: o.number,
  isDraft: o.draft,
  headRefOid: o.head,
  headRefName: o.branch,
  isCrossRepository: o.fork,
  mergeable: "MERGEABLE",
  labels: { pageInfo: { hasNextPage: false }, nodes: o.labels.map((name) => ({ name })) },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] },
  comments: {
    pageInfo: { hasPreviousPage: false, startCursor: null },
    nodes: o.comments.map((n) => ({
      body: n.body,
      createdAt: n.at,
      author: { login: n.author.name, __typename: "User" },
    })),
  },
});

// the answer to one call: the user, each GraphQL list by its query, else a write's label list
const ANSWERS: readonly (readonly [(call: Call) => boolean, (c: Changes) => unknown])[] = [
  [(call) => call.args[2] === "user", () => ({ login: "ram" })],
  [
    (call) => queryOf(call).includes("collaborators"),
    (c) => ({
      data: {
        repository: {
          collaborators: {
            pageInfo: PAGE,
            edges: c.team.map((p) => ({ permission: "ADMIN", node: { login: p.name } })),
          },
        },
      },
    }),
  ],
  [(call) => queryOf(call).includes("states: [OPEN]"), (c) => pulls(c.open.map(openNode))],
  [
    (call) => queryOf(call).includes("states: [MERGED]"),
    (c) => pulls(c.merged.map((m) => ({ number: m.number, headRefName: m.branch, isCrossRepository: m.fork }))),
  ],
];

const queryOf = (call: Call): string => call.args.find((a) => a.startsWith("query=")) ?? "";

function bodyOf(call: Call, c: Changes): unknown {
  const found = ANSWERS.find(([match]) => match(call));
  return found === undefined ? [{ name: "agent::claimed" }] : found[1](c);
}

describe("the orchestrator loop and the git host's rate limit (#62)", () => {
  it("a pass that did nothing reads the git host once: its login and 3 GraphQL lists, where it made 8 calls", async () => {
    await approved();
    // the writer, the ready check and the review are done at the head, and CI runs there: the ticket waits on CI, in
    // flight, and a pass does nothing
    await doneAtHead();
    let merged = false;
    // a person spoke 5 minutes ago, so the claim is not quiet
    const said = { body: "go on", author: { name: "ram" }, at: "2026-11-07T09:55:00Z" };
    const host = gh(
      () =>
        merged
          ? { team, open: [], merged: [{ number: 12, branch: "factory/PROJ-1", fork: false }] }
          : { team, open: [open({ labels: ["agent::claimed"], comments: [said] })], merged: [] },
      () => false,
    );
    const marks: number[] = [];
    const loop = loopWith(
      () => "down",
      STEPS_TODAY,
      NO_CAPS,
      host.forge,
      () => {
        marks.push(host.calls.length);
        merged = marks.length >= 2;
      },
    );
    const ended = await loop.run();
    expect(ended).toMatchObject({ kind: "ok", value: { passes: 3 } });
    expect(loop.lines.filter((l) => l.startsWith("PROJ-1: wait: CI"))).toHaveLength(2);
    // pass 1 posted the approval's shared copy, so it looked again: its login, 3 lists, the note, 3 lists
    const [first = 0, second = 0] = marks;
    expect(first).toBe(8);
    // pass 2 did nothing: its login and the 3 lists, each one call; before #62 it read them twice, with the login
    const pass2 = host.calls.slice(first, second);
    expect(pass2.map((c) => c.args[2])).toEqual(["user", "graphql", "graphql", "graphql"]);
    // no pass of this one-ticket project makes more than 9 calls: the pass that reconciles the merge reads it once
    // (Forge.landed, #487) before the claim comes off; a pass that did nothing still makes 4, above
    expect(host.calls.length - second).toBeLessThanOrEqual(9);
  });

  it("a pass that meets the limit makes one call, and the next pass waits until the reset, with no retry storm", async () => {
    await approved();
    let limited = true;
    const host = gh(
      () => ({ team, open: [], merged: [] }),
      () => limited,
    );
    const loop = loopWith(
      () => "down",
      STEPS_TODAY,
      NO_CAPS,
      host.forge,
      () => {
        limited = false;
      },
    );
    expect(await loop.run()).toMatchObject({ kind: "ok", value: { passes: 2 } });
    expect(loop.slept).toEqual([RESET - NOW]);
    expect(loop.lines[0]).toMatch(
      /^pass 1 failed: github: rate limited until 2026-11-07T10:40:00Z: HTTP 200 after 1 try on user: API rate limit already exceeded for user ID 15411573\./,
    );
    expect(loop.lines).toContain("next pass in 40 min, when the rate limit is over");
    // the limited pass stopped at its first call; the next pass read the user once and the three lists
    expect(host.calls.length).toBe(1 + 4);
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
