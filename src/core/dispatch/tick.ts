// tick — one pass of the dispatcher over a project (#103; ADR-0012 S3). It keeps no memory of its own: every pass reads
// the local approvals, the forge (poll), and the run records, decides each ticket with the table, then acts:
//   - forge-only actions (needs-human, release, ping, reconcile) for every ticket that has one
//   - at most one run (writer, ready check or reviewer) per pass: runs at once is 1 (ADR-0012 S16)
// A run's step is a seam. A step that is not built yet says so, and the pass records nothing for it, so the ticket is
// decided the same way next time. A "started" record is written before a run and an "ended" one after it; a pass that
// dies in between leaves the first alone, and the next pass hands that ticket to a person.
//
// A lock file keeps two passes from running at once (cron every few minutes, a run of an hour).

import { constants } from "node:fs";
import { mkdir, open, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { approvalState } from "../approval.js";
import { NEEDS_HUMAN } from "../finish.js";
import type { Done, Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
import { poll, type MergedLine, type OpenLine } from "../poll.js";
import type { Post } from "../post.js";
import { plainName } from "../spec.js";
import { readRecords, record, summarize, type WriterMode } from "./records.js";
import { decide, type Action, type ApprovalView, type ChangeView, type TicketState } from "./table.js";

export const BRANCH_PREFIX = "factory/";

export type Unavailable = { readonly kind: "unavailable"; readonly reason: string };
export type Step<I, O> = Unavailable | { readonly kind: "available"; readonly run: (input: I) => Promise<Result<O>> };

export type RunInput = { readonly ticket: string; readonly change: ChangeView; readonly head: string };
export type Steps = {
  readonly writer: Step<RunInput & { readonly mode: WriterMode }, { readonly head: string; readonly outcome: "done" | "asked" | "blocked"; readonly patch: string }>;
  readonly ready: Step<RunInput, { readonly passed: boolean }>;
  readonly review: Step<RunInput, { readonly actOn: number }>;
};

// The steps as they are today: the writer waits on the container box (#113), the ready check and the reviewer on
// their port to TypeScript (#138).
export const STEPS_TODAY: Steps = {
  writer: { kind: "unavailable", reason: "the writer's box is not built yet (#113)" },
  ready: { kind: "unavailable", reason: "the ready check is not ported yet (#138)" },
  review: { kind: "unavailable", reason: "the reviewer is not ported yet (#138)" },
};

export type TickSetup = {
  readonly home: string;
  readonly project: string;
  readonly forge: Forge;
  readonly label: string;
  readonly steps: Steps;
  readonly now: () => number;
  readonly quietMinutes: number;
  // print each decision and act on none
  readonly dryRun: boolean;
  readonly log: (line: string) => void;
};

export type Decision = { readonly ticket: string; readonly action: Action };

// tickets with a local approval record, and those whose change is on the forge
async function ticketNames(setup: TickSetup, lines: readonly (OpenLine | MergedLine)[]): Promise<readonly string[]> {
  const files = await readdir(join(setup.home, "approvals", setup.project)).catch(() => [] as string[]);
  const approved = files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
  const onForge = lines.filter((l) => l.branch.startsWith(BRANCH_PREFIX)).map((l) => l.branch.slice(BRANCH_PREFIX.length));
  return [...new Set([...approved, ...onForge])].filter(plainName).sort();
}

async function approvalOf(setup: TickSetup, ticket: string): Promise<Result<ApprovalView>> {
  const state = await approvalState({ home: setup.home, project: setup.project, ticket });
  switch (state.kind) {
    case "approved":
      return { kind: "ok", value: { kind: "approved", at: state.record.at, lane: state.spec.lane } };
    case "stale":
    case "missing":
      return { kind: "ok", value: { kind: state.kind } };
    case "refused":
      return { kind: "failed", reason: `${ticket}: ${state.reason}` };
  }
}

function changeOf(ticket: string, lines: readonly (OpenLine | MergedLine)[]): ChangeView {
  const line = lines.find((l) => l.branch === `${BRANCH_PREFIX}${ticket}`);
  if (line === undefined) {
    return { kind: "none" };
  }
  return line.kind === "open" ? { kind: "open", line } : { kind: "merged", line };
}

async function stateOf(setup: TickSetup, ticket: string, lines: readonly (OpenLine | MergedLine)[]): Promise<Result<TicketState>> {
  const approval = await approvalOf(setup, ticket);
  if (approval.kind === "failed") {
    return approval;
  }
  const events = await readRecords({ home: setup.home, project: setup.project, ticket });
  if (events.kind === "failed") {
    return events;
  }
  const since = approval.value.kind === "approved" ? approval.value.at : "1970-01-01T00:00:00Z";
  const runs = summarize({ events: events.value, since });
  return { kind: "ok", value: { ticket, approval: approval.value, change: changeOf(ticket, lines), runs, now: setup.now(), quietMinutes: setup.quietMinutes } };
}

// decideAll : one decision per ticket, in ticket order
export async function decideAll(setup: TickSetup): Promise<Result<readonly { readonly state: TicketState; readonly action: Action }[]>> {
  const lines = await poll({ forge: setup.forge, label: setup.label });
  if (lines.kind === "failed") {
    return lines;
  }
  const out: { readonly state: TicketState; readonly action: Action }[] = [];
  for (const ticket of await ticketNames(setup, lines.value)) {
    const state = await stateOf(setup, ticket, lines.value);
    if (state.kind === "failed") {
      return state;
    }
    out.push({ state: state.value, action: decide(state.value) });
  }
  return { kind: "ok", value: out };
}

function number(state: TicketState): number | "none" {
  return state.change.kind === "none" ? "none" : state.change.line.number;
}

async function say(setup: TickSetup, state: TicketState, post: Post): Promise<Done> {
  const n = number(state);
  return n === "none" ? { kind: "ok" } : setup.forge.note({ number: n, post });
}

// forgeAction : the actions that only touch the forge; "none" for a run or a wait
async function forgeAction(setup: TickSetup, state: TicketState, action: Action): Promise<Done | "none"> {
  const n = number(state);
  switch (action.kind) {
    case "needs-human": {
      const label = n === "none" ? ({ kind: "ok" } as const) : await setup.forge.addLabel({ number: n, label: NEEDS_HUMAN });
      return label.kind === "ok" ? say(setup, state, { seat: "coordinator", title: `blocked: ${action.why}`, fields: [], items: [] }) : label;
    }
    case "release": {
      const removed = n === "none" ? ({ kind: "ok" } as const) : await setup.forge.removeLabel({ number: n, label: setup.label });
      return removed.kind === "ok" ? say(setup, state, { seat: "coordinator", title: `released: ${action.why}`, fields: [], items: [] }) : removed;
    }
    case "ping": {
      const said = await say(setup, state, { seat: "coordinator", title: `ready for you at ${action.head.slice(0, 8)}: the gate is green; review and merge`, fields: [], items: [] });
      return said.kind === "ok" ? record({ where: { home: setup.home, project: setup.project, ticket: state.ticket }, event: { at: new Date(setup.now()).toISOString(), kind: "pinged", head: action.head } }) : said;
    }
    case "reconcile":
      return n === "none" ? { kind: "ok" } : setup.forge.removeLabel({ number: n, label: setup.label });
    default:
      return "none";
  }
}

export type Ran = { readonly ticket: string; readonly action: Action; readonly result: Done | Unavailable };

// claim : the change carries the claim label before a writer runs on it
async function claim(setup: TickSetup, state: TicketState): Promise<Done> {
  const line = state.change.kind === "open" ? state.change.line : "none";
  return line === "none" || line.claimed ? { kind: "ok" } : setup.forge.addLabel({ number: line.number, label: setup.label });
}

function at(setup: TickSetup): string {
  return new Date(setup.now()).toISOString();
}

function headOf(state: TicketState): string {
  return state.change.kind === "open" ? state.change.line.head : "";
}

async function runWriter(setup: TickSetup, state: TicketState, mode: WriterMode): Promise<Done | Unavailable> {
  const step = setup.steps.writer;
  if (step.kind === "unavailable") {
    return step;
  }
  const claimed = await claim(setup, state);
  const where = { home: setup.home, project: setup.project, ticket: state.ticket };
  const started = claimed.kind === "ok" ? await record({ where, event: { at: at(setup), kind: "started", phase: "writer", mode, head: headOf(state) } }) : claimed;
  if (started.kind === "failed") {
    return started;
  }
  const ran = await step.run({ ticket: state.ticket, change: state.change, head: headOf(state), mode });
  // a step that fails leaves the start alone: the next pass sees a run that never ended and asks a person
  return ran.kind === "ok" ? record({ where, event: { at: at(setup), kind: "writer-ended", mode, ...ran.value } }) : ran;
}

async function runCheck(setup: TickSetup, state: TicketState, phase: "ready" | "review", head: string): Promise<Done | Unavailable> {
  const where = { home: setup.home, project: setup.project, ticket: state.ticket };
  const step = phase === "ready" ? setup.steps.ready : setup.steps.review;
  if (step.kind === "unavailable") {
    return step;
  }
  const started = await record({ where, event: { at: at(setup), kind: "started", phase, mode: "none", head } });
  if (started.kind === "failed") {
    return started;
  }
  const ran = await step.run({ ticket: state.ticket, change: state.change, head });
  if (ran.kind === "failed") {
    return ran;
  }
  const value = ran.value as { readonly passed?: boolean; readonly actOn?: number };
  return phase === "ready"
    ? record({ where, event: { at: at(setup), kind: "ready-ended", head, passed: value.passed === true } })
    : record({ where, event: { at: at(setup), kind: "review-ended", head, actOn: value.actOn ?? 0 } });
}

function runAction(setup: TickSetup, state: TicketState, action: Action): Promise<Done | Unavailable> | "none" {
  switch (action.kind) {
    case "writer":
      return runWriter(setup, state, action.mode);
    case "ready":
    case "review":
      return runCheck(setup, state, action.kind, action.head);
    default:
      return "none";
  }
}

function describe(action: Action): string {
  switch (action.kind) {
    case "wait":
    case "needs-human":
    case "release":
      return `${action.kind}: ${action.why}`;
    case "writer":
      return `writer (${action.mode}): ${action.why}`;
    case "ready":
    case "review":
    case "ping":
      return `${action.kind} at ${action.head.slice(0, 8)}`;
    case "reconcile":
      return "reconcile: merged; remove the claim";
  }
}

function logResult(setup: TickSetup, ticket: string, result: Done | Unavailable): void {
  setup.log(`${ticket}: ${result.kind === "ok" ? "done" : `${result.kind}: ${result.reason}`}`);
}

// actAll : every forge-only action, then the first run that can start; one line per ticket on the log
async function actAll(setup: TickSetup, decided: readonly { readonly state: TicketState; readonly action: Action }[]): Promise<readonly Ran[]> {
  const ran: Ran[] = [];
  let runStarted = false;
  for (const { state, action } of decided) {
    setup.log(`${state.ticket}: ${describe(action)}`);
    const forgeDone = await forgeAction(setup, state, action);
    const pending: Promise<Done | Unavailable> | "none" = forgeDone === "none" && !runStarted ? runAction(setup, state, action) : "none";
    const result: Done | Unavailable | "none" = forgeDone !== "none" ? forgeDone : pending !== "none" ? await pending : "none";
    if (result === "none") {
      continue;
    }
    runStarted ||= pending !== "none" && result.kind !== "unavailable";
    ran.push({ ticket: state.ticket, action, result });
    logResult(setup, state.ticket, result);
  }
  return ran;
}

type Lock = { readonly kind: "held"; readonly release: () => Promise<void> } | { readonly kind: "busy"; readonly reason: string };

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}

// lock : one pass at a time per project; a lock whose process is gone is taken over
export async function lock(input: { readonly home: string; readonly project: string }): Promise<Lock> {
  const path = join(input.home, "runs", input.project, ".lock");
  await mkdir(join(input.home, "runs", input.project), { recursive: true, mode: 0o700 });
  for (let tries = 0; tries < 2; tries++) {
    try {
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      return { kind: "held", release: () => rm(path, { force: true }) };
    } catch {
      const pid = Number((await readFile(path, "utf8").catch(() => "")).trim());
      if (Number.isSafeInteger(pid) && pid > 0 && alive(pid)) {
        return { kind: "busy", reason: `another pass (pid ${pid}) is running for ${input.project}` };
      }
      await rm(path, { force: true });
    }
  }
  return { kind: "busy", reason: `cannot take ${path}` };
}

// tick : one locked pass
export async function tick(setup: TickSetup): Promise<Result<readonly Ran[]>> {
  if (!plainName(setup.project)) {
    return { kind: "failed", reason: `the project must be a plain name, got ${JSON.stringify(setup.project)}` };
  }
  const held = await lock({ home: setup.home, project: setup.project });
  if (held.kind === "busy") {
    return { kind: "failed", reason: held.reason };
  }
  try {
    const decided = await decideAll(setup);
    if (decided.kind === "failed") {
      return decided;
    }
    if (setup.dryRun) {
      decided.value.forEach(({ state, action }) => setup.log(`${state.ticket}: ${describe(action)} (dry run)`));
      return { kind: "ok", value: [] };
    }
    return { kind: "ok", value: await actAll(setup, decided.value) };
  } finally {
    await held.release();
  }
}
