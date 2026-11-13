import { describe, expect, it } from "vitest";
import type { Event } from "../src/core/dispatch/records.js";
import { tallyOf, ticketLines, touchesOf } from "../src/core/dispatch/touches.js";
import { UTC } from "../src/core/zone.js";

// Per ticket: the touches a person made, how long each waited, rework rounds and cost (#487 AC-2).

const writer = (at: string, mode: "fix" | "rework", outcome: "done" | "asked" | "blocked"): Event => ({
  at,
  kind: "writer-ended",
  mode,
  head: "h",
  outcome,
  patch: "",
  evidence: [],
  hung: false,
});
const answered = (at: string): Event => ({ at, kind: "answered", spec: "", answers: [] });
const begun = (at: string, by = "ram"): Event => ({ at, kind: "begun", by, via: "terminal" });
const approved = (at: string, by = "ram"): Event => ({ at, kind: "approved", by, via: "terminal", spec: "h" });
const blocked = (at: string): Event => ({ at, kind: "blocked", why: "needs a person" });
const designVerify = (at: string): Event => ({
  at,
  kind: "design-ended",
  step: "verify",
  spec: "s",
  design: "d",
  outcome: "done",
  why: "",
  findings: [],
  kept: [],
});
const COST = { spend: { usd: 1.5, tokens: 300 }, unmeasured: 1 };

describe("a ticket's touches (#487)", () => {
  it("an answer waited from the run that asked to the answers; an answer with no open ask before it is no touch", () => {
    const events = [
      answered("2026-11-13T07:00:00Z"),
      writer("2026-11-13T08:00:00Z", "fix", "asked"),
      answered("2026-11-13T10:05:00Z"),
      // a second answers line for the same ask is not a second touch
      answered("2026-11-13T10:10:00Z"),
      writer("2026-11-13T11:00:00Z", "fix", "asked"),
      answered("2026-11-13T11:30:00Z"),
    ];
    expect(touchesOf(events)).toEqual([
      { kind: "answer", at: "2026-11-13T10:05:00Z", waitedMs: 125 * 60_000 },
      { kind: "answer", at: "2026-11-13T11:30:00Z", waitedMs: 30 * 60_000 },
    ]);
  });

  it("an approval waits from the later of START and the design verify pass, and carries who approved (Q4 A)", () => {
    const events = [
      begun("2026-11-13T08:00:00Z"),
      designVerify("2026-11-13T09:00:00Z"),
      approved("2026-11-13T10:00:00Z", "mo"),
    ];
    expect(touchesOf(events)).toEqual([{ kind: "approve", at: "2026-11-13T10:00:00Z", by: "mo", waitedMs: 3_600_000 }]);
  });

  it("an approval waits from START when there is no design verify pass", () => {
    const events = [begun("2026-11-13T08:00:00Z"), approved("2026-11-13T09:30:00Z")];
    expect(touchesOf(events)).toEqual([
      { kind: "approve", at: "2026-11-13T09:30:00Z", by: "ram", waitedMs: 90 * 60_000 },
    ]);
  });

  it("a START alone is no touch", () => {
    expect(touchesOf([begun("2026-11-13T08:00:00Z")])).toEqual([]);
  });

  it("a START or approval after a hand-over is a rescue, waiting from the blocked line; the hand-over then closes", () => {
    const events = [
      approved("2026-11-13T08:00:00Z"),
      blocked("2026-11-13T09:00:00Z"),
      begun("2026-11-13T11:00:00Z", "mo"),
      blocked("2026-11-13T12:00:00Z"),
      approved("2026-11-13T12:30:00Z", "mo"),
    ];
    expect(touchesOf(events)).toEqual([
      { kind: "approve", at: "2026-11-13T08:00:00Z", by: "ram", waitedMs: 0 },
      { kind: "rescue", at: "2026-11-13T11:00:00Z", by: "mo", waitedMs: 2 * 3_600_000 },
      { kind: "rescue", at: "2026-11-13T12:30:00Z", by: "mo", waitedMs: 30 * 60_000 },
    ]);
  });

  it("a rescue waits from the first blocked line when several open before it", () => {
    const events = [
      blocked("2026-11-13T08:00:00Z"),
      blocked("2026-11-13T09:00:00Z"),
      begun("2026-11-13T10:00:00Z", "mo"),
    ];
    expect(touchesOf(events)).toEqual([
      { kind: "rescue", at: "2026-11-13T10:00:00Z", by: "mo", waitedMs: 2 * 3_600_000 },
    ]);
  });

  it("reads the lines in time order, not file order, so a later-written begun line still sorts first", () => {
    // the begun line is appended after the approval line, but its at is earlier
    const events = [approved("2026-11-13T10:00:00Z"), begun("2026-11-13T08:00:00Z")];
    expect(touchesOf(events)).toEqual([
      { kind: "approve", at: "2026-11-13T10:00:00Z", by: "ram", waitedMs: 2 * 3_600_000 },
    ]);
  });

  it("an ask not answered yet is no touch", () => {
    expect(touchesOf([writer("2026-11-13T08:00:00Z", "fix", "asked")])).toEqual([]);
  });

  it("counts the writer's rework runs, sums the waits, and keeps the ticket's cost and newest line", () => {
    const events = [
      writer("2026-11-13T08:00:00Z", "fix", "asked"),
      answered("2026-11-13T09:00:00Z"),
      writer("2026-11-13T10:00:00Z", "rework", "done"),
      writer("2026-11-13T11:00:00Z", "rework", "done"),
      writer("2026-11-13T12:00:00Z", "fix", "done"),
    ];
    expect(tallyOf({ project: "ledger", ticket: "PROJ-1" }, events, COST)).toEqual({
      project: "ledger",
      ticket: "PROJ-1",
      last: "2026-11-13T12:00:00Z",
      touches: [{ kind: "answer", at: "2026-11-13T09:00:00Z", waitedMs: 3_600_000 }],
      waitingMs: 3_600_000,
      reworkRounds: 2,
      cost: COST,
    });
  });
});

describe("the tickets section of usage (#487)", () => {
  const tally = tallyOf(
    { project: "ledger", ticket: "PROJ-1" },
    [writer("2026-11-13T08:00:00Z", "fix", "asked"), answered("2026-11-13T10:05:00Z")],
    COST,
  );

  it("says touches and waits are counted from the records and are not effort, then one block per ticket", () => {
    expect(
      ticketLines({ tallies: [tally], from: Date.parse("2026-11-01T00:00:00Z"), zone: { name: "Asia/Tokyo" } }),
    ).toEqual([
      "tickets this month: touches are a person's acts the ticket waited on (approve, answer, rescue, merge), counted from the records; waiting is how long they waited, not effort",
      "  ledger PROJ-1: cost $1.50 300 tok +1? · rework rounds 0 · touches 1 · waiting 2h 05m",
      "    answer at 2026-11-13 19:05 Asia/Tokyo, waited 2h 05m",
    ]);
  });

  it("leaves out a ticket with no line since the start of the month, and prints nothing when none is left", () => {
    expect(ticketLines({ tallies: [tally], from: Date.parse("2026-12-01T00:00:00Z"), zone: UTC })).toEqual([]);
  });
});
