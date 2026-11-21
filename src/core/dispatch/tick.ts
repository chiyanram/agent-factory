// tick — one pass of the orchestrator over a project (#103; ADR-0012 S3). It keeps no memory of its own: every pass
// reads the local START and approval records, the git host (poll), and the run records, decides each ticket with the
// table, then acts:
//   - the shared copy of each approval, once, on the ticket's open PR
//   - forge-only actions (needs-human, release, ping, a design note, a hold, an unread blocker, reconcile) for every
//     ticket that has one
//   - up to runs at once runs (writer, ready check, reviewer, local verifier or a design review's run), one after
//     another (caps.ts)
//   - when a design review's verify pass ends, what it kept goes to the front doors: a note on the ticket's PR
//     when one is open, a ping, and the pass's log
//   - no run at all while the project is at its day cap or its window share (caps.ts), with one notice for it
// A run's step is a seam (steps.ts). A step that is not built yet says so, and the pass records nothing for it, so
// the ticket is decided the same way next time. A "started" record is written before a run and an "ended" one after
// it; a pass that dies in between leaves the first alone, and the next pass hands that ticket to a person. The start
// is recorded before the claim is taken, so a pass that dies between them leaves a run for a person, never a claim
// with no record, which would look like someone else's.
//
// A pass records first and then pings, so each ping goes once; a line that cannot be written sends no ping, and the
// next pass tries again. A ping only informs: one that fails is printed, and the pass goes on. The factory never
// re-runs a red check: a check a person quarantined reads as passed, and any other goes back to the implementer.
//
// A lock file keeps two passes from running at once (a pass by hand while the orchestrator loop runs, a run of an
// hour). A lock whose holder died is taken over by a rename and a read-back, so of two passes only one keeps it. No
// cron or launchd job runs a pass: a human's command starts the orchestrator loop (orchestrator-loop.ts), and it ends
// by itself when no ticket is in flight. Each pass that polled writes its last-poll time (last-poll.ts), so `status`
// shows a loop that stopped. Each pass first deletes the project's traces older than TRACE_DAYS (trace.ts).
//
// The ticket list is every ticket with a START record, an approval record, or a factory/<ticket> PR. What lets
// the build begin is a human's word: a START and an approval, or in the tiny lane a START alone (table.ts). An
// approval with no START waits. The newer of the two records is when the counts start afresh. The shared copy is a
// note the project's own git host identity posts, `approved by <human> via <door>, spec <hash>, design <hash|none>`,
// for people to see. It never starts anything: the orchestrator decides only from the local records.

import type { PluginHash } from "../process/use.js";
import { heldBy, quarantineItems, quarantineLine, type Held, type Quarantined } from "../process/quarantine.js";
import { randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  approvalState,
  currentSpec,
  type ApprovalRecord,
  type Current,
  type Where as ApprovalWhere,
} from "../approval.js";
import { NEEDS_HUMAN } from "../finish.js";
import type { Done, Result } from "../forge/api.js";
import { leftNote, type KeptInput, type KeptRun } from "../left.js";
import type { Forge } from "../forge/types.js";
import { poll, type MergedLine, type OpenLine } from "../poll.js";
import { pruneTraces } from "./trace.js";
import type { Notify, Ping } from "../notify.js";
import { turnPing, turnStep } from "./turn-ping.js";
import { WAITING_LABEL } from "./waiting.js";
import {
  NO_FLIGHT,
  waitingLabels,
  waitingPinged,
  type Flight,
  type WaitingRan,
  type WaitingSetup,
} from "./waiting-pass.js";
import type { Post } from "../post.js";
import { needsApproval, needsTestFirst, oneWayDoorPathsOf, plannedCheck, raisedWhy, type LaneProps } from "../lane.js";
import { plainName, type Lane, type Spec, type SpecStore } from "../spec.js";
import { readStart, type StartRecord } from "../start.js";
import { readWaiver } from "../waiver.js";
import type { Evidence } from "../report.js";
import {
  codeOf,
  modeOf,
  nextTryOf,
  parkedTaskOf,
  spentAndTrace,
  readRecords,
  record,
  summarize,
  type Event,
  type Retried,
  type RunFolder,
  type Summary,
  type Task,
  type Where,
} from "./records.js";
import { writeLastPoll } from "./last-poll.js";
import { shownAt, UTC } from "../zone.js";
import { timelineOf } from "./timeline.js";
import { blockersView, withIssue, type Blocker, type BlockersView, type BlockerState } from "./blockers.js";
import type { BranchState } from "../forge/types.js";
import { designView, dropRepeats, roundsBefore, type DesignView, type EarlierRound, type SpecRead } from "./design.js";
import { nextStep, whoseTurn } from "./next-step.js";
import { keptLine, toVerify, type DesignFinding, type Kept } from "../design/findings.js";
import { needsDesignReview } from "../lane.js";
import { NO_SPEND, type FailedSpent, type RoundSpend, type Spend } from "./spend.js";
import type { Acted, FoundByRule } from "../review/acted-on.js";
import { heldWords, overCaps, projectStop, type Caps, type Stop } from "./caps.js";
import { openAt } from "./hours.js";
import { settingName } from "../settings/machine.js";
import { periodsAt, readSpends, totalOf } from "./usage.js";
import { approvalKey, sharedNote } from "./shared.js";
import { BRANCH_PREFIX, type DesignRan, type ReadyFacts, type Steps, type Unavailable } from "./steps.js";
import {
  decide,
  goAt,
  PARK_WAIT,
  type Action,
  type ApprovalView,
  type ChangeView,
  type Gate,
  type TicketState,
  type WaiverView,
} from "./table.js";

export type Logged = { readonly kind: "ok"; readonly said?: string } | Extract<Done, { kind: "failed" }>;

export type TickSetup = {
  readonly home: string;
  readonly project: string;
  readonly forge: Forge;
  readonly label: string;
  readonly steps: Steps;
  readonly gate: Gate;
  readonly readyPrograms?: readonly string[];
  readonly now: () => number;
  readonly quietMinutes: number;
  readonly pollMinutes: number;
  readonly repo: string;
  readonly dryRun: boolean;
  readonly log: (line: string) => void;
  readonly notify: Notify;
  readonly plugins?: readonly PluginHash[];
  readonly lanes?: readonly LaneProps[];
  readonly caps: Caps;
  readonly specs?: SpecStore;
  readonly quarantine?: readonly Quarantined[];
};

export type Decision = { readonly ticket: string; readonly action: Action };

async function namesIn(dir: string): Promise<readonly string[]> {
  const files = await readdir(dir).catch(() => [] as string[]);
  return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
}

async function ticketNames(setup: TickSetup, lines: readonly (OpenLine | MergedLine)[]): Promise<readonly string[]> {
  const started = await namesIn(join(setup.home, "starts", setup.project));
  const approved = await namesIn(join(setup.home, "approvals", setup.project));
  const onForge = lines
    .filter((l) => l.branch.startsWith(BRANCH_PREFIX) && !l.fork)
    .map((l) => l.branch.slice(BRANCH_PREFIX.length));
  return [...new Set([...started, ...approved, ...onForge])].filter(plainName).toSorted();
}

type Said = {
  readonly view: ApprovalView;
  readonly record: ApprovalRecord | "none";
  readonly blockedBy?: readonly string[];
};

function newest(a: string, b: string): string {
  return Date.parse(b) > Date.parse(a) ? b : a;
}

function approvedView(
  approval: ApprovalRecord,
  lane: Lane,
  started: StartRecord | "none",
  lanes: readonly LaneProps[] | undefined,
): ApprovalView {
  return started === "none"
    ? { kind: "unstarted" }
    : { kind: "approved", at: newest(approval.at, started.at), lane, testFirst: needsTestFirst(lane, lanes) };
}

async function startedView(
  setup: TickSetup,
  ticket: string,
  started: StartRecord,
  stale: boolean,
): Promise<ApprovalView> {
  const spec = await currentSpec(ticketAt(setup, ticket));
  if (spec.kind !== "spec") {
    return { kind: "unwritten" };
  }
  const { lane } = spec.spec;
  if (!needsApproval(lane, setup.lanes)) {
    return { kind: "started", at: started.at, lane, testFirst: needsTestFirst(lane, setup.lanes) };
  }
  return stale ? { kind: "stale" } : { kind: "unapproved", lane };
}

async function startOf(setup: TickSetup, ticket: string): Promise<Result<StartRecord | "none">> {
  const stored = await readStart({ home: setup.home, project: setup.project, ticket });
  if (stored.kind === "refused") {
    return { kind: "failed", reason: `${ticket}: ${stored.reason}` };
  }
  return { kind: "ok", value: stored.kind === "record" ? stored.record : "none" };
}

async function unapprovedSaid(
  setup: TickSetup,
  ticket: string,
  started: StartRecord | "none",
  stale: boolean,
): Promise<Result<Said>> {
  const view: ApprovalView =
    started === "none" ? { kind: stale ? "stale" : "missing" } : await startedView(setup, ticket, started, stale);
  return { kind: "ok", value: { view, record: "none" } };
}

async function plannedView(setup: TickSetup, ticket: string, said: Said, spec: Spec): Promise<Result<Said>> {
  const raise = await plannedCheck({ home: setup.home, project: setup.project, spec });
  if (raise.kind === "failed") {
    return { kind: "failed", reason: `${ticket}: ${raise.reason}` };
  }
  return raise.value.kind === "raised"
    ? { kind: "ok", value: { ...said, view: raise.value } }
    : { kind: "ok", value: said };
}

async function saidOf(setup: TickSetup, ticket: string): Promise<Result<Said>> {
  const said = await humanSaid(setup, ticket);
  const go = said.kind === "ok" && goAt(said.value.view) !== "";
  if (!go) {
    return said;
  }
  const spec = await currentSpec(ticketAt(setup, ticket));
  return spec.kind === "spec"
    ? plannedView(setup, ticket, { ...said.value, blockedBy: spec.spec.blockedBy }, spec.spec)
    : said;
}

async function humanSaid(setup: TickSetup, ticket: string): Promise<Result<Said>> {
  const started = await startOf(setup, ticket);
  if (started.kind === "failed") {
    return started;
  }
  const state = await approvalState(ticketAt(setup, ticket));
  if (state.kind === "approved") {
    const view = approvedView(state.record, state.spec.lane, started.value, setup.lanes);
    return { kind: "ok", value: { view, record: state.record } };
  }
  return state.kind === "refused"
    ? { kind: "failed", reason: `${ticket}: ${state.reason}` }
    : unapprovedSaid(setup, ticket, started.value, state.kind === "stale");
}

function changeOf(ticket: string, lines: readonly (OpenLine | MergedLine)[]): ChangeView {
  const ours = lines.filter((l) => l.branch === `${BRANCH_PREFIX}${ticket}` && !l.fork);
  const opened = ours.filter((l): l is OpenLine => l.kind === "open");
  const pick: readonly (OpenLine | MergedLine)[] = opened.length > 0 ? opened : ours;
  const [only] = pick;
  if (only === undefined) {
    return { kind: "none" };
  }
  if (pick.length > 1) {
    return { kind: "many", numbers: pick.map((l) => l.number) };
  }
  return only.kind === "open" ? { kind: "open", line: only } : { kind: "merged", line: only };
}

async function quarantined(setup: TickSetup, ticket: string, change: ChangeView): Promise<ChangeView> {
  const list = setup.quarantine ?? [];
  if (!redOpen(change) || list.length === 0) {
    return change;
  }
  const held = await heldAt(setup, change.line, list);
  if (held.kind === "blocks") {
    return change;
  }
  setup.log(`${ticket}: ${quarantineLine(held.shown)}`);
  return { kind: "open", line: { ...change.line, pipeline: { kind: "success" }, quarantined: held.shown } };
}

function redOpen(change: ChangeView): change is Extract<ChangeView, { kind: "open" }> {
  return change.kind === "open" && change.line.pipeline.kind === "failed";
}

async function heldAt(setup: TickSetup, line: OpenLine, list: readonly Quarantined[]): Promise<Held> {
  const jobs = await setup.forge.failedJobs({ number: line.number, head: line.head });
  return jobs.kind === "ok"
    ? heldBy(
        jobs.value.map((j) => j.name),
        list,
        setup.now(),
      )
    : { kind: "blocks" };
}

async function waiverOf(setup: TickSetup, ticket: string): Promise<Result<WaiverView>> {
  const stored = await readWaiver({ home: setup.home, project: setup.project, ticket });
  if (stored.kind === "refused") {
    return { kind: "failed", reason: `${ticket}: ${stored.reason}` };
  }
  return {
    kind: "ok",
    value:
      stored.kind === "record" ? { kind: "waived", head: stored.record.head, at: stored.record.at } : { kind: "none" },
  };
}

function sharedBefore(events: readonly Event[], approved: ApprovalRecord | "none"): boolean {
  const key = approved === "none" ? "" : approvalKey(approved);
  return events.some((e) => e.kind === "shared" && e.approval === key);
}

const DESIGN_KINDS: ReadonlySet<ApprovalView["kind"]> = new Set(["unapproved", "stale", "approved"]);

async function hasStart(setup: TickSetup, ticket: string): Promise<boolean> {
  const started = await startOf(setup, ticket);
  return started.kind === "ok" && started.value !== "none";
}

async function designDue(setup: TickSetup, ticket: string, said: Said): Promise<Current | "off"> {
  if (!DESIGN_KINDS.has(said.view.kind) || !(await hasStart(setup, ticket))) {
    return "off";
  }
  const spec = await currentSpec(ticketAt(setup, ticket));
  return spec.kind === "spec" && needsDesignReview(spec.spec.lane, setup.lanes) ? spec : "off";
}

async function designOf(setup: TickSetup, ticket: string, said: Said, events: readonly Event[]): Promise<DesignView> {
  const spec = await designDue(setup, ticket, said);
  if (spec === "off" || spec.kind !== "spec") {
    return { kind: "off" };
  }
  const approvedAt = said.record === "none" ? "" : said.record.at;
  return designView({
    events,
    spec: spec.spec.hash,
    design: spec.design,
    read: { lane: spec.spec.lane, planned: spec.spec.planned },
    raised: await raisedOf(setup, spec.spec),
    approvedAt,
    now: setup.now(),
  });
}

async function raisedOf(setup: TickSetup, spec: Spec): Promise<string> {
  const raise = await plannedCheck({ home: setup.home, project: setup.project, spec });
  if (raise.kind === "failed") {
    return `the lane check failed, so no design review runs: ${raise.reason}`;
  }
  return raise.value.kind === "raised" ? raisedWhy(raise.value) : "";
}

const MOST_BLOCKER_SPECS = 50;

async function blockedByOf(setup: TickSetup, ticket: string): Promise<readonly string[]> {
  const spec = await currentSpec(ticketAt(setup, ticket));
  return spec.kind === "spec" ? spec.spec.blockedBy : [];
}

async function specsBehind(
  setup: TickSetup,
  start: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  const seen = new Map<string, readonly string[]>();
  const queue = start.filter(plainName);
  while (queue.length > 0 && seen.size < MOST_BLOCKER_SPECS) {
    const next = queue.shift() ?? "";
    if (!seen.has(next)) {
      const behind = await blockedByOf(setup, next);
      seen.set(next, behind);
      queue.push(...behind.filter(plainName));
    }
  }
  return seen;
}

function building(runs: Summary, change: ChangeView): boolean {
  return runs.lastWriter.kind !== "none" || change.kind !== "none";
}

type BlockerRead = { readonly state: BlockerState; readonly unread?: string };

async function blockerState(setup: TickSetup, ticket: string): Promise<BlockerRead> {
  const read = await setup.forge.branchState({ branch: `${BRANCH_PREFIX}${ticket}` });
  if (read.kind === "failed") {
    return { state: "none", unread: read.reason };
  }
  const branch = read.value;
  return branch === "merged" || !issueTicket(setup, ticket)
    ? { state: branch }
    : issueBlocker(setup, Number(ticket), branch);
}

function issueTicket(setup: TickSetup, ticket: string): boolean {
  return setup.specs?.kind === "issue" && ISSUE_NUMBER.test(ticket);
}

const ISSUE_NUMBER = /^[1-9]\d{0,9}$/;

async function issueBlocker(setup: TickSetup, issue: number, branch: BranchState): Promise<BlockerRead> {
  const read = await setup.forge.issueState({ number: issue });
  return read.kind === "ok" ? { state: withIssue(branch, read.value) } : { state: branch, unread: read.reason };
}

async function blockersOf(
  setup: TickSetup,
  ticket: string,
  said: Said,
  now: { readonly runs: Summary; readonly change: ChangeView },
): Promise<BlockersView> {
  const blockedBy = building(now.runs, now.change) ? [] : (said.blockedBy ?? []);
  if (blockedBy.length === 0 || blockedBy.includes(ticket)) {
    return blockersView(ticket, blockedBy, []);
  }
  return blockersView(ticket, blockedBy, await blockersRead(setup, blockedBy));
}

async function blockersRead(setup: TickSetup, blockedBy: readonly string[]): Promise<readonly Blocker[]> {
  const read: Blocker[] = [];
  for (const [b, list] of await specsBehind(setup, blockedBy)) {
    const state: BlockerRead = blockedBy.includes(b) ? await blockerState(setup, b) : { state: "none" };
    read.push({ ticket: b, ...state, blockedBy: list });
  }
  return read;
}

function blockersField(blockers: BlockersView): { readonly blockers?: BlockersView } {
  return blockers.kind === "none" ? {} : { blockers };
}

function programsField(setup: TickSetup): { readonly programs?: readonly string[] } {
  return setup.readyPrograms === undefined ? {} : { programs: setup.readyPrograms };
}

type Read = {
  readonly state: TicketState;
  readonly approved: ApprovalRecord | "none";
  readonly shared: boolean;
};

async function stateOf(
  setup: TickSetup,
  ticket: string,
  lines: readonly (OpenLine | MergedLine)[],
): Promise<Result<Read>> {
  const said = await saidOf(setup, ticket);
  if (said.kind === "failed") {
    return said;
  }
  const events = await readRecords(
    { home: setup.home, project: setup.project, ticket },
    { warn: setup.log, setAside: true },
  );
  if (events.kind === "failed") {
    return events;
  }
  const waiver = await waiverOf(setup, ticket);
  if (waiver.kind === "failed") {
    return waiver;
  }
  const since = goAt(said.value.view) || "1970-01-01T00:00:00Z";
  const runs = summarize({ events: events.value, since });
  const design = await designOf(setup, ticket, said.value, events.value);
  const change = await quarantined(setup, ticket, changeOf(ticket, lines));
  const blockers = await blockersOf(setup, ticket, said.value, { runs, change });
  const approved = said.value.record;
  return {
    kind: "ok",
    value: {
      state: {
        ticket,
        gate: setup.gate,
        approval: said.value.view,
        waiver: waiver.value,
        change,
        runs,
        now: setup.now(),
        quietMinutes: setup.quietMinutes,
        caps: setup.caps,
        design,
        ...blockersField(blockers),
        ...programsField(setup),
      },
      approved,
      shared: sharedBefore(events.value, approved),
    },
  };
}

export type Decided =
  | (Read & { readonly action: Action })
  | { readonly kind: "broken"; readonly ticket: string; readonly reason: string };

export async function decideAll(setup: TickSetup): Promise<Result<readonly Decided[]>> {
  const lines = await poll({ forge: setup.forge, label: setup.label });
  if (lines.kind === "failed") {
    return lines;
  }
  const out: Decided[] = [];
  for (const ticket of await ticketNames(setup, lines.value)) {
    const read = await stateOf(setup, ticket, lines.value);
    out.push(
      read.kind === "ok"
        ? { ...read.value, action: decide(read.value.state) }
        : { kind: "broken", ticket, reason: read.reason },
    );
  }
  return { kind: "ok", value: out };
}

function number(state: TicketState): number | "none" {
  return state.change.kind === "open" || state.change.kind === "merged" ? state.change.line.number : "none";
}

async function say(setup: TickSetup, state: TicketState, post: Post): Promise<Done> {
  const n = number(state);
  return n === "none" ? { kind: "ok" } : setup.forge.note({ number: n, post });
}

function where(
  setup: TickSetup,
  state: TicketState,
): { readonly home: string; readonly project: string; readonly ticket: string } {
  return { home: setup.home, project: setup.project, ticket: state.ticket };
}

function ticketAt(setup: TickSetup, ticket: string): ApprovalWhere {
  return {
    home: setup.home,
    project: setup.project,
    ticket,
    ...(setup.specs === undefined ? {} : { store: setup.specs }),
  };
}

function nextFields(why: string): Post["fields"] {
  const step = nextStep({ kind: "needs-human", why });
  return step === undefined ? [] : [{ label: "next", value: `a person ${step.does}` }];
}

async function handOver(
  setup: TickSetup,
  state: TicketState,
  why: string,
  told: () => Promise<Told> = async () => NOTHING_MORE,
): Promise<Done> {
  const n = number(state);
  if (n === "none") {
    return handOverUnchanged(setup, state, why);
  }
  const steps: readonly (() => Promise<Done>)[] = [
    () => setup.forge.addLabel({ number: n, label: NEEDS_HUMAN }),
    () => setup.forge.removeLabel({ number: n, label: setup.label }),
    async () => {
      const more = await told();
      const fields = [...more.fields, ...nextFields(why)];
      return say(setup, state, { seat: "coordinator", title: `blocked: ${why}`, fields, items: more.items });
    },
    () => record({ where: where(setup, state), event: { at: at(setup), kind: "blocked", why } }),
  ];
  for (const step of steps) {
    const done = await step();
    if (done.kind === "failed") {
      return done;
    }
  }
  return { kind: "ok" };
}

type Told = { readonly fields: Post["fields"]; readonly items: readonly string[] };
const NOTHING_MORE: Told = { fields: [], items: [] };

async function keptTold(setup: TickSetup, state: TicketState, run: RunFolder): Promise<Told> {
  const kept = await keptIn(setup, state, run);
  const folder = { label: "run folder", value: run.folder };
  if (kept.kind === "failed") {
    return { fields: [folder, { label: "push", value: `nothing pushed: ${kept.reason}` }], items: [] };
  }
  const note = leftNote(kept.value, kept.value.pushed);
  return { fields: [folder, ...note.fields], items: note.items };
}

function keptIn(setup: TickSetup, state: TicketState, run: RunFolder): Promise<Result<KeptRun>> {
  const step = setup.steps.writer;
  const keep = step.kind === "available" ? step.keep : undefined;
  return keep === undefined
    ? Promise.resolve({ kind: "failed", reason: "the writer's step cannot look into it" })
    : keep({ folder: run.folder, since: run.head, change: changeNow(state) });
}

function changeNow(state: TicketState): KeptInput["change"] {
  return state.change.kind === "open" ? { branch: state.change.line.branch, head: state.change.line.head } : "none";
}

function handOverRun(setup: TickSetup, state: TicketState, why: string, run: RunFolder | undefined): Promise<Done> {
  return run === undefined
    ? handOver(setup, state, why)
    : handOver(setup, state, why, () => keptTold(setup, state, run));
}

function handOverUnchanged(setup: TickSetup, state: TicketState, why: string): Promise<Done> {
  return record({ where: where(setup, state), event: { at: at(setup), kind: "blocked", why } });
}

type ActionMap = { readonly [A in Action as A["kind"]]: A };
type ActionKind = keyof ActionMap;
type Handler<R> = { readonly [K in ActionKind]: (setup: TickSetup, state: TicketState, action: ActionMap[K]) => R };

function dispatchOn<K extends ActionKind, R>(
  table: Handler<R>,
  kind: K,
  setup: TickSetup,
  state: TicketState,
  action: ActionMap[K],
): R {
  return table[kind](setup, state, action);
}

async function releaseClaim(setup: TickSetup, state: TicketState, why: string): Promise<Done> {
  const n = number(state);
  const removed =
    n === "none" ? ({ kind: "ok" } as const) : await setup.forge.removeLabel({ number: n, label: setup.label });
  return removed.kind === "ok"
    ? say(setup, state, { seat: "coordinator", title: `released: ${why}`, fields: [], items: [] })
    : removed;
}

function quarantinedAt(state: TicketState): readonly Quarantined[] {
  return state.change.kind === "open" ? (state.change.line.quarantined ?? []) : [];
}

async function ping(setup: TickSetup, state: TicketState, head: string): Promise<Done> {
  const held = quarantinedAt(state);
  const said = await say(setup, state, {
    seat: "coordinator",
    title:
      held.length === 0
        ? `ready for you at ${head.slice(0, 8)}: the gate is green; review and merge`
        : `ready for you at ${head.slice(0, 8)}: the gate is green but for ${held.length} quarantined check(s); review and merge`,
    fields: [],
    items: quarantineItems(held),
  });
  return said.kind === "ok"
    ? record({ where: where(setup, state), event: { at: at(setup), kind: "pinged", head } })
    : said;
}

async function informed(setup: TickSetup, message: Ping): Promise<Done> {
  const sent = await setup.notify(message);
  if (sent.kind === "failed") {
    setup.log(`${message.ticket}: the ping did not go out (the forge note is the record): ${sent.reason}`);
  }
  return { kind: "ok" };
}

function writerSaid(state: TicketState, value: WriterValue): string {
  if (value.outcome === "done") {
    return "";
  }
  const output = value.output === undefined ? "" : `; output kept in ${value.output}`;
  const nowhere = number(state) === "none" ? "; there is no open change to say so on" : "";
  return `writer ${value.outcome}: ${value.why ?? "no reason recorded"}${output}${nowhere}`;
}

async function reconcile(setup: TickSetup, state: TicketState): Promise<Done> {
  const n = number(state);
  if (n === "none") {
    return { kind: "ok" };
  }
  await mergedLine(setup, state, n);
  return setup.forge.removeLabel({ number: n, label: setup.label });
}

async function mergedLine(setup: TickSetup, state: TicketState, n: number): Promise<void> {
  const place = where(setup, state);
  const events = await readRecords(place, { warn: () => undefined });
  if (events.kind === "failed") {
    return;
  }
  const merged = await mergeOf(setup, place, events.value, n);
  const kept =
    merged.kind === "ok" && !events.value.some((e) => e.kind === "timeline" && e.number === n)
      ? await record({ where: place, event: timelineOf(events.value, merged.value) })
      : merged;
  if (kept.kind === "failed") {
    setup.log(`${state.ticket}: the merge was not recorded: ${kept.reason}`);
  }
}

async function mergeOf(
  setup: TickSetup,
  place: Where,
  events: readonly Event[],
  n: number,
): Promise<Result<{ readonly number: number; readonly at: string }>> {
  const held = events.find((e) => e.kind === "merged" && e.number === n);
  if (held !== undefined) {
    return { kind: "ok", value: { number: n, at: held.at } };
  }
  const landed = await setup.forge.landed({ number: n });
  if (landed.kind === "failed") {
    return landed;
  }
  const kept = await record({ where: place, event: { kind: "merged", number: n, ...landed.value } });
  return kept.kind === "ok" ? { kind: "ok", value: { number: n, at: landed.value.at } } : kept;
}

const FORGE: Handler<Promise<Done> | "none"> = {
  "needs-human": (setup, state, a) => handOverRun(setup, state, a.why, a.run),
  release: (setup, state, a) => releaseClaim(setup, state, a.why),
  ping: (setup, state, a) => ping(setup, state, a.head),
  "design-note": (setup, state, a) => designNote(setup, state, a),
  held: (setup, state, a) => holdRecorded(setup, state, a),
  "blockers-unread": (setup, state, a) =>
    record({ where: where(setup, state), event: { at: at(setup), kind: "blockers-unread", why: a.why } }),
  reconcile: (setup, state) => reconcile(setup, state),
  wait: () => "none",
  writer: () => "none",
  ready: () => "none",
  review: () => "none",
  verify: () => "none",
  design: () => "none",
};

async function forgeAction(setup: TickSetup, state: TicketState, action: Action): Promise<Done | "none"> {
  return dispatchOn(FORGE, action.kind, setup, state, action);
}

export type Ran = {
  readonly ticket: string;
  readonly action: Action;
  readonly result: Logged | Unavailable;
  readonly held?: boolean;
};

async function claim(setup: TickSetup, state: TicketState): Promise<Done> {
  const line = state.change.kind === "open" ? state.change.line : "none";
  return line === "none" || line.claimed
    ? { kind: "ok" }
    : setup.forge.addLabel({ number: line.number, label: setup.label });
}

function at(setup: TickSetup): string {
  return new Date(setup.now()).toISOString();
}

function headOf(state: TicketState): string {
  return state.change.kind === "open" ? state.change.line.head : "";
}

async function specHashOf(setup: TickSetup, ticket: string): Promise<string> {
  const spec = await currentSpec(ticketAt(setup, ticket));
  return spec.kind === "spec" ? spec.spec.hash : "";
}

async function answeredFirst(setup: TickSetup, state: TicketState, task: Task): Promise<Done> {
  const answers = task.kind === "fix" || task.kind === "test-first" ? (task.answers ?? []) : [];
  if (answers.length === 0) {
    return { kind: "ok" };
  }
  const spec = await specHashOf(setup, state.ticket);
  return record({ where: where(setup, state), event: { at: at(setup), kind: "answered", spec, answers } });
}

async function runWriter(setup: TickSetup, state: TicketState, task: Task): Promise<Logged | Unavailable> {
  const step = setup.steps.writer;
  if (step.kind === "unavailable") {
    return step;
  }
  const kept = await answeredFirst(setup, state, task);
  return kept.kind === "ok" ? startWriter(setup, state, task, step) : kept;
}

async function begin(
  setup: TickSetup,
  state: TicketState,
  step: Extract<Steps["writer"], { kind: "available" }>,
  mode: ReturnType<typeof modeOf>,
): Promise<Result<{ readonly folder?: string }>> {
  const folder = await folderFor(step);
  if (folder.kind === "failed") {
    return folder;
  }
  const named = folder.value;
  const started = await record({
    where: where(setup, state),
    event: {
      at: at(setup),
      kind: "started",
      phase: "writer",
      mode,
      head: headOf(state),
      plugins: usedBy(setup),
      ...named,
    },
  });
  const claimed = started.kind === "ok" ? await claim(setup, state) : started;
  if (claimed.kind === "failed") {
    await emptied(named.folder);
    return claimed;
  }
  return { kind: "ok", value: named };
}

async function startWriter(
  setup: TickSetup,
  state: TicketState,
  task: Task,
  step: Extract<Steps["writer"], { kind: "available" }>,
): Promise<Logged> {
  const mode = modeOf(task);
  const begun = await begin(setup, state, step, mode);
  if (begun.kind === "failed") {
    return begun;
  }
  const named = begun.value;
  const ran = await step.run({ ticket: state.ticket, change: state.change, head: headOf(state), task, ...named });
  if (ran.kind !== "ok") {
    return failedSpent(setup, state, headOf(state), ran, "writer");
  }
  const { outcome, parked: _parked, ...rest } = ran.value;
  return outcome === "parked"
    ? writerParked(setup, state, task, ran.value)
    : writerEnded(setup, state, mode, { ...rest, outcome });
}

function parkedEvent(when: string, task: Task, value: WriterValue): Extract<Event, { kind: "parked" }> {
  const { until, said } = value.parked ?? { until: "unknown", said: value.why ?? "" };
  const parkedTask = parkedTaskOf(task);
  return {
    at: when,
    kind: "parked",
    phase: "writer",
    head: value.head,
    until,
    said,
    ...(parkedTask === undefined ? {} : { task: parkedTask }),
    ...spentAndTrace(value.spend, value.trace),
  };
}

async function writerParked(setup: TickSetup, state: TicketState, task: Task, value: WriterValue): Promise<Logged> {
  const event = parkedEvent(at(setup), task, value);
  const kept = await record({ where: where(setup, state), event });
  if (kept.kind === "failed") {
    return kept;
  }
  if (event.until !== "unknown") {
    await parkNoticed(setup, state, event.until, event.said);
  }
  return { kind: "ok", said: `writer parked: ${PARK_WAIT} ${event.until}: ${event.said}` };
}

async function parkNoticed(setup: TickSetup, state: TicketState, until: string, said: string): Promise<void> {
  const path = join(setup.home, "runs", setup.project, "provider-notice.json");
  const before = await readFile(path, "utf8").catch(() => "");
  const key = JSON.stringify({ until });
  if (before === key) {
    return;
  }
  await writeFile(path, key, { mode: 0o600 }).catch(() => undefined);
  const why = `${PARK_WAIT} ${shownAt(until, UTC)}, then its run starts again: ${said}`;
  await informed(setup, { kind: "held", ticket: state.ticket, change: number(state), why });
}

async function folderFor(
  step: Extract<Steps["writer"], { kind: "available" }>,
): Promise<Result<{ readonly folder?: string }>> {
  if (step.folder === undefined) {
    return { kind: "ok", value: {} };
  }
  const made = await step.folder();
  return made.kind === "ok" ? { kind: "ok", value: { folder: made.value } } : made;
}

async function emptied(folder: string | undefined): Promise<void> {
  if (folder !== undefined) {
    await rmdir(folder).catch(() => undefined);
  }
}

type WriterValue = Extract<
  Awaited<ReturnType<Extract<Steps["writer"], { kind: "available" }>["run"]>>,
  { kind: "ok" }
>["value"];

type EndedValue = Omit<WriterValue, "outcome" | "parked"> & { readonly outcome: "done" | "asked" | "blocked" };

async function writerEnded(
  setup: TickSetup,
  state: TicketState,
  mode: ReturnType<typeof modeOf>,
  value: EndedValue,
): Promise<Logged> {
  const ended = await record({
    where: where(setup, state),
    event: { at: at(setup), kind: "writer-ended", mode, ...value },
  });
  const said = writerSaid(state, value);
  return ended.kind === "ok" && said !== "" ? { kind: "ok", said } : ended;
}

function usedBy(setup: TickSetup): readonly PluginHash[] {
  return setup.plugins ?? [];
}

async function startCheck(
  setup: TickSetup,
  state: TicketState,
  phase: "ready" | "review" | "verify",
  head: string,
): Promise<Done> {
  return record({
    where: where(setup, state),
    event: { at: at(setup), kind: "started", phase, mode: "none", head, plugins: usedBy(setup) },
  });
}

function failedAt(setup: TickSetup, step: Retried, failed: boolean, before: number) {
  return failed ? { nextTry: nextTryOf(step, before + 1, setup.now()) } : {};
}

function evidenceOf(state: TicketState): readonly Evidence[] {
  const w = state.runs.lastWriter;
  return w.kind === "ended" ? w.evidence : [];
}

async function readyFacts(setup: TickSetup, state: TicketState): Promise<Result<ReadyFacts>> {
  const spec = await currentSpec(ticketAt(setup, state.ticket));
  if (spec.kind !== "spec") {
    return { kind: "failed", reason: spec.kind === "missing" ? "the ticket's spec is gone" : spec.reason };
  }
  const oneWayDoor = await oneWayDoorPathsOf(setup);
  return oneWayDoor.kind === "ok"
    ? { kind: "ok", value: { criteria: spec.spec.criteria, oneWayDoor: oneWayDoor.value } }
    : oneWayDoor;
}

async function readyStarted(setup: TickSetup, state: TicketState, head: string): Promise<Result<ReadyFacts>> {
  const facts = await readyFacts(setup, state);
  const started = facts.kind === "ok" ? await startCheck(setup, state, "ready", head) : facts;
  return started.kind === "ok" ? facts : started;
}

async function runReady(setup: TickSetup, state: TicketState, head: string): Promise<Done | Unavailable> {
  const step = setup.steps.ready;
  if (step.kind === "unavailable") {
    return step;
  }
  const facts = await readyStarted(setup, state, head);
  if (facts.kind === "failed") {
    return facts;
  }
  const ran = await step.run({
    ticket: state.ticket,
    change: state.change,
    head,
    evidence: evidenceOf(state),
    ...facts.value,
  });
  return ran.kind === "ok"
    ? record({ where: where(setup, state), event: readyEnded(setup, state, head, ran.value) })
    : ran;
}

function readyEnded(
  setup: TickSetup,
  state: TicketState,
  head: string,
  value: { readonly passed: boolean; readonly why: string; readonly human: boolean; readonly lane?: Lane },
): Event {
  const forWriter = !value.passed && !value.human;
  return {
    at: at(setup),
    kind: "ready-ended",
    head,
    passed: value.passed,
    why: value.why,
    ...(value.human ? { human: true } : {}),
    ...(value.lane === undefined ? {} : { lane: value.lane }),
    ...programsField(setup),
    ...failedAt(setup, "ready", forWriter, state.runs.readyFailures),
  };
}

async function runVerify(setup: TickSetup, state: TicketState, head: string): Promise<Done | Unavailable> {
  const step = setup.steps.verify;
  const started = step.kind === "available" ? await startCheck(setup, state, "verify", head) : step;
  if (started.kind !== "ok" || step.kind === "unavailable") {
    return started;
  }
  const ran = await step.run({ ticket: state.ticket, change: state.change, head });
  return ran.kind === "ok"
    ? record({
        where: where(setup, state),
        event: {
          at: at(setup),
          kind: "verify-ended",
          head,
          passed: ran.value.passed,
          ...failedAt(setup, "verify", !ran.value.passed, state.runs.verifyFailures),
        },
      })
    : ran;
}

function dollarCapped(caps: Caps): boolean {
  return caps.ticket.usd !== "none" || caps.day.usd !== "none";
}

function roomCheck(setup: TickSetup): (() => Promise<Result<number | "unbounded">>) | undefined {
  const step = setup.steps.review;
  const worstUsd = step.kind === "available" ? step.worstUsd : undefined;
  return dollarCapped(setup.caps) ? worstUsd : undefined;
}

async function daySpend(setup: TickSetup): Promise<Spend> {
  const { caps } = setup;
  const runs = caps.day.usd === "none" ? [] : (await readSpends({ home: setup.home, project: setup.project })).runs;
  return totalOf(runs, periodsAt(setup.now(), caps.windowHours).day).spend;
}

async function roundRoom(setup: TickSetup, state: TicketState): Promise<Result<string>> {
  const worstUsd = roomCheck(setup);
  if (worstUsd === undefined) {
    return { kind: "ok", value: "" };
  }
  const worst = await worstUsd();
  return worst.kind === "ok"
    ? {
        kind: "ok",
        value: overCaps({ worst: worst.value, ticket: state.runs.spent, day: await daySpend(setup), caps: setup.caps }),
      }
    : worst;
}

async function heldRound(setup: TickSetup, state: TicketState): Promise<Done | Unavailable | "go"> {
  const room = await roundRoom(setup, state);
  if (room.kind === "failed") {
    return room;
  }
  return room.value === "" ? "go" : { kind: "unavailable", reason: `held: ${room.value}`, held: true };
}

async function runReview(setup: TickSetup, state: TicketState, head: string): Promise<Done | Unavailable> {
  const step = setup.steps.review;
  if (step.kind === "unavailable") {
    return step;
  }
  const held = await heldRound(setup, state);
  if (held !== "go") {
    return held;
  }
  const started = await startCheck(setup, state, "review", head);
  if (started.kind !== "ok") {
    return started;
  }
  const ran = await step.run({ ticket: state.ticket, change: state.change, head });
  return ran.kind === "ok"
    ? reviewEnded(setup, state, head, ran.value)
    : failedSpent(setup, state, head, ran, "review");
}

function reviewEnded(
  setup: TickSetup,
  state: TicketState,
  head: string,
  value: {
    readonly actOn: number;
    readonly spend: Spend;
    readonly split?: RoundSpend;
    readonly acted?: Acted;
    readonly lenses?: Readonly<Record<string, number>>;
    readonly citesNotFound?: number;
    readonly found?: FoundByRule;
    readonly traces?: readonly string[];
  },
): Promise<Done> {
  return record({
    where: where(setup, state),
    event: {
      at: at(setup),
      kind: "review-ended",
      head,
      actOn: value.actOn,
      spend: value.spend,
      ...splitIn(value),
      ...ratings(value),
      ...counts(value),
      ...tracesIn(value),
      ...failedAt(setup, "review", value.actOn > 0, state.runs.reviewFailures),
    },
  });
}

function ratings(value: { readonly acted?: Acted; readonly lenses?: Readonly<Record<string, number>> }): {
  readonly acted?: Acted;
  readonly lenses?: Readonly<Record<string, number>>;
} {
  return {
    ...(value.acted === undefined ? {} : { acted: value.acted }),
    ...(value.lenses === undefined ? {} : { lenses: value.lenses }),
  };
}

function counts(value: { readonly citesNotFound?: number; readonly found?: FoundByRule }): {
  readonly citesNotFound?: number;
  readonly found?: FoundByRule;
} {
  return {
    ...(value.citesNotFound === undefined ? {} : { citesNotFound: value.citesNotFound }),
    ...(value.found === undefined ? {} : { found: value.found }),
  };
}

function splitIn(ran: { readonly split?: RoundSpend }): { readonly split?: RoundSpend } {
  return ran.split === undefined ? {} : { split: ran.split };
}

function tracesIn(ran: { readonly traces?: readonly string[] }): { readonly traces?: readonly string[] } {
  return ran.traces === undefined ? {} : { traces: ran.traces };
}

async function failedSpent(
  setup: TickSetup,
  state: TicketState,
  head: string,
  ran: FailedSpent,
  phase: "writer" | "review",
): Promise<Done> {
  const spend = ran.spend ?? NO_SPEND;
  if (spend.usd > 0 || spend.tokens > 0) {
    const kept = await record({
      where: where(setup, state),
      event: { at: at(setup), kind: "spent", phase, head, spend, ...splitIn(ran), ...tracesIn(ran) },
    });
    if (kept.kind === "failed") {
      setup.log(`${state.ticket}: the failed ${phase} run's spend was not recorded: ${kept.reason}`);
    }
  }
  return { kind: "failed", reason: ran.reason };
}

type DesignAction = Extract<Action, { kind: "design" }>;

async function earlierOf(setup: TickSetup, state: TicketState, a: DesignAction): Promise<readonly EarlierRound[]> {
  const events = await readRecords(where(setup, state), { warn: setup.log, setAside: true });
  return events.kind === "ok" ? roundsBefore(events.value, { spec: a.spec, design: a.design }) : [];
}

function earlierField(rounds: readonly EarlierRound[]): { readonly earlier?: readonly EarlierRound[] } {
  return rounds.length === 0 ? {} : { earlier: rounds };
}

type ReviewRan = Result<DesignRan<{ readonly findings: readonly DesignFinding[] }>>;

function lessRepeats(setup: TickSetup, state: TicketState, ran: ReviewRan, rounds: readonly EarlierRound[]): ReviewRan {
  if (ran.kind === "failed" || ran.value.kind === "failed" || rounds.length === 0) {
    return ran;
  }
  const left = dropRepeats(ran.value.findings, rounds);
  if (left.dropped > 0) {
    setup.log(`${state.ticket}: design review: dropped ${left.dropped} finding(s) an earlier round settled`);
  }
  return { kind: "ok", value: { ...ran.value, findings: left.findings } };
}

async function designFindings(
  setup: TickSetup,
  state: TicketState,
  a: DesignAction,
): Promise<Result<readonly DesignFinding[]>> {
  const events = await readRecords(where(setup, state), { warn: setup.log, setAside: true });
  if (events.kind === "failed") {
    return events;
  }
  const review = events.value.findLast(
    (e) =>
      e.kind === "design-ended" &&
      e.step === "review" &&
      e.outcome === "done" &&
      e.spec === a.spec &&
      e.design === a.design,
  );
  return review?.kind === "design-ended"
    ? { kind: "ok", value: review.findings }
    : { kind: "failed", reason: "the design-reviewer's findings at this spec and design are gone" };
}

type DesignEnded = Extract<Event, { kind: "design-ended" }>;

function answerOf(v: {
  readonly findings?: readonly DesignFinding[];
  readonly kept?: readonly Kept[];
}): Pick<DesignEnded, "findings" | "kept"> {
  return { findings: v.findings ?? [], kept: v.kept ?? [] };
}

function readField(read: SpecRead | "none"): Partial<SpecRead> {
  return read === "none" ? {} : { lane: read.lane, planned: read.planned };
}

function finalField(final: true | undefined): { readonly final?: true } {
  return final === true ? { final: true } : {};
}

function designEnded(
  setup: TickSetup,
  a: DesignAction,
  ran: Result<DesignRan<{ readonly findings?: readonly DesignFinding[]; readonly kept?: readonly Kept[] }>>,
  read: SpecRead | "none",
): DesignEnded {
  const base = {
    at: at(setup),
    kind: "design-ended",
    step: a.step,
    spec: a.spec,
    design: a.design,
    ...readField(read),
  } as const;
  if (ran.kind === "failed") {
    return { ...base, outcome: "failed", why: ran.reason, findings: [], kept: [] };
  }
  const v = ran.value;
  const extras = {
    card: v.card,
    ...(v.spend === undefined ? {} : { spend: v.spend }),
    ...(v.trace === undefined ? {} : { trace: v.trace }),
  };
  return v.kind === "failed"
    ? { ...base, outcome: "failed", why: v.why, findings: [], kept: [], ...extras, ...finalField(v.final) }
    : { ...base, outcome: "done", why: "", ...answerOf(v), ...extras };
}

async function runDesignStep(
  setup: TickSetup,
  state: TicketState,
  a: DesignAction,
): Promise<Result<DesignRan<{ readonly findings?: readonly DesignFinding[]; readonly kept?: readonly Kept[] }>>> {
  const rounds = await earlierOf(setup, state, a);
  const input = { ticket: state.ticket, spec: a.spec, design: a.design, ...earlierField(rounds) };
  if (a.step === "review") {
    const step = setup.steps.designReview;
    return step.kind === "available"
      ? lessRepeats(setup, state, await step.run(input), rounds)
      : { kind: "failed", reason: step.reason };
  }
  const step = setup.steps.designVerify;
  if (step.kind === "unavailable") {
    return { kind: "failed", reason: step.reason };
  }
  const findings = await designFindings(setup, state, a);
  return findings.kind === "ok" ? step.run({ ...input, findings: toVerify(findings.value) }) : findings;
}

const DESIGN_PHASE = { review: "design-review", verify: "design-verify" } as const;

async function runDesign(setup: TickSetup, state: TicketState, a: DesignAction): Promise<Done | Unavailable> {
  const step = a.step === "review" ? setup.steps.designReview : setup.steps.designVerify;
  if (step.kind === "unavailable") {
    return step;
  }
  const started = await record({
    where: where(setup, state),
    event: { at: at(setup), kind: "started", phase: DESIGN_PHASE[a.step], mode: "none", head: "" },
  });
  return started.kind === "ok" ? designRan(setup, state, a) : started;
}

async function designRan(setup: TickSetup, state: TicketState, a: DesignAction): Promise<Done> {
  const ended = designEnded(setup, a, await runDesignStep(setup, state, a), await readAt(setup, state, a));
  const kept = await record({ where: where(setup, state), event: ended });
  if (kept.kind === "failed") {
    return kept;
  }
  if (ended.outcome === "failed") {
    return { kind: "failed", reason: `the ${DESIGN_PHASE[a.step]} run failed: ${ended.why}` };
  }
  return ended.step === "verify" ? designPosted(setup, state, ended) : { kind: "ok" };
}

async function readAt(setup: TickSetup, state: TicketState, a: DesignAction): Promise<SpecRead | "none"> {
  const current = await currentSpec(ticketAt(setup, state.ticket));
  return current.kind === "spec" && current.spec.hash === a.spec && current.design === a.design
    ? { lane: current.spec.lane, planned: current.spec.planned }
    : "none";
}

function designNote(setup: TickSetup, state: TicketState, a: DesignNoteAction): Promise<Done> {
  setup.log(`${state.ticket}: design review: ${a.why}`);
  return record({
    where: where(setup, state),
    event: { at: at(setup), kind: "design-noted", spec: a.spec, design: a.design, why: a.why },
  });
}

type DesignNoteAction = Extract<Action, { kind: "design-note" }>;

async function holdRecorded(setup: TickSetup, state: TicketState, a: Extract<Action, { kind: "held" }>): Promise<Done> {
  const kept = await record({ where: where(setup, state), event: { at: at(setup), kind: "held", why: a.why } });
  if (kept.kind === "failed" || !a.ping) {
    return kept;
  }
  return informed(setup, { kind: "held", ticket: state.ticket, change: number(state), why: a.why });
}

export function designPost(ended: DesignEnded): Post {
  const counted = ended.kept.length === 0 ? "no finding kept" : `${ended.kept.length} finding(s) kept`;
  return {
    seat: "coordinator",
    title: `design review: ${counted}; read them, then approve`,
    fields: [
      { label: "spec", value: ended.spec },
      { label: "design", value: ended.design },
    ],
    items: ended.kept.map(keptLine),
  };
}

function designPosted(setup: TickSetup, state: TicketState, ended: DesignEnded): Promise<Done> {
  for (const k of ended.kept) {
    setup.log(`${state.ticket}: design review: ${keptLine(k)}`);
  }
  return say(setup, state, designPost(ended));
}

const RUN: Handler<Promise<Logged | Unavailable> | "none"> = {
  writer: (setup, state, a) => runWriter(setup, state, a.task),
  ready: (setup, state, a) => runReady(setup, state, a.head),
  review: (setup, state, a) => runReview(setup, state, a.head),
  verify: (setup, state, a) => runVerify(setup, state, a.head),
  design: (setup, state, a) => runDesign(setup, state, a),
  "needs-human": () => "none",
  release: () => "none",
  ping: () => "none",
  "design-note": () => "none",
  held: () => "none",
  "blockers-unread": () => "none",
  reconcile: () => "none",
  wait: () => "none",
};

function runAction(setup: TickSetup, state: TicketState, action: Action): Promise<Logged | Unavailable> | "none" {
  return dispatchOn(RUN, action.kind, setup, state, action);
}

type Describe = { readonly [K in ActionKind]: (action: ActionMap[K]) => string };

const DESCRIBE: Describe = {
  wait: (a) => `wait: ${a.why}`,
  "needs-human": (a) => `needs-human: ${a.why}`,
  release: (a) => `release: ${a.why}`,
  writer: (a) => `writer (${modeOf(a.task)}): ${a.why}`,
  ready: (a) => `ready at ${a.head.slice(0, 8)}`,
  review: (a) => `review at ${a.head.slice(0, 8)}`,
  verify: (a) => `local verifier at ${a.head.slice(0, 8)}`,
  design: (a) => `${a.step === "review" ? "design review" : "design verify pass"} at spec ${a.spec.slice(0, 8)}`,
  ping: (a) => `ping at ${a.head.slice(0, 8)}`,
  "design-note": (a) => `design note: ${a.why}`,
  held: (a) => `wait: ${a.why}${a.ping ? " (the person is told)" : ""}`,
  "blockers-unread": (a) => `wait: the git host did not answer for a blocker: ${a.why}`,
  reconcile: () => "reconcile: merged; remove the claim",
};

function describeAs<K extends ActionKind>(kind: K, action: ActionMap[K]): string {
  return DESCRIBE[kind](action);
}

export function describe(action: Action): string {
  return describeAs(action.kind, action);
}

function logResult(setup: TickSetup, ticket: string, result: Logged | Unavailable): void {
  setup.log(`${ticket}: ${result.kind === "ok" ? (result.said ?? "done") : `${result.kind}: ${result.reason}`}`);
}

type Later = { readonly state: TicketState; readonly action: Action };

function unshared(d: Read): { readonly approval: ApprovalRecord; readonly number: number } | "none" {
  const n = d.state.change.kind === "open" ? d.state.change.line.number : "none";
  return d.approved === "none" || d.shared || n === "none" ? "none" : { approval: d.approved, number: n };
}

async function share(setup: TickSetup, d: Read): Promise<void> {
  const due = unshared(d);
  if (due === "none") {
    return;
  }
  const posted = await setup.forge.note({ number: due.number, post: sharedNote(due.approval) });
  const event = { at: at(setup), kind: "shared", approval: approvalKey(due.approval) } as const;
  const kept = posted.kind === "ok" ? await record({ where: where(setup, d.state), event }) : posted;
  if (kept.kind === "failed") {
    setup.log(`${d.state.ticket}: the shared copy of the approval did not go out: ${kept.reason}`);
  }
}

export function heardLines(
  events: readonly Event[],
  started: StartRecord | "none",
  approved: ApprovalRecord | "none",
): readonly Event[] {
  const has = (kind: "begun" | "approved", time: string) => events.some((e) => e.kind === kind && e.at === time);
  const begun: readonly Event[] =
    started === "none" || has("begun", started.at)
      ? []
      : [{ at: started.at, kind: "begun", by: started.by, via: started.via }];
  const ok: readonly Event[] =
    approved === "none" || has("approved", approved.at)
      ? []
      : [{ at: approved.at, kind: "approved", by: approved.by, via: approved.via, spec: approved.spec_hash }];
  return [...begun, ...ok];
}

async function heard(setup: TickSetup, d: Read): Promise<void> {
  const place = where(setup, d.state);
  const events = await readRecords(place, { warn: () => undefined });
  const started = await startOf(setup, d.state.ticket);
  if (events.kind === "failed" || started.kind === "failed") {
    return;
  }
  for (const event of heardLines(events.value, started.value, d.approved)) {
    const kept = await record({ where: place, event });
    if (kept.kind === "failed") {
      setup.log(`${d.state.ticket}: the ${event.kind} line was not written: ${kept.reason}`);
    }
  }
}

async function turnPinged(setup: TickSetup, d: Read & { readonly action: Action }): Promise<void> {
  const step = turnStep(d.state.runs, whoseTurn(d.action).lane);
  if (step.record === "none") {
    return;
  }
  const kept = await record({ where: where(setup, d.state), event: { at: at(setup), kind: "turn", to: step.record } });
  if (kept.kind === "failed") {
    setup.log(`${d.state.ticket}: the turn was not recorded, so no ping went out: ${kept.reason}`);
    return;
  }
  if (step.ping) {
    await informed(setup, turnPing({ state: d.state, action: d.action, change: number(d.state) }));
  }
}

async function forgeThenTurn(setup: TickSetup, d: Read & { readonly action: Action }): Promise<Done | "none"> {
  const done = await forgeAction(setup, d.state, d.action);
  if (done === "none" || done.kind === "ok") {
    await turnPinged(setup, d);
  }
  return done;
}

async function forgePass(setup: TickSetup, decided: readonly Decided[], ran: Ran[]): Promise<readonly Later[]> {
  const later: Later[] = [];
  for (const d of decided) {
    if ("kind" in d) {
      setup.log(`${d.ticket}: broken: ${d.reason}`);
      ran.push({
        ticket: d.ticket,
        action: { kind: "wait", why: "broken" },
        result: { kind: "failed", reason: d.reason },
      });
      continue;
    }
    setup.log(`${d.state.ticket}: ${describe(d.action)}`);
    await heard(setup, d);
    await share(setup, d);
    const done = await forgeThenTurn(setup, d);
    if (done === "none") {
      later.push(d);
    } else {
      ran.push({ ticket: d.state.ticket, action: d.action, result: done });
      logResult(setup, d.state.ticket, done);
    }
  }
  return later;
}

export const RUN_KINDS: ReadonlySet<ActionKind> = new Set(["writer", "ready", "review", "verify", "design"]);

async function stopNow(setup: TickSetup): Promise<Stop> {
  const { day, window } = setup.caps;
  const set = [day.usd, day.tokens, window.tokens, window.machineTokens].some((l) => l !== "none");
  if (!set) {
    return { kind: "go" };
  }
  const project = await readSpends({ home: setup.home, project: setup.project });
  const machine = window.machineTokens === "none" ? project : await readSpends({ home: setup.home });
  return projectStop({ project: project.runs, machine: machine.runs, now: setup.now(), caps: setup.caps });
}

async function noticed(setup: TickSetup, stop: Extract<Stop, { kind: "stop" }>, first: Later): Promise<void> {
  const path = join(setup.home, "runs", setup.project, "caps-notice.json");
  const before = await readFile(path, "utf8").catch(() => "");
  const key = JSON.stringify({ notice: stop.notice });
  if (before === key) {
    return;
  }
  await writeFile(path, key, { mode: 0o600 }).catch(() => undefined);
  await informed(setup, { kind: "paused", ticket: first.state.ticket, change: number(first.state), why: stop.why });
}

async function paused(setup: TickSetup, runs: readonly Later[], ran: Ran[]): Promise<boolean> {
  const [first] = runs;
  const stop = first === undefined ? ({ kind: "go" } as const) : await stopNow(setup);
  if (stop.kind === "go" || first === undefined) {
    return false;
  }
  const why = heldWords(stop, setup.project);
  setup.log(`no new runs: ${why}`);
  await noticed(setup, stop, first);
  for (const { state, action } of runs) {
    ran.push({ ticket: state.ticket, action, result: { kind: "unavailable", reason: why }, held: true });
  }
  return true;
}

const OUTSIDE_HOURS = "held: outside";

export function runHoursEnd(setup: Pick<TickSetup, "project" | "caps">, ran: readonly Ran[]): string {
  const hours = setup.caps.runHours;
  const held = ran.some((r) => r.result.kind === "unavailable" && r.result.reason.startsWith(OUTSIDE_HOURS));
  return held && hours !== "any"
    ? `run hours are ${hours.text} UTC; run \`agent-factory dispatch ${setup.project}\` again then`
    : "none";
}

function closed(setup: TickSetup, runs: readonly Later[], ran: Ran[]): boolean {
  const hours = setup.caps.runHours;
  if (runs.length === 0 || hours === "any" || openAt(hours, setup.now())) {
    return false;
  }
  const why = `the run hours ${hours.text} (UTC, ${settingName("runHours")})`;
  setup.log(`no new runs: outside ${why}`);
  for (const { state, action } of runs) {
    ran.push({
      ticket: state.ticket,
      action,
      result: { kind: "unavailable", reason: `${OUTSIDE_HOURS} ${why}` },
      held: true,
    });
  }
  return true;
}

async function runPass(setup: TickSetup, later: readonly Later[], ran: Ran[]): Promise<void> {
  const runs = later.filter((l) => RUN_KINDS.has(l.action.kind));
  if (closed(setup, runs, ran)) {
    return;
  }
  await someRuns(setup, later, ran, setup.caps.runsAtOnce);
}

async function someRuns(setup: TickSetup, later: readonly Later[], ran: Ran[], most: number): Promise<void> {
  const pending = later.filter((l) => RUN_KINDS.has(l.action.kind));
  if (most < 1 || pending.length === 0 || (await paused(setup, pending, ran))) {
    return;
  }
  const next = await firstRun(setup, later, ran);
  if (next !== "none") {
    await someRuns(setup, later.slice(next + 1), ran, most - 1);
  }
}

function heldOf(result: Logged | Unavailable): { readonly held?: true } {
  return result.kind === "unavailable" && result.held === true ? { held: true } : {};
}

async function firstRun(setup: TickSetup, later: readonly Later[], ran: Ran[]): Promise<number | "none"> {
  for (const [i, { state, action }] of later.entries()) {
    const pending = runAction(setup, state, action);
    const result = pending === "none" ? "none" : await pending;
    if (result === "none") {
      continue;
    }
    ran.push({ ticket: state.ticket, action, result, ...heldOf(result) });
    logResult(setup, state.ticket, result);
    if (result.kind !== "unavailable") {
      return i;
    }
  }
  return "none";
}

async function actAll(setup: TickSetup, decided: readonly Decided[]): Promise<readonly Ran[]> {
  const ran: Ran[] = [];
  await runPass(setup, await forgePass(setup, decided, ran), ran);
  return ran;
}

type Lock =
  | { readonly kind: "held"; readonly release: () => Promise<void> }
  | { readonly kind: "busy"; readonly reason: string };

const STALE_UNREADABLE_MS = 10 * 60_000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) === "EPERM";
  }
}

export type Holder =
  | { readonly kind: "alive"; readonly pid: number }
  | { readonly kind: "dead" }
  | { readonly kind: "unknown" };

export async function holder(path: string, now: number): Promise<Holder> {
  const text = await readFile(path, "utf8").catch(() => "");
  const pid = Number(text.split(":")[0]);
  if (Number.isSafeInteger(pid) && pid > 0) {
    return alive(pid) ? { kind: "alive", pid } : { kind: "dead" };
  }
  const age = await stat(path).then(
    (st) => now - st.mtimeMs,
    () => 0,
  );
  return age > STALE_UNREADABLE_MS ? { kind: "dead" } : { kind: "unknown" };
}

async function take(lockPath: string, mine: string, token: string): Promise<boolean> {
  try {
    await link(mine, lockPath);
    return true;
  } catch {
    const found = await holder(lockPath, Date.now());
    if (found.kind !== "dead") {
      return false;
    }
    await rename(mine, lockPath);
    return (await readFile(lockPath, "utf8").catch(() => "")) === token;
  }
}

export type Guard = { readonly file: string; readonly what: string };
export const PASS_GUARD: Guard = { file: ".lock", what: "pass" };

export async function lock(input: {
  readonly home: string;
  readonly project: string;
  readonly guard?: Guard;
}): Promise<Lock> {
  const guard = input.guard ?? PASS_GUARD;
  const dir = join(input.home, "runs", input.project);
  const lockPath = join(dir, guard.file);
  const token = `${process.pid}:${randomUUID()}`;
  const mine = join(dir, `.lock.${randomUUID()}`);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(mine, token, { mode: 0o600, flag: "wx" });
    const held = await take(lockPath, mine, token);
    await rm(mine, { force: true });
    if (!held) {
      const found = await holder(lockPath, Date.now());
      return {
        kind: "busy",
        reason:
          found.kind === "alive"
            ? `another ${guard.what} (pid ${found.pid}) is running for ${input.project}`
            : `another ${guard.what} holds ${lockPath}`,
      };
    }
    const release = async (): Promise<void> => {
      const now = await readFile(lockPath, "utf8").catch(() => "");
      if (now === token) {
        await rm(lockPath, { force: true });
      }
    };
    return { kind: "held", release };
  } catch {
    await rm(mine, { force: true }).catch(() => undefined);
    return { kind: "busy", reason: `cannot take ${lockPath}` };
  }
}

async function acted(setup: TickSetup, decided: readonly Decided[]): Promise<readonly Ran[]> {
  if (setup.dryRun) {
    decided.forEach((d) =>
      setup.log(
        "kind" in d
          ? `${d.ticket}: broken: ${d.reason} (dry run)`
          : `${d.state.ticket}: ${describe(d.action)} (dry run)`,
      ),
    );
    return [];
  }
  await polled(setup);
  await waitingPinged(waitingOf(setup), flights(setup, decided));
  return actAll(setup, decided);
}

function waitingOf(setup: TickSetup): WaitingSetup {
  return { ...setup, waiting: () => setup.forge.waiting({ label: WAITING_LABEL }) };
}

function flights(setup: TickSetup, decided: readonly Decided[]): (ticket: string) => Flight {
  return (ticket) => (issueTicket(setup, ticket) ? flightOf(decided, ticket) : NO_FLIGHT);
}

function flightOf(decided: readonly Decided[], ticket: string): Flight {
  const flying = decided.find(
    (d): d is Read & { readonly action: Action } => !("kind" in d) && d.state.ticket === ticket,
  );
  return flying === undefined ? NO_FLIGHT : { lane: whoseTurn(flying.action).lane, change: number(flying.state) };
}

async function polled(setup: TickSetup): Promise<void> {
  const last = { at: at(setup), pollMinutes: setup.pollMinutes, forge: setup.forge.name, repo: setup.repo };
  const written = await writeLastPoll({ home: setup.home, project: setup.project, poll: last });
  if (written.kind === "failed") {
    setup.log(`the last-poll time was not written: ${written.reason}`);
  }
}

async function pruned(setup: TickSetup): Promise<void> {
  const gone = await pruneTraces({ home: setup.home, project: setup.project, now: setup.now() });
  for (const problem of gone.problems) {
    setup.log(problem);
  }
}

export async function tick(setup: TickSetup): Promise<Result<readonly Ran[]>> {
  if (!plainName(setup.project)) {
    return { kind: "failed", reason: `the project must be a plain name, got ${JSON.stringify(setup.project)}` };
  }
  const held = await lock({ home: setup.home, project: setup.project });
  if (held.kind === "busy") {
    return { kind: "failed", reason: held.reason };
  }
  try {
    await pruned(setup);
    const decided = await decideAll(setup);
    if (decided.kind === "failed") {
      return decided;
    }
    return { kind: "ok", value: await acted(setup, decided.value) };
  } finally {
    await held.release();
  }
}

export type WaitingRun = { readonly kind: "ran"; readonly waits: readonly WaitingRan[] } | { readonly kind: "busy" };

export async function waitingPass(setup: TickSetup): Promise<Result<WaitingRun>> {
  if (!plainName(setup.project)) {
    return { kind: "failed", reason: `the project must be a plain name, got ${JSON.stringify(setup.project)}` };
  }
  const held = await lock({ home: setup.home, project: setup.project });
  if (held.kind === "busy") {
    return { kind: "ok", value: { kind: "busy" } };
  }
  try {
    const waits = setup.dryRun ? await dryWaits(setup) : await waitsPinged(setup);
    return waits.kind === "ok" ? { kind: "ok", value: { kind: "ran", waits: waits.value } } : waits;
  } finally {
    await held.release();
  }
}

async function waitsPinged(setup: TickSetup): Promise<Result<readonly WaitingRan[]>> {
  const decided = await decideAll(setup);
  return decided.kind === "ok" ? waitingPinged(waitingOf(setup), flights(setup, decided.value)) : decided;
}

async function dryWaits(setup: TickSetup): Promise<Result<readonly WaitingRan[]>> {
  const read = await waitingLabels(waitingOf(setup));
  return read.kind === "ok"
    ? { kind: "ok", value: read.value.map((w) => ({ ticket: String(w.number), title: w.title, outcome: "dry-run" })) }
    : read;
}
