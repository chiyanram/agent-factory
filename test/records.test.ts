import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRecords, tornPath } from "../src/core/dispatch/records.js";
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
