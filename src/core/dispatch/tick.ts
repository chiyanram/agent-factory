// tick — one pass of the dispatcher over a project (#103; ADR-0012 S3). It keeps no memory of its own: every pass reads
// the local approvals, the forge (poll), and the run records, decides each ticket with the table, then acts:
//   - forge-only actions (needs-human, release, ping, reconcile) for every ticket that has one
//   - at most one run (writer, ready check or reviewer) per pass: runs at once is 1 (ADR-0012 S16)
// A run's step is a seam. A step that is not built yet says so, and the pass records nothing for it, so the ticket is
// decided the same way next time. A "started" record is written before a run and an "ended" one after it; a pass that
// dies in between leaves the first alone, and the next pass hands that ticket to a person.
//
// A lock file keeps two passes from running at once (cron every few minutes, a run of an hour).

import { randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { approvalState } from "../approval.js";
import { NEEDS_HUMAN } from "../finish.js";
import type { Done, Result } from "../forge/api.js";
import type { Forge } from "../forge/types.js";
import { poll, type MergedLine, type OpenLine } from "../poll.js";
import type { Post } from "../post.js";
import { plainName } from "../spec.js";
import type { Evidence } from "../report.js";
import { codeOf, modeOf, readRecords, record, summarize, type Task } from "./records.js";
import { decide, type Action, type ApprovalView, type ChangeView, type Gate, type TicketState } from "./table.js";

export const BRANCH_PREFIX = "factory/";

export type Unavailable = { readonly kind: "unavailable"; readonly reason: string };
export type Step<I, O> = Unavailable | { readonly kind: "available"; readonly run: (input: I) => Promise<Result<O>> };

export type RunInput = { readonly ticket: string; readonly change: ChangeView; readonly head: string };
export type Steps = {
  readonly writer: Step<
    RunInput & { readonly task: Task },
    {
      readonly head: string;
      readonly outcome: "done" | "asked" | "blocked";
      readonly stop: "exited" | "hung";
      readonly patch: string;
      readonly evidence: readonly Evidence[];
    }
  >;
  // the ready check runs the writer's evidence rows again at the head; why names the first row that failed
  readonly ready: Step<
    RunInput & { readonly evidence: readonly Evidence[] },
    { readonly passed: boolean; readonly why: string }
  >;
  readonly review: Step<RunInput, { readonly actOn: number }>;
  // the local verifier (#91): it posts its result as a commit status at the head
  readonly verify: Step<RunInput, { readonly passed: boolean }>;
};

// The steps when nothing is set up: the writer waits on the container box (#113); the ready check and the verifier on
// a box and the project file; the reviewer on its settings.
export const STEPS_TODAY: Steps = {
  writer: { kind: "unavailable", reason: "the writer's box is not built yet (#113)" },
  ready: { kind: "unavailable", reason: "the ready check needs a box (#113) and the project file" },
  review: { kind: "unavailable", reason: "the reviewer needs FACTORY_REPO and FACTORY_RULEBOOK" },
  verify: { kind: "unavailable", reason: "the local verifier needs a box (#113) and the project file" },
};

export type TickSetup = {
  readonly home: string;
  readonly project: string;
  readonly forge: Forge;
  readonly label: string;
  readonly steps: Steps;
  // the project file's gate (#91)
  readonly gate: Gate;
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
  const onForge = lines
    .filter((l) => l.branch.startsWith(BRANCH_PREFIX) && !l.fork)
    .map((l) => l.branch.slice(BRANCH_PREFIX.length));
  return [...new Set([...approved, ...onForge])].filter(plainName).toSorted();
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

async function stateOf(
  setup: TickSetup,
  ticket: string,
  lines: readonly (OpenLine | MergedLine)[],
): Promise<Result<TicketState>> {
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
  return {
    kind: "ok",
    value: {
      ticket,
      gate: setup.gate,
      approval: approval.value,
      change: changeOf(ticket, lines),
      runs,
      now: setup.now(),
      quietMinutes: setup.quietMinutes,
    },
  };
}

export type Decided =
  | { readonly state: TicketState; readonly action: Action }
  | { readonly kind: "broken"; readonly ticket: string; readonly reason: string };

// decideAll : one decision per ticket, in ticket order. A ticket whose spec, approval or records cannot be read is
// broken: it fails on its own, and every other ticket is still decided.
export async function decideAll(setup: TickSetup): Promise<Result<readonly Decided[]>> {
  const lines = await poll({ forge: setup.forge, label: setup.label });
  if (lines.kind === "failed") {
    return lines;
  }
  const out: Decided[] = [];
  for (const ticket of await ticketNames(setup, lines.value)) {
    const state = await stateOf(setup, ticket, lines.value);
    out.push(
      state.kind === "ok"
        ? { state: state.value, action: decide(state.value) }
        : { kind: "broken", ticket, reason: state.reason },
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
    () => say(setup, state, { seat: "coordinator", title: `blocked: ${why}`, fields: [], items: [] }),
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

async function ping(setup: TickSetup, state: TicketState, head: string): Promise<Done> {
  const said = await say(setup, state, {
    seat: "coordinator",
    title: `ready for you at ${head.slice(0, 8)}: the gate is green; review and merge`,
    fields: [],
    items: [],
  });
  return said.kind === "ok"
    ? record({ where: where(setup, state), event: { at: at(setup), kind: "pinged", head } })
    : said;
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
  reconcile: (setup, state) => reconcile(setup, state),
  wait: () => "none",
  writer: () => "none",
  ready: () => "none",
  review: () => "none",
  verify: () => "none",
};

async function forgeAction(setup: TickSetup, state: TicketState, action: Action): Promise<Done | "none"> {
  return dispatchOn(FORGE, action.kind, setup, state, action);
}

export type Ran = { readonly ticket: string; readonly action: Action; readonly result: Done | Unavailable };

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

async function runWriter(setup: TickSetup, state: TicketState, task: Task): Promise<Done | Unavailable> {
  const step = setup.steps.writer;
  if (step.kind === "unavailable") {
    return step;
  }
  const place = where(setup, state);
  const mode = modeOf(task);
  // the start is recorded before the claim: a pass that dies between them leaves a run that never ended, which goes to
  // a person, never a claim with no record, which would look like someone else's
  const started = await record({
    where: place,
    event: { at: at(setup), kind: "started", phase: "writer", mode, head: headOf(state) },
  });
  const claimed = started.kind === "ok" ? await claim(setup, state) : started;
  if (claimed.kind === "failed") {
    return claimed;
  }
  const ran = await step.run({ ticket: state.ticket, change: state.change, head: headOf(state), task });
  // a step that fails leaves the start alone: the next pass sees a run that never ended and asks a person
  return ran.kind === "ok"
    ? record({ where: place, event: { at: at(setup), kind: "writer-ended", mode, ...ran.value } })
    : ran;
}

// startCheck : the "started" line of a ready check or a review, or why it cannot start
async function startCheck(
  setup: TickSetup,
  state: TicketState,
  phase: "ready" | "review" | "verify",
  head: string,
): Promise<Done> {
  return record({ where: where(setup, state), event: { at: at(setup), kind: "started", phase, mode: "none", head } });
}

// the rows the writer's last done run gave, which the ready check runs again
function evidenceOf(state: TicketState): readonly Evidence[] {
  const w = state.runs.lastWriter;
  return w.kind === "ended" ? w.evidence : [];
}

async function runReady(setup: TickSetup, state: TicketState, head: string): Promise<Done | Unavailable> {
  const step = setup.steps.ready;
  const started = step.kind === "available" ? await startCheck(setup, state, "ready", head) : step;
  if (started.kind !== "ok" || step.kind === "unavailable") {
    return started;
  }
  const ran = await step.run({ ticket: state.ticket, change: state.change, head, evidence: evidenceOf(state) });
  return ran.kind === "ok"
    ? record({
        where: where(setup, state),
        event: { at: at(setup), kind: "ready-ended", head, passed: ran.value.passed, why: ran.value.why },
      })
    : ran;
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
        event: { at: at(setup), kind: "verify-ended", head, passed: ran.value.passed },
      })
    : ran;
}

async function runReview(setup: TickSetup, state: TicketState, head: string): Promise<Done | Unavailable> {
  const step = setup.steps.review;
  const started = step.kind === "available" ? await startCheck(setup, state, "review", head) : step;
  if (started.kind !== "ok" || step.kind === "unavailable") {
    return started;
  }
  const ran = await step.run({ ticket: state.ticket, change: state.change, head });
  return ran.kind === "ok"
    ? record({
        where: where(setup, state),
        event: { at: at(setup), kind: "review-ended", head, actOn: ran.value.actOn },
      })
    : ran;
}

// the actions that start a run; "none" for the rest
const RUN: Handler<Promise<Done | Unavailable> | "none"> = {
  writer: (setup, state, a) => runWriter(setup, state, a.task),
  ready: (setup, state, a) => runReady(setup, state, a.head),
  review: (setup, state, a) => runReview(setup, state, a.head),
  verify: (setup, state, a) => runVerify(setup, state, a.head),
  "needs-human": () => "none",
  release: () => "none",
  ping: () => "none",
  reconcile: () => "none",
  wait: () => "none",
};

function runAction(setup: TickSetup, state: TicketState, action: Action): Promise<Done | Unavailable> | "none" {
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
  ping: (a) => `ping at ${a.head.slice(0, 8)}`,
  reconcile: () => "reconcile: merged; remove the claim",
};

function describeAs<K extends ActionKind>(kind: K, action: ActionMap[K]): string {
  return DESCRIBE[kind](action);
}

function describe(action: Action): string {
  return describeAs(action.kind, action);
}

function logResult(setup: TickSetup, ticket: string, result: Done | Unavailable): void {
  setup.log(`${ticket}: ${result.kind === "ok" ? "done" : `${result.kind}: ${result.reason}`}`);
}

type Later = { readonly state: TicketState; readonly action: Action };

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

// runPass : the first run that can start, and no other: runs at once is 1
async function runPass(setup: TickSetup, later: readonly Later[], ran: Ran[]): Promise<void> {
  for (const { state, action } of later) {
    const pending = runAction(setup, state, action);
    const result = pending === "none" ? "none" : await pending;
    if (result === "none") {
      continue;
    }
    ran.push({ ticket: state.ticket, action, result });
    logResult(setup, state.ticket, result);
    if (result.kind !== "unavailable") {
      return;
    }
  }
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

type Holder =
  | { readonly kind: "alive"; readonly pid: number }
  | { readonly kind: "dead" }
  | { readonly kind: "unknown" };

async function holder(path: string, now: number): Promise<Holder> {
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

// lock : one pass at a time per project. It never throws: a lock it cannot take is "busy", with the reason.
export async function lock(input: { readonly home: string; readonly project: string }): Promise<Lock> {
  const dir = join(input.home, "runs", input.project);
  const lockPath = join(dir, ".lock");
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
            ? `another pass (pid ${found.pid}) is running for ${input.project}`
            : `another pass holds ${lockPath}`,
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
      decided.value.forEach((d) =>
        setup.log(
          "kind" in d
            ? `${d.ticket}: broken: ${d.reason} (dry run)`
            : `${d.state.ticket}: ${describe(d.action)} (dry run)`,
        ),
      );
      return { kind: "ok", value: [] };
    }
    return { kind: "ok", value: await actAll(setup, decided.value) };
  } finally {
    await held.release();
  }
}
