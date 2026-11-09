import { describe, expect, it } from "vitest";
import { capsOf, NO_CAPS, projectStop, ticketCapped } from "../src/core/dispatch/caps.js";
import { keyById } from "../src/core/settings/keys.js";
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
      },
    });
    expect(capsOf({ FACTORY_MAX_USD_DAY: "0" })).toEqual({
      kind: "failed",
      reason: "FACTORY_MAX_USD_DAY must be a dollar amount above 0",
    });
    expect(capsOf({ FACTORY_MAX_TOKENS_TICKET: "1.5" })).toMatchObject({ reason: expect.stringContaining("whole") });
    expect(capsOf({ FACTORY_WINDOW_HOURS: "0" })).toMatchObject({ kind: "failed" });
  });

  it("per run: the writer's run carries the run cap as --max-budget-usd", () => {
    const argv = claudeArgv({ maxUsd: "2", model: "" });
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
    const unmeasured: Spent = { project: "ledger", ticket: "PROJ-1", at: "2026-11-09T11:00:00Z", spend: "unmeasured" };
    expect(projectStop({ project: [unmeasured], machine: [], now: NOW, caps })).toEqual({ kind: "go" });
  });
});
