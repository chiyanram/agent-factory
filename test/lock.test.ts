import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { takeLock } from "../src/core/lock.js";
import { tempDir } from "./temp.js";

let home = "";
beforeEach(() => {
  home = tempDir("factory-lock-");
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  return Number(child.stdout);
}

describe("takeLock", () => {
  it("should keep the plugin write lock held by one run when two runs find the same stale lock", async () => {
    const path = join(home, "writes", "ledger", "PROJ-1.lock");
    mkdirSync(join(home, "writes", "ledger"), { recursive: true });
    writeFileSync(path, `${deadPid()}:stale`);
    const both = await Promise.all([takeLock(path), takeLock(path)]);
    expect(both.map((t) => t.kind).toSorted()).toEqual(["busy", "held"]);
  });

  it("should take a stale lock again when a crashed takeover left its takeover lock", async () => {
    const path = join(home, "runs", "ledger", ".lock");
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    writeFileSync(path, `${deadPid()}:stale`);
    writeFileSync(`${path}.takeover`, `${deadPid()}:crashed`);
    const first = await takeLock(path);
    const second = await takeLock(path);
    expect([first.kind, second.kind]).toEqual(["busy", "held"]);
  });

  it("should leave a lock another run took over when the first holder releases", async () => {
    const path = join(home, "runs", "ledger", ".lock");
    const first = await takeLock(path);
    writeFileSync(path, "someone-else");
    await (first.kind === "held" ? first.release() : Promise.resolve());
    expect(readFileSync(path, "utf8")).toBe("someone-else");
  });
});
