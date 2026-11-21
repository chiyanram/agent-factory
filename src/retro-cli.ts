// retro-cli — agent-factory retro <project> [--json] [--draft] (#488 AC-2): the failures seen on two or more merged
// tickets, and every escaped defect, from each ticket's timeline line and its outcome (retro/repeated.ts), with no
// model. A merged ticket with no timeline line is named: it merged before #624, or the write failed. The listing reads
// only. With --draft, one model run of the retro card turns the failures into lesson drafts (retro/draft.ts). A person
// starts it, and nothing in the pass, the loop or the coordinator does (P12, AC-3).

import { readRecords, type Event, type Where } from "./core/dispatch/records.js";
import type { Result } from "./core/forge/api.js";
import type { Timeline } from "./core/dispatch/timeline.js";
import { ticketsOf } from "./core/dispatch/usage.js";
import { fetchDefault, outcomeOf, type MergeOutcome } from "./core/outcome.js";
import { draftRetro, type Drafted } from "./core/retro/draft.js";
import { runPlugins } from "./core/process/use.js";
import { openAgentCli } from "./core/agent/index.js";
import { limitOf } from "./core/agent/limits.js";
import { REVIEW_MODELS } from "./core/review/pinned.js";
import { repeatedOf, REPEATS, type Failure, type Merge } from "./core/retro/repeated.js";
import { settingOf } from "./core/settings/machine.js";
import { plainName } from "./core/spec.js";

export type Merged = { readonly ticket: string; readonly at: string; readonly sha: string };

export type Outcomes = (merged: readonly Merged[]) => Promise<ReadonlyMap<string, MergeOutcome>>;

export type RetroIo = {
  readonly home: string;
  readonly outcomes: Outcomes;
  readonly draft: (project: string, failures: readonly Failure[]) => Promise<Result<Drafted>>;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
};

export const RETRO_HELP = `  retro <project> [--json] [--draft]
                               the failures seen on ${REPEATS} or more merged tickets (a rule ID in Act on that was
                               acted on, a rescue kind) and every fix or revert within 14 days of a merge, each with
                               its tickets and the record lines it cites; no model. --draft: one run of the retro card,
                               capped at $10, writes the lesson drafts under <home>/retro/; a person opens the PR. A
                               person starts it; the coordinator's settings deny --draft
`;

const USAGE = "usage: agent-factory retro <project> [--json] [--draft]\n";

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

function fetchedWhy(repo: string, env: NodeJS.ProcessEnv, merges: number): Promise<string> {
  if (repo === "") {
    return Promise.resolve("the project's clone is not set");
  }
  return merges === 0 ? Promise.resolve("") : fetchDefault({ repo, env });
}

export function cardDraft(home: string, env: NodeJS.ProcessEnv): RetroIo["draft"] {
  return async (project, failures) => {
    const limit = limitOf(env, "retro.minutes");
    if (limit.kind === "failed") {
      return limit;
    }
    const used = await runPlugins({ home, project, env });
    if (used.kind === "failed") {
      return used;
    }
    const model = openAgentCli({ env }).readOnly;
    const modelName = settingOf(env, "review.logicModel") ?? REVIEW_MODELS.logic;
    const setup = { home, project, plugins: used.value.plugins, model, modelName, limit: limit.value, now: Date.now };
    return draftRetro(setup, failures);
  };
}

type Read = {
  readonly merged: readonly Merged[];
  readonly timelines: ReadonlyMap<string, Timeline>;
  readonly problems: readonly string[];
};

function lastOf<K extends Event["kind"]>(events: readonly Event[], kind: K): Extract<Event, { kind: K }> | undefined {
  return events.findLast((e): e is Extract<Event, { kind: K }> => e.kind === kind);
}

type TicketRead = { readonly merged: readonly Merged[]; readonly timelines: readonly (readonly [string, Timeline])[] };

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

function failureLines(f: Failure): readonly string[] {
  const n = f.tickets.length;
  return [
    `${f.kind} ${f.key}: on ${n} ticket${n === 1 ? "" : "s"} (${f.tickets.join(", ")})`,
    ...f.cites.map((c) => `  ${c}`),
  ];
}

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

function listingText(
  args: Args,
  l: {
    readonly merged: readonly Merged[];
    readonly failures: readonly Failure[];
    readonly untimed: readonly string[];
    readonly unknown: readonly { readonly ticket: string; readonly why: string }[];
  },
): string {
  if (args.json) {
    const { failures, untimed, unknown } = l;
    return `${JSON.stringify({ project: args.project, merged: l.merged.length, failures, untimed, unknown })}\n`;
  }
  const lines = listingLines({ project: args.project, ...l });
  return `${[...lines, ...l.unknown.map((u) => `outcome unknown for ${u.ticket}: ${u.why}`)].join("\n")}\n`;
}

type Args = { readonly project: string; readonly json: boolean; readonly draft: boolean };

function argsOf(positionals: readonly string[]): Args | undefined {
  const rest = positionals.filter((p) => p !== "--json" && p !== "--draft");
  const [project] = rest;
  return rest.length === 1 && project !== undefined && plainName(project)
    ? { project, json: positionals.includes("--json"), draft: positionals.includes("--draft") }
    : undefined;
}

async function drafted(io: RetroIo, project: string, failures: readonly Failure[]): Promise<number> {
  const made = await io.draft(project, failures);
  if (made.kind === "failed") {
    io.err(`agent-factory retro: no drafts: ${made.reason}\n`);
    return 1;
  }
  const dirs = made.value.dirs.map((d) => `draft: ${d}`);
  const lines = dirs.length === 0 ? ["no failure to draft a lesson for; no model ran"] : dirs;
  const trace = made.value.trace === "" ? [] : [`trace: ${made.value.trace}`];
  io.out(`${[...lines, `spent $${made.value.usd.toFixed(2)}`, ...trace].join("\n")}\n`);
  return 0;
}

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
  io.out(listingText(args, { merged: read.merged, failures, untimed, unknown }));
  for (const problem of read.problems) {
    io.err(`agent-factory retro: ${problem}\n`);
  }
  const draft = args.draft ? await drafted(io, args.project, failures) : 0;
  return read.problems.length === 0 ? draft : 1;
}
