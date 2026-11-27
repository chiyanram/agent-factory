// records — what the dispatcher has done for each ticket, so a restart loses nothing (#103; ADR-0012 S3). One
// append-only JSON-lines file per ticket: <FACTORY_HOME>/runs/<project>/<ticket>.jsonl. The dispatcher writes a line
// before a run starts and one after it ends; the counts the table needs (ready-check failures, review rounds, CI
// rounds: writer runs started for a red pipeline) are summed from the lines written since the human's START or approval
// that let the build begin, so a new one starts afresh.
//
// A "started" line with no "ended" after it means the dispatcher died during that run: the summary says so, and the
// table blocks the ticket for a person rather than guess whether the run pushed.
//
// A check that fails (a ready check, a review with Act on findings, the local verifier) records nextTry{step, at} on
// its "ended" line: the writer's retry for it waits until then, at = now + min(10 s × 2^(n−1), 5 min) for the
// step's n-th failure since the approval. The newest check line's nextTry is the one that holds.
//
// A writer or review "ended" line carries the run's spend{usd, tokens}, as the agent CLI reported it; a line
// with none was not measured (an older line, or a run stopped before its result). A run that failed after it spent
// writes a "spent" line instead: it ends nothing, so the start still reads as a run that never ended and goes to a
// person, but its spend counts. `usage` and the caps sum them all. A review round's line, ended or spent, also carries
// split{finders, verify}: each finder's spend by its lens and the verify pass's, which sum to its spend.
//
// A writer "ended" line names the run's trace, a plain file name in <ticket>/ (trace.ts); a "spent" line names
// the failed run's traces.
//
// A model run's "started" line names its CLI and the model it asked for (cli, asks); its end line (ended, "spent",
// "parked", "design-ended") names each run's CLI, asked model, and the version and model the CLI reported (runs). A
// value of the wrong shape there is dropped, not failed, since no count, cap or decision reads it (agent/ran.ts).
//
// Every line that ends a run (writer-ended, design-ended, review-ended, ready-ended, verify-ended, parked, spent)
// names how it ended, a reason from end-reason.ts's closed list that its outcome takes; outcome, passed and actOn still
// decide, so the reason never changes what the table does. A line written without one reads with the reason its old
// fields give, never its why, and a pair its outcome refuses fails the read. A failed writer, review, ready or verify
// run always writes its "spent" line, with no spend when none was measured; such a line spends nothing and is no
// activity. A step that cannot run writes a "setup-refused" line once per cause (refused.ts). It is no ended line,
// because no run started: the table reads past it, and the pass tries the step again. It is no activity either. Older
// code refuses both of those lines, and reads past a reason. **Today:** no command prints a reason; only the tests
// read closedReason.
//
// A design review runs before the human's approval: a design-reviewer run, then a verify pass, each recorded by
// a "started" line and a "design-ended" line that names the spec hash it read (an old line also a design hash), the
// card's hash, its findings or what the verify pass kept, and its spend, whether it finished or failed (design.ts).
//
// Old lines stay readable: each field added after the first lines is optional, and a line that lacks it reads as the
// old behaviour. Before a ticket has a "turn" line, seedTurn reads the turn from its older lines. The "turn" and
// "waiting" lines only record whom a ping went to, so they are no activity: a claim's quiet time ignores them.
//
// Every string a line keeps is scrubbed, so no record holds a secret, whatever a run or a person wrote (P4). A bad line
// fails the read with its line number, since a count summed past it could let a run go on that should have stopped.
// The one exception is a torn last line, a write cut short: it is read past with a warning, so its run reads as one
// that never ended. Only the pass that holds the pass lock moves it to <ticket>.jsonl.torn, since the cut would race
// with an append from a second writer.

import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { plainName, type Lane } from "../spec.js";
import type { Done, Result } from "../forge/api.js";
import type { Evidence } from "../report.js";
import { scrubbedJson } from "../scrub.js";
import { addSpend, NO_SPEND, type Spend } from "./spend.js";
import type { Lane as TurnLane } from "./next-step.js";
import { codeOf } from "../field.js";
import type { EndReason } from "../end-reason.js";
import type { HeldLock } from "../lock.js";
import type { Phase, WriterMode, ParkedTask, NextTry, Event, EventMap, Kind } from "./event.js";
import { BAD } from "./parse-fields.js";
import { parseLine, eventOf, isEvent } from "./event-parse.js";
export {
  type Phase,
  type DesignStep,
  type WriterMode,
  type Task,
  type ParkedTask,
  parkedTaskOf,
  modeOf,
  type Retried,
  type NextTry,
  backoffMs,
  nextTryOf,
  type Event,
} from "./event.js";
export { spentAndTrace } from "./parse-runs.js";

export type Where = { readonly home: string; readonly project: string; readonly ticket: string };

export function recordPath(where: Where): Result<string> {
  return plainName(where.project) && plainName(where.ticket)
    ? { kind: "ok", value: join(where.home, "runs", where.project, `${where.ticket}.jsonl`) }
    : {
        kind: "failed",
        reason: `a project and a ticket must be plain names, got ${JSON.stringify(where.project)} ${JSON.stringify(where.ticket)}`,
      };
}

export async function record(input: { readonly where: Where; readonly event: Event }): Promise<Done> {
  const path = recordPath(input.where);
  if (path.kind === "failed") {
    return path;
  }
  try {
    await mkdir(dirname(path.value), { recursive: true, mode: 0o700 });
    const line = scrubbedJson(input.event);
    await appendFile(path.value, `${line}\n`, { mode: 0o600 });
    return { kind: "ok" };
  } catch {
    return { kind: "failed", reason: `cannot write ${path.value}` };
  }
}

type Line = { readonly text: string; readonly start: number };

function linesOf(text: string): readonly Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const part of text.split("\n")) {
    if (part.trim() !== "") {
      lines.push({ text: part, start });
    }
    start += Buffer.byteLength(part, "utf8") + 1;
  }
  return lines;
}

export function tornPath(recordFile: string): string {
  return `${recordFile}.torn`;
}

async function setAside(file: string, size: number, line: Line): Promise<Done> {
  try {
    const handle = await open(file, "r+");
    try {
      const now = await handle.stat();
      if (now.size !== size) {
        return { kind: "failed", reason: `${file} grew while its torn last line was set aside` };
      }
      await appendFile(tornPath(file), `${line.text}\n`, { mode: 0o600 });
      await handle.truncate(line.start);
      return { kind: "ok" };
    } finally {
      await handle.close();
    }
  } catch {
    return { kind: "failed", reason: `cannot set aside the torn last line of ${file}` };
  }
}

export type ReadOptions = {
  readonly warn?: (line: string) => void;
  readonly setAside?: HeldLock;
};

export async function readRecords(where: Where, options: ReadOptions = {}): Promise<Result<readonly Event[]>> {
  const path = recordPath(where);
  if (path.kind === "failed") {
    return path;
  }
  const text = await recordText(path.value);
  return text.kind === "ok" ? eventsIn(path.value, text.value, options) : text;
}

async function recordText(path: string): Promise<Result<string>> {
  try {
    return { kind: "ok", value: await readFile(path, "utf8") };
  } catch (error) {
    return codeOf(error) === "ENOENT" ? { kind: "ok", value: "" } : { kind: "failed", reason: `cannot read ${path}` };
  }
}

function tornLine(text: string, lines: readonly Line[], index: number): Line | undefined {
  const line = index === lines.length - 1 && !text.endsWith("\n") ? lines[index] : undefined;
  return line !== undefined && parseLine(line.text) === undefined ? line : undefined;
}

function warnOf(options: ReadOptions): (line: string) => void {
  return options.warn ?? ((line) => process.stderr.write(`${line}\n`));
}

async function tornRead(path: string, text: string, torn: Line, options: ReadOptions): Promise<Done> {
  const aside =
    options.setAside === undefined ? { kind: "ok" as const } : await setAside(path, Buffer.byteLength(text), torn);
  const where = options.setAside !== undefined ? `it is moved to ${tornPath(path)}` : "it is skipped";
  if (aside.kind === "ok") {
    warnOf(options)(
      `warning: the last line of ${path} was torn (a write cut short); ${where}, and its run counts as one that never ended`,
    );
  }
  return aside;
}

async function eventsIn(path: string, text: string, options: ReadOptions): Promise<Result<readonly Event[]>> {
  const lines = linesOf(text);
  const events = lines.map((l) => eventOf(l.text));
  const first = events.indexOf(BAD);
  if (first < 0) {
    return { kind: "ok", value: events.filter(isEvent) };
  }
  const torn = tornLine(text, lines, first);
  if (torn === undefined) {
    return { kind: "failed", reason: `${path} line ${first + 1} is not a record; fix or remove it` };
  }
  const read = await tornRead(path, text, torn, options);
  return read.kind === "ok" ? { kind: "ok", value: events.filter(isEvent) } : read;
}

export type LastWriter =
  | { readonly kind: "none" }
  | {
      readonly kind: "ended";
      readonly mode: WriterMode;
      readonly head: string;
      readonly outcome: "done" | "asked" | "blocked";
      readonly patch: string;
      readonly evidence: readonly Evidence[];
      readonly at?: string;
    };

export type RunFolder = { readonly folder: string; readonly head: string };

export type Summary = {
  readonly interrupted:
    | { readonly kind: "none" }
    | {
        readonly kind: "interrupted";
        readonly phase: Phase;
        readonly at: string;
        readonly run?: RunFolder;
      };
  readonly lastWriter: LastWriter;
  readonly previousPatch: string;
  readonly implementerPatch: string;
  readonly testFirstDone: boolean;
  readonly readyFailures: number;
  readonly lastReady:
    | { readonly kind: "none" }
    | {
        readonly kind: "ended";
        readonly at: string;
        readonly head: string;
        readonly passed: boolean;
        readonly why: string;
        readonly human: boolean;
        readonly lane?: Lane;
        readonly evidence?: readonly Evidence[];
        readonly programs?: readonly string[];
      };
  readonly lastVerify:
    | { readonly kind: "none" }
    | { readonly kind: "ended"; readonly head: string; readonly passed: boolean };
  readonly reviewRounds: number;
  readonly lastReview:
    | { readonly kind: "none" }
    | { readonly kind: "ended"; readonly head: string; readonly actOn: number };
  readonly ciRounds: number;
  readonly reviewFailures: number;
  readonly verifyFailures: number;
  readonly nextTry: { readonly kind: "none" } | ({ readonly kind: "set" } & NextTry);
  readonly rebaseRuns: number;
  readonly pingedAt: string;
  readonly turn: TurnLane | "none";
  readonly turnRead: boolean;
  readonly blockedRun: string;
  readonly blocked: readonly string[];
  readonly heldWhy: string;
  readonly unreadPasses: number;
  readonly unreadFirst: string;
  readonly unreadSince: string;
  readonly lastAt: string;
  readonly spent: Spend;
  readonly parked: Parked;
  readonly refused: { readonly phase: Phase; readonly why: string } | "none";
};

export type Parked =
  | { readonly kind: "none" }
  | {
      readonly kind: "parked";
      readonly phase: Phase;
      readonly at: string;
      readonly head: string;
      readonly until: string;
      readonly said: string;
      readonly task?: ParkedTask;
      readonly repeated: boolean;
    };

export const EMPTY: Summary = {
  interrupted: { kind: "none" },
  lastWriter: { kind: "none" },
  previousPatch: "",
  implementerPatch: "",
  testFirstDone: false,
  readyFailures: 0,
  lastReady: { kind: "none" },
  lastVerify: { kind: "none" },
  reviewRounds: 0,
  lastReview: { kind: "none" },
  ciRounds: 0,
  reviewFailures: 0,
  verifyFailures: 0,
  nextTry: { kind: "none" },
  rebaseRuns: 0,
  pingedAt: "",
  turn: "none",
  turnRead: false,
  blockedRun: "",
  blocked: [],
  heldWhy: "",
  unreadPasses: 0,
  unreadFirst: "",
  unreadSince: "",
  lastAt: "",
  spent: NO_SPEND,
  parked: { kind: "none" },
  refused: "none",
};

function patches(
  s: Summary,
  e: Extract<Event, { kind: "writer-ended" }>,
): Pick<Summary, "previousPatch" | "implementerPatch"> {
  return e.mode === "cleanup"
    ? { previousPatch: s.previousPatch, implementerPatch: s.implementerPatch }
    : { previousPatch: s.implementerPatch, implementerPatch: e.patch };
}

function writerTurn(s: Summary, e: Extract<Event, { kind: "writer-ended" }>): Partial<Summary> {
  const why = e.why ?? "its note on the change says why";
  return {
    ...seedTurn(s, e.outcome === "done" ? "factory" : "needs-you"),
    blockedRun: e.outcome === "blocked" ? `the writer's run is blocked: ${why}` : "",
  };
}

function writerEnded(s: Summary, e: Extract<Event, { kind: "writer-ended" }>): Summary {
  const testFirst = e.mode === "test-first" && e.outcome === "done";
  return {
    ...s,
    interrupted: { kind: "none" },
    parked: UNPARKED,
    ...patches(s, e),
    lastWriter: {
      kind: "ended",
      mode: e.mode,
      head: e.head,
      outcome: e.outcome,
      patch: e.patch,
      evidence: e.evidence,
      at: e.at,
    },
    ...writerTurn(s, e),
    testFirstDone: s.testFirstDone || testFirst,
    rebaseRuns: s.rebaseRuns + Number(e.mode === "rebase"),
    ciRounds: s.ciRounds + Number(e.mode === "ci"),
    spent: addSpend(s.spent, e.spend ?? NO_SPEND),
  };
}

const UNPARKED: Parked = { kind: "none" };

function repeatOf(before: Parked, until: string): boolean {
  return (
    before.kind === "parked" &&
    until !== "unknown" &&
    before.until !== "unknown" &&
    Date.parse(until) <= Date.parse(before.until)
  );
}

function parkedStep(s: Summary, e: Extract<Event, { kind: "parked" }>): Summary {
  return {
    ...s,
    ...seedTurn(s, "factory"),
    interrupted: { kind: "none" },
    parked: {
      kind: "parked",
      phase: e.phase,
      at: e.at,
      head: e.head,
      until: e.until,
      said: e.said,
      ...(e.task === undefined ? {} : { task: e.task }),
      repeated: repeatOf(s.parked, e.until),
    },
    spent: addSpend(s.spent, e.spend ?? NO_SPEND),
  };
}

function nextTryView(next: NextTry | undefined): Summary["nextTry"] {
  return next === undefined ? { kind: "none" } : { kind: "set", ...next };
}

type Steps = { readonly [K in Kind]: (s: Summary, e: EventMap[K]) => Summary };

function seedTurn(s: Summary, lane: TurnLane): Partial<Summary> {
  return s.turnRead ? {} : { turn: lane };
}

const STEPS: Steps = {
  started: (s, e) => ({
    ...s,
    ...seedTurn(s, "factory"),
    blockedRun: "",
    refused: "none",
    interrupted: {
      kind: "interrupted",
      phase: e.phase,
      at: e.at,
      ...(e.folder === undefined ? {} : { run: { folder: e.folder, head: e.head } }),
    },
  }),
  "writer-ended": writerEnded,
  "ready-ended": (s, e) => ({
    ...s,
    interrupted: { kind: "none" },
    parked: UNPARKED,
    lastReady: {
      kind: "ended",
      at: e.at,
      head: e.head,
      passed: e.passed,
      why: e.why,
      human: e.human === true,
      ...(e.lane === undefined ? {} : { lane: e.lane }),
      evidence: s.lastWriter.kind === "ended" ? s.lastWriter.evidence : [],
      ...(e.programs === undefined ? {} : { programs: e.programs }),
    },
    readyFailures: s.readyFailures + Number(!e.passed),
    nextTry: nextTryView(e.nextTry),
  }),
  "review-ended": (s, e) => ({
    ...s,
    interrupted: { kind: "none" },
    parked: UNPARKED,
    lastReview: { kind: "ended", head: e.head, actOn: e.actOn },
    reviewRounds: s.reviewRounds + 1,
    reviewFailures: s.reviewFailures + Number(e.actOn > 0),
    nextTry: nextTryView(e.nextTry),
    spent: addSpend(s.spent, e.spend ?? NO_SPEND),
  }),
  "verify-ended": (s, e) => ({
    ...s,
    interrupted: { kind: "none" },
    parked: UNPARKED,
    lastVerify: { kind: "ended", head: e.head, passed: e.passed },
    verifyFailures: s.verifyFailures + Number(!e.passed),
    nextTry: nextTryView(e.nextTry),
  }),
  spent: (s, e) => ({ ...s, spent: addSpend(s.spent, e.spend ?? NO_SPEND) }),
  "setup-refused": (s, e) => ({ ...s, refused: { phase: e.phase, why: e.why } }),
  "design-ended": (s, e) => ({
    ...s,
    ...(e.step === "verify" && e.outcome === "done" ? seedTurn(s, "needs-you") : {}),
    interrupted: { kind: "none" },
    parked: UNPARKED,
    spent: addSpend(s.spent, e.spend ?? NO_SPEND),
  }),
  parked: parkedStep,
  "design-noted": (s) => ({ ...s, ...seedTurn(s, "needs-you") }),
  pinged: (s, e) => ({ ...s, ...seedTurn(s, "ready-to-merge"), pingedAt: e.head }),
  turn: (s, e) => ({ ...s, turn: e.to, turnRead: true }),
  waiting: (s) => s,
  blocked: (s, e) => ({ ...s, ...seedTurn(s, "needs-you"), blocked: [...s.blocked, e.why] }),
  held: (s, e) => ({ ...s, heldWhy: e.why, unreadPasses: 0, unreadFirst: "", unreadSince: "" }),
  "blockers-unread": (s, e) => ({
    ...s,
    unreadPasses: s.unreadPasses + 1,
    unreadFirst: s.unreadFirst === "" ? e.why : s.unreadFirst,
    unreadSince: s.unreadSince === "" ? e.at : s.unreadSince,
  }),
  shared: (s) => s,
  answered: (s) => s,
  begun: (s) => s,
  approved: (s) => s,
  "review-again": (s) => s,
  merged: (s) => s,
  timeline: (s) => s,
};

function step<K extends Kind>(s: Summary, kind: K, e: EventMap[K]): Summary {
  return STEPS[kind](s, e);
}

const NO_ACTIVITY: ReadonlySet<Kind> = new Set(["turn", "waiting", "setup-refused"]);

export function isActivity(e: Event): boolean {
  return !NO_ACTIVITY.has(e.kind) && !(e.kind === "spent" && e.spend === undefined);
}

export function closedReason(e: Event): EndReason | undefined {
  return "reason" in e ? e.reason : undefined;
}

export function summarize(input: { readonly events: readonly Event[]; readonly since: string }): Summary {
  const from = Date.parse(input.since);
  return input.events
    .filter((e) => !(Date.parse(e.at) < from))
    .reduce((s, e) => ({ ...step(s, e.kind, e), lastAt: isActivity(e) ? e.at : s.lastAt }), EMPTY);
}
