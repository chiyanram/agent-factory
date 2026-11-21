// door/read — the one read model every front door shows (ADR-0023 D2): the board's lines (dispatch/board.ts), decided
// as a pass would decide them, with each ticket whose session waits for the operator (dispatch/waiting.ts) as an
// ordinary needs-you line, on a git host whose write ops refuse and with no step or ping that can run. The CLI's
// `board` prints them; the Discord door (#548) reads the same lines. The write ops come from the seam's own list, so a
// write op added later is refused too: a write is impossible here, not merely unused.

import type { Done, Result } from "../forge/api.js";
import { FORGE_OPS } from "../forge/ops.js";
import type { Forge, Waiting } from "../forge/types.js";
import { boardOf, type BoardLine } from "../dispatch/board.js";
import { readRecords, type Event } from "../dispatch/records.js";
import { STEPS_TODAY } from "../dispatch/steps.js";
import { describe, type Decided, type TickSetup } from "../dispatch/tick.js";
import { NO_NOTIFY } from "../notify.js";

const REFUSED = "the board writes nothing to the git host";

const WRITE_OPS = Object.entries(FORGE_OPS).flatMap(([op, kind]) => (kind === "forge.write" ? [op] : []));

export function readOnly(forge: Forge): Forge {
  const refuse = async (): Promise<Done> => ({ kind: "failed", reason: REFUSED });
  return { ...forge, ...Object.fromEntries(WRITE_OPS.map((op) => [op, refuse])) };
}

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
  readonly decided: () => Promise<Result<readonly Decided[]>>;
  readonly waiting: () => Promise<Result<readonly Waiting[]>>;
  readonly ticketsAreIssues: boolean;
  readonly now: () => number;
};

export function ticketsAreIssues(setup: Pick<TickSetup, "specs">): boolean {
  return setup.specs?.kind === "issue";
}

export async function doorBoard(read: BoardRead): Promise<Result<readonly BoardLine[]>> {
  const decided = await read.decided();
  if (decided.kind === "failed") {
    return decided;
  }
  const events = await eventsOf(read.home, read.project, decided.value);
  const waiting = await read.waiting();
  const lines = boardOf({
    decided: decided.value,
    events,
    now: read.now(),
    describe,
    waiting,
    ticketsAreIssues: read.ticketsAreIssues,
  });
  return { kind: "ok", value: lines };
}
