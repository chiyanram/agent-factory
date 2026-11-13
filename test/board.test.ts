import { describe, expect, it } from "vitest";
import { boardJson, boardOf, boardText } from "../src/core/dispatch/board.js";
import { EMPTY, type Event, type Summary } from "../src/core/dispatch/records.js";
import { NO_CAPS } from "../src/core/dispatch/caps.js";
import { decide, type TicketState } from "../src/core/dispatch/table.js";
import { describe as describeAction, type Decided } from "../src/core/dispatch/tick.js";
import type { OpenLine } from "../src/core/poll.js";
import type { ApprovalRecord } from "../src/core/approval.js";

// One line per ticket in flight: its change, its step, what it waits on and for how long (#487 AC-5).

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

// the implementer, cleanup, ready check and review are done at the head
const done: Summary = {
  ...EMPTY,
  lastWriter: { kind: "ended", mode: "cleanup", head: H, outcome: "done", patch: "p", evidence: [] },
  lastReady: { kind: "ended", at: "2026-11-13T09:00:00Z", human: false, head: H, passed: true, why: "" },
  lastReview: { kind: "ended", head: H, actOn: 0 },
  reviewRounds: 1,
  // recent, so no claim is quiet
  lastAt: "2026-11-13T11:50:00Z",
};

const APPROVAL: ApprovalRecord = {
  version: 2,
  kind: "approval",
  project: "ledger",
  ticket: "PROJ-1",
  spec_hash: "s",
  design_hash: "none",
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
  return { state, approved, shared: true, action: decide(state) };
}

const begun = (at: string, by: string): Event => ({ at, kind: "begun", by, via: "terminal" });
const at = (iso: string): Event => ({ at: iso, kind: "pinged", head: H });

describe("the board (#487 AC-5)", () => {
  const tickets: readonly Decided[] = [
    // the gate is green and pinged: the approver reviews and merges
    decided("PROJ-1", { runs: { ...done, pingedAt: H } }),
    // CI runs at the head: the gate
    decided("PROJ-2", { change: { kind: "open", line: line({ number: 14, pipeline: { kind: "running" } }) } }),
    // approved, no PR yet: the factory's first run
    decided("PROJ-3", { change: { kind: "none" }, runs: EMPTY }),
    // a START in a lane that needs approval: the STARTer approves
    decided(
      "PROJ-4",
      { change: { kind: "none" }, runs: EMPTY, approval: { kind: "unapproved", lane: "feature" } },
      "none",
    ),
    // merged: no longer in flight
    decided("PROJ-5", {
      change: { kind: "merged", line: { kind: "merged", number: 9, branch: "factory/PROJ-5", fork: false } },
    }),
    { kind: "broken", ticket: "PROJ-6", reason: "PROJ-6.jsonl line 2 is not a record" },
  ];
  const events = new Map<string, readonly Event[]>([
    ["PROJ-1", [begun("2026-11-13T07:00:00Z", "ram"), at("2026-11-13T10:00:00Z")]],
    // STARTed twice: the newest START names the person, whatever the file's order
    ["PROJ-4", [begun("2026-11-13T07:00:00Z", "lee"), begun("2026-11-13T11:00:00Z", "ram")]],
  ]);
  const lines = boardOf({ decided: tickets, events, now: NOW, describe: describeAction });

  it("lists every ticket in flight, PR or not, and leaves out a merged one", () => {
    expect(lines.map((l) => [l.ticket, l.change])).toEqual([
      ["PROJ-1", 12],
      ["PROJ-2", 14],
      ["PROJ-3", "none"],
      ["PROJ-4", "none"],
      ["PROJ-6", "none"],
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
      { kind: "person", who: "mo", does: "reviews and merges the change" },
      { kind: "gate", what: "wait: CI is running at this head" },
      { kind: "run", what: "starts the writer step" },
      { kind: "person", who: "ram", does: "approves the spec: agent-factory approve <project> <ticket> <hash>" },
      { kind: "person", who: "a person", does: "reads why it cannot be read: PROJ-6.jsonl line 2 is not a record" },
    ]);
  });

  it("waits since the newest record line, else the approval; a ticket with neither has no time", () => {
    expect(lines.map((l) => [l.since, l.forMs])).toEqual([
      ["2026-11-13T10:00:00Z", 2 * 3_600_000],
      ["2026-11-13T08:00:00Z", 4 * 3_600_000],
      ["2026-11-13T08:00:00Z", 4 * 3_600_000],
      ["2026-11-13T11:00:00Z", 3_600_000],
      ["", 0],
    ]);
  });

  it("shows each ticket in the reader's zone, and the same fields as JSON in UTC", () => {
    const text = boardText({ lines, zone: { name: "Asia/Tokyo" }, mark: "#" });
    expect(text.slice(0, 3)).toEqual([
      "tickets in flight (times in Asia/Tokyo):",
      "  PROJ-1  #12  wait: the gate is green; the human reviews and merges",
      "    waits on mo, who reviews and merges the change, for 2h 00m since 2026-11-13 19:00 Asia/Tokyo",
    ]);
    expect(text).toContain(
      "    waits on the gate: wait: CI is running at this head, for 4h 00m since 2026-11-13 17:00 Asia/Tokyo",
    );
    expect(text).toContain("  PROJ-3  no PR  writer (fix): approved; no run yet");
    const json = JSON.parse(boardJson(lines)) as unknown;
    expect(Array.isArray(json) && json[0]).toEqual({
      ticket: "PROJ-1",
      change: 12,
      step: "wait: the gate is green; the human reviews and merges",
      waitsOn: { kind: "person", who: "mo", does: "reviews and merges the change" },
      since: "2026-11-13T10:00:00Z",
      forMs: 2 * 3_600_000,
    });
    expect(Array.isArray(json) && json[4]).toMatchObject({ change: null, since: null });
    expect(boardText({ lines: [], zone: { name: "UTC" }, mark: "#" })).toEqual(["no ticket in flight"]);
  });
});
