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
  return { project: "ledger", ticket: "PROJ-1", at, kind: "implementer", spend: { usd, tokens: usd * 1000 }, ...over };
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
    expect(lines.slice(1, -2)).toEqual([
      "          kind         today               window              month",
      "all       implementer  $3.00 3000 tok +1?  $1.00 1000 tok +1?  $7.00 7000 tok +1?",
      "atlas     implementer  $0.00 0 tok +1?     $0.00 0 tok +1?     $0.00 0 tok +1?",
      "  PROJ-1  implementer  $0.00 0 tok +1?     $0.00 0 tok +1?     $0.00 0 tok +1?",
      "ledger    implementer  $3.00 3000 tok      $1.00 1000 tok      $7.00 7000 tok",
      "  PROJ-1  implementer  $2.00 2000 tok      $0.00 0 tok         $6.00 6000 tok",
      "  PROJ-2  implementer  $1.00 1000 tok      $1.00 1000 tok      $1.00 1000 tok",
    ]);
  });

  it("a window that reaches back into last month still counts its runs", () => {
    const runs = [spent("2026-10-31T23:00:00Z", 8)];
    const lines = usageLines({ runs, now: Date.parse("2026-11-01T01:00:00Z"), windowHours: 5 });
    expect(lines[2]?.split(/\s{2,}/)).toEqual(["all", "implementer", "$0.00 0 tok", "$8.00 8000 tok", "$0.00 0 tok"]);
  });

  it("splits each period, per project and per ticket, by run kind, and a ticket's finders by lens (#337)", () => {
    const runs = [
      spent("2026-11-02T10:00:00Z", 4, { kind: "design-reviewer" }),
      spent("2026-11-02T10:05:00Z", 1, { kind: "verify pass" }),
      spent("2026-11-05T10:00:00Z", 3, { kind: "automated review" }),
      spent("2026-11-09T01:00:00Z", 2, { kind: "test-first" }),
      spent("2026-11-09T08:00:00Z", 3),
      spent("2026-11-09T09:00:00Z", 0, { spend: "unmeasured" }),
      spent("2026-11-09T10:00:00Z", 1, { kind: "cleanup" }),
      spent("2026-11-09T11:00:00Z", 2, { kind: "finder", lens: "errors" }),
      spent("2026-11-09T11:00:00Z", 1, { kind: "finder", lens: "api" }),
      spent("2026-11-09T11:00:00Z", 1, { kind: "verify pass" }),
      spent("2026-11-09T11:30:00Z", 5, { ticket: "PROJ-2" }),
      spent("2026-11-03T09:00:00Z", 6, { project: "atlas", ticket: "onboarder", kind: "onboarder" }),
    ];
    const lines = usageLines({ runs, now: NOW, windowHours: 5 });
    expect(lines.slice(1, -2)).toEqual([
      "             kind              today                 window                month",
      "all          all               $15.00 15000 tok +1?  $13.00 13000 tok +1?  $29.00 29000 tok +1?",
      "             design-reviewer   $0.00 0 tok           $0.00 0 tok           $4.00 4000 tok",
      "             test-first        $2.00 2000 tok        $0.00 0 tok           $2.00 2000 tok",
      "             implementer       $8.00 8000 tok +1?    $8.00 8000 tok +1?    $8.00 8000 tok +1?",
      "             cleanup           $1.00 1000 tok        $1.00 1000 tok        $1.00 1000 tok",
      "             finder            $3.00 3000 tok        $3.00 3000 tok        $3.00 3000 tok",
      "             verify pass       $1.00 1000 tok        $1.00 1000 tok        $2.00 2000 tok",
      "             onboarder         $0.00 0 tok           $0.00 0 tok           $6.00 6000 tok",
      "             automated review  $0.00 0 tok           $0.00 0 tok           $3.00 3000 tok",
      "atlas        onboarder         $0.00 0 tok           $0.00 0 tok           $6.00 6000 tok",
      "  onboarder  onboarder         $0.00 0 tok           $0.00 0 tok           $6.00 6000 tok",
      "ledger       all               $15.00 15000 tok +1?  $13.00 13000 tok +1?  $23.00 23000 tok +1?",
      "             design-reviewer   $0.00 0 tok           $0.00 0 tok           $4.00 4000 tok",
      "             test-first        $2.00 2000 tok        $0.00 0 tok           $2.00 2000 tok",
      "             implementer       $8.00 8000 tok +1?    $8.00 8000 tok +1?    $8.00 8000 tok +1?",
      "             cleanup           $1.00 1000 tok        $1.00 1000 tok        $1.00 1000 tok",
      "             finder            $3.00 3000 tok        $3.00 3000 tok        $3.00 3000 tok",
      "             verify pass       $1.00 1000 tok        $1.00 1000 tok        $2.00 2000 tok",
      "             automated review  $0.00 0 tok           $0.00 0 tok           $3.00 3000 tok",
      "  PROJ-1     all               $10.00 10000 tok +1?  $8.00 8000 tok +1?    $18.00 18000 tok +1?",
      "             design-reviewer   $0.00 0 tok           $0.00 0 tok           $4.00 4000 tok",
      "             test-first        $2.00 2000 tok        $0.00 0 tok           $2.00 2000 tok",
      "             implementer       $3.00 3000 tok +1?    $3.00 3000 tok +1?    $3.00 3000 tok +1?",
      "             cleanup           $1.00 1000 tok        $1.00 1000 tok        $1.00 1000 tok",
      "             finder (api)      $1.00 1000 tok        $1.00 1000 tok        $1.00 1000 tok",
      "             finder (errors)   $2.00 2000 tok        $2.00 2000 tok        $2.00 2000 tok",
      "             verify pass       $1.00 1000 tok        $1.00 1000 tok        $2.00 2000 tok",
      "             automated review  $0.00 0 tok           $0.00 0 tok           $3.00 3000 tok",
      "  PROJ-2     implementer       $5.00 5000 tok        $5.00 5000 tok        $5.00 5000 tok",
    ]);
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

  const writerEnded = (at: string, spend?: unknown, mode = "fix") => ({
    at,
    kind: "writer-ended",
    mode,
    head: "1".repeat(40),
    outcome: "done",
    patch: "p",
    evidence: [],
    hung: false,
    ...(spend === undefined ? {} : { spend }),
  });

  it("names each record's run kind: the writer's mode, each finder and verify pass of a round, an older round, each design review run, the onboarder", async () => {
    const head = "1".repeat(40);
    const designEnded = (step: string, spend: unknown) => ({
      at: "2026-11-09T08:00:00Z",
      kind: "design-ended",
      step,
      spec: "s",
      design: "d",
      outcome: "done",
      why: "",
      findings: [],
      kept: [],
      spend,
    });
    write("ledger", "PROJ-1", [
      designEnded("review", { usd: 1, tokens: 1 }),
      designEnded("verify", { usd: 2, tokens: 2 }),
      writerEnded("2026-11-09T09:00:00Z", { usd: 3, tokens: 3 }, "test-first"),
      ...["fix", "rework", "ci", "rebase"].map((mode) => writerEnded("2026-11-09T09:10:00Z", undefined, mode)),
      writerEnded("2026-11-09T09:30:00Z", { usd: 4, tokens: 4 }, "cleanup"),
      { at: "2026-11-09T10:00:00Z", kind: "review-ended", head, actOn: 0, spend: { usd: 5, tokens: 5 } },
      { at: "2026-11-09T10:30:00Z", kind: "spent", phase: "review", head, spend: { usd: 6, tokens: 6 } },
      // a round's line with its spend per run (#337): each finder's by lens, and the verify pass's
      {
        at: "2026-11-09T11:00:00Z",
        kind: "review-ended",
        head,
        actOn: 0,
        spend: { usd: 6, tokens: 6 },
        split: {
          finders: { errors: { usd: 2, tokens: 2 }, api: { usd: 1, tokens: 1 } },
          verify: { usd: 3, tokens: 3 },
        },
      },
      // a failed round's, whose verify pass never ran
      {
        at: "2026-11-09T11:30:00Z",
        kind: "spent",
        phase: "review",
        head,
        spend: { usd: 2, tokens: 2 },
        split: { finders: { errors: { usd: 2, tokens: 2 } }, verify: { usd: 0, tokens: 0 } },
      },
    ]);
    write("ledger", "onboarder", [
      { at: "2026-11-09T07:00:00Z", kind: "spent", phase: "onboard", head, spend: { usd: 7, tokens: 7 } },
    ]);
    const read = await readSpends({ home });
    expect(read.problems).toEqual([]);
    expect(read.runs.map((r) => [r.ticket, r.kind, r.lens ?? ""])).toEqual([
      ["PROJ-1", "design-reviewer", ""],
      ["PROJ-1", "verify pass", ""],
      ["PROJ-1", "test-first", ""],
      ["PROJ-1", "implementer", ""],
      ["PROJ-1", "implementer", ""],
      ["PROJ-1", "implementer", ""],
      ["PROJ-1", "implementer", ""],
      ["PROJ-1", "cleanup", ""],
      ["PROJ-1", "automated review", ""],
      ["PROJ-1", "automated review", ""],
      ["PROJ-1", "finder", "errors"],
      ["PROJ-1", "finder", "api"],
      ["PROJ-1", "verify pass", ""],
      ["PROJ-1", "finder", "errors"],
      ["onboarder", "onboarder", ""],
    ]);
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
    expect(out.join("")).toContain("  PROJ-1  implementer  $2.00 10 tok  $2.00 10 tok  $2.00 10 tok");
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
