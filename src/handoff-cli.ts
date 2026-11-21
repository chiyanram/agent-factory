// handoff-cli — agent-factory handoff [<project>]: the project coordinator's reset note, built by code from the
// board (the door seam's one read model, core/door/read.ts) and the open maps' tables (core/handoff.ts), never by a
// model. Read-only: it takes no lock and writes no record, label or note. A fresh coordinator runs it first, in any
// host, and a hook may print it after a compaction. Times are in UTC, so the model reading it never guesses a
// zone.

import type { Result } from "./core/forge/api.js";
import type { Waiting } from "./core/forge/types.js";
import type { BoardIo } from "./board-cli.js";
import { doorBoard } from "./core/door/read.js";
import { handoffNote, type MapRead } from "./core/handoff.js";
import { UTC } from "./core/zone.js";

export type HandoffIo = Omit<BoardIo, "env"> & {
  readonly maps: () => Promise<Result<readonly Waiting[]>>;
  readonly mapBody: (number: number) => Promise<Result<string>>;
};

export const HANDOFF_HELP = `  handoff [<project>]          the coordinator's reset note, built by code from the records with no model: what
                               waits on you, what is in flight, each open map's tables and where to read more;
                               cut to 32000 characters, never cutting what waits on you; read-only. Start a
                               fresh coordinator from it
`;

async function mapsRead(io: HandoffIo): Promise<Result<readonly MapRead[]>> {
  const open = await io.maps();
  if (open.kind === "failed") {
    return open;
  }
  const maps = await Promise.all(
    open.value.map(async (m) => ({ number: m.number, title: m.title, body: await io.mapBody(m.number) })),
  );
  return { kind: "ok", value: maps };
}

export async function handoffCommand(project: string, io: HandoffIo): Promise<number> {
  const waiting = await io.waiting();
  const lines = await doorBoard({
    home: io.home,
    project,
    decided: io.decided,
    waiting: async () => waiting,
    ticketsAreIssues: io.ticketsAreIssues,
    now: io.now,
  });
  const note = handoffNote({ project, at: io.now(), lines, maps: await mapsRead(io), zone: UTC, mark: io.mark });
  io.out(note.text);
  if (!note.complete || waiting.kind === "failed") {
    io.err("agent-factory handoff: a section could not be read; the note names it\n");
    return 1;
  }
  return 0;
}
