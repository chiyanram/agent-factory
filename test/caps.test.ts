import { describe, expect, it } from "vitest";
import { capsOf, heldWords, NO_CAPS, overCaps, projectStop, roomAt, ticketCapped } from "../src/core/dispatch/caps.js";
import { hoursOf, openAt, within } from "../src/core/dispatch/hours.js";
import { keyById } from "../src/core/settings/keys.js";
import { settingName } from "../src/core/settings/machine.js";
import { claudeArgv } from "../src/core/writer/run.js";
import type { Spent } from "../src/core/dispatch/usage.js";

// The caps on spend (#131): per run, per ticket, per project-day, and the share of a window with its stop line.

describe("the caps are cap-class settings keys", () => {
  it("every cap is a cap, so the lowest layer wins", () => {
    for (const id of [
      "caps.usdPerRun",
      "caps.usdPerTicket",
      "caps.tokensPerTicket",
      "caps.usdPerProjectDay",
      "caps.tokensPerProjectDay",
      "caps.windowTokens",
      "caps.machineWindowTokens",
    ]) {
      expect(keyById(id)?.class).toBe("cap");
    }
  });

  it("reads each cap through its setting; none set is no cap, and a bad one refuses the pass", () => {
    expect(capsOf({})).toEqual({ kind: "ok", value: NO_CAPS });
    expect(
      capsOf({
        FACTORY_MAX_USD_TICKET: "4.5",
        FACTORY_MAX_TOKENS_TICKET: "9000",
        FACTORY_MAX_USD_DAY: "20",
        FACTORY_MAX_TOKENS_DAY: "1000000",
        FACTORY_WINDOW_TOKENS: "500",
        FACTORY_MACHINE_WINDOW_TOKENS: "800",
        FACTORY_WINDOW_HOURS: "3",
      }),
    ).toEqual({
      kind: "ok",
      value: {
        ticket: { usd: 4.5, tokens: 9000 },
        day: { usd: 20, tokens: 1_000_000 },
        window: { tokens: 500, machineTokens: 800 },
        windowHours: 3,
        runsAtOnce: 1,
        runHours: "any",
      },
    });
    expect(capsOf({ FACTORY_MAX_RUNS: "3", FACTORY_RUN_HOURS: "22-06" })).toMatchObject({
      kind: "ok",
      value: { runsAtOnce: 3, runHours: { from: 22, to: 6, text: "22-06" } },
    });
    expect(capsOf({ FACTORY_MAX_RUNS: "0" })).toMatchObject({ reason: expect.stringContaining("FACTORY_MAX_RUNS") });
    expect(capsOf({ FACTORY_RUN_HOURS: "9-17" })).toEqual({
      kind: "failed",
      reason:
        'FACTORY_RUN_HOURS must be hours in UTC as "HH-HH", from 00 to 24, such as "22-06"; not empty, got "9-17"',
    });
    expect(capsOf({ FACTORY_MAX_USD_DAY: "0" })).toEqual({
      kind: "failed",
      reason: "FACTORY_MAX_USD_DAY must be a dollar amount above 0",
    });
    expect(capsOf({ FACTORY_MAX_TOKENS_TICKET: "1.5" })).toMatchObject({ reason: expect.stringContaining("whole") });
    expect(capsOf({ FACTORY_WINDOW_HOURS: "0" })).toMatchObject({ kind: "failed" });
  });

  it("per run: the writer's run carries the run cap as --max-budget-usd", () => {
    const argv = claudeArgv({ maxUsd: "2", model: "" }, { kind: "none" }, 1, ["Read"], "vm");
    expect(argv.slice(argv.indexOf("--max-budget-usd"), argv.indexOf("--max-budget-usd") + 2)).toEqual([
      "--max-budget-usd",
      "2",
    ]);
  });
});

describe("the ticket cap", () => {
  const caps = { ...NO_CAPS, ticket: { usd: 2, tokens: 1000 } };

  it("is reached at its dollars or its tokens, and names what the ticket spent", () => {
    expect(ticketCapped({ usd: 1.99, tokens: 999 }, caps)).toBe("");
    expect(ticketCapped({ usd: 2, tokens: 0 }, caps)).toBe(
      "the ticket spent $2.00 and 0 tokens since its approval, at its cap of $2 (FACTORY_MAX_USD_TICKET)",
    );
    expect(ticketCapped({ usd: 0, tokens: 1000 }, caps)).toBe(
      "the ticket spent $0.00 and 1000 tokens since its approval, at its cap of 1000 tokens (FACTORY_MAX_TOKENS_TICKET)",
    );
    expect(ticketCapped({ usd: 99, tokens: 99_999 }, NO_CAPS)).toBe("");
  });
});

describe("the project's stop: the day cap, then the window share, then the machine's", () => {
  const NOW = Date.parse("2026-11-09T12:00:00Z");
  const run = (at: string, usd: number, tokens: number, project = "ledger"): Spent => ({
    project,
    ticket: "PROJ-1",
    at,
    kind: "implementer",
    spend: { usd, tokens },
  });

  it("counts only today's runs for the day cap, and keys its one notice by the day", () => {
    const caps = { ...NO_CAPS, day: { usd: 5, tokens: "none" as const } };
    const yesterday = [run("2026-11-08T23:59:00Z", 9, 0)];
    expect(projectStop({ project: yesterday, machine: [], now: NOW, caps })).toEqual({ kind: "go" });
    const today = [...yesterday, run("2026-11-09T00:00:00Z", 5, 0)];
    expect(projectStop({ project: today, machine: [], now: NOW, caps })).toMatchObject({
      kind: "stop",
      notice: "day 2026-11-09",
    });
  });

  it("the window share is the stop line: reached by the tokens in the last window.hours", () => {
    const caps = { ...NO_CAPS, window: { tokens: 100, machineTokens: "none" as const }, windowHours: 2 };
    const old = run("2026-11-09T09:59:00Z", 0, 500);
    expect(projectStop({ project: [old], machine: [], now: NOW, caps })).toEqual({ kind: "go" });
    const recent = run("2026-11-09T10:00:00Z", 0, 100);
    expect(projectStop({ project: [old, recent], machine: [], now: NOW, caps })).toMatchObject({
      kind: "stop",
      why: "in the last 2 h the project spent $0.00 and 100 tokens, at the cap of 100 tokens (FACTORY_WINDOW_TOKENS)",
    });
  });

  it("the machine's share sums every project, and the day cap comes first", () => {
    const caps = {
      ...NO_CAPS,
      day: { usd: "none" as const, tokens: 50 },
      window: { tokens: "none" as const, machineTokens: 100 },
    };
    const mine = [run("2026-11-09T11:00:00Z", 0, 40)];
    const all = [...mine, run("2026-11-09T11:00:00Z", 0, 60, "atlas")];
    expect(projectStop({ project: mine, machine: all, now: NOW, caps })).toMatchObject({
      why: expect.stringContaining("every project on this machine spent $0.00 and 100 tokens"),
    });
    const more = [...mine, run("2026-11-09T11:30:00Z", 0, 10)];
    expect(projectStop({ project: more, machine: all, now: NOW, caps })).toMatchObject({
      why: expect.stringContaining("FACTORY_MAX_TOKENS_DAY"),
    });
  });

  it("a run with no spend recorded adds nothing", () => {
    const caps = { ...NO_CAPS, day: { usd: "none" as const, tokens: 1 } };
    const unmeasured: Spent = {
      project: "ledger",
      ticket: "PROJ-1",
      at: "2026-11-09T11:00:00Z",
      kind: "implementer",
      spend: "unmeasured",
    };
    expect(projectStop({ project: [unmeasured], machine: [], now: NOW, caps })).toEqual({ kind: "go" });
  });

  it("says when a run may start again: the next UTC day, or when the window's oldest runs leave it (#305)", () => {
    const day = { ...NO_CAPS, day: { usd: 5, tokens: "none" as const } };
    const stop = projectStop({ project: [run("2026-11-09T01:00:00Z", 5, 0)], machine: [], now: NOW, caps: day });
    expect(stop).toMatchObject({ period: "day", until: Date.parse("2026-11-10T00:00:00Z") });
    expect(stop.kind === "stop" ? heldWords(stop, "ledger") : "").toBe(
      "the project-day cap is reached: today (2026-11-09, UTC) the project spent $5.00 and 0 tokens, at the cap of $5 (FACTORY_MAX_USD_DAY); run `agent-factory dispatch ledger` again tomorrow",
    );
    const share = { ...NO_CAPS, window: { tokens: 100, machineTokens: "none" as const }, windowHours: 2 };
    // 60 + 50 + 30 in the window: it has room (80 under 100) once the first has left it, at 10:20 + 2 h
    const runs = [
      run("2026-11-09T10:20:00Z", 0, 60),
      run("2026-11-09T10:40:00Z", 0, 50),
      run("2026-11-09T11:00:00Z", 0, 30),
    ];
    const full = projectStop({ project: runs, machine: [], now: NOW, caps: share });
    expect(full).toMatchObject({ period: "window", until: Date.parse("2026-11-09T12:20:00Z") });
    expect(full.kind === "stop" ? heldWords(full, "ledger") : "").toMatch(
      /^the window is full until 12:20 UTC: in the last 2 h .*; run `agent-factory dispatch ledger` again then$/,
    );
    expect(roomAt({ runs, from: 0, hours: 2, limit: 50, unit: "tokens" })).toBe(Date.parse("2026-11-09T12:40:00Z"));
  });
});

describe("run hours (#299)", () => {
  it("reads HH-HH in UTC, wrapping past midnight; refuses an empty or malformed one", () => {
    expect(hoursOf("22-06")).toEqual({ from: 22, to: 6, text: "22-06" });
    expect(["06-06", "24-00", "9-17", "25-01", "", 6, undefined].map(hoursOf)).toEqual(Array(7).fill("bad"));
    const night = hoursOf("22-06");
    const all = hoursOf("00-24");
    if (night === "bad" || all === "bad") {
      throw new Error("unreadable");
    }
    const hour = (h: number) => Date.UTC(2026, 10, 7, h, 30);
    expect([21, 22, 23, 0, 5, 6].map((h) => openAt(night, hour(h)))).toEqual([false, true, true, true, true, false]);
    expect([0, 12, 23].every((h) => openAt(all, hour(h)))).toBe(true);
  });

  it("a lower value is within the one above only when every hour of it is", () => {
    expect(within("23-05", "22-06")).toBe(true);
    expect(within("01-03", "00-24")).toBe(true);
    expect(within("21-06", "22-06")).toBe(false);
    expect(within("bad", "22-06")).toBe(false);
  });
});

describe("overCaps: a review round's worst case against the dollar caps (#237)", () => {
  const caps = { ...NO_CAPS, ticket: { usd: 5, tokens: "none" }, day: { usd: 10, tokens: "none" } } as const;
  const spent = (usd: number) => ({ usd, tokens: 0 });

  it("holds a round that could pass the ticket's or the day's cap, naming the cap and what is left", () => {
    expect(overCaps({ worst: 3, ticket: spent(2), day: spent(0), caps })).toBe("");
    expect(overCaps({ worst: 3.5, ticket: spent(2), day: spent(0), caps })).toContain(
      `more than the $3.00 left under ${settingName("caps.usdPerTicket")}`,
    );
    expect(overCaps({ worst: 3, ticket: spent(0), day: spent(8), caps })).toContain(
      `more than the $2.00 left under ${settingName("caps.usdPerProjectDay")}`,
    );
  });

  it("never holds an unbounded worst case, or a project with no dollar caps", () => {
    expect(overCaps({ worst: "unbounded", ticket: spent(5), day: spent(10), caps })).toBe("");
    expect(overCaps({ worst: 100, ticket: spent(5), day: spent(10), caps: NO_CAPS })).toBe("");
  });
});
