// tick — one pass of the orchestrator over a project (#103; ADR-0012 S3). It keeps no memory of its own: every pass
// reads the local START and approval records, the git host (poll), and the run records, decides each ticket with the
// table, then acts:
//   - the shared copy of each approval, once, on the ticket's open PR (#227)
//   - forge-only actions (needs-human, release, ping, reconcile) for every ticket that has one
//   - at most one run (writer, ready check, reviewer or a design review's run) per pass: runs at once is 1 (ADR-0012 S16)
//   - when a design review's verify pass ends (#236), what it kept goes to the front doors: a note on the ticket's PR
//     when one is open, a ping, and the pass's log
//   - no run at all while the project is at its day cap or its window share (#131; caps.ts), with one notice for it
// A run's step is a seam. A step that is not built yet says so, and the pass records nothing for it, so the ticket is
// decided the same way next time. A "started" record is written before a run and an "ended" one after it; a pass that
// dies in between leaves the first alone, and the next pass hands that ticket to a person.
//
// A lock file keeps two passes from running at once (a pass by hand while the orchestrator loop runs, a run of an
// hour). No cron or launchd job runs a pass: a human's command starts the orchestrator loop (orchestrator-loop.ts), and
// it ends by itself when no ticket is in flight (#305). Each pass that polled writes its last-poll time (last-poll.ts),
// so `status` shows a loop that stopped.
//
// The ticket list (#227) is every ticket with a START record, an approval record, or a factory/<ticket> PR. What lets
// the build begin is a human's word: a START and an approval, or in the tiny lane a START alone (table.ts). An
// approval with no START waits. The newer of the two records is when the counts start afresh. The shared copy is a note the
// project's own git host identity posts, "approved by <human> via <door>, spec <hash>, design <hash or none>", for
// people to see. It never starts anything: the orchestrator decides only from the local records.

import type { PluginHash } from "../process/use.js";
import { heldBy, quarantineItems, quarantineLine, type Held, type Quarantined } from "../process/quarantine.js";
import { randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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
import type { Forge } from "../forge/types.js";
import { poll, type MergedLine, type OpenLine } from "../poll.js";
import type { Notify, Ping } from "../notify.js";
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
  readRecords,
  record,
  summarize,
  type Event,
  type Retried,
  type Task,
} from "./records.js";
import { writeLastPoll } from "./last-poll.js";
import { designView, dropRepeats, roundsBefore, type DesignView, type EarlierRound, type SpecRead } from "./design.js";
import { nextStep } from "./next-step.js";
import { keptLine, toVerify, type DesignFinding, type Kept } from "../design/findings.js";
import { needsDesignReview } from "../lane.js";
import { NO_SPEND, type FailedSpent, type RoundSpend, type Spend } from "./spend.js";
import type { Acted } from "../review/acted-on.js";
import { heldWords, overCaps, projectStop, type Caps, type Stop } from "./caps.js";
import { openAt } from "./hours.js";
import { settingName } from "../settings/machine.js";
import { periodsAt, readSpends, totalOf } from "./usage.js";
import { approvalKey, sharedNote } from "./shared.js";
import {
  decide,
  goAt,
  type Action,
  type ApprovalView,
  type ChangeView,
  type Gate,
  type TicketState,
  type WaiverView,
} from "./table.js";

export const BRANCH_PREFIX = "factory/";

// Logged : an action that ended, with what the log says of it in place of "done" (#62: a writer run that stopped, and
// why)
export type Logged = { readonly kind: "ok"; readonly said?: string } | Extract<Done, { kind: "failed" }>;

// held: a cap kept the run from starting (#131, #237), not a step that is not set up
export type Unavailable = { readonly kind: "unavailable"; readonly reason: string; readonly held?: boolean };
// F: how a failed run may say what it spent, for a step whose runs spend (#483)
export type Step<I, O, F = never> =
  | Unavailable
  | { readonly kind: "available"; readonly run: (input: I) => Promise<Result<O> | F> };

export type { FailedSpent } from "./spend.js";

export type RunInput = { readonly ticket: string; readonly change: ChangeView; readonly head: string };
// what a design review's run reads (#236): the spec and design with these hashes, and for the verify pass the
// design-reviewer's conflicts and opens
// earlier: every earlier round, with its hashes, findings, what the verify pass kept and what it dismissed, for a
// re-review and its verify pass (#489); none on a first round
export type DesignInput = {
  readonly ticket: string;
  readonly spec: string;
  readonly design: string;
  readonly earlier?: readonly EarlierRound[];
};
// how a design review's run ended; its card's hash and what it spent are kept either way
// final: a failure no retry fixes (a cite that does not hold), so the step stops at once (#489)
export type DesignRan<T> = { readonly card: string; readonly spend?: Spend } & (
  | ({ readonly kind: "done" } & T)
  | { readonly kind: "failed"; readonly why: string; readonly final?: true }
);
// what the ready check holds the change to, read on the host (#230): the spec's acceptance criteria, in order (AC-1
// first), and the project's one-way-door paths
export type ReadyFacts = { readonly criteria: readonly string[]; readonly oneWayDoor: readonly string[] };
export type Steps = {
  readonly writer: Step<
    RunInput & { readonly task: Task },
    {
      readonly head: string;
      readonly outcome: "done" | "asked" | "blocked";
      readonly patch: string;
      readonly evidence: readonly Evidence[];
      // the writer hung after its report, and the host stopped it after the completion window (#182)
      readonly hung: boolean;
      // what the run spent (#131); none when it was not measured
      readonly spend?: Spend;
      // the role card's hash, and what a cleanup run deferred (#236)
      readonly card?: string;
      readonly deferred?: readonly string[];
      // each cite of the project's brief that went stale (#235)
      readonly stale?: readonly string[];
      // why a run that is not done stopped, and the file that keeps the end of its output (#62)
      readonly why?: string;
      readonly output?: string;
    },
    // a writer step that fails after the run still says what the run spent (#483)
    FailedSpent
  >;
  // the ready check runs the writer's evidence rows again at the head; why names the first row that failed, and human
  // says a test check stopped it for a person (#231). It reads the lane the real diff needs (#230), and holds each
  // acceptance criterion of the spec to an evidence row.
  readonly ready: Step<
    RunInput & { readonly evidence: readonly Evidence[] } & ReadyFacts,
    { readonly passed: boolean; readonly why: string; readonly human: boolean; readonly lane?: Lane }
  >;
  // what the round spent: zero when it ran no model, as when it reused a verdict (#131); a round that fails says what
  // its passes spent too, so the caps and usage count it
  readonly review:
    | Unavailable
    | {
        readonly kind: "available";
        // the most a round can spend, in dollars: every finder it can pick and its verify passes at the per-run cap;
        // "unbounded" with no per-run cap. A round whose worst case could pass a dollar cap is held (#237)
        readonly worstUsd?: () => Promise<Result<number | "unbounded">>;
        readonly run: (input: RunInput) => Promise<
          | Result<{
              readonly actOn: number;
              readonly spend: Spend;
              // the round's spend per run: each finder's by its lens, and the verify pass's (#337)
              readonly split?: RoundSpend;
              readonly acted?: Acted;
              readonly lenses?: Readonly<Record<string, number>>;
              readonly citesNotFound?: number;
            }>
          | FailedSpent
        >;
      };
  // the local verifier (#91): it posts its result as a commit status at the head
  readonly verify: Step<RunInput, { readonly passed: boolean }>;
  // the design review's two read-only runs (#236): the design-reviewer, then the verify pass over its findings
  readonly designReview: Step<DesignInput, DesignRan<{ readonly findings: readonly DesignFinding[] }>>;
  readonly designVerify: Step<
    DesignInput & { readonly findings: readonly DesignFinding[] },
    DesignRan<{ readonly kept: readonly Kept[] }>
  >;
};

// The steps when nothing is set up: the writer waits on the container box (#113); the ready check and the verifier on
// a box and the project file; the reviewer on its settings.
export const STEPS_TODAY: Steps = {
  writer: { kind: "unavailable", reason: "the writer's box is not built yet (#113)" },
  ready: { kind: "unavailable", reason: "the ready check needs a box (#113) and the project file" },
  review: { kind: "unavailable", reason: "the reviewer needs FACTORY_REPO and a plugin that holds its references" },
  verify: { kind: "unavailable", reason: "the local verifier needs a box (#113) and the project file" },
  designReview: { kind: "unavailable", reason: "the design review needs FACTORY_REPO" },
  designVerify: { kind: "unavailable", reason: "the design review needs FACTORY_REPO" },
};

export type TickSetup = {
  readonly home: string;
  readonly project: string;
  readonly forge: Forge;
  readonly label: string;
  readonly steps: Steps;
  // the project file's gate (#91)
  readonly gate: Gate;
  // every program an evidence row may start with (#444; ready/steps.ts readyPrograms); none without a project file
  readonly readyPrograms?: readonly string[];
  readonly now: () => number;
  readonly quietMinutes: number;
  // how long the orchestrator loop waits between passes (poll.minutes), kept with the last-poll time for status
  readonly pollMinutes: number;
  // the repository on the git host (FACTORY_PROJECT): status finds the last-poll time by it
  readonly repo: string;
  // print each decision and act on none
  readonly dryRun: boolean;
  readonly log: (line: string) => void;
  // a person's ping when a ticket needs them (#119); NO_NOTIFY when the project maps no notify plugin
  readonly notify: Notify;
  // the plugins this pass's runs use, each with its hash, for the run records (#232); none when it lists none
  readonly plugins?: readonly PluginHash[];
  // the project's lanes, from its process plugin or the built-in process (#232); the default lanes when absent
  readonly lanes?: readonly LaneProps[];
  // the ticket, day and window caps (#131)
  readonly caps: Caps;
  // the project's spec store (spec-store.ts, #381); the local one under <home>/specs when absent
  readonly specs?: SpecStore;
  // the checks a person quarantined in the process plugin (#485; process/quarantine.ts); none when absent
  readonly quarantine?: readonly Quarantined[];
};

export type Decision = { readonly ticket: string; readonly action: Action };

async function namesIn(dir: string): Promise<readonly string[]> {
  const files = await readdir(dir).catch(() => [] as string[]);
  return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
}

// tickets with a START or an approval record, and those whose change is on the git host
async function ticketNames(setup: TickSetup, lines: readonly (OpenLine | MergedLine)[]): Promise<readonly string[]> {
  const started = await namesIn(join(setup.home, "starts", setup.project));
  const approved = await namesIn(join(setup.home, "approvals", setup.project));
  const onForge = lines
    .filter((l) => l.branch.startsWith(BRANCH_PREFIX) && !l.fork)
    .map((l) => l.branch.slice(BRANCH_PREFIX.length));
  return [...new Set([...started, ...approved, ...onForge])].filter(plainName).toSorted();
}

// What a human said for the ticket: its approval as the table sees it, and the approval record itself, for its shared
// copy, while it is the current one.
type Said = { readonly view: ApprovalView; readonly record: ApprovalRecord | "none" };

function newest(a: string, b: string): string {
  return Date.parse(b) > Date.parse(a) ? b : a;
}

// approvedView : an approval lets the build begin only with a START; the newer of the two is when the counts start,
// so a person who takes the ticket back from needs-human may START or approve again
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

// startedView : a START with no current approval: the build may begin in the tiny lane only. A spec the coordinator
// has not written yet, or one not ready, waits for it.
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

// unapprovedSaid : no current approval; a START may still let a tiny ticket begin
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

// plannedView : a view that lets the build begin is held when the spec's planned files need a heavier lane (#230)
async function plannedView(setup: TickSetup, ticket: string, said: Said, spec: Spec): Promise<Result<Said>> {
  const raise = await plannedCheck({ home: setup.home, project: setup.project, spec });
  if (raise.kind === "failed") {
    return { kind: "failed", reason: `${ticket}: ${raise.reason}` };
  }
  return raise.value.kind === "raised"
    ? { kind: "ok", value: { ...said, view: raise.value } }
    : { kind: "ok", value: said };
}

// saidOf : what a human said for the ticket, with the lane checked against the planned files before the build
async function saidOf(setup: TickSetup, ticket: string): Promise<Result<Said>> {
  const said = await humanSaid(setup, ticket);
  const go = said.kind === "ok" && goAt(said.value.view) !== "";
  if (!go) {
    return said;
  }
  const spec = await currentSpec(ticketAt(setup, ticket));
  return spec.kind === "spec" ? plannedView(setup, ticket, said.value, spec.spec) : said;
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

// changeOf : the ticket's change: on factory/<ticket>, in this repository (a fork's branch is never it). An open change
// wins over merged ones; two of the same kind cannot be told apart, so a person decides.
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

// quarantined : the change as the table reads it with the quarantine in force (#485): a red head whose every failed
// job a person quarantined, unexpired, reads as passed, and the pass logs each one so it still shows. A red check is
// never re-run by the factory; one that is not quarantined goes back to the implementer as a CI round (table.ts).
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

// heldAt : what the failed jobs at the head mean with the quarantine in force; jobs the git host cannot name block
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

// waiverOf : the ticket's waiver of the test checks (#231), as the table sees it
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

// sharedBefore : whether the run records hold the shared copy of this approval
function sharedBefore(events: readonly Event[], approved: ApprovalRecord | "none"): boolean {
  const key = approved === "none" ? "" : approvalKey(approved);
  return events.some((e) => e.kind === "shared" && e.approval === key);
}

const DESIGN_KINDS: ReadonlySet<ApprovalView["kind"]> = new Set(["unapproved", "stale", "approved"]);

// designOf : where the design review of the ticket's current spec and design stands (#236): due only after a START, in
// a lane with a design review, while the ticket waits for its approval or has one
// hasStart : whether the ticket has a START record
async function hasStart(setup: TickSetup, ticket: string): Promise<boolean> {
  const started = await startOf(setup, ticket);
  return started.kind === "ok" && started.value !== "none";
}

// designDue : the ticket's current spec, when a design review is due for it
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

// raisedOf : why the spec's Planned files need a heavier lane, before any design review reads it (#230, #489); "" when
// they do not. A check that cannot read the project's one-way-door paths holds the review too, and says why.
async function raisedOf(setup: TickSetup, spec: Spec): Promise<string> {
  const raise = await plannedCheck({ home: setup.home, project: setup.project, spec });
  if (raise.kind === "failed") {
    return `the lane check failed, so no design review runs: ${raise.reason}`;
  }
  return raise.value.kind === "raised" ? raisedWhy(raise.value) : "";
}

// programsField : the pass's allowed evidence programs, as a field to spread: none without a project file (#444)
function programsField(setup: TickSetup): { readonly programs?: readonly string[] } {
  return setup.readyPrograms === undefined ? {} : { programs: setup.readyPrograms };
}

// Decided's ticket: its state for the table, and the current approval with whether its shared copy is posted
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
  const approved = said.value.record;
  return {
    kind: "ok",
    value: {
      state: {
        ticket,
        gate: setup.gate,
        approval: said.value.view,
        waiver: waiver.value,
        change: await quarantined(setup, ticket, changeOf(ticket, lines)),
        runs,
        now: setup.now(),
        quietMinutes: setup.quietMinutes,
        caps: setup.caps,
        design,
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

// decideAll : one decision per ticket, in ticket order. A ticket whose spec, START, approval or records cannot be read
// is broken: it fails on its own, and every other ticket is still decided.
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

// ticketAt : where the ticket's spec and approval are read, with the project's spec store
function ticketAt(setup: TickSetup, ticket: string): ApprovalWhere {
  return {
    home: setup.home,
    project: setup.project,
    ticket,
    ...(setup.specs === undefined ? {} : { store: setup.specs }),
  };
}

// nextFields : what the person does next, as the hand-over note's one field (next-step.ts, #485)
function nextFields(why: string): Post["fields"] {
  const step = nextStep({ kind: "needs-human", why });
  return step === undefined ? [] : [{ label: "next", value: `a person ${step.does}` }];
}

// handOver : needs-human, the claim released (as block does), one note, and a record so the same stop is never posted
// twice. With no change to label, the pass fails for this ticket, so the operator sees it.
async function handOver(setup: TickSetup, state: TicketState, why: string): Promise<Done> {
  const n = number(state);
  if (n === "none") {
    return { kind: "failed", reason: `a person must look, and there is no change to label: ${why}` };
  }
  const steps: readonly (() => Promise<Done>)[] = [
    () => setup.forge.addLabel({ number: n, label: NEEDS_HUMAN }),
    () => setup.forge.removeLabel({ number: n, label: setup.label }),
    () => say(setup, state, { seat: "coordinator", title: `blocked: ${why}`, fields: nextFields(why), items: [] }),
    () => record({ where: where(setup, state), event: { at: at(setup), kind: "blocked", why } }),
    () => informed(setup, { kind: "needs-you", ticket: state.ticket, change: n, why }),
  ];
  for (const step of steps) {
    const done = await step();
    if (done.kind === "failed") {
      return done;
    }
  }
  return { kind: "ok" };
}

// each action by its kind, so a handler per kind is typed without an assertion
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

// quarantinedAt : the checks a person quarantined that let this head's red gate read as passed; none for a green one
function quarantinedAt(state: TicketState): readonly Quarantined[] {
  return state.change.kind === "open" ? (state.change.line.quarantined ?? []) : [];
}

async function ping(setup: TickSetup, state: TicketState, head: string): Promise<Done> {
  const held = quarantinedAt(state);
  // a gate that reads as green only because of a quarantine says so, naming each check and its expiry (#485)
  const said = await say(setup, state, {
    seat: "coordinator",
    title:
      held.length === 0
        ? `ready for you at ${head.slice(0, 8)}: the gate is green; review and merge`
        : `ready for you at ${head.slice(0, 8)}: the gate is green but for ${held.length} quarantined check(s); review and merge`,
    fields: [],
    items: quarantineItems(held),
  });
  const pinged =
    said.kind === "ok"
      ? await record({ where: where(setup, state), event: { at: at(setup), kind: "pinged", head } })
      : said;
  return pinged.kind === "ok"
    ? informed(setup, { kind: "ready", ticket: state.ticket, change: number(state), head })
    : pinged;
}

// informed : a person pinged; a ping only informs, so one that fails is printed and the pass goes on (#119)
async function informed(setup: TickSetup, message: Ping): Promise<Done> {
  const sent = await setup.notify(message);
  if (sent.kind === "failed") {
    setup.log(`${message.ticket}: the ping did not go out (the forge note is the record): ${sent.reason}`);
  }
  return { kind: "ok" };
}

// writerPing : a writer run that ended on a person: a question that waits on them, or a blocked run, with why (#62)
function writerPing(state: TicketState, value: WriterValue): Ping | "none" {
  const change = number(state);
  if (value.outcome === "asked") {
    return { kind: "asked", ticket: state.ticket, change };
  }
  const why = value.why ?? "its note on the change says why";
  return value.outcome === "blocked"
    ? { kind: "needs-you", ticket: state.ticket, change, why: `the writer's run is blocked: ${why}` }
    : "none";
}

// writerSaid : the log line of a writer run that is not done, in place of "done" (#62): why it stopped, the file that
// keeps its output, and, before the change is opened, that this line and the record are the only place it is said.
// "" for a done run. Pure.
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
  return n === "none" ? { kind: "ok" } : setup.forge.removeLabel({ number: n, label: setup.label });
}

// the actions that only touch the forge; "none" for a run or a wait
const FORGE: Handler<Promise<Done> | "none"> = {
  "needs-human": (setup, state, a) => handOver(setup, state, a.why),
  release: (setup, state, a) => releaseClaim(setup, state, a.why),
  ping: (setup, state, a) => ping(setup, state, a.head),
  "design-note": (setup, state, a) => designNote(setup, state, a),
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

// a run a cap held back is marked held (#131, #305), so the orchestrator loop tells it from a step not set up
export type Ran = {
  readonly ticket: string;
  readonly action: Action;
  readonly result: Logged | Unavailable;
  readonly held?: boolean;
};

// claim : the change carries the claim label before a writer runs on it
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

// specHashOf : the hash of the ticket's spec as it is now, or "" when it cannot be read
async function specHashOf(setup: TickSetup, ticket: string): Promise<string> {
  const spec = await currentSpec(ticketAt(setup, ticket));
  return spec.kind === "spec" ? spec.spec.hash : "";
}

// answeredFirst : the person's answers kept as their own event before the run that receives them, tied to the spec
// version they answered (#486, P13); nothing for a task with none
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

// startWriter : the writer's start recorded, the claim taken, then the run
async function startWriter(
  setup: TickSetup,
  state: TicketState,
  task: Task,
  step: Extract<Steps["writer"], { kind: "available" }>,
): Promise<Logged> {
  const place = where(setup, state);
  const mode = modeOf(task);
  // the start is recorded before the claim: a pass that dies between them leaves a run that never ended, which goes to
  // a person, never a claim with no record, which would look like someone else's
  const started = await record({
    where: place,
    event: { at: at(setup), kind: "started", phase: "writer", mode, head: headOf(state), plugins: usedBy(setup) },
  });
  const claimed = started.kind === "ok" ? await claim(setup, state) : started;
  if (claimed.kind === "failed") {
    return claimed;
  }
  const ran = await step.run({ ticket: state.ticket, change: state.change, head: headOf(state), task });
  // a step that fails leaves the start alone: the next pass sees a run that never ended and asks a person; what the
  // run spent is still recorded (#483)
  return ran.kind === "ok"
    ? writerEnded(setup, state, mode, ran.value)
    : failedSpent(setup, state, headOf(state), ran, "writer");
}

type WriterValue = Extract<
  Awaited<ReturnType<Extract<Steps["writer"], { kind: "available" }>["run"]>>,
  { kind: "ok" }
>["value"];

// writerEnded : the run's end recorded, then the person pinged when it ended on them; the pass logs why it stopped
async function writerEnded(
  setup: TickSetup,
  state: TicketState,
  mode: ReturnType<typeof modeOf>,
  value: WriterValue,
): Promise<Logged> {
  const ended = await record({
    where: where(setup, state),
    event: { at: at(setup), kind: "writer-ended", mode, ...value },
  });
  const message = writerPing(state, value);
  const done = ended.kind === "ok" && message !== "none" ? await informed(setup, message) : ended;
  const said = writerSaid(state, value);
  return done.kind === "ok" && said !== "" ? { kind: "ok", said } : done;
}

// usedBy : the plugins and hashes a run of this pass records
function usedBy(setup: TickSetup): readonly PluginHash[] {
  return setup.plugins ?? [];
}

// startCheck : the "started" line of a ready check or a review, or why it cannot start
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

// failedAt : a failed check's nextTry, as a field to spread; n counts this failure (#228)
function failedAt(setup: TickSetup, step: Retried, failed: boolean, before: number) {
  return failed ? { nextTry: nextTryOf(step, before + 1, setup.now()) } : {};
}

// the rows the writer's last done run gave, which the ready check runs again
function evidenceOf(state: TicketState): readonly Evidence[] {
  const w = state.runs.lastWriter;
  return w.kind === "ended" ? w.evidence : [];
}

// readyFacts : the spec's acceptance criteria and the project's one-way-door paths, read on the host before the check
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

// readyStarted : the facts the ready check needs, then its "started" line; neither is written when the facts cannot
// be read
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

// readyEnded : the ready check's end, with the lane the diff needs (#230); a stop for a person (#231) is marked so and
// sets no next try for the writer
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

// dollarCapped : whether the ticket or the day has a dollar cap. Pure.
function dollarCapped(caps: Caps): boolean {
  return caps.ticket.usd !== "none" || caps.day.usd !== "none";
}

// roomCheck : the review step's worst case, when a dollar cap could hold the round; undefined when none could
function roomCheck(setup: TickSetup): (() => Promise<Result<number | "unbounded">>) | undefined {
  const step = setup.steps.review;
  const worstUsd = step.kind === "available" ? step.worstUsd : undefined;
  return dollarCapped(setup.caps) ? worstUsd : undefined;
}

// daySpend : what the project's runs spent today (UTC); read only when the day has a dollar cap
async function daySpend(setup: TickSetup): Promise<Spend> {
  const { caps } = setup;
  const runs = caps.day.usd === "none" ? [] : (await readSpends({ home: setup.home, project: setup.project })).runs;
  return totalOf(runs, periodsAt(setup.now(), caps.windowHours).day).spend;
}

// roundRoom : why a review round is held by its worst case (caps.ts overCaps), or ""; read before its "started" line,
// so a held round leaves no run behind
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

// heldRound : the round held by its worst case, or a failure to read it, or "go"
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
      ...(value.split === undefined ? {} : { split: value.split }),
      ...(value.acted === undefined ? {} : { acted: value.acted }),
      ...(value.lenses === undefined ? {} : { lenses: value.lenses }),
      ...(value.citesNotFound === undefined ? {} : { citesNotFound: value.citesNotFound }),
      ...failedAt(setup, "review", value.actOn > 0, state.runs.reviewFailures),
    },
  });
}

// splitIn : a round's spend per run, as a field to spread; none when it has none (#337). Pure.
function splitIn(ran: { readonly split?: RoundSpend }): { readonly split?: RoundSpend } {
  return ran.split === undefined ? {} : { split: ran.split };
}

// failedSpent : a writer run or a review that failed leaves its start alone, so a person looks; what it spent is still
// recorded, as a spent line, so the caps and usage count it (#131, #483)
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
      event: { at: at(setup), kind: "spent", phase, head, spend, ...splitIn(ran) },
    });
    if (kept.kind === "failed") {
      setup.log(`${state.ticket}: the failed ${phase} run's spend was not recorded: ${kept.reason}`);
    }
  }
  return { kind: "failed", reason: ran.reason };
}

type DesignAction = Extract<Action, { kind: "design" }>;

// designFindings : the design-reviewer's findings at the action's hashes, which its verify pass checks
// earlierOf : the ticket's earlier rounds, for a re-review and its verify pass; none on a first round or when the
// records do not read (the review then runs as a first round)
async function earlierOf(setup: TickSetup, state: TicketState, a: DesignAction): Promise<readonly EarlierRound[]> {
  const events = await readRecords(where(setup, state), { warn: setup.log, setAside: true });
  return events.kind === "ok" ? roundsBefore(events.value, { spec: a.spec, design: a.design }) : [];
}

function earlierField(rounds: readonly EarlierRound[]): { readonly earlier?: readonly EarlierRound[] } {
  return rounds.length === 0 ? {} : { earlier: rounds };
}

type ReviewRan = Result<DesignRan<{ readonly findings: readonly DesignFinding[] }>>;

// lessRepeats : a re-review's findings less those an earlier round settled (design.ts dropRepeats), logged
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

// answerOf : a finished run's findings and kept findings; each run gives one of the two
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

// designEnded : the run's "design-ended" line, from how it ended; a step that failed with no answer kept no card
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
  const extras = { card: v.card, ...(v.spend === undefined ? {} : { spend: v.spend }) };
  return v.kind === "failed"
    ? { ...base, outcome: "failed", why: v.why, findings: [], kept: [], ...extras, ...finalField(v.final) }
    : { ...base, outcome: "done", why: "", ...answerOf(v), ...extras };
}

// runDesignStep : the design-reviewer, or the verify pass over its conflicts and opens
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

// runDesign : one run of the design review (#236): a "started" line, the run, then its "design-ended" line, whether it
// finished or failed, with its card and spend; a finished verify pass then goes to the front doors
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

// designRan : the run, then its "design-ended" line; a finished verify pass goes to the front doors
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

// readAt : the spec's lane and Planned files, when the spec still has the action's hashes; kept on its design line so
// a later edit that moves them is reviewed again (design.ts)
async function readAt(setup: TickSetup, state: TicketState, a: DesignAction): Promise<SpecRead | "none"> {
  const current = await currentSpec(ticketAt(setup, state.ticket));
  return current.kind === "spec" && current.spec.hash === a.spec && current.design === a.design
    ? { lane: current.spec.lane, planned: current.spec.planned }
    : "none";
}

// designNote : the person told once why the design review holds or ends at these hashes (#489): the record first, so
// the note is never sent twice, then a ping, which only informs
async function designNote(setup: TickSetup, state: TicketState, a: DesignNoteAction): Promise<Done> {
  setup.log(`${state.ticket}: design review: ${a.why}`);
  const kept = await record({
    where: where(setup, state),
    event: { at: at(setup), kind: "design-noted", spec: a.spec, design: a.design, why: a.why },
  });
  return kept.kind === "ok"
    ? informed(setup, {
        kind: "needs-you",
        ticket: state.ticket,
        change: number(state),
        why: `design review: ${a.why}`,
      })
    : kept;
}

type DesignNoteAction = Extract<Action, { kind: "design-note" }>;

// designPost : the verify pass's kept findings, as the note on the ticket's PR. Pure.
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

// designPosted : what the verify pass kept, to the front doors: the pass's log, a note on the ticket's PR when one is
// open, and a ping. A ping only informs; the record holds the findings, so a note that fails fails the pass, and the
// next pass does not post it again: it reads the review as done.
async function designPosted(setup: TickSetup, state: TicketState, ended: DesignEnded): Promise<Done> {
  for (const k of ended.kept) {
    setup.log(`${state.ticket}: design review: ${keptLine(k)}`);
  }
  const noted = await say(setup, state, designPost(ended));
  const why = `the design review is in, ${ended.kept.length} finding(s) kept at spec ${ended.spec.slice(0, 8)}: read them, then approve`;
  const pinged = await informed(setup, { kind: "needs-you", ticket: state.ticket, change: number(state), why });
  return noted.kind === "ok" ? pinged : noted;
}

// the actions that start a run; "none" for the rest
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
  reconcile: () => "reconcile: merged; remove the claim",
};

function describeAs<K extends ActionKind>(kind: K, action: ActionMap[K]): string {
  return DESCRIBE[kind](action);
}

function describe(action: Action): string {
  return describeAs(action.kind, action);
}

function logResult(setup: TickSetup, ticket: string, result: Logged | Unavailable): void {
  setup.log(`${ticket}: ${result.kind === "ok" ? (result.said ?? "done") : `${result.kind}: ${result.reason}`}`);
}

type Later = { readonly state: TicketState; readonly action: Action };

// unshared : the approval and the PR its shared copy goes on, or "none" when it is posted already or has no PR yet
function unshared(d: Read): { readonly approval: ApprovalRecord; readonly number: number } | "none" {
  const n = d.state.change.kind === "open" ? d.state.change.line.number : "none";
  return d.approved === "none" || d.shared || n === "none" ? "none" : { approval: d.approved, number: n };
}

// share : the shared copy of the ticket's current approval (#227), once, on its open PR. It is for people to see and
// never starts anything, so one that fails is printed and the pass goes on; the next pass tries again.
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

// forgePass : every forge-only action, on fresh decisions; what is left is a run or a wait
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
    await share(setup, d);
    const done = await forgeAction(setup, d.state, d.action);
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

// stopNow : whether a new run may start in the project; the runs are read only when a cap is set (#131)
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

// noticed : one notice per stop and period: the period's key is kept in the project's runs folder
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

// paused : every run held while the project is at a cap, each recorded as unavailable, so the pass does not fail
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

// what a run held outside the run hours is recorded with; the orchestrator loop ends on it (runHoursEnd)
const OUTSIDE_HOURS = "held: outside";

// runHoursEnd : after a pass that held a run outside the run hours, what to tell the human; "none" otherwise. The
// orchestrator loop ends then, with this line, and never waits for the hours (#299; no job runs in the background):
// the held runs stay in the records, so the next dispatch picks them up. Pure.
export function runHoursEnd(setup: Pick<TickSetup, "project" | "caps">, ran: readonly Ran[]): string {
  const hours = setup.caps.runHours;
  const held = ran.some((r) => r.result.kind === "unavailable" && r.result.reason.startsWith(OUTSIDE_HOURS));
  return held && hours !== "any"
    ? `run hours are ${hours.text} UTC; run \`agent-factory dispatch ${setup.project}\` again then`
    : "none";
}

// closed : every run held while the hour is outside the run hours (hours.ts); nothing is stopped, and the tickets stay
// in flight, so a dispatch started inside the hours runs them (runHoursEnd)
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

// runPass : up to runs at once of the runs that can start, one after another; none outside the run hours, and none
// while the project is at a cap, checked again before each run after the first
async function runPass(setup: TickSetup, later: readonly Later[], ran: Ran[]): Promise<void> {
  const runs = later.filter((l) => RUN_KINDS.has(l.action.kind));
  if (closed(setup, runs, ran)) {
    return;
  }
  await someRuns(setup, later, ran, setup.caps.runsAtOnce);
}

// someRuns : up to `most` runs from `later`, the caps checked before each
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

// heldOf : a result a cap held, marked held, as a field to spread. Pure.
function heldOf(result: Logged | Unavailable): { readonly held?: true } {
  return result.kind === "unavailable" && result.held === true ? { held: true } : {};
}

// firstRun : the first run that can start, and the index of its entry in `later`, or "none"; an unavailable step
// lets the next one try
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

// a lock with no readable pid this old is left over from a crash, not one being written
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

// holder : who holds a lock file: a live pid, a dead one (a crash left it), or unknown while it is being written
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

// take : the lock, from a file already holding our token: link (fails if any lock is there), or, over a dead one, an
// atomic rename followed by a read-back, so of two passes that both found it dead only one keeps it
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

// what a lock file guards: one pass, or one orchestrator loop (#305), at a time per project
export type Guard = { readonly file: string; readonly what: string };
export const PASS_GUARD: Guard = { file: ".lock", what: "pass" };

// lock : one pass at a time per project, or with a guard one of what it guards. It never throws: a lock it cannot take
// is "busy", with the reason.
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
    // release only a lock that is still ours
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

// acted : a dry run prints each decision and acts on none; a real pass writes its last-poll time, then acts
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
  return actAll(setup, decided);
}

// polled : the pass's last-poll time; one that cannot be written is printed, and status then shows the pass as late
async function polled(setup: TickSetup): Promise<void> {
  const last = { at: at(setup), pollMinutes: setup.pollMinutes, forge: setup.forge.name, repo: setup.repo };
  const written = await writeLastPoll({ home: setup.home, project: setup.project, poll: last });
  if (written.kind === "failed") {
    setup.log(`the last-poll time was not written: ${written.reason}`);
  }
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
    return { kind: "ok", value: await acted(setup, decided.value) };
  } finally {
    await held.release();
  }
}
