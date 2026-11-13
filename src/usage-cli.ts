// usage-cli — agent-factory usage [<project>] (#131): what the orchestrator's runs spent today, in the current window
// and this month, per project and per ticket, each by run kind (#337), the automated review's acted-on rate this month
// (#220), and each ticket's touches, waits, rework rounds and cost (#487), read from the run records
// (src/core/dispatch/usage.ts, touches.ts), with days and times in the reader's zone (zone.ts). It reads only.

import { plainName } from "./core/spec.js";
import { actedLines, periodsAt, readSpends, usageLines, WINDOW_HOURS, type Spends } from "./core/dispatch/usage.js";
import { ticketLines } from "./core/dispatch/touches.js";
import { readerZone } from "./core/zone.js";
import { settingName, settingOf } from "./core/settings/machine.js";

export type UsageIo = {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly now: () => number;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
};

export const USAGE_HELP = `  usage [<project>]            what the orchestrator's runs spent today, in the current window and this month, per
                               project and ticket, each by run kind, the automated review's acted-on rate, and each
                               ticket's touches, waits, rework rounds and cost, from the run records; days and times
                               in the reader's zone (TZ)
`;

function windowHours(env: NodeJS.ProcessEnv): number | "bad" {
  const raw = settingOf(env, "window.hours") ?? String(WINDOW_HOURS);
  return /^[1-9]\d?$/.test(raw) && Number(raw) <= 24 ? Number(raw) : "bad";
}

// projectArg : the one project named, none for every project, or "bad"
function projectArg(positionals: readonly string[]): { readonly project?: string } | "bad" {
  const [project] = positionals;
  if (project === undefined) {
    return {};
  }
  return positionals.length === 1 && plainName(project) ? { project } : "bad";
}

// printed : the table on stdout and each problem on stderr; 1 when there was one
function printed(io: UsageIo, spends: Spends, hours: number): number {
  const zone = readerZone(io.env);
  const now = io.now();
  const lines = [
    ...usageLines({ runs: spends.runs, now, windowHours: hours, zone }),
    ...actedLines({ acted: spends.acted, now, zone }),
    ...ticketLines({ tallies: spends.tallies, from: periodsAt(now, hours, zone).month, zone }),
  ];
  for (const line of lines) {
    io.out(`${line}\n`);
  }
  for (const problem of spends.problems) {
    io.err(`agent-factory usage: ${problem}\n`);
  }
  return spends.problems.length === 0 ? 0 : 1;
}

// usageCommand : the table on stdout; a ticket whose records cannot be read is named on stderr, and exits 1
export async function usageCommand(positionals: readonly string[], io: UsageIo): Promise<number> {
  const which = projectArg(positionals);
  if (which === "bad") {
    io.err("usage: agent-factory usage [<project>]\n");
    return 64;
  }
  const hours = windowHours(io.env);
  if (hours === "bad") {
    io.err(`agent-factory usage: ${settingName("window.hours")} must be a whole number of hours from 1 to 24\n`);
    return 1;
  }
  return printed(io, await readSpends({ home: io.home, ...which }), hours);
}
