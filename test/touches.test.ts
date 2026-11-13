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
