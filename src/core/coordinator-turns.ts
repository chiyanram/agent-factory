// coordinator-turns — the coordinator's context size, measured by code on every turn, and its reset before the client
// compacts (#732 D-8, D-9). Claude Code's Stop hook runs `agent-factory coordinator-turn` at the end of each turn: it
// reads the turn's token usage from the session's transcript and appends one line to the coordinator user's own log.
// When the size reaches RESET_AT it also writes a reset marker, which the --discord launcher watches: it ends the
// session after that turn and starts a fresh one from the handoff note. A compaction is a fault: the SessionStart
// brief logs one when the session starts again from a compaction.
//
//   ~/.local/state/agent-factory/coordinator-<project>.jsonl   one JSON line per turn, reset and compaction
//   ~/.local/state/agent-factory/coordinator-<project>.reset   the reset marker, removed by the launcher
//
// Today: the transcript's usage fields are Claude Code's, not a documented contract; a turn whose usage cannot be
// read is logged with contextTokens null and why.

import { appendFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prop } from "./field.js";

export const AUTOCOMPACT = "200k";
export const RESET_AT = 120_000;

export function stateDir(home: string): string {
  return join(home, ".local", "state", "agent-factory");
}

export function turnLog(home: string, project: string): string {
  return join(stateDir(home), `coordinator-${project === "" ? "none" : project}.jsonl`);
}

export function resetMarker(home: string, project: string): string {
  return join(stateDir(home), `coordinator-${project === "" ? "none" : project}.reset`);
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function usageTokens(usage: unknown): number {
  return (
    count(prop(usage, "input_tokens")) +
    count(prop(usage, "cache_creation_input_tokens")) +
    count(prop(usage, "cache_read_input_tokens"))
  );
}

export function contextTokens(transcript: string): number | { readonly reason: string } {
  const usages = transcript
    .split("\n")
    .map(parsed)
    .filter((line) => prop(line, "type") === "assistant")
    .map((line) => prop(prop(line, "message"), "usage"))
    .filter((usage) => typeof usage === "object" && usage !== null);
  const last = usages.at(-1);
  return last === undefined ? { reason: "no assistant turn with usage in the transcript" } : usageTokens(last);
}

export type TurnIo = {
  readonly home: string;
  readonly project: string;
  readonly now: () => Date;
};

async function appendLine(io: TurnIo, line: Readonly<Record<string, unknown>>): Promise<void> {
  await mkdir(stateDir(io.home), { recursive: true, mode: 0o700 });
  await appendFile(turnLog(io.home, io.project), `${JSON.stringify({ at: io.now().toISOString(), ...line })}\n`, {
    mode: 0o600,
  });
}

export type Turn =
  | { readonly kind: "measured"; readonly tokens: number; readonly reset: boolean }
  | { readonly kind: "unread"; readonly reason: string };

async function transcriptOf(input: unknown): Promise<string | { readonly reason: string }> {
  const path = prop(input, "transcript_path");
  if (typeof path !== "string" || path === "") {
    return { reason: "the hook input names no transcript_path" };
  }
  return readFile(path, "utf8").catch(() => ({ reason: `cannot read the transcript at ${path}` }));
}

async function turnTokens(input: unknown): Promise<number | { readonly reason: string }> {
  const transcript = await transcriptOf(input);
  return typeof transcript === "string" ? contextTokens(transcript) : transcript;
}

export async function recordTurn(hookInput: string, io: TurnIo, resetAt = RESET_AT): Promise<Turn> {
  const input = parsed(hookInput);
  const tokens = await turnTokens(input);
  const session = prop(input, "session_id") ?? null;
  if (typeof tokens !== "number") {
    await appendLine(io, { kind: "turn", session, contextTokens: null, why: tokens.reason });
    return { kind: "unread", reason: tokens.reason };
  }
  await appendLine(io, { kind: "turn", session, contextTokens: tokens, resetAt });
  if (tokens < resetAt) {
    return { kind: "measured", tokens, reset: false };
  }
  await appendLine(io, { kind: "reset", session, contextTokens: tokens, resetAt });
  await writeFile(resetMarker(io.home, io.project), `${tokens}\n`, { mode: 0o600 });
  return { kind: "measured", tokens, reset: true };
}

export async function recordStart(hookInput: string, io: TurnIo): Promise<boolean> {
  const input = parsed(hookInput);
  if (prop(input, "source") !== "compact") {
    return false;
  }
  await appendLine(io, { kind: "compaction", fault: true, session: prop(input, "session_id") ?? null });
  return true;
}

export async function resetWanted(home: string, project: string): Promise<boolean> {
  return stat(resetMarker(home, project)).then(
    () => true,
    () => false,
  );
}

export async function clearReset(home: string, project: string): Promise<void> {
  await rm(resetMarker(home, project), { force: true });
}
