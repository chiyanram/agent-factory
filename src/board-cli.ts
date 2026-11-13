// board-cli — agent-factory board [<project>] [--json] (#487 AC-5; #456 decision 4): one line per ticket in flight, PR
// or not, with its step, what it waits on and for how long (src/core/dispatch/board.ts). It reads what a pass would
// decide, read-only: it takes no lock and writes no record, label or note. --json gives the same fields, times in UTC,
// for a program (the chat bot's /waiting, #233; the web view, #120).

import type { Done, Result } from "./core/forge/api.js";
import { FORGE_OPS } from "./core/forge/ops.js";
import type { Forge } from "./core/forge/types.js";
import { boardJson, boardOf, boardText } from "./core/dispatch/board.js";
import { readRecords, type Event } from "./core/dispatch/records.js";
import { STEPS_TODAY } from "./core/dispatch/steps.js";
import { describe, type Decided, type TickSetup } from "./core/dispatch/tick.js";
import { NO_NOTIFY } from "./core/notify.js";
import { readerZone } from "./core/zone.js";

export type BoardIo = {
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  readonly now: () => number;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  // the change's prefix on the project's git host: # or !
  readonly mark: string;
  // every ticket of the project, decided as a pass would, read-only (tick.ts decideAll)
  readonly decided: () => Promise<Result<readonly Decided[]>>;
};

export const BOARD_HELP = `  board [<project>] [--json]   one line per ticket in flight, PR or not: its step, what it waits on (a person by
                               name, the gate or a run) and for how long; read-only. --json: the same, times in UTC
`;

const REFUSED = "agent-factory board writes nothing to the git host";

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
  io: BoardIo,
  project: string,
  decided: readonly Decided[],
): Promise<ReadonlyMap<string, readonly Event[]>> {
  const out = new Map<string, readonly Event[]>();
  for (const d of decided) {
    const ticket = "kind" in d ? d.ticket : d.state.ticket;
    const read = await readRecords({ home: io.home, project, ticket }, { warn: () => undefined });
    out.set(ticket, read.kind === "ok" ? read.value : []);
  }
  return out;
}

// boardCommand : the board on stdout; a project the pass cannot read fails on stderr, and exits 1
export async function boardCommand(project: string, json: boolean, io: BoardIo): Promise<number> {
  const decided = await io.decided();
  if (decided.kind === "failed") {
    io.err(`agent-factory board: ${decided.reason}\n`);
    return 1;
  }
  const events = await eventsOf(io, project, decided.value);
  const lines = boardOf({ decided: decided.value, events, now: io.now(), describe });
  const text = json ? [boardJson(lines)] : boardText({ lines, zone: readerZone(io.env), mark: io.mark });
  io.out(`${text.join("\n")}\n`);
  return 0;
}
