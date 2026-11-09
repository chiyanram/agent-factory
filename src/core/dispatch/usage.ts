// usage — what the runs spent, from the run records (#131; ADR-0012 S16): today, the current window and the month, per
// project and per ticket, and per run kind (#337). Only the orchestrator's runs write records, so a review or eval run
// by hand is not in it.
// Days and months are UTC; the window is the last window.hours hours (default 5), the length of a subscription's usage
// window. A run whose record has no spend is counted apart as unmeasured, never as free.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { plainName } from "../spec.js";
import type { Result } from "../forge/api.js";
import { readRecords, type DesignStep, type Event, type Phase, type WriterMode } from "./records.js";
import { addSpend, NO_SPEND, type RoundSpend, type Spend } from "./spend.js";
import { actedRates, type ActedRow, type Rate } from "../review/acted-on.js";

// what a run was, in the glossary's role names (#337), as far as its record tells: an automated review's round line
// splits its spend into each finder's, by lens, and the verify pass's; an older round line that has no split is one
// "automated review". A design review records each of its two runs, the design-reviewer's and the verify pass's. A
// spent line from the ready check or the local verifier, which run no model, is never written; it is named for what it
// is all the same.
export type RunKind =
  | "design-reviewer"
  | "test-first"
  | "implementer"
  | "cleanup"
  | "finder"
  | "verify pass"
  | "onboarder"
  | "automated review"
  | "ready check"
  | "local verifier";

// the order the kinds are shown in: the glossary's order of the roles, then the older round lines
export const RUN_KINDS: readonly RunKind[] = [
  "design-reviewer",
  "test-first",
  "implementer",
  "cleanup",
  "finder",
  "verify pass",
  "onboarder",
  "automated review",
  "ready check",
  "local verifier",
];

// one model run's record: the writer's, a review round's or a design review run's end, or what a failed run spent
export type Spent = {
  readonly project: string;
  readonly ticket: string;
  readonly at: string;
  readonly kind: RunKind;
  // a finder's lens (#337)
  readonly lens?: string;
  readonly spend: Spend | "unmeasured";
};

// one review round's acted-on rows (#220): the last full round's findings, each acted on or not since
export type ActedSeen = { readonly project: string; readonly at: string; readonly rows: readonly ActedRow[] };

export type Spends = {
  readonly runs: readonly Spent[];
  readonly acted: readonly ActedSeen[];
  readonly problems: readonly string[];
};

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

// a writer run is the implementer's, but for its test-first and cleanup modes; a fix, rework, CI or merge run is the
// implementer's
const KIND_OF_MODE: Readonly<Record<WriterMode, RunKind>> = {
  "test-first": "test-first",
  fix: "implementer",
  rework: "implementer",
  ci: "implementer",
  rebase: "implementer",
  cleanup: "cleanup",
};

const KIND_OF_PHASE: Readonly<Record<Phase, RunKind>> = {
  writer: "implementer",
  ready: "ready check",
  review: "automated review",
  verify: "local verifier",
  "design-review": "design-reviewer",
  "design-verify": "verify pass",
  onboard: "onboarder",
};

const KIND_OF_STEP: Readonly<Record<DesignStep, RunKind>> = { review: "design-reviewer", verify: "verify pass" };

// kindOf : the run kind of a line that spends. Pure.
function kindOf(e: Spending): RunKind {
  if (e.kind === "writer-ended") {
    return KIND_OF_MODE[e.mode];
  }
  if (e.kind === "design-ended") {
    return KIND_OF_STEP[e.step];
  }
  return e.kind === "review-ended" ? "automated review" : KIND_OF_PHASE[e.phase];
}

// spentOf : a spending line's runs: a review round's split into each finder's, by lens, and the verify pass's when it
// spent; any other line, or a round line with no split, is one run of its kind. Pure.
function spentOf(e: Spending, project: string, ticket: string): readonly Spent[] {
  const split = splitOf(e);
  return split === undefined
    ? [{ project, ticket, at: e.at, kind: kindOf(e), spend: e.spend ?? "unmeasured" }]
    : splitRuns(split, { project, ticket, at: e.at });
}

// splitOf : a review round line's spend per run; none on another line, or an older one (#337). Pure.
function splitOf(e: Spending): RoundSpend | undefined {
  return e.kind === "review-ended" || e.kind === "spent" ? e.split : undefined;
}

// splitRuns : a round's runs: each finder's, by lens, and the verify pass's when it spent. Pure.
function splitRuns(split: RoundSpend, where: Pick<Spent, "project" | "ticket" | "at">): readonly Spent[] {
  const { project, ticket, at } = where;
  const verify = split.verify.usd > 0 || split.verify.tokens > 0 ? [split.verify] : [];
  return [
    ...Object.entries(split.finders).map(
      ([lens, spend]): Spent => ({ project, ticket, at, kind: "finder", lens, spend }),
    ),
    ...verify.map((spend): Spent => ({ project, ticket, at, kind: "verify pass", spend })),
  ];
}

type Read = { readonly runs: readonly Spent[]; readonly acted: readonly ActedSeen[] };

// ticketSpends : every measured or unmeasured run of one ticket, and its acted-on rows, or why its records cannot be
// read
async function ticketSpends(home: string, project: string, ticket: string): Promise<Result<Read>> {
  const events = await readRecords({ home, project, ticket });
  if (events.kind === "failed") {
    return events;
  }
  return {
    kind: "ok",
    value: {
      runs: events.value.filter(spending).flatMap((e) => spentOf(e, project, ticket)),
      acted: events.value.flatMap((e) =>
        e.kind === "review-ended" && e.acted !== undefined ? [{ project, at: e.at, rows: e.acted.rows }] : [],
      ),
    },
  };
}

// readSpends : every run of the project, or of every project; a ticket whose records cannot be read is a problem, and
// the rest are still read
export async function readSpends(input: { readonly home: string; readonly project?: string }): Promise<Spends> {
  const runs: Spent[] = [];
  const acted: ActedSeen[] = [];
  const problems: string[] = [];
  for (const project of await projectsOf(input.home, input.project)) {
    for (const ticket of await names(join(input.home, "runs", project), ".jsonl")) {
      const read = await ticketSpends(input.home, project, ticket);
      if (read.kind === "ok") {
        runs.push(...read.value.runs);
        acted.push(...read.value.acted);
      } else {
        problems.push(read.reason);
      }
    }
  }
  return { runs, acted, problems };
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

function row(name: string, kind: string, runs: readonly Spent[], p: Periods): readonly string[] {
  return [name, kind, cell(totalOf(runs, p.day)), cell(totalOf(runs, p.window)), cell(totalOf(runs, p.month))];
}

// kindName : a run's kind as its row names it: a finder by its lens in a ticket's rows. Pure.
function kindName(r: Spent, byLens: boolean): string {
  return byLens && r.lens !== undefined ? `finder (${r.lens})` : r.kind;
}

// kindsIn : the kind names of a group's runs, in RUN_KINDS order, and a finder's lenses by name. Pure.
function kindsIn(runs: readonly Spent[], byLens: boolean): readonly string[] {
  return RUN_KINDS.flatMap((k) =>
    [...new Set(runs.filter((r) => r.kind === k).map((r) => kindName(r, byLens)))].toSorted(),
  );
}

// groupRows : one group's rows: its one kind on one row; or with more kinds, a row for them all, then one per kind; a
// ticket's finders one per lens (#337)
function groupRows(name: string, runs: readonly Spent[], p: Periods, byLens = false): readonly (readonly string[])[] {
  const kinds = kindsIn(runs, byLens);
  const [only] = kinds;
  if (kinds.length === 1 && only !== undefined) {
    return [row(name, only, runs, p)];
  }
  return [
    row(name, "all", runs, p),
    ...kinds.map((k) =>
      row(
        "",
        k,
        runs.filter((r) => kindName(r, byLens) === k),
        p,
      ),
    ),
  ];
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

// usageLines : the usage table: all, then each project, then each of its tickets with a run this month or window, each
// split by run kind. Pure.
export function usageLines(input: {
  readonly runs: readonly Spent[];
  readonly now: number;
  readonly windowHours: number;
}): readonly string[] {
  const p = periodsAt(input.now, input.windowHours);
  // the window can reach back into the month before
  const month = input.runs.filter((r) => Date.parse(r.at) >= Math.min(p.month, p.window));
  const table: (readonly string[])[] = [["", "kind", "today", "window", "month"], ...groupRows("all", month, p)];
  for (const project of [...new Set(month.map((r) => r.project))].toSorted()) {
    const ofProject = month.filter((r) => r.project === project);
    table.push(...groupRows(project, ofProject, p));
    for (const ticket of [...new Set(ofProject.map((r) => r.ticket))].toSorted()) {
      table.push(
        ...groupRows(
          `  ${ticket}`,
          ofProject.filter((r) => r.ticket === ticket),
          p,
          true,
        ),
      );
    }
  }
  return [
    `usage at ${new Date(input.now).toISOString()}: days and months in UTC, the window is the last ${input.windowHours} h`,
    ...aligned(table),
    "+N? is N runs with no spend reported (stopped before their result): not in the sums",
    "automated review is an older round's finder runs and verify pass, recorded before their spend was split (#337)",
  ];
}

function rateText(name: string, r: Rate): string {
  return `${name} ${r.acted}/${r.of}`;
}

// actedLines : the automated review's acted-on rate this month, all and per project, per lens, category and bucket
// (#220).
// Pure.
export function actedLines(input: { readonly acted: readonly ActedSeen[]; readonly now: number }): readonly string[] {
  const month = periodsAt(input.now, 1).month;
  const seen = input.acted.filter((a) => Date.parse(a.at) >= month);
  if (seen.length === 0) {
    return [];
  }
  const line = (name: string, rows: readonly ActedRow[]): string => {
    const r = actedRates(rows);
    const parts = [r.lens, r.category, r.bucket].flatMap((by) => Object.entries(by).map(([k, v]) => rateText(k, v)));
    return [rateText(name, r.all), ...parts].join(" · ");
  };
  const projects = [...new Set(seen.map((a) => a.project))].toSorted();
  return [
    "acted on this month: findings in Act on or Consider whose region a later commit changed, per lens, category and bucket",
    line(
      "all",
      seen.flatMap((a) => a.rows),
    ),
    ...projects.map((p) =>
      line(
        `  ${p}`,
        seen.filter((a) => a.project === p).flatMap((a) => a.rows),
      ),
    ),
  ];
}
