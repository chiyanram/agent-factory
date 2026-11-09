// usage — what the runs spent, from the run records (#131; ADR-0012 S16): today, the current window and the month, per
// project and per ticket. Only the orchestrator's runs write records, so a review or eval run by hand is not in it.
// Days and months are UTC; the window is the last window.hours hours (default 5), the length of a subscription's usage
// window. A run whose record has no spend is counted apart as unmeasured, never as free.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { plainName } from "../spec.js";
import type { Result } from "../forge/api.js";
import { readRecords, type Event } from "./records.js";
import { addSpend, NO_SPEND, type Spend } from "./spend.js";

// one model run's record: the writer's, a review round's or a design review run's end, or what a failed run spent
export type Spent = {
  readonly project: string;
  readonly ticket: string;
  readonly at: string;
  readonly spend: Spend | "unmeasured";
};

export type Spends = { readonly runs: readonly Spent[]; readonly problems: readonly string[] };

export const WINDOW_HOURS = 5;

async function names(dir: string, suffix: string): Promise<readonly string[]> {
  const found = await readdir(dir).catch(() => [] as string[]);
  return found
    .filter((f) => f.endsWith(suffix))
    .map((f) => f.slice(0, f.length - suffix.length))
    .filter(plainName)
    .toSorted();
}

// projectsOf : the one project asked for, or every project with a records folder
async function projectsOf(home: string, project: string | undefined): Promise<readonly string[]> {
  return project === undefined ? names(join(home, "runs"), "") : [project];
}

// the lines that end or follow a model run: the writer's, a review round's, a design review run's (#236), and what a
// failed run spent; a line of these kinds with no spend was not measured
const SPENDING: ReadonlySet<string> = new Set(["writer-ended", "review-ended", "spent", "design-ended"]);

type Spending = Extract<Event, { kind: "writer-ended" | "review-ended" | "spent" | "design-ended" }>;

function spending(e: Event): e is Spending {
  return SPENDING.has(e.kind);
}

// ticketSpends : every measured or unmeasured run of one ticket, or why its records cannot be read
async function ticketSpends(home: string, project: string, ticket: string): Promise<Result<readonly Spent[]>> {
  const events = await readRecords({ home, project, ticket });
  if (events.kind === "failed") {
    return events;
  }
  return {
    kind: "ok",
    value: events.value.filter(spending).map((e) => ({ project, ticket, at: e.at, spend: e.spend ?? "unmeasured" })),
  };
}

// readSpends : every run of the project, or of every project; a ticket whose records cannot be read is a problem, and
// the rest are still read
export async function readSpends(input: { readonly home: string; readonly project?: string }): Promise<Spends> {
  const runs: Spent[] = [];
  const problems: string[] = [];
  for (const project of await projectsOf(input.home, input.project)) {
    for (const ticket of await names(join(input.home, "runs", project), ".jsonl")) {
      const read = await ticketSpends(input.home, project, ticket);
      if (read.kind === "ok") {
        runs.push(...read.value);
      } else {
        problems.push(read.reason);
      }
    }
  }
  return { runs, problems };
}

// Periods : the start of today, of the current window and of the month, in ms since the epoch
export type Periods = { readonly day: number; readonly window: number; readonly month: number };

// periodsAt : the periods at now (ms), UTC. Pure.
export function periodsAt(now: number, windowHours: number): Periods {
  const d = new Date(now);
  return {
    day: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    window: now - windowHours * 3_600_000,
    month: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1),
  };
}

// Total : the measured spend and the unmeasured runs of a set of runs
export type Total = { readonly spend: Spend; readonly unmeasured: number };

// totalOf : the runs since from (ms), summed. Pure.
export function totalOf(runs: readonly Spent[], from: number): Total {
  const since = runs.filter((r) => Date.parse(r.at) >= from);
  const measured = since.flatMap((r) => (r.spend === "unmeasured" ? [] : [r.spend]));
  return { spend: measured.reduce(addSpend, NO_SPEND), unmeasured: since.length - measured.length };
}

function cell(t: Total): string {
  const extra = t.unmeasured === 0 ? "" : ` +${t.unmeasured}?`;
  return `$${t.spend.usd.toFixed(2)} ${t.spend.tokens} tok${extra}`;
}

function row(name: string, runs: readonly Spent[], p: Periods): readonly string[] {
  return [name, cell(totalOf(runs, p.day)), cell(totalOf(runs, p.window)), cell(totalOf(runs, p.month))];
}

function aligned(rows: readonly (readonly string[])[]): readonly string[] {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
  return rows.map((r) =>
    r
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd(),
  );
}

// usageLines : the usage table: all, then each project, then each of its tickets with a run this month or window.
// Pure.
export function usageLines(input: {
  readonly runs: readonly Spent[];
  readonly now: number;
  readonly windowHours: number;
}): readonly string[] {
  const p = periodsAt(input.now, input.windowHours);
  // the window can reach back into the month before
  const month = input.runs.filter((r) => Date.parse(r.at) >= Math.min(p.month, p.window));
  const rows: (readonly string[])[] = [["", "today", "window", "month"], row("all", month, p)];
  for (const project of [...new Set(month.map((r) => r.project))].toSorted()) {
    const ofProject = month.filter((r) => r.project === project);
    rows.push(row(project, ofProject, p));
    for (const ticket of [...new Set(ofProject.map((r) => r.ticket))].toSorted()) {
      rows.push(
        row(
          `  ${ticket}`,
          ofProject.filter((r) => r.ticket === ticket),
          p,
        ),
      );
    }
  }
  return [
    `usage at ${new Date(input.now).toISOString()}: days and months in UTC, the window is the last ${input.windowHours} h`,
    ...aligned(rows),
    "+N? is N runs with no spend reported (stopped before their result): not in the sums",
  ];
}
