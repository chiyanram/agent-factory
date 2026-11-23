import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRecords, record, tornPath } from "../src/core/dispatch/records.js";
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
      patch: "",
      evidence: [],
      hung: false,
      runs: [{ cli: "claude", asked: "default", version: "9.9.9", model: "m" }],
    },
    { at, kind: "review-ended", head, actOn: 0, runs },
    { at, kind: "spent", phase: "review", head, spend: { usd: 0.1, tokens: 1 }, runs },
    { at, kind: "parked", phase: "writer", head, until: "unknown", said: "", runs: [{ cli: "claude", asked: "x" }] },
    {
      at,
      kind: "design-ended",
      step: "review",
      spec: "s",
      design: "d",
      outcome: "done",
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
    const ended = { at, kind: "review-ended", head, actOn: 0 };
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
