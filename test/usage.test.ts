import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NO_STREAM, spendOf, streamOf, streamSpend } from "../src/core/dispatch/spend.js";
import { periodsAt, readSpends, totalOf, usageLines, type Spent } from "../src/core/dispatch/usage.js";
import { usageCommand } from "../src/usage-cli.js";
import { runCli, type Io } from "../src/app.js";
import { tempDir } from "./temp.js";

// Every run records its tokens and cost, and `usage` sums them from the run records (#131).

const RESULT = {
  type: "result",
  total_cost_usd: 1.5,
  usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 1, cache_read_input_tokens: 100 },
};

describe("a run's spend, from the agent CLI's output", () => {
  it("reads the cost and every token of an answer; a missing or bad figure counts 0", () => {
    expect(spendOf(RESULT)).toEqual({ usd: 1.5, tokens: 116 });
    expect(spendOf({ total_cost_usd: "1", usage: { input_tokens: -3, output_tokens: 2 } })).toEqual({
      usd: 0,
      tokens: 2,
    });
    expect(spendOf(undefined)).toEqual({ usd: 0, tokens: 0 });
  });

  it("finds the result event in stream-json output, however the output is cut into pieces", () => {
    const text = `{"type":"system"}\n{"type":"assistant","message":{"content":"the result"}}\n${JSON.stringify(RESULT)}\n`;
    const whole = streamOf(NO_STREAM, text);
    expect(streamSpend(whole)).toEqual({ usd: 1.5, tokens: 116 });
    const pieces = text.match(/.{1,7}/gs) ?? [];
    expect(streamSpend(pieces.reduce(streamOf, NO_STREAM))).toEqual({ usd: 1.5, tokens: 116 });
    // the last line with no newline yet still counts
    expect(streamSpend(streamOf(NO_STREAM, JSON.stringify(RESULT)))).toEqual({ usd: 1.5, tokens: 116 });
  });

  it("is unmeasured with no result event, and never keeps a line past the most", () => {
    expect(streamSpend(streamOf(NO_STREAM, '{"type":"assistant"}\n{"type":"res'))).toBe("unmeasured");
    const long = streamOf(NO_STREAM, "x".repeat(1024 * 1024 + 1));
    expect(long.partial).toBe("");
    expect(streamSpend(long)).toBe("unmeasured");
  });
});

const NOW = Date.parse("2026-11-09T12:00:00Z");

function spent(at: string, usd: number, over: Partial<Spent> = {}): Spent {
  return { project: "ledger", ticket: "PROJ-1", at, spend: { usd, tokens: usd * 1000 }, ...over };
}

describe("usage sums", () => {
  it("today, the window and the month start at UTC midnight, now less the window, and the 1st", () => {
    expect(periodsAt(NOW, 5)).toEqual({
      day: Date.parse("2026-11-09T00:00:00Z"),
      window: Date.parse("2026-11-09T07:00:00Z"),
      month: Date.parse("2026-11-01T00:00:00Z"),
    });
  });

  it("counts a run with no spend as unmeasured, never as free", () => {
    const runs = [spent("2026-11-09T08:00:00Z", 1), spent("2026-11-09T09:00:00Z", 0, { spend: "unmeasured" })];
    expect(totalOf(runs, 0)).toEqual({ spend: { usd: 1, tokens: 1000 }, unmeasured: 1 });
  });

  it("shows all, each project and each ticket, today, in the window and this month", () => {
    const runs = [
      spent("2026-10-31T23:00:00Z", 8),
      spent("2026-11-02T10:00:00Z", 4),
      spent("2026-11-09T01:00:00Z", 2),
      spent("2026-11-09T11:00:00Z", 1, { ticket: "PROJ-2" }),
      spent("2026-11-09T11:30:00Z", 0, { project: "atlas", spend: "unmeasured" }),
    ];
    const lines = usageLines({ runs, now: NOW, windowHours: 5 });
    expect(lines[0]).toBe("usage at 2026-11-09T12:00:00.000Z: days and months in UTC, the window is the last 5 h");
    expect(lines.slice(1, -1)).toEqual([
      "          today               window              month",
      "all       $3.00 3000 tok +1?  $1.00 1000 tok +1?  $7.00 7000 tok +1?",
      "atlas     $0.00 0 tok +1?     $0.00 0 tok +1?     $0.00 0 tok +1?",
      "  PROJ-1  $0.00 0 tok +1?     $0.00 0 tok +1?     $0.00 0 tok +1?",
      "ledger    $3.00 3000 tok      $1.00 1000 tok      $7.00 7000 tok",
      "  PROJ-1  $2.00 2000 tok      $0.00 0 tok         $6.00 6000 tok",
      "  PROJ-2  $1.00 1000 tok      $1.00 1000 tok      $1.00 1000 tok",
    ]);
  });

  it("a window that reaches back into last month still counts its runs", () => {
    const runs = [spent("2026-10-31T23:00:00Z", 8)];
    const lines = usageLines({ runs, now: Date.parse("2026-11-01T01:00:00Z"), windowHours: 5 });
    expect(lines[2]?.split(/\s{2,}/)).toEqual(["all", "$0.00 0 tok", "$8.00 8000 tok", "$0.00 0 tok"]);
  });
});

describe("agent-factory usage", () => {
  let home = "";
  beforeEach(() => {
    home = tempDir("factory-usage-");
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  function write(project: string, ticket: string, lines: readonly unknown[]): void {
    mkdirSync(join(home, "runs", project), { recursive: true });
    writeFileSync(join(home, "runs", project, `${ticket}.jsonl`), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  }

  const writerEnded = (at: string, spend?: unknown) => ({
    at,
    kind: "writer-ended",
    mode: "fix",
    head: "1".repeat(40),
    outcome: "done",
    patch: "p",
    evidence: [],
    hung: false,
    ...(spend === undefined ? {} : { spend }),
  });

  it("reads the writer's and the reviewer's ends from every project's run records", async () => {
    write("ledger", "PROJ-1", [
      { at: "2026-11-09T09:00:00Z", kind: "started", phase: "writer", mode: "fix", head: "1".repeat(40) },
      writerEnded("2026-11-09T09:30:00Z", { usd: 2, tokens: 10 }),
      {
        at: "2026-11-09T10:00:00Z",
        kind: "review-ended",
        head: "1".repeat(40),
        actOn: 0,
        spend: { usd: 1, tokens: 5 },
      },
    ]);
    write("atlas", "A-1", [writerEnded("2026-11-09T09:30:00Z")]);
    const all = await readSpends({ home });
    expect(all.problems).toEqual([]);
    expect(all.runs.map((r) => [r.project, r.ticket, r.spend])).toEqual([
      ["atlas", "A-1", "unmeasured"],
      ["ledger", "PROJ-1", { usd: 2, tokens: 10 }],
      ["ledger", "PROJ-1", { usd: 1, tokens: 5 }],
    ]);
    expect((await readSpends({ home, project: "atlas" })).runs).toHaveLength(1);
  });

  it("prints the table, names a ticket whose records cannot be read, and exits 1 for it", async () => {
    write("ledger", "PROJ-1", [writerEnded("2026-11-09T09:30:00Z", { usd: 2, tokens: 10 })]);
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    writeFileSync(join(home, "runs", "ledger", "PROJ-2.jsonl"), "not a record\n");
    const out: string[] = [];
    const err: string[] = [];
    const io = { env: {}, home, now: () => NOW, out: (t: string) => out.push(t), err: (t: string) => err.push(t) };
    expect(await usageCommand(["ledger"], io)).toBe(1);
    expect(out.join("")).toContain("  PROJ-1  $2.00 10 tok  $2.00 10 tok  $2.00 10 tok");
    expect(err.join("")).toContain("PROJ-2.jsonl line 1 is not a record");
  });

  it("reads the window from window.hours, and refuses a bad one or a bad project name", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const io = (env: NodeJS.ProcessEnv) => ({
      env,
      home,
      now: () => NOW,
      out: (t: string) => out.push(t),
      err: (t: string) => err.push(t),
    });
    expect(await usageCommand([], io({ FACTORY_WINDOW_HOURS: "3" }))).toBe(0);
    expect(out[0]).toContain("the window is the last 3 h");
    expect(await usageCommand([], io({ FACTORY_WINDOW_HOURS: "25" }))).toBe(1);
    expect(err.join("")).toContain("FACTORY_WINDOW_HOURS must be a whole number of hours from 1 to 24");
    expect(await usageCommand(["../x"], io({}))).toBe(64);
  });

  it("is a command of the CLI, listed in its help", async () => {
    const out: string[] = [];
    const io: Io = {
      env: { FACTORY_HOME: home },
      out: (t) => out.push(t),
      err: () => undefined,
      readSecret: async () => "",
      readStdin: async () => "",
      system: {
        platform: "linux",
        uid: 501,
        gid: 20,
        run: async () => ({ code: 1, stdout: "", stderr: "no CLI in this test" }),
        interactive: async () => 1,
        background: async () => ({ kind: "failed", reason: "no background in this test" }),
      },
    };
    expect(await runCli(["usage"], io)).toBe(0);
    expect(out.join("")).toContain("today");
    out.length = 0;
    await runCli(["--help"], io);
    expect(out.join("")).toContain("usage [<project>]");
  });
});
