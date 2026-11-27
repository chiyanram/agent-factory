import { describe, expect, it } from "vitest";
import { boardJson, boardOf, boardText, waitingLines } from "../src/core/dispatch/board.js";
import { EMPTY, type Event, type Summary } from "../src/core/dispatch/records.js";
import { NO_CAPS } from "../src/core/dispatch/caps.js";
import { decide, type TicketState } from "../src/core/dispatch/table.js";
import { describe as describeAction, type Decided } from "../src/core/dispatch/tick.js";
import type { OpenLine } from "../src/core/poll.js";
import type { ApprovalRecord } from "../src/core/approval.js";
import type { Result } from "../src/core/forge/api.js";
import type { Waiting } from "../src/core/forge/types.js";

const H = "1".repeat(40);
const NOW = Date.parse("2026-11-13T12:00:00Z");

const line = (over: Partial<OpenLine> = {}): OpenLine => ({
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
});

const done: Summary = {
  ...EMPTY,
  lastWriter: { kind: "ended", mode: "cleanup", head: H, outcome: "done", patch: "p", evidence: [] },
  lastReady: { kind: "ended", at: "2026-11-13T09:00:00Z", human: false, head: H, passed: true, why: "" },
  lastReview: { kind: "ended", head: H, actOn: 0 },
  reviewRounds: 1,
  lastAt: "2026-11-13T11:50:00Z",
};

const APPROVAL: ApprovalRecord = {
  version: 3,
  kind: "approval",
  project: "ledger",
  ticket: "PROJ-1",
  spec_hash: "s",
  by: "mo",
  via: "terminal",
  at: "2026-11-13T08:00:00Z",
};

function decided(ticket: string, over: Partial<TicketState>, approved: ApprovalRecord | "none" = APPROVAL): Decided {
  const state: TicketState = {
    ticket,
    gate: "forge-ci",
    approval: { kind: "approved", at: "2026-11-13T08:00:00Z", lane: "feature", testFirst: false },
    change: { kind: "open", line: line() },
    runs: done,
    now: NOW,
    quietMinutes: 30,
    waiver: { kind: "none" },
    caps: NO_CAPS,
    design: { kind: "off" },
    ...over,
  };
  return { state, approved, again: "none", shared: true, action: decide(state) };
}

const begun = (at: string, by: string): Event => ({ at, kind: "begun", by, via: "terminal" });
const at = (iso: string): Event => ({ at: iso, kind: "pinged", head: H });

describe("the board (#487 AC-5)", () => {
  const tickets: readonly Decided[] = [
    decided("PROJ-1", { runs: { ...done, pingedAt: H } }),
    decided("PROJ-2", { change: { kind: "open", line: line({ number: 14, pipeline: { kind: "running" } }) } }),
    decided("PROJ-3", { change: { kind: "none" }, runs: EMPTY }),
    decided(
      "PROJ-4",
      { change: { kind: "none" }, runs: EMPTY, approval: { kind: "unapproved", lane: "feature" } },
      "none",
    ),
    decided("PROJ-5", {
      change: { kind: "merged", line: { kind: "merged", number: 9, branch: "factory/PROJ-5", fork: false } },
    }),
    { kind: "broken", ticket: "PROJ-6", reason: "PROJ-6.jsonl line 2 is not a record" },
  ];
  const events = new Map<string, readonly Event[]>([
    ["PROJ-1", [begun("2026-11-13T07:00:00Z", "ram"), at("2026-11-13T10:00:00Z")]],
    ["PROJ-4", [begun("2026-11-13T07:00:00Z", "lee"), begun("2026-11-13T11:00:00Z", "ram")]],
  ]);
  const lines = boardOf({ decided: tickets, events, now: NOW, describe: describeAction });

  it("lists every ticket in flight, PR or not, and leaves out a merged one", () => {
    expect(lines.map((l) => [l.ticket, l.change])).toEqual([
      ["PROJ-4", "none"],
      ["PROJ-6", "none"],
      ["PROJ-1", 12],
      ["PROJ-2", 14],
      ["PROJ-3", "none"],
    ]);
  });

  it("reads a quiet claim given back while CI runs as a wait on the gate, not a run", () => {
    const quiet = decided("PROJ-7", {
      change: { kind: "open", line: line({ number: 15, pipeline: { kind: "running" } }) },
      runs: { ...done, lastAt: "2026-11-13T09:00:00Z" },
    });
    expect("kind" in quiet ? "" : quiet.action.kind).toBe("release");
    const [one] = boardOf({ decided: [quiet], events: new Map(), now: NOW, describe: describeAction });
    expect(one?.waitsOn).toMatchObject({ kind: "gate" });
  });

  it("names 'a person' when the records name no one who STARTed the ticket", () => {
    const unnamed = decided(
      "PROJ-8",
      { change: { kind: "none" }, runs: EMPTY, approval: { kind: "unapproved", lane: "feature" } },
      "none",
    );
    const [one] = boardOf({ decided: [unnamed], events: new Map(), now: NOW, describe: describeAction });
    expect(one?.waitsOn).toMatchObject({ kind: "person", who: "a person" });
  });

  it("names what each waits on: the approver for a merge, the STARTer for an approval, the gate, a run", () => {
    expect(lines.map((l) => l.waitsOn)).toEqual([
      { kind: "person", who: "ram", does: "approves the spec: agent-factory approve <project> <ticket> <hash>" },
      { kind: "person", who: "a person", does: "reads why it cannot be read: PROJ-6.jsonl line 2 is not a record" },
      { kind: "person", who: "mo", does: "reviews and merges the change" },
      { kind: "gate", what: "wait: CI is running at this head" },
      { kind: "run", what: "starts the writer step" },
    ]);
  });

  it("waits since the newest record line, else the approval; a ticket with neither has no time", () => {
    expect(lines.map((l) => [l.since, l.forMs])).toEqual([
      ["2026-11-13T11:00:00Z", 3_600_000],
      ["", 0],
      ["2026-11-13T10:00:00Z", 2 * 3_600_000],
      ["2026-11-13T08:00:00Z", 4 * 3_600_000],
      ["2026-11-13T08:00:00Z", 4 * 3_600_000],
    ]);
  });

  it("prints the same for a ticket whose records also hold reasons, a refused setup and an unmeasured failed run", () => {
    const noted: readonly Event[] = [
      ...(events.get("PROJ-1") ?? []),
      { at: "2026-11-13T11:00:00Z", kind: "setup-refused", phase: "review", why: "the reviewer is not set up" },
      { at: "2026-11-13T11:10:00Z", kind: "spent", phase: "verify", head: H, reason: "unknown" },
    ];
    const withNew = boardOf({
      decided: tickets,
      events: new Map([...events, ["PROJ-1", noted]]),
      now: NOW,
      describe: describeAction,
    });
    const zone = { name: "Asia/Tokyo" };
    expect(boardText({ lines: withNew, zone, mark: "#" })).toEqual(boardText({ lines, zone, mark: "#" }));
    expect(boardJson(withNew)).toEqual(boardJson(lines));
  });

  it("shows each ticket in the reader's zone, and the same fields as JSON in UTC", () => {
    const text = boardText({ lines, zone: { name: "Asia/Tokyo" }, mark: "#" });
    expect(text.slice(6, 9)).toEqual([
      "ready to merge (1)",
      "  PROJ-1  #12  wait: the gate is green; the human reviews and merges",
      "    waits on mo, who reviews and merges the change, for 2h 00m since 2026-11-13 19:00 Asia/Tokyo",
    ]);
    expect(text).toContain(
      "    waits on the gate: wait: CI is running at this head, for 4h 00m since 2026-11-13 17:00 Asia/Tokyo",
    );
    expect(text).toContain("  PROJ-3  no PR  writer (fix): approved; no run yet");
    const json = JSON.parse(boardJson(lines)) as unknown;
    expect(Array.isArray(json) && json[2]).toEqual({
      ticket: "PROJ-1",
      change: 12,
      lane: "ready-to-merge",
      step: "wait: the gate is green; the human reviews and merges",
      waitsOn: { kind: "person", who: "mo", does: "reviews and merges the change" },
      since: "2026-11-13T10:00:00Z",
      forMs: 2 * 3_600_000,
    });
    expect(Array.isArray(json) && json[1]).toMatchObject({ change: null, since: null, lane: "needs-you" });
    expect(Array.isArray(json) ? json.map((r: object) => Object.keys(r).join(",")) : json).toEqual(
      Array(5).fill("ticket,change,lane,step,waitsOn,since,forMs"),
    );
    expect(boardText({ lines: [], zone: { name: "UTC" }, mark: "#" })).toEqual([
      "no ticket in flight:",
      "needs you (0)",
      "  nothing",
      "ready to merge (0)",
      "  nothing",
      "factory (0)",
      "  nothing",
    ]);
  });
});

describe("the board's lanes (#671)", () => {
  const planted: readonly Decided[] = [
    decided("PROJ-3", { change: { kind: "none" }, runs: EMPTY }),
    decided(
      "PROJ-4",
      { change: { kind: "none" }, runs: EMPTY, approval: { kind: "unapproved", lane: "feature" } },
      "none",
    ),
    decided("PROJ-1", { runs: { ...done, pingedAt: H } }),
    decided("PROJ-2", { change: { kind: "open", line: line({ number: 14, pipeline: { kind: "running" } }) } }),
    { kind: "broken", ticket: "PROJ-6", reason: "PROJ-6.jsonl line 2 is not a record" },
  ];
  const laned = boardOf({ decided: planted, events: new Map(), now: NOW, describe: describeAction });

  it("puts a person's step and a broken row under needs you, first", () => {
    expect(laned.slice(0, 2).map((l) => [l.ticket, l.lane])).toEqual([
      ["PROJ-4", "needs-you"],
      ["PROJ-6", "needs-you"],
    ]);
  });

  it("puts a green gate under ready to merge, pinged or not yet pinged", () => {
    const unpinged = decided("PROJ-7", {});
    expect("kind" in unpinged ? "" : unpinged.action.kind).toBe("ping");
    const [one] = boardOf({ decided: [unpinged], events: new Map(), now: NOW, describe: describeAction });
    expect(one?.lane).toBe("ready-to-merge");
    expect(one?.waitsOn).toMatchObject({ kind: "person", does: "reviews and merges the change" });
    expect(laned[2]).toMatchObject({ ticket: "PROJ-1", lane: "ready-to-merge" });
  });

  it("puts the factory's runs and the gate under factory, after ready to merge, in decision order", () => {
    expect(laned.slice(2).map((l) => [l.ticket, l.lane, l.waitsOn.kind])).toEqual([
      ["PROJ-1", "ready-to-merge", "person"],
      ["PROJ-3", "factory", "run"],
      ["PROJ-2", "factory", "gate"],
    ]);
  });

  it("puts a design note, and a wait for a manual CI job, under needs you", () => {
    const base = decided("PROJ-8", { change: { kind: "none" }, runs: EMPTY });
    const note =
      "kind" in base
        ? base
        : {
            ...base,
            action: {
              kind: "design-note" as const,
              spec: "s",
              why: "no further design review (round cap): the person decides",
            },
          };
    const odd =
      "kind" in base
        ? base
        : {
            ...base,
            action: { kind: "wait" as const, wait: "manual-ci" as const, why: "a manual CI job waits for a person" },
          };
    const two = boardOf({ decided: [note, odd], events: new Map(), now: NOW, describe: describeAction });
    expect(two.map((l) => [l.lane, l.waitsOn.kind])).toEqual([
      ["needs-you", "person"],
      ["needs-you", "person"],
    ]);
  });

  it("prints every lane's header, with nothing under an empty lane", () => {
    const only = laned.filter((l) => l.lane === "factory");
    expect(boardText({ lines: only, zone: { name: "UTC" }, mark: "#" })).toEqual([
      "tickets in flight (times in UTC):",
      "needs you (0)",
      "  nothing",
      "ready to merge (0)",
      "  nothing",
      "factory (2)",
      "  PROJ-3  no PR  writer (fix): approved; no run yet",
      "    waits on the run: starts the writer step, for 4h 00m since 2026-11-13 08:00 UTC",
      "  PROJ-2  #14  wait: CI is running at this head",
      "    waits on the gate: wait: CI is running at this head, for 4h 00m since 2026-11-13 08:00 UTC",
    ]);
  });

  it("shows a park's reset in the reader's zone, with UTC beside it, in the factory lane (#707)", () => {
    const parked = {
      ticket: "PROJ-7",
      change: 15,
      lane: "factory",
      step: "wait: the provider's usage limit lasts until 2026-11-13T15:00:00Z",
      waitsOn: { kind: "gate", what: "wait: the provider's usage limit lasts until 2026-11-13T15:00:00Z" },
      since: "2026-11-13T11:00:00Z",
      forMs: 3_600_000,
      parkedUntil: "2026-11-13T15:00:00Z",
    } as const;
    expect(boardText({ lines: [parked], zone: { name: "Asia/Tokyo" }, mark: "#" }).slice(-2)).toEqual([
      "  PROJ-7  #15  wait: the provider's usage limit lasts until 2026-11-14 00:00 Asia/Tokyo (2026-11-13 15:00 UTC)",
      "    waits on the gate: wait: the provider's usage limit lasts until 2026-11-14 00:00 Asia/Tokyo (2026-11-13 15:00 UTC), for 1h 00m since 2026-11-13 20:00 Asia/Tokyo",
    ]);
    expect(boardText({ lines: [parked], zone: { name: "UTC" }, mark: "#" }).at(-2)).toBe(
      "  PROJ-7  #15  wait: the provider's usage limit lasts until 2026-11-13 15:00 UTC",
    );
    expect(JSON.parse(boardJson([parked]))).toMatchObject([{ step: parked.step }]);
  });

  it("gives each JSON row its lane, in lane order", () => {
    const json = JSON.parse(boardJson(laned)) as unknown;
    expect(Array.isArray(json) ? json.map((r: { ticket: string; lane: string }) => [r.ticket, r.lane]) : json).toEqual([
      ["PROJ-4", "needs-you"],
      ["PROJ-6", "needs-you"],
      ["PROJ-1", "ready-to-merge"],
      ["PROJ-3", "factory"],
      ["PROJ-2", "factory"],
    ]);
  });
});

describe("the board's waiting sessions", () => {
  const waitingSince = "2026-11-13T11:00:00Z";
  const read = (numbers: readonly number[]) => ({
    kind: "ok" as const,
    value: numbers.map((n) => ({ number: n, title: `ticket ${n}`, since: waitingSince })),
  });
  const ci = decided("41", { change: { kind: "open", line: line({ number: 50, pipeline: { kind: "running" } }) } });
  const board = (waiting: Result<readonly Waiting[]>) =>
    boardOf({ decided: [ci], events: new Map(), now: NOW, describe: describeAction, waiting, ticketsAreIssues: true });

  it("lists a waiting ticket that is not in flight under needs you, first, since its label went on", () => {
    const lines = board(read([7]));
    expect(lines.map((l) => [l.ticket, l.lane])).toEqual([
      ["7", "needs-you"],
      ["41", "factory"],
    ]);
    expect(lines[0]).toMatchObject({ step: "session waits", since: waitingSince, forMs: 3_600_000 });
  });

  it("moves a waiting ticket in flight to needs you, keeping its change and step, as one line", () => {
    const lines = board(read([41]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      ticket: "41",
      change: 50,
      lane: "needs-you",
      step: "wait: CI is running at this head",
      waitsOn: { kind: "person", who: "the operator", does: expect.stringContaining("waiting:operator: ticket 41") },
    });
  });

  it("keeps a broken ticket's own line, which says why it cannot be read, when its session waits too", () => {
    const broken: Decided = { kind: "broken", ticket: "41", reason: "a torn record" };
    const lines = boardOf({
      decided: [broken],
      events: new Map(),
      now: NOW,
      describe: describeAction,
      waiting: read([41]),
      ticketsAreIssues: true,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      ticket: "41",
      step: "broken",
      waitsOn: { does: expect.stringContaining("a torn record") },
    });
  });

  it("never merges a waiting issue with a ticket of the same name when the project's tickets are not issues", () => {
    const lines = boardOf({
      decided: [ci],
      events: new Map(),
      now: NOW,
      describe: describeAction,
      waiting: read([41]),
      ticketsAreIssues: false,
    });
    expect(lines.map((l) => [l.ticket, l.lane])).toEqual([
      ["41", "needs-you"],
      ["41", "factory"],
    ]);
  });

  it("names a read that failed under needs you, and still lists every ticket in flight", () => {
    const lines = board({ kind: "failed", reason: "github: 502" });
    expect(lines.map((l) => [l.ticket, l.step])).toEqual([
      ["waiting sessions", "broken"],
      ["41", "wait: CI is running at this head"],
    ]);
  });

  it("says in words that the session waits for the operator, and keeps the JSON's key order", () => {
    const lines = board(read([7]));
    expect(boardText({ lines, zone: { name: "UTC" }, mark: "#" }).slice(1, 4)).toEqual([
      "needs you (1)",
      "  7  no PR  session waits",
      "    waits on the operator, who answers the ticket's session, which waits for their word (waiting:operator: ticket 7), for 1h 00m since 2026-11-13 11:00 UTC",
    ]);
    const json = JSON.parse(boardJson(lines)) as unknown;
    expect(Array.isArray(json) && json[0]).toEqual({
      ticket: "7",
      change: null,
      lane: "needs-you",
      step: "session waits",
      waitsOn: {
        kind: "person",
        who: "the operator",
        does: "answers the ticket's session, which waits for their word (waiting:operator: ticket 7)",
      },
      since: waitingSince,
      forMs: 3_600_000,
    });
  });
});

describe("waitingLines", () => {
  const T = Date.parse("2026-11-17T05:00:00Z");
  const w = (number: number, since = "2026-11-17T03:00:00Z") => ({ number, title: `ticket ${number}`, since });

  it("lists each waiting ticket under needs you, waiting on the operator, since the label went on", () => {
    expect(waitingLines({ kind: "ok", value: [w(12)] }, T)).toEqual([
      {
        ticket: "12",
        change: "none",
        lane: "needs-you",
        step: "session waits",
        waitsOn: {
          kind: "person",
          who: "the operator",
          does: "answers the ticket's session, which waits for their word (waiting:operator: ticket 12)",
        },
        since: "2026-11-17T03:00:00Z",
        forMs: 2 * 3_600_000,
      },
    ]);
  });

  it("shows no time for a label the git host keeps no time for", () => {
    expect(waitingLines({ kind: "ok", value: [w(12, "")] }, T)[0]).toMatchObject({ since: "", forMs: 0 });
  });

  it("names a read that failed as one broken needs-you line, never as nothing waiting", () => {
    expect(waitingLines({ kind: "failed", reason: "github: 502" }, T)).toEqual([
      {
        ticket: "waiting sessions",
        change: "none",
        lane: "needs-you",
        step: "broken",
        waitsOn: {
          kind: "person",
          who: "a person",
          does: "reads why it cannot be read: the waiting:operator label: github: 502",
        },
        since: "",
        forMs: 0,
      },
    ]);
  });
});
