// board-cli — agent-factory board [<project>] [--json] (#487 AC-5; #456 decision 4): one line per ticket in flight, PR
// or not, with its step, what it waits on and for how long, grouped into needs you, ready to merge and factory
// (src/core/dispatch/board.ts). It reads what a pass would decide, read-only: it takes no lock and writes no record,
// label or note. --json gives the same fields with each line's lane, times in UTC,
// for a program (the chat bot's /waiting, #233; the web view, #120).
// The lines are the door seam's read model (core/door/read.ts), so every front door shows the same board.

import type { Result } from "./core/forge/api.js";
import { boardJson, boardText } from "./core/dispatch/board.js";
import type { Decided } from "./core/dispatch/tick.js";
import { doorBoard } from "./core/door/read.js";
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

export const BOARD_HELP = `  board [<project>] [--json]   one line per ticket in flight, PR or not, in lanes: needs you, ready to merge,
                               factory; its step, what it waits on (a person by name, the gate or a run) and for
                               how long; read-only. --json: the same with each line's lane, times in UTC
`;

// boardCommand : the board on stdout; a project the pass cannot read fails on stderr, and exits 1
export async function boardCommand(project: string, json: boolean, io: BoardIo): Promise<number> {
  const lines = await doorBoard({ home: io.home, project, decided: io.decided, now: io.now });
  if (lines.kind === "failed") {
    io.err(`agent-factory board: ${lines.reason}\n`);
    return 1;
  }
  const text = json
    ? [boardJson(lines.value)]
    : boardText({ lines: lines.value, zone: readerZone(io.env), mark: io.mark });
  io.out(`${text.join("\n")}\n`);
  return 0;
}
