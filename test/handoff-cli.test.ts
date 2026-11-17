import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, rmSync } from "node:fs";
import type { Result } from "../src/core/forge/api.js";
import type { Waiting } from "../src/core/forge/types.js";
import { handoffCommand, type HandoffIo } from "../src/handoff-cli.js";
import { tempDir } from "./temp.js";

// agent-factory handoff prints the coordinator's reset note from the board and the open maps, read-only, and exits 1
// when a section could not be read.

const NOW = Date.parse("2026-11-17T15:00:00Z");

let home = "";
beforeEach(() => {
  home = tempDir("factory-handoff-");
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const ok = <T>(value: T): Result<T> => ({ kind: "ok", value });

function io(over: Partial<HandoffIo> = {}): { io: HandoffIo; out: string[]; err: string[]; read: number[] } {
  const out: string[] = [];
  const err: string[] = [];
  const read: number[] = [];
  return {
    out,
    err,
    read,
    io: {
      home,
      now: () => NOW,
      out: (t) => out.push(t),
      err: (t) => err.push(t),
      mark: "#",
      decided: async () => ok([]),
      waiting: async () => ok([{ number: 7, title: "a session waits", since: "2026-11-17T14:00:00Z" }]),
      ticketsAreIssues: true,
      maps: async () => ok<readonly Waiting[]>([{ number: 654, title: "lessons", since: "" }]),
      mapBody: async (n) => {
        read.push(n);
        return ok("Intro words.\n\n| child | state |\n|---|---|\n| #711 | open |\n");
      },
      ...over,
    },
  };
}

describe("handoffCommand", () => {
  it("prints the note: the waiting session under waits on you, and each open map's table", async () => {
    const run = io();
    expect(await handoffCommand("aruvii", run.io)).toBe(0);
    const text = run.out.join("");
    expect(text.startsWith("factory handoff: aruvii at 2026-11-17T15:00:00Z;")).toBe(true);
    const waits = text.slice(text.indexOf("## Waits on you"), text.indexOf("## In flight"));
    expect(waits).toContain("  7  no PR  session waits");
    expect(text).toContain("### #654 lessons\n| child | state |\n|---|---|\n| #711 | open |");
    expect(text).not.toContain("Intro words.");
    expect(run.read).toEqual([654]);
    expect(run.err).toEqual([]);
  });

  it("writes nothing under the factory's home", async () => {
    await handoffCommand("aruvii", io().io);
    expect(readdirSync(home)).toEqual([]);
  });

  it("names a board it cannot read in the note, and exits 1", async () => {
    const run = io({ decided: async () => ({ kind: "failed", reason: "no clone" }) });
    expect(await handoffCommand("aruvii", run.io)).toBe(1);
    expect(run.out.join("")).toContain("  could not read the board: no clone");
    expect(run.err.join("")).toContain("agent-factory handoff: a section could not be read");
  });

  it("names a waiting label it cannot read under waits on you, and exits 1", async () => {
    const run = io({ waiting: async () => ({ kind: "failed", reason: "rate limited" }) });
    expect(await handoffCommand("aruvii", run.io)).toBe(1);
    const text = run.out.join("");
    expect(text.slice(text.indexOf("## Waits on you"), text.indexOf("## In flight"))).toContain("rate limited");
  });

  it("names a map it cannot read in the note, and exits 1", async () => {
    const run = io({ mapBody: async () => ({ kind: "failed", reason: "rate limited" }) });
    expect(await handoffCommand("aruvii", run.io)).toBe(1);
    expect(run.out.join("")).toContain("  could not read #654: rate limited");
  });

  it("names open maps it cannot list, and exits 1", async () => {
    const run = io({ maps: async () => ({ kind: "failed", reason: "host down" }) });
    expect(await handoffCommand("aruvii", run.io)).toBe(1);
    expect(run.out.join("")).toContain("  could not list the open maps: host down");
  });
});
