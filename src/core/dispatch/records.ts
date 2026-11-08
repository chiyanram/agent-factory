// records — what the dispatcher has done for each ticket, so a restart loses nothing (#103; ADR-0012 S3). One
// append-only JSON-lines file per ticket: <FACTORY_HOME>/runs/<project>/<ticket>.jsonl. The dispatcher writes a line
// before a run starts and one after it ends; the counts the table needs (ready-check failures, review rounds, CI
// rounds: writer runs started for a red pipeline) are summed from the lines written since the ticket's latest approval, so approving again starts afresh.
//
// A "started" line with no "ended" after it means the dispatcher died during that run: the summary says so, and the
// table blocks the ticket for a person rather than guess whether the run pushed.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { plainName } from "../spec.js";
import type { Done, Result } from "../forge/api.js";
import type { Evidence } from "../report.js";

export type Phase = "writer" | "ready" | "review" | "verify";
// what the writer was started for
export type WriterMode = "test-first" | "fix" | "rework" | "ci" | "rebase";

// what one writer run is for, and so what the host hands the writer (#171). The record keeps only its mode.
export type Task =
  | { readonly kind: "test-first" }
  | { readonly kind: "fix" }
  // the ready check failed at the writer's head; why names the first row that failed
  | { readonly kind: "ready-failed"; readonly why: string }
  // the factory's review at this head left Act on findings
  | { readonly kind: "act-on"; readonly head: string }
  // CI is red at this head
  | { readonly kind: "ci-red"; readonly head: string }
  // the local verifier failed at this head (a local gate, #91); its output is kept with the head (kept.ts)
  | { readonly kind: "verify-failed"; readonly head: string };

const MODE_OF: Readonly<Record<Task["kind"], WriterMode>> = {
  "test-first": "test-first",
  fix: "fix",
  "ready-failed": "rework",
  "act-on": "rework",
  "ci-red": "ci",
  "verify-failed": "ci",
};

// modeOf : the mode a task is recorded as. Pure.
export function modeOf(task: Task): WriterMode {
  return MODE_OF[task.kind];
}

export type Event =
  | {
      readonly at: string;
      readonly kind: "started";
      readonly phase: Phase;
      readonly mode: WriterMode | "none";
      readonly head: string;
    }
  | {
      readonly at: string;
      readonly kind: "writer-ended";
      readonly mode: WriterMode;
      readonly head: string;
      readonly outcome: "done" | "asked" | "blocked";
      // hung: the writer did not exit after its report, and the host stopped it (#182); a record from before has none
      readonly stop: "exited" | "hung";
      readonly patch: string;
      // the rows the ready check runs again; none unless the outcome is done
      readonly evidence: readonly Evidence[];
    }
  // why: the first row that failed, "" when it passed
  | {
      readonly at: string;
      readonly kind: "ready-ended";
      readonly head: string;
      readonly passed: boolean;
      readonly why: string;
    }
  // the local verifier's run (#91); its result is the commit status it posted
  | { readonly at: string; readonly kind: "verify-ended"; readonly head: string; readonly passed: boolean }
  | { readonly at: string; readonly kind: "review-ended"; readonly head: string; readonly actOn: number }
  | { readonly at: string; readonly kind: "pinged"; readonly head: string }
  // the dispatcher handed the ticket to a person, for this reason; the same stop is never posted twice
  | { readonly at: string; readonly kind: "blocked"; readonly why: string };

export type Where = { readonly home: string; readonly project: string; readonly ticket: string };

export function recordPath(where: Where): Result<string> {
  return plainName(where.project) && plainName(where.ticket)
    ? { kind: "ok", value: join(where.home, "runs", where.project, `${where.ticket}.jsonl`) }
    : {
        kind: "failed",
        reason: `a project and a ticket must be plain names, got ${JSON.stringify(where.project)} ${JSON.stringify(where.ticket)}`,
      };
}

// record : one line, appended; the folder is made on first use, readable by this user alone
export async function record(input: { readonly where: Where; readonly event: Event }): Promise<Done> {
  const path = recordPath(input.where);
  if (path.kind === "failed") {
    return path;
  }
  try {
    await mkdir(dirname(path.value), { recursive: true, mode: 0o700 });
    await appendFile(path.value, `${JSON.stringify(input.event)}\n`, { mode: 0o600 });
    return { kind: "ok" };
  } catch {
    return { kind: "failed", reason: `cannot write ${path.value}` };
  }
}

// prop : one property of a parsed JSON value, or undefined; no type assertion on the way
export function prop(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? (Reflect.get(value, name) as unknown) : undefined;
}

// codeOf : an error's code ("ENOENT"), or ""
export function codeOf(error: unknown): string {
  const code = prop(error, "code");
  return typeof code === "string" ? code : "";
}

// a field that is not there, or not what it should be
const BAD: unique symbol = Symbol("bad");
type Bad = typeof BAD;

function str(value: unknown, name: string): string | Bad {
  const v = prop(value, name);
  return typeof v === "string" ? v : BAD;
}

function oneOf<T extends string>(value: unknown, name: string, allowed: readonly T[]): T | Bad {
  const v = prop(value, name);
  return allowed.find((a) => a === v) ?? BAD;
}

const PHASES = ["writer", "ready", "review", "verify"] as const;
const MODES = ["test-first", "fix", "rework", "ci", "rebase"] as const;
const OUTCOMES = ["done", "asked", "blocked"] as const;
const STOPS = ["exited", "hung"] as const;

// stopOf : how a writer run ended; a record written before #182 has no stop, and its writer exited
function stopOf(raw: unknown): (typeof STOPS)[number] | Bad {
  return prop(raw, "stop") === undefined ? "exited" : oneOf(raw, "stop", STOPS);
}

// each event by its kind, so a handler per kind is typed without an assertion (TypeScript's correlated unions)
type EventMap = { readonly [E in Event as E["kind"]]: E };
type Kind = keyof EventMap;

type Parse = (raw: unknown, at: string) => Event | Bad;
const isKind = (k: unknown): k is Kind => typeof k === "string" && Object.hasOwn(PARSE, k);

function startedOf(raw: unknown, at: string): Event | Bad {
  const phase = oneOf(raw, "phase", PHASES);
  const mode = oneOf(raw, "mode", [...MODES, "none"] as const);
  const head = str(raw, "head");
  return phase === BAD || mode === BAD || head === BAD ? BAD : { at, kind: "started", phase, mode, head };
}

function rowOf(row: unknown): Evidence | Bad {
  const criterion = str(row, "criterion");
  const command = str(row, "command");
  const result = str(row, "result");
  return criterion === BAD || command === BAD || result === BAD ? BAD : { criterion, command, result };
}

// evidenceOf : the rows; a line written before the rows were kept has none
function evidenceOf(raw: unknown): readonly Evidence[] | Bad {
  const rows = prop(raw, "evidence");
  if (rows === undefined) {
    return [];
  }
  const read = Array.isArray(rows) ? rows.map(rowOf) : [BAD];
  return read.includes(BAD) ? BAD : read.filter((r): r is Evidence => r !== BAD);
}

type WriterParts = {
  readonly head: string;
  readonly patch: string;
  readonly evidence: readonly Evidence[];
  readonly stop: (typeof STOPS)[number];
};

function writerParts(raw: unknown): WriterParts | Bad {
  const head = str(raw, "head");
  const patch = str(raw, "patch");
  const evidence = evidenceOf(raw);
  const stop = stopOf(raw);
  return head === BAD || patch === BAD || evidence === BAD || stop === BAD ? BAD : { head, patch, evidence, stop };
}

function writerEndedOf(raw: unknown, at: string): Event | Bad {
  const mode = oneOf(raw, "mode", MODES);
  const outcome = oneOf(raw, "outcome", OUTCOMES);
  const parts = writerParts(raw);
  return mode === BAD || outcome === BAD || parts === BAD ? BAD : { at, kind: "writer-ended", mode, outcome, ...parts };
}

function readyEndedOf(raw: unknown, at: string): Event | Bad {
  const head = str(raw, "head");
  const passed = prop(raw, "passed");
  const why = prop(raw, "why") === undefined ? "" : str(raw, "why");
  return head === BAD || why === BAD || typeof passed !== "boolean"
    ? BAD
    : { at, kind: "ready-ended", head, passed, why };
}

function verifyEndedOf(raw: unknown, at: string): Event | Bad {
  const head = str(raw, "head");
  const passed = prop(raw, "passed");
  return head === BAD || typeof passed !== "boolean" ? BAD : { at, kind: "verify-ended", head, passed };
}

function reviewEndedOf(raw: unknown, at: string): Event | Bad {
  const head = str(raw, "head");
  const actOn = prop(raw, "actOn");
  return head === BAD || !Number.isSafeInteger(actOn) ? BAD : { at, kind: "review-ended", head, actOn: Number(actOn) };
}

const PARSE: Readonly<Record<Kind, Parse>> = {
  started: startedOf,
  "writer-ended": writerEndedOf,
  "ready-ended": readyEndedOf,
  "review-ended": reviewEndedOf,
  "verify-ended": verifyEndedOf,
  pinged: (raw, at) => {
    const head = str(raw, "head");
    return head === BAD ? BAD : { at, kind: "pinged", head };
  },
  blocked: (raw, at) => {
    const why = str(raw, "why");
    return why === BAD ? BAD : { at, kind: "blocked", why };
  },
};

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

// eventOf : one line, checked field by field; anything else is BAD
function eventOf(line: string): Event | Bad {
  const raw = parseLine(line);
  const at = str(raw, "at");
  const kind = prop(raw, "kind");
  return at === BAD || !isKind(kind) ? BAD : PARSE[kind](raw, at);
}

function isEvent(e: Event | Bad): e is Event {
  return e !== BAD;
}

// readRecords : every line of the ticket's file, oldest first; no file is no events. A line that is not an event fails
// the read, since a count summed past it could let a run go on that should have stopped.
export async function readRecords(where: Where): Promise<Result<readonly Event[]>> {
  const path = recordPath(where);
  if (path.kind === "failed") {
    return path;
  }
  let text = "";
  try {
    text = await readFile(path.value, "utf8");
  } catch (error) {
    return codeOf(error) === "ENOENT"
      ? { kind: "ok", value: [] }
      : { kind: "failed", reason: `cannot read ${path.value}` };
  }
  const events = text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map(eventOf);
  const first = events.indexOf(BAD);
  return first < 0
    ? { kind: "ok", value: events.filter(isEvent) }
    : { kind: "failed", reason: `${path.value} line ${first + 1} is not a record; fix or remove it` };
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
    };

export type Summary = {
  // a run whose start has no end: the dispatcher died during it
  readonly interrupted:
    | { readonly kind: "none" }
    | { readonly kind: "interrupted"; readonly phase: Phase; readonly at: string };
  readonly lastWriter: LastWriter;
  // the writer's patch before the last one, to catch the same patch twice
  readonly previousPatch: string;
  readonly testFirstDone: boolean;
  readonly readyFailures: number;
  readonly lastReady:
    | { readonly kind: "none" }
    | { readonly kind: "ended"; readonly head: string; readonly passed: boolean; readonly why: string };
  readonly lastVerify:
    | { readonly kind: "none" }
    | { readonly kind: "ended"; readonly head: string; readonly passed: boolean };
  readonly reviewRounds: number;
  readonly lastReview:
    | { readonly kind: "none" }
    | { readonly kind: "ended"; readonly head: string; readonly actOn: number };
  readonly ciRounds: number;
  readonly rebaseRuns: number;
  readonly pingedAt: string;
  // every reason the dispatcher already handed the ticket to a person for
  readonly blocked: readonly string[];
  // the time of the newest line, or "" for none
  readonly lastAt: string;
};

export const EMPTY: Summary = {
  interrupted: { kind: "none" },
  lastWriter: { kind: "none" },
  previousPatch: "",
  testFirstDone: false,
  readyFailures: 0,
  lastReady: { kind: "none" },
  lastVerify: { kind: "none" },
  reviewRounds: 0,
  lastReview: { kind: "none" },
  ciRounds: 0,
  rebaseRuns: 0,
  pingedAt: "",
  blocked: [],
  lastAt: "",
};

function writerEnded(s: Summary, e: Extract<Event, { kind: "writer-ended" }>): Summary {
  const testFirst = e.mode === "test-first" && e.outcome === "done";
  return {
    ...s,
    interrupted: { kind: "none" },
    previousPatch: s.lastWriter.kind === "ended" ? s.lastWriter.patch : "",
    lastWriter: {
      kind: "ended",
      mode: e.mode,
      head: e.head,
      outcome: e.outcome,
      patch: e.patch,
      evidence: e.evidence,
    },
    testFirstDone: s.testFirstDone || testFirst,
    rebaseRuns: s.rebaseRuns + Number(e.mode === "rebase"),
    ciRounds: s.ciRounds + Number(e.mode === "ci"),
  };
}

type Steps = { readonly [K in Kind]: (s: Summary, e: EventMap[K]) => Summary };

const STEPS: Steps = {
  started: (s, e) => ({ ...s, interrupted: { kind: "interrupted", phase: e.phase, at: e.at } }),
  "writer-ended": writerEnded,
  "ready-ended": (s, e) => ({
    ...s,
    interrupted: { kind: "none" },
    lastReady: { kind: "ended", head: e.head, passed: e.passed, why: e.why },
    readyFailures: s.readyFailures + Number(!e.passed),
  }),
  "review-ended": (s, e) => ({
    ...s,
    interrupted: { kind: "none" },
    lastReview: { kind: "ended", head: e.head, actOn: e.actOn },
    reviewRounds: s.reviewRounds + 1,
  }),
  "verify-ended": (s, e) => ({
    ...s,
    interrupted: { kind: "none" },
    lastVerify: { kind: "ended", head: e.head, passed: e.passed },
  }),
  pinged: (s, e) => ({ ...s, pingedAt: e.head }),
  blocked: (s, e) => ({ ...s, blocked: [...s.blocked, e.why] }),
};

function step<K extends Kind>(s: Summary, kind: K, e: EventMap[K]): Summary {
  return STEPS[kind](s, e);
}

// summarize : the counts since the approval at `since` (ISO 8601); older lines belong to an earlier approval.
export function summarize(input: { readonly events: readonly Event[]; readonly since: string }): Summary {
  const from = Date.parse(input.since);
  return input.events
    .filter((e) => !(Date.parse(e.at) < from))
    .reduce((s, e) => ({ ...step(s, e.kind, e), lastAt: e.at }), EMPTY);
}
