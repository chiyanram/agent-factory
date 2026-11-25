import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  closedReason,
  EMPTY,
  isActivity,
  readRecords,
  record,
  summarize,
  tornPath,
  type Event,
} from "../src/core/dispatch/records.js";
import { END_REASONS, type EndReason } from "../src/core/end-reason.js";
import { prop } from "../src/core/field.js";
import { takeLock, type HeldLock } from "../src/core/lock.js";
import { tempDir } from "./temp.js";

const grow = vi.hoisted(() => ({ file: "", line: "" }));

vi.mock("node:fs/promises", async (actual) => {
  const real = await actual<typeof import("node:fs/promises")>();
  const { appendFileSync: append } = await import("node:fs");
  return {
    ...real,
    open: async (...args: Parameters<typeof real.open>) => {
      if (grow.file !== "" && args[0] === grow.file) {
        append(grow.file, grow.line);
      }
      return real.open(...args);
    },
  };
});

let home = "";
beforeEach(() => {
  home = tempDir("factory-records-");
});
afterEach(() => {
  grow.file = "";
  rmSync(home, { recursive: true, force: true });
});

async function passLock(): Promise<HeldLock> {
  const held = await takeLock(join(home, "runs", "ledger", ".lock"));
  if (held.kind !== "held") {
    throw new Error(`the test cannot take a pass lock: ${held.kind}`);
  }
  return held;
}

describe("the torn-line set-aside", () => {
  it("should keep the record file and the torn-line file unchanged when the record file grows during a set-aside", async () => {
    const file = join(home, "runs", "ledger", "PROJ-1.jsonl");
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    const started = JSON.stringify({ at: "2026-11-07T09:00:00Z", kind: "pinged", head: "a".repeat(40) });
    writeFileSync(file, `${started}\n{"at":"2026-11-07T09:10:00Z","kind":"writer-en`);
    grow.file = file;
    grow.line = "ded\n";
    const where = { home, project: "ledger", ticket: "PROJ-1" };
    const read = await readRecords(where, { warn: () => undefined, setAside: await passLock() });
    expect(read).toEqual({ kind: "failed", reason: `${file} grew while its torn last line was set aside` });
    expect(readFileSync(file, "utf8")).toBe(`${started}\n{"at":"2026-11-07T09:10:00Z","kind":"writer-ended\n`);
    expect(existsSync(tornPath(file))).toBe(false);
  });
});

describe("what a run record names: the CLI, its version and the model", () => {
  const where = () => ({ home, project: "ledger", ticket: "PROJ-1" });
  const file = () => join(home, "runs", "ledger", "PROJ-1.jsonl");
  const at = "2026-11-23T09:00:00Z";
  const head = "a".repeat(40);
  const runs = [
    { part: "baseline", cli: "claude", asked: "model-a", version: "9.9.9", model: "model-a-ran" },
    { part: "verify", cli: "claude", asked: "model-b" },
  ];
  const lines = [
    { at, kind: "started", phase: "writer", mode: "fix", head, cli: "claude", asks: { writer: "default" } },
    { at, kind: "started", phase: "review", mode: "none", head, cli: "claude", asks: { find: "a", rule: "b" } },
    {
      at,
      kind: "writer-ended",
      mode: "fix",
      head,
      outcome: "done",
      reason: "done",
      patch: "",
      evidence: [],
      hung: false,
      runs: [{ cli: "claude", asked: "default", version: "9.9.9", model: "m" }],
    },
    { at, kind: "review-ended", head, actOn: 0, runs, reason: "done" },
    { at, kind: "spent", phase: "review", head, spend: { usd: 0.1, tokens: 1 }, runs, reason: "unknown" },
    {
      at,
      kind: "parked",
      phase: "writer",
      head,
      until: "unknown",
      said: "",
      runs: [{ cli: "claude", asked: "x" }],
      reason: "usage_limit",
    },
    {
      at,
      kind: "design-ended",
      step: "review",
      spec: "s",
      design: "d",
      outcome: "done",
      reason: "done",
      why: "",
      findings: [],
      kept: [],
      runs: [{ cli: "claude", asked: "opus" }],
    },
  ] as const;

  function written(events: readonly unknown[]): void {
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    writeFileSync(file(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  }

  it("reads back cli and asks on a started line, and runs on each end line, as written", async () => {
    for (const line of lines) {
      expect(await record({ where: where(), event: line })).toEqual({ kind: "ok" });
    }
    expect(await readRecords(where())).toEqual({ kind: "ok", value: lines });
  });

  it("reads a line without them as before", async () => {
    const started = { at, kind: "started", phase: "ready", mode: "none", head };
    written([started]);
    expect(await readRecords(where())).toEqual({ kind: "ok", value: [started] });
  });

  it("drops a cli, asks or runs of the wrong shape, and keeps the rest of the line", async () => {
    const started = { at, kind: "started", phase: "writer", mode: "fix", head };
    const ended = { at, kind: "review-ended", reason: "done", head, actOn: 0 };
    written([
      { ...started, cli: 3, asks: { writer: 3 } },
      { ...ended, runs: [{ cli: "claude" }] },
    ]);
    expect(await readRecords(where())).toEqual({ kind: "ok", value: [started, ended] });
  });

  it("reads past a field it does not know, which is the rollback: older code reads past cli, asks and runs", async () => {
    const started = { at, kind: "started", phase: "ready", mode: "none", head };
    written([{ ...started, later: { any: "thing" } }]);
    expect(await readRecords(where())).toEqual({ kind: "ok", value: [started] });
  });
});

describe("the closed reason on every line that ends a run", () => {
  const where = () => ({ home, project: "ledger", ticket: "PROJ-1" });
  const file = () => join(home, "runs", "ledger", "PROJ-1.jsonl");
  const at = "2026-11-23T09:00:00Z";
  const head = "a".repeat(40);
  const writer = {
    at,
    kind: "writer-ended",
    mode: "fix",
    head,
    outcome: "blocked",
    patch: "",
    evidence: [],
    hung: false,
  } as const;
  const design = {
    at,
    kind: "design-ended",
    step: "review",
    spec: "s",
    design: "d",
    outcome: "failed",
    why: "the model run failed",
    findings: [],
    kept: [],
  } as const;
  const ready = { at, kind: "ready-ended", head, passed: false, why: "a row failed" } as const;
  const verify = { at, kind: "verify-ended", head, passed: true } as const;
  const review = { at, kind: "review-ended", head, actOn: 2 } as const;
  const parked = { at, kind: "parked", phase: "writer", head, until: "unknown", said: "limit" } as const;
  const spent = { at, kind: "spent", phase: "review", head, spend: { usd: 0.5, tokens: 10 } } as const;

  function written(events: readonly unknown[]): void {
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    writeFileSync(file(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  }

  it("reads back the reason on each line that ends a run, as written", async () => {
    const lines: readonly Event[] = [
      { ...writer, reason: "stalled" },
      { ...design, reason: "timed_out" },
      { ...ready, reason: "done" },
      { ...verify, reason: "done" },
      { ...review, reason: "done" },
      { ...parked, reason: "usage_limit" },
      { ...spent, reason: "launch_failed" },
    ];
    for (const line of lines) {
      expect(await record({ where: where(), event: line })).toEqual({ kind: "ok" });
    }
    expect(await readRecords(where())).toEqual({ kind: "ok", value: lines });
  });

  it("fails the read, with its line number, on a reason that is not on the list", async () => {
    written([writer, { ...review, reason: "no_room" }]);
    expect(await readRecords(where())).toEqual({
      kind: "failed",
      reason: `${file()} line 2 is not a record; fix or remove it`,
    });
  });

  it("reads a failed run's spent line that has no spend", async () => {
    const unmeasured = { at, kind: "spent", phase: "verify", head, reason: "unknown" } as const;
    written([unmeasured]);
    expect(await readRecords(where())).toEqual({ kind: "ok", value: [unmeasured] });
  });

  it("reads a setup-refused line, and fails one with no phase or why", async () => {
    const refused = { at, kind: "setup-refused", phase: "review", why: "the reviewer is not set up" } as const;
    written([refused]);
    expect(await readRecords(where())).toEqual({ kind: "ok", value: [refused] });
    written([{ at, kind: "setup-refused", phase: "review" }]);
    expect(await readRecords(where())).toMatchObject({ kind: "failed" });
  });

  it("reads a line written without a reason with its reason from its old fields only, never from its why", async () => {
    written([
      { ...writer, outcome: "done" },
      { ...writer, outcome: "asked" },
      { ...writer, why: "the run was stopped after 3600s" },
      { ...design, outcome: "done" },
      design,
      review,
      ready,
      verify,
      parked,
      spent,
    ]);
    const read = await readRecords(where());
    expect(read.kind === "ok" ? read.value.map(closedReason) : read).toEqual([
      "done",
      "asked",
      "unknown",
      "done",
      "unknown",
      "done",
      "done",
      "done",
      "usage_limit",
      "unknown",
    ]);
  });

  it("gives a line's own reason first, and none for a line that ends no run", () => {
    expect(closedReason({ ...writer, reason: "stalled" })).toBe("stalled");
    expect(closedReason({ at, kind: "started", phase: "writer", mode: "fix", head })).toBeUndefined();
    expect(closedReason({ at, kind: "setup-refused", phase: "writer", why: "no box" })).toBeUndefined();
  });

  const FAILED = [
    "setup_refused",
    "launch_failed",
    "timed_out",
    "stalled",
    "output_invalid",
    "oom_killed",
    "stopped",
    "unknown",
  ] as const;
  const AGREES: readonly { readonly line: object; readonly reasons: readonly EndReason[] }[] = [
    { line: { ...writer, outcome: "done" }, reasons: ["done"] },
    { line: { ...writer, outcome: "asked" }, reasons: ["asked"] },
    { line: { ...writer, outcome: "blocked" }, reasons: ["done", "asked", "blocked", ...FAILED] },
    { line: { ...design, outcome: "done" }, reasons: ["done"] },
    { line: { ...design, outcome: "failed" }, reasons: FAILED },
    { line: ready, reasons: ["done"] },
    { line: verify, reasons: ["done"] },
    { line: review, reasons: ["done"] },
    { line: parked, reasons: ["usage_limit"] },
    { line: spent, reasons: END_REASONS },
  ];
  const pairs = AGREES.flatMap(({ line, reasons }) =>
    END_REASONS.map((reason) => ({
      name: `${JSON.stringify({ kind: prop(line, "kind"), outcome: prop(line, "outcome") })} with ${reason}`,
      line: { ...line, reason },
      agrees: reasons.includes(reason),
    })),
  );

  it.each(pairs.filter((p) => !p.agrees))("fails the read of $name, a reason its outcome refuses", async ({ line }) => {
    written([review, line]);
    expect(await readRecords(where())).toEqual({
      kind: "failed",
      reason: `${file()} line 2 is not a record; fix or remove it`,
    });
  });

  it.each(pairs.filter((p) => p.agrees))("reads $name, a reason its outcome takes", async ({ line }) => {
    written([line]);
    expect(await readRecords(where())).toEqual({ kind: "ok", value: [line] });
  });

  it("counts neither a setup-refused line nor a spent line with no spend as activity", () => {
    expect(isActivity({ at, kind: "setup-refused", phase: "writer", why: "no box" })).toBe(false);
    expect(isActivity({ at, kind: "spent", phase: "verify", head, reason: "unknown" })).toBe(false);
    expect(isActivity({ ...spent, reason: "unknown" })).toBe(true);
  });

  it("keeps the newest refused setup until a run starts", () => {
    const refused: Event = { at, kind: "setup-refused", phase: "review", why: "the reviewer is not set up" };
    const started: Event = { at: "2026-11-23T09:05:00Z", kind: "started", phase: "review", mode: "none", head };
    const since = "2026-11-23T08:00:00Z";
    expect(EMPTY.refused).toBe("none");
    expect(summarize({ events: [refused], since }).refused).toEqual({
      phase: "review",
      why: "the reviewer is not set up",
    });
    expect(summarize({ events: [refused, started], since }).refused).toBe("none");
  });

  it("sums a spent line with no spend as nothing, and reads it as it read an interrupted run", () => {
    const started: Event = { at, kind: "started", phase: "verify", mode: "none", head };
    const failed: Event = { at, kind: "spent", phase: "verify", head, reason: "unknown" };
    const since = "2026-11-23T08:00:00Z";
    const before = summarize({ events: [started], since });
    const after = summarize({ events: [started, failed], since });
    expect(after.spent).toEqual(before.spent);
    expect(after.interrupted).toEqual(before.interrupted);
    expect(after.lastAt).toBe(before.lastAt);
  });
});
