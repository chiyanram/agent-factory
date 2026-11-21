// waiting-cli — agent-factory waiting [<project>] (#722): a pass's wait pings alone (dispatch/waiting-pass.ts), for a
// ticket session that waits for the operator while no orchestrator loop runs. The coordinator runs it, with no prompt,
// when a session tells it it waits. It records each label's time, then pings once per label, as a pass does; it starts
// no run and writes nothing to the git host. While a pass holds the lock it does nothing, and says to run it again
// once that pass ends, since the pass may have read the labels before this one went on.

import type { Result } from "./core/forge/api.js";
import type { WaitingRun } from "./core/dispatch/tick.js";
import type { WaitingRan } from "./core/dispatch/waiting-pass.js";
import { WAITING_LABEL } from "./core/dispatch/waiting.js";

export type WaitingIo = {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly run: () => Promise<Result<WaitingRun>>;
};

export const WAITING_HELP = `  waiting [<project>] [--dry-run]
                               ping the operator once for each ticket session that waits for their word (label
                               ${WAITING_LABEL}), recorded first, as a pass does; for when no loop runs. No run, no
                               git host write; nothing while a pass runs. --dry-run: name them, record and ping nothing
`;

const SAID: { readonly [O in WaitingRan["outcome"]]: string } = {
  pinged: "pinged",
  "ping-failed": "recorded, but the ping did not go out; the log line says why",
  recorded: "recorded; its own turn already pinged the operator",
  already: "already pinged for this label",
  failed: "not recorded or pinged; the log line says why",
  "dry-run": "DRY RUN, not recorded or pinged",
};

export function waitingLine(w: WaitingRan): string {
  return `#${w.ticket} waits for the operator (${w.title}): ${SAID[w.outcome]}`;
}

export async function waitingCommand(project: string, io: WaitingIo): Promise<number> {
  const ran = await io.run();
  if (ran.kind === "failed") {
    io.err(`agent-factory waiting: ${ran.reason}\n`);
    return 1;
  }
  if (ran.value.kind === "busy") {
    io.out(
      `a pass for ${project} is running; a loop's next pass pings each waiting session, else run this again once it ends\n`,
    );
    return 0;
  }
  const waits = ran.value.waits;
  io.out(waits.length === 0 ? "no session waits\n" : `${waits.map(waitingLine).join("\n")}\n`);
  return waits.some((w) => w.outcome === "failed" || w.outcome === "ping-failed") ? 2 : 0;
}
