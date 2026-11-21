// usage-cli — agent-factory usage [<project>] (#131): what the orchestrator's runs spent today, in the current window
// and this month, per project and per ticket, each by run kind (#337), the automated review's acted-on rate this month
// (#220), and each ticket's touches, waits, rework rounds and cost (#487), read from the run records
// (src/core/dispatch/usage.ts, touches.ts), with days and times in the reader's zone (zone.ts). It reads only.

import { plainName } from "./core/spec.js";
import { actedLines, periodsAt, readSpends, usageLines, WINDOW_HOURS, type Spends } from "./core/dispatch/usage.js";
import { tallyKey, ticketLines } from "./core/dispatch/touches.js";
import { fetchDefault, outcomeOf, type MergeOutcome } from "./core/outcome.js";
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

function projectArg(positionals: readonly string[]): { readonly project?: string } | "bad" {
  const [project] = positionals;
  if (project === undefined) {
    return {};
  }
  return positionals.length === 1 && plainName(project) ? { project } : "bad";
}

async function outcomes(
  io: UsageIo,
  spends: Spends,
  project: string | undefined,
): Promise<ReadonlyMap<string, MergeOutcome>> {
  const repo = settingOf(io.env, "clone") ?? "";
  const merged =
    repo === ""
      ? []
      : spends.tallies.flatMap((t) => (t.merged !== undefined && t.project === project ? [{ t, m: t.merged }] : []));
  const why = merged.length === 0 ? "" : await fetchDefault({ repo, env: io.env });
  const read = new Map<string, MergeOutcome>();
  for (const { t, m } of merged) {
    read.set(tallyKey(t), await outcomeFor({ repo, env: io.env, merged: m, now: io.now() }, why));
  }
  return read;
}

function outcomeFor(input: Parameters<typeof outcomeOf>[0], why: string): Promise<MergeOutcome> {
  return why === "" ? outcomeOf({ ...input, fetched: true }) : Promise.resolve({ kind: "unknown", why });
}

function printed(io: UsageIo, spends: Spends, hours: number, read: ReadonlyMap<string, MergeOutcome>): number {
  const zone = readerZone(io.env);
  const now = io.now();
  const lines = [
    ...usageLines({ runs: spends.runs, now, windowHours: hours, zone }),
    ...actedLines({ acted: spends.acted, now, zone }),
    ...ticketLines({ tallies: spends.tallies, from: periodsAt(now, hours, zone).month, zone, outcomes: read }),
  ];
  for (const line of lines) {
    io.out(`${line}\n`);
  }
  for (const problem of spends.problems) {
    io.err(`agent-factory usage: ${problem}\n`);
  }
  return spends.problems.length === 0 ? 0 : 1;
}

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
  const spends = await readSpends({ home: io.home, ...which });
  return printed(io, spends, hours, await outcomes(io, spends, which.project));
}
