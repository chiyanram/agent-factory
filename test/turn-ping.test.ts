import { describe, expect, it } from "vitest";
import { NO_CAPS } from "../src/core/dispatch/caps.js";
import { LANES, type Lane } from "../src/core/dispatch/next-step.js";
import { EMPTY, summarize, type Event, type Summary } from "../src/core/dispatch/records.js";
import type { Action, TicketState } from "../src/core/dispatch/table.js";
import { turnDue, turnPing, turnStep } from "../src/core/dispatch/turn-ping.js";
import type { OpenLine } from "../src/core/poll.js";

const H = "1".repeat(40);

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

function state(runs: Partial<Summary> = {}): TicketState {
  return {
    ticket: "PROJ-1",
    gate: "forge-ci",
    approval: { kind: "approved", at: "2026-11-07T08:00:00Z", lane: "feature", testFirst: false },
    change: { kind: "open", line: line() },
    runs: { ...EMPTY, ...runs },
    now: Date.parse("2026-11-07T10:00:00Z"),
    quietMinutes: 30,
    waiver: { kind: "none" },
    caps: NO_CAPS,
    design: { kind: "off" },
  };
}

const read = (turn: Lane | "none", turnRead = true) => ({ turn, turnRead });

describe("turnStep: the turn a pass records, and whether it pings", () => {
  it("pings once on entering a person's turn, and records it first", () => {
    expect(turnStep(read("factory"), "needs-you")).toEqual({ record: "needs-you", ping: true });
    expect(turnStep(read("factory"), "ready-to-merge")).toEqual({ record: "ready-to-merge", ping: true });
    expect(turnStep(read("needs-you"), "ready-to-merge")).toEqual({ record: "ready-to-merge", ping: true });
  });

  it("does nothing while the ticket stays in its lane, whatever step it names", () => {
    for (const lane of LANES) {
      expect(turnStep(read(lane), lane)).toEqual({ record: "none", ping: false });
    }
  });

  it("records leaving for the factory's turn, which re-arms the ping, and sends no resolved ping", () => {
    expect(turnStep(read("needs-you"), "factory")).toEqual({ record: "factory", ping: false });
    expect(turnStep(read("ready-to-merge"), "factory")).toEqual({ record: "factory", ping: false });
  });

  it("records the first turn of a ticket with no turn line; pings only a person's turn older lines did not ping", () => {
    expect(turnStep(read("none", false), "factory")).toEqual({ record: "factory", ping: false });
    expect(turnStep(read("none", false), "needs-you")).toEqual({ record: "needs-you", ping: true });
    expect(turnStep(read("ready-to-merge", false), "ready-to-merge")).toEqual({
      record: "ready-to-merge",
      ping: false,
    });
  });
});

describe("turnDue: a person's turn no pass has pinged is in flight", () => {
  const manual: Action = { kind: "wait", wait: "manual-ci", why: "a manual CI job waits for a person" };
  it("is due until the turn is recorded, and never for the factory's turn", () => {
    expect(turnDue(state({ turn: "factory", turnRead: true }), manual)).toBe(true);
    expect(turnDue(state({ turn: "needs-you", turnRead: true }), manual)).toBe(false);
    expect(turnDue(state({ turn: "needs-you", turnRead: true }), { kind: "review", head: H })).toBe(false);
  });
});

describe("turnPing: what the person reads", () => {
  it("names the wait's why and the person's step", () => {
    expect(
      turnPing({
        state: state(),
        action: { kind: "wait", wait: "ci-skipped", why: "CI skipped this head" },
        change: 12,
      }),
    ).toEqual({
      kind: "needs-you",
      ticket: "PROJ-1",
      change: 12,
      why: "CI skipped this head",
      next: "starts CI at this head on the git host, or pushes a commit",
    });
  });

  it("gives the needs-human label's wait the newest hand-over's reason, and a blocked run's own why", () => {
    const label: Action = { kind: "wait", wait: "needs-human", why: "needs-human: a person decides" };
    expect(
      turnPing({ state: state({ blocked: ["first", "CI is still red"] }), action: label, change: 12 }),
    ).toMatchObject({ why: "CI is still red" });
    const blockedRun = "the writer's run is blocked: no key";
    expect(turnPing({ state: state({ blockedRun }), action: label, change: 12 })).toMatchObject({
      why: `needs-human: a person decides; ${blockedRun}`,
    });
    const manual: Action = { kind: "wait", wait: "manual-ci", why: "a manual CI job waits for a person" };
    expect(turnPing({ state: state({ blockedRun }), action: manual, change: 12 })).toMatchObject({
      why: "a manual CI job waits for a person",
    });
  });

  it("says a design note is the design review's, and a green gate's head", () => {
    const note: Action = { kind: "design-note", spec: "s", why: "no further design review (round cap)" };
    expect(turnPing({ state: state(), action: note, change: "none" })).toMatchObject({
      why: "design review: no further design review (round cap)",
    });
    expect(turnPing({ state: state(), action: { kind: "ping", head: H }, change: 12 })).toEqual({
      kind: "ready",
      ticket: "PROJ-1",
      change: 12,
      head: H,
    });
    const green: Action = { kind: "wait", wait: "merge", why: "the gate is green; the human reviews and merges" };
    expect(turnPing({ state: state(), action: green, change: 12 })).toMatchObject({ kind: "ready", head: H });
  });
});

describe("the turn in the summary", () => {
  const at = (minute: number) => `2026-11-07T09:${String(minute).padStart(2, "0")}:00Z`;
  const turnOf = (events: readonly Event[]) => {
    const s = summarize({ events, since: "1970-01-01T00:00:00Z" });
    return [s.turn, s.turnRead];
  };
  const started: Event = { at: at(1), kind: "started", phase: "writer", mode: "fix", head: H };
  const asked: Extract<Event, { kind: "writer-ended" }> = {
    at: at(2),
    kind: "writer-ended",
    mode: "fix",
    head: H,
    outcome: "asked",
    patch: "",
    evidence: [],
    hung: false,
  };

  it("takes the turn from the lines the old code pinged with, when there is no turn line", () => {
    expect(turnOf([])).toEqual(["none", false]);
    expect(turnOf([{ at: at(3), kind: "pinged", head: H }])).toEqual(["ready-to-merge", false]);
    expect(turnOf([{ at: at(3), kind: "blocked", why: "x" }])).toEqual(["needs-you", false]);
    expect(turnOf([started, asked])).toEqual(["needs-you", false]);
    expect(turnOf([{ at: at(0), kind: "pinged", head: H }, started])).toEqual(["factory", false]);
  });

  it("moves only on turn lines once one is read", () => {
    const turn: Event = { at: at(0), kind: "turn", to: "factory" };
    expect(turnOf([turn, started, asked, { at: at(3), kind: "pinged", head: H }])).toEqual(["factory", true]);
    expect(turnOf([turn, { at: at(4), kind: "turn", to: "needs-you" }])).toEqual(["needs-you", true]);
  });

  it("reads a turn line for every lane, and never counts one as the ticket's activity", () => {
    for (const to of LANES) {
      expect(turnOf([{ at: at(4), kind: "turn", to }])).toEqual([to, true]);
    }
    const s = summarize({ events: [started, { at: at(9), kind: "turn", to: "needs-you" }], since: at(0) });
    expect(s.lastAt).toBe(at(1));
    expect(summarize({ events: [{ at: at(9), kind: "turn", to: "factory" }], since: at(0) }).lastAt).toBe("");
  });

  it("keeps a blocked run's why until the next run starts", () => {
    const blocked: Event = { ...asked, outcome: "blocked", why: "no key" };
    const s = (events: readonly Event[]) => summarize({ events, since: "1970-01-01T00:00:00Z" }).blockedRun;
    expect(s([blocked])).toBe("the writer's run is blocked: no key");
    expect(s([blocked, { ...started, at: at(5) }])).toBe("");
  });
});
