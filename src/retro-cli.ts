// retro-cli — agent-factory retro <project> [--json] (#488 AC-2, the listing): the failures seen on two or more merged
// tickets, and every escaped defect, from each ticket's timeline line and its outcome (retro/repeated.ts), with no
// model. A merged ticket with no timeline line is named: it merged before #624, or the write failed. It reads only;
// a person starts it, and nothing in the pass, the loop or the coordinator does (P12, AC-3).
//
// **Today:** the listing only; `retro --draft`, the lesson drafts, is slice 4 of #488.

import { readRecords, type Event, type Where } from "./core/dispatch/records.js";
import type { Result } from "./core/forge/api.js";
import type { Timeline } from "./core/dispatch/timeline.js";
import { ticketsOf } from "./core/dispatch/usage.js";
import { fetchDefault, outcomeOf, type MergeOutcome } from "./core/outcome.js";
import { repeatedOf, REPEATS, type Failure, type Merge } from "./core/retro/repeated.js";
import { settingOf } from "./core/settings/machine.js";
import { plainName } from "./core/spec.js";

export type Merged = { readonly ticket: string; readonly at: string; readonly sha: string };

// what became of each merge, by ticket
export type Outcomes = (merged: readonly Merged[]) => Promise<ReadonlyMap<string, MergeOutcome>>;

export type RetroIo = {
  readonly home: string;
  readonly outcomes: Outcomes;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
};

export const RETRO_HELP = `  retro <project> [--json]     the failures seen on ${REPEATS} or more merged tickets (a rule ID in Act on that was
                               acted on, a rescue kind) and every fix or revert within 14 days of a merge, each with
                               its tickets and the record lines it cites; no model. A person starts it
`;

const USAGE = "usage: agent-factory retro <project> [--json]\n";

// cloneOutcomes : each merge's outcome from the project's clone (outcome.ts), one fetch for all; unknown when the clone
// is not set
export function cloneOutcomes(env: NodeJS.ProcessEnv, now: () => number): Outcomes {
  return async (merged) => {
    const repo = settingOf(env, "clone") ?? "";
    const why = await fetchedWhy(repo, env, merged.length);
    const read = new Map<string, MergeOutcome>();
    for (const m of merged) {
      read.set(
        m.ticket,
        why === "" ? await outcomeOf({ repo, env, merged: m, now: now(), fetched: true }) : { kind: "unknown", why },
      );
    }
    return read;
  };
}

// fetchedWhy : the default branch fetched once for every merge; why it could not be, or "" when it was or none is needed
function fetchedWhy(repo: string, env: NodeJS.ProcessEnv, merges: number): Promise<string> {
  if (repo === "") {
    return Promise.resolve("the project's clone is not set");
  }
  return merges === 0 ? Promise.resolve("") : fetchDefault({ repo, env });
}

type Read = {
  readonly merged: readonly Merged[];
  readonly timelines: ReadonlyMap<string, Timeline>;
  readonly problems: readonly string[];
};

// lastOf : the ticket's last line of a kind. Pure.
function lastOf<K extends Event["kind"]>(events: readonly Event[], kind: K): Extract<Event, { kind: K }> | undefined {
  return events.findLast((e): e is Extract<Event, { kind: K }> => e.kind === kind);
}

type TicketRead = { readonly merged: readonly Merged[]; readonly timelines: readonly (readonly [string, Timeline])[] };

// ticketMerge : the ticket's merge and its timeline line (none when it has not merged), or why its records cannot be
// read
async function ticketMerge(where: Where, warn: (line: string) => void): Promise<Result<TicketRead>> {
  const events = await readRecords(where, { warn });
  if (events.kind === "failed") {
    return events;
  }
  const m = lastOf(events.value, "merged");
  const t = lastOf(events.value, "timeline");
  if (m === undefined) {
    return { kind: "ok", value: { merged: [], timelines: [] } };
  }
  const merged = { ticket: where.ticket, at: m.at, sha: m.sha };
  return { kind: "ok", value: { merged: [merged], timelines: t === undefined ? [] : [[where.ticket, t]] } };
}

// readMerges : each merged ticket of the project and its timeline line; a ticket whose records cannot be read is a
// problem, and the rest are still read
async function readMerges(home: string, project: string, warn: (line: string) => void): Promise<Read> {
  const reads: Result<TicketRead>[] = [];
  for (const ticket of await ticketsOf(home, project)) {
    reads.push(await ticketMerge({ home, project, ticket }, warn));
  }
  const ok = reads.flatMap((r) => (r.kind === "ok" ? [r.value] : []));
  return {
    merged: ok.flatMap((r) => r.merged),
    timelines: new Map(ok.flatMap((r) => r.timelines)),
    problems: reads.flatMap((r) => (r.kind === "failed" ? [r.reason] : [])),
  };
}

// failureLines : one failure as the listing shows it. Pure.
function failureLines(f: Failure): readonly string[] {
  const n = f.tickets.length;
  return [
    `${f.kind} ${f.key}: on ${n} ticket${n === 1 ? "" : "s"} (${f.tickets.join(", ")})`,
    ...f.cites.map((c) => `  ${c}`),
  ];
}

// listingLines : the listing. Pure.
export function listingLines(input: {
  readonly project: string;
  readonly merged: readonly Merged[];
  readonly failures: readonly Failure[];
  readonly untimed: readonly string[];
}): readonly string[] {
  const head = `retro ${input.project}: ${input.merged.length} merged ticket(s), ${input.failures.length} failure(s)`;
  const none =
    input.failures.length === 0 ? [`no failure seen on ${REPEATS} or more tickets, and no escaped defect`] : [];
  const untimed =
    input.untimed.length === 0
      ? []
      : [`no timeline line (merged before #624, or the write failed): ${input.untimed.join(", ")}`];
  return [head, ...none, ...input.failures.flatMap(failureLines), ...untimed];
}

// argsOf : the project and whether --json was asked, or none for a bad command line. Pure.
function argsOf(positionals: readonly string[]): { readonly project: string; readonly json: boolean } | undefined {
  const json = positionals.includes("--json");
  const rest = positionals.filter((p) => p !== "--json");
  const [project] = rest;
  return rest.length === 1 && project !== undefined && plainName(project) ? { project, json } : undefined;
}

// retroCommand : the listing on stdout (JSON with --json); each unreadable ticket on stderr, and exit 1; 64 for a bad
// command line
export async function retroCommand(positionals: readonly string[], io: RetroIo): Promise<number> {
  const args = argsOf(positionals);
  if (args === undefined) {
    io.err(USAGE);
    return 64;
  }
  const read = await readMerges(io.home, args.project, (line) => io.err(`${line}\n`));
  const outcomes = await io.outcomes(read.merged);
  const merges = new Map<string, Merge>(
    read.merged.flatMap((m) => {
      const outcome = outcomes.get(m.ticket);
      return outcome === undefined ? [] : [[m.ticket, { at: m.at, outcome }]];
    }),
  );
  const failures = repeatedOf({ timelines: read.timelines, merges, min: REPEATS });
  const untimed = read.merged.filter((m) => !read.timelines.has(m.ticket)).map((m) => m.ticket);
  const unknown = [...outcomes].flatMap(([ticket, o]) => (o.kind === "unknown" ? [{ ticket, why: o.why }] : []));
  if (args.json) {
    io.out(`${JSON.stringify({ project: args.project, merged: read.merged.length, failures, untimed, unknown })}\n`);
  } else {
    const lines = listingLines({ project: args.project, merged: read.merged, failures, untimed });
    const unread = unknown.map((u) => `outcome unknown for ${u.ticket}: ${u.why}`);
    io.out(`${[...lines, ...unread].join("\n")}\n`);
  }
  for (const problem of read.problems) {
    io.err(`agent-factory retro: ${problem}\n`);
  }
  return read.problems.length === 0 ? 0 : 1;
}
