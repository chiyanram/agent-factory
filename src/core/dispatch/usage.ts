// usage — what the runs spent, from the run records (#131; ADR-0012 S16): today, the current window and the month, per
// project and per ticket, and per run kind. Only the orchestrator's runs write records, so a review or eval run
// by hand is not in it. Days and months are the reader's (zone.ts; records stay UTC); the window is the last
// window.hours hours (default 5), the length of a subscription's usage window. A run whose record has no spend is
// counted apart as unmeasured, never as free.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { plainName } from "../spec.js";
import type { Result } from "../forge/api.js";
import { isActivity, readRecords, type DesignStep, type Event, type Phase, type WriterMode } from "./records.js";
import { addSpend, NO_SPEND, RUN_KINDS, type CopilotRuns, type RoundSpend, type RunKind, type Spend } from "./spend.js";
import { actedRates, type ActedRow, type Rate } from "../review/acted-on.js";
import { tallyOf, type TicketTally } from "./touches.js";
import { dayStart, monthStart, shownAt, UTC, type Zone } from "../zone.js";

export { RUN_KINDS, type RunKind };

export type Spent = {
  readonly project: string;
  readonly ticket: string;
  readonly at: string;
  readonly kind: RunKind;
  readonly lens?: string;
  readonly spend: Spend | "unmeasured";
  readonly copilot?: CopilotRuns;
};

export type ActedSeen = { readonly project: string; readonly at: string; readonly rows: readonly ActedRow[] };

export type Spends = {
  readonly runs: readonly Spent[];
  readonly acted: readonly ActedSeen[];
  readonly tallies: readonly TicketTally[];
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

export function ticketsOf(home: string, project: string): Promise<readonly string[]> {
  return names(join(home, "runs", project), ".jsonl");
}

async function projectsOf(home: string, project: string | undefined): Promise<readonly string[]> {
  return project === undefined ? names(join(home, "runs"), "") : [project];
}

const SPENDING: ReadonlySet<string> = new Set(["writer-ended", "review-ended", "spent", "design-ended", "parked"]);

type Spending = Extract<Event, { kind: "writer-ended" | "review-ended" | "spent" | "design-ended" | "parked" }>;

function spending(e: Event): e is Spending {
  return SPENDING.has(e.kind) && !(e.kind === "spent" && e.spend === undefined);
}

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

function parkedKind(e: Extract<Spending, { kind: "parked" }>): RunKind {
  return e.task?.kind === "test-first" ? "test-first" : KIND_OF_PHASE[e.phase];
}

function kindOf(e: Spending): RunKind {
  if (e.kind === "writer-ended") {
    return KIND_OF_MODE[e.mode];
  }
  if (e.kind === "design-ended") {
    return KIND_OF_STEP[e.step];
  }
  if (e.kind === "parked") {
    return parkedKind(e);
  }
  return e.kind === "review-ended" ? "automated review" : KIND_OF_PHASE[e.phase];
}

function spentOf(e: Spending, project: string, ticket: string): readonly Spent[] {
  const split = splitOf(e);
  const copilot = e.copilot === undefined ? {} : { copilot: e.copilot };
  return split === undefined
    ? [{ project, ticket, at: e.at, kind: kindOf(e), spend: e.spend ?? "unmeasured", ...copilot }]
    : withCopilot(splitRuns(split, { project, ticket, at: e.at }), e, { project, ticket });
}

function withCopilot(runs: readonly Spent[], e: Spending, where: Pick<Spent, "project" | "ticket">): readonly Spent[] {
  if (e.copilot === undefined) {
    return runs;
  }
  const [first, ...rest] = runs;
  return first === undefined
    ? [{ ...where, at: e.at, kind: kindOf(e), spend: NO_SPEND, copilot: e.copilot }]
    : [{ ...first, copilot: e.copilot }, ...rest];
}

function splitOf(e: Spending): RoundSpend | undefined {
  return e.kind === "review-ended" || e.kind === "spent" ? e.split : undefined;
}

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

type Read = {
  readonly runs: readonly Spent[];
  readonly acted: readonly ActedSeen[];
  readonly tally: TicketTally | "none";
};

export function runsOf(events: readonly Event[], where: Pick<Spent, "project" | "ticket">): readonly Spent[] {
  return events.filter(spending).flatMap((e) => spentOf(e, where.project, where.ticket));
}

async function ticketSpends(home: string, project: string, ticket: string): Promise<Result<Read>> {
  const events = await readRecords({ home, project, ticket });
  if (events.kind === "failed") {
    return events;
  }
  const runs = runsOf(events.value, { project, ticket });
  return {
    kind: "ok",
    value: {
      runs,
      acted: events.value.flatMap((e) =>
        e.kind === "review-ended" && e.acted !== undefined ? [{ project, at: e.at, rows: e.acted.rows }] : [],
      ),
      tally: events.value.some(isActivity) ? tallyOf({ project, ticket }, events.value, totalOf(runs, 0)) : "none",
    },
  };
}

export async function readSpends(input: { readonly home: string; readonly project?: string }): Promise<Spends> {
  const runs: Spent[] = [];
  const acted: ActedSeen[] = [];
  const tallies: TicketTally[] = [];
  const problems: string[] = [];
  for (const project of await projectsOf(input.home, input.project)) {
    for (const ticket of await ticketsOf(input.home, project)) {
      const read = await ticketSpends(input.home, project, ticket);
      if (read.kind === "ok") {
        runs.push(...read.value.runs);
        acted.push(...read.value.acted);
        tallies.push(...(read.value.tally === "none" ? [] : [read.value.tally]));
      } else {
        problems.push(read.reason);
      }
    }
  }
  return { runs, acted, tallies, problems };
}

export type Periods = { readonly day: number; readonly window: number; readonly month: number };

export function periodsAt(now: number, windowHours: number, zone: Zone = UTC): Periods {
  return { day: dayStart(now, zone), window: now - windowHours * 3_600_000, month: monthStart(now, zone) };
}

export type Total = { readonly spend: Spend; readonly unmeasured: number };

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

function kindName(r: Spent, byLens: boolean): string {
  return byLens && r.lens !== undefined ? `finder (${r.lens})` : r.kind;
}

function kindsIn(runs: readonly Spent[], byLens: boolean): readonly string[] {
  return RUN_KINDS.flatMap((k) =>
    [...new Set(runs.filter((r) => r.kind === k).map((r) => kindName(r, byLens)))].toSorted(),
  );
}

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

export function usageLines(input: {
  readonly runs: readonly Spent[];
  readonly now: number;
  readonly windowHours: number;
  readonly zone?: Zone;
}): readonly string[] {
  const zone = input.zone ?? UTC;
  const p = periodsAt(input.now, input.windowHours, zone);
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
    `usage at ${shownAt(new Date(input.now).toISOString(), zone)}: days and months in ${zone.name}, the window is the last ${input.windowHours} h`,
    ...aligned(table),
    "+N? is N runs with no spend reported (stopped before their result): not in the sums",
    "automated review is an older round's finder runs and verify pass, recorded before their spend was split (#337)",
  ];
}

function rateText(name: string, r: Rate): string {
  return `${name} ${r.acted}/${r.of}`;
}

export function actedLines(input: {
  readonly acted: readonly ActedSeen[];
  readonly now: number;
  readonly zone?: Zone;
}): readonly string[] {
  const month = periodsAt(input.now, 1, input.zone).month;
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
