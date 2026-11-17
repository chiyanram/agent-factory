// door/read — the one read model every front door shows (ADR-0023 D2): the board's lines (dispatch/board.ts), decided
// as a pass would decide them, on a git host whose write ops refuse and with no step or ping that can run. The CLI's
// `board` prints them; the Discord door (#548) reads the same lines.

import type { Done, Result } from "../forge/api.js";
import { FORGE_OPS } from "../forge/ops.js";
import type { Forge } from "../forge/types.js";
import { boardOf, type BoardLine } from "../dispatch/board.js";
import { readRecords, type Event } from "../dispatch/records.js";
import { STEPS_TODAY } from "../dispatch/steps.js";
import { describe, type Decided, type TickSetup } from "../dispatch/tick.js";
import { NO_NOTIFY } from "../notify.js";

const REFUSED = "the board writes nothing to the git host";

// the git host's write ops (forge/ops.ts forge.write), read from the seam's own list so a write op added later is
// refused too
const WRITE_OPS = Object.entries(FORGE_OPS).flatMap(([op, kind]) => (kind === "forge.write" ? [op] : []));

// readOnly : the git host with every write op refused: the board only reads, so a write it should never make fails
// instead of landing
export function readOnly(forge: Forge): Forge {
  const refuse = async (): Promise<Done> => ({ kind: "failed", reason: REFUSED });
  return { ...forge, ...Object.fromEntries(WRITE_OPS.map((op) => [op, refuse])) };
}

// boardPass : the pass setup the board decides with: a dry run on a read-only git host, with no step that can run and
// no ping that can go out, and its log on stderr, so --json stays one value. decideAll only reads; this makes a write
// impossible, not merely unused.
export function boardPass(setup: TickSetup, err: (text: string) => void): TickSetup {
  return {
    ...setup,
    forge: readOnly(setup.forge),
    steps: STEPS_TODAY,
    notify: NO_NOTIFY,
    dryRun: true,
    log: (line) => err(`${line}\n`),
  };
}

// eventsOf : each ticket's record lines; a ticket whose records cannot be read has none here (decideAll names it)
async function eventsOf(
  home: string,
  project: string,
  decided: readonly Decided[],
): Promise<ReadonlyMap<string, readonly Event[]>> {
  const out = new Map<string, readonly Event[]>();
  for (const d of decided) {
    const ticket = "kind" in d ? d.ticket : d.state.ticket;
    const read = await readRecords({ home, project, ticket }, { warn: () => undefined });
    out.set(ticket, read.kind === "ok" ? read.value : []);
  }
  return out;
}

export type BoardRead = {
  readonly home: string;
  readonly project: string;
  // every ticket of the project, decided as a pass would, read-only (tick.ts decideAll on a boardPass)
  readonly decided: () => Promise<Result<readonly Decided[]>>;
  readonly now: () => number;
};

// doorBoard : the board's lines; a project the pass cannot read fails
export async function doorBoard(read: BoardRead): Promise<Result<readonly BoardLine[]>> {
  const decided = await read.decided();
  if (decided.kind === "failed") {
    return decided;
  }
  const events = await eventsOf(read.home, read.project, decided.value);
  return { kind: "ok", value: boardOf({ decided: decided.value, events, now: read.now(), describe }) };
}
