import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  clearReset,
  contextTokens,
  recordStart,
  recordTurn,
  RESET_AT,
  resetMarker,
  resetWanted,
  turnLog,
} from "../src/core/coordinator-turns.js";
import { field } from "../src/core/human-record.js";
import { tempDir } from "./temp.js";

// one transcript line as Claude Code writes it for an assistant turn
function assistant(input: number, created: number, read: number): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      usage: {
        input_tokens: input,
        cache_creation_input_tokens: created,
        cache_read_input_tokens: read,
        output_tokens: 9,
      },
    },
  });
}

describe("contextTokens: the size the last turn was sent with", () => {
  it("adds the input and the cache written and read, from the last assistant turn", () => {
    const transcript = [
      JSON.stringify({ type: "user", message: { content: "hi" } }),
      assistant(2, 100, 1000),
      "not json",
      assistant(3, 200, 5000),
      JSON.stringify({ type: "user", message: { content: "next" } }),
    ].join("\n");
    expect(contextTokens(transcript)).toBe(5203);
  });

  it("says why when no turn has usage", () => {
    expect(contextTokens(JSON.stringify({ type: "user" }))).toEqual({
      reason: expect.stringContaining("no assistant"),
    });
  });
});

describe("recordTurn and recordStart: the coordinator's own log", () => {
  let home = "";
  const now = () => new Date("2026-11-17T18:00:00Z");
  beforeEach(() => {
    home = tempDir("factory-turns-");
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const io = () => ({ home, project: "ledger", now });
  const lines = (): readonly unknown[] =>
    readFileSync(turnLog(home, "ledger"), "utf8")
      .trim()
      .split("\n")
      .map((l): unknown => JSON.parse(l));
  const hookInput = (tokens: number): string => {
    const path = join(home, "transcript.jsonl");
    writeFileSync(path, `${assistant(tokens, 0, 0)}\n`);
    return JSON.stringify({ session_id: "s1", transcript_path: path });
  };

  it("logs every turn's size, and asks for no reset below the reset size", async () => {
    expect(await recordTurn(hookInput(5000), io())).toEqual({ kind: "measured", tokens: 5000, reset: false });
    expect(lines()).toEqual([
      { at: "2026-11-17T18:00:00.000Z", kind: "turn", session: "s1", contextTokens: 5000, resetAt: RESET_AT },
    ]);
    expect(await resetWanted(home, "ledger")).toBe(false);
  });

  it("at the reset size logs a reset and writes the marker the launcher watches", async () => {
    expect(await recordTurn(hookInput(RESET_AT), io())).toEqual({ kind: "measured", tokens: RESET_AT, reset: true });
    expect(lines().map((l) => field(l, "kind"))).toEqual(["turn", "reset"]);
    expect(await resetWanted(home, "ledger")).toBe(true);
    await clearReset(home, "ledger");
    expect(existsSync(resetMarker(home, "ledger"))).toBe(false);
  });

  it("logs a turn it cannot read with no size and why, and asks for no reset", async () => {
    const turn = await recordTurn(JSON.stringify({ session_id: "s1", transcript_path: join(home, "gone") }), io());
    expect(turn).toEqual({ kind: "unread", reason: expect.stringContaining("cannot read the transcript") });
    expect(lines()[0]).toMatchObject({ contextTokens: null, why: expect.stringContaining("cannot read") });
    expect(await recordTurn("not json", io())).toMatchObject({ kind: "unread" });
  });

  it("logs a start from a compaction as a fault, and nothing for any other start", async () => {
    expect(await recordStart(JSON.stringify({ source: "startup", session_id: "s1" }), io())).toBe(false);
    expect(existsSync(turnLog(home, "ledger"))).toBe(false);
    expect(await recordStart(JSON.stringify({ source: "compact", session_id: "s1" }), io())).toBe(true);
    expect(lines()).toEqual([{ at: "2026-11-17T18:00:00.000Z", kind: "compaction", fault: true, session: "s1" }]);
  });
});
