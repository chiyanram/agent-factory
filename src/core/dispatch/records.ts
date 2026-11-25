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
import { LANES, plainName, type Lane } from "../spec.js";
import type { Done, Result } from "../forge/api.js";
import type { Answer } from "../answers.js";
import { isVia, type Via } from "../human-record.js";
import type { Evidence } from "../report.js";
import type { PluginHash } from "../process/use.js";
import { scrubbedJson } from "../scrub.js";
import { addSpend, NO_SPEND, RUN_KINDS, type CopilotRuns, type RoundSpend, type RunKind, type Spend } from "./spend.js";
import { recordedFindings, recordedKept, type DesignFinding, type Kept } from "../design/findings.js";
import { isActedRow, type Acted, type FoundByRule } from "../review/acted-on.js";
import { BUCKETS } from "../finding.js";
import type { Rescue } from "./timeline.js";
import type { Lane as TurnLane } from "./next-step.js";
import { prop, codeOf } from "../field.js";
import { asksOf, runsField, runsOf, type Asks, type RunNamed } from "../agent/ran.js";
import type { HeldLock } from "../lock.js";

export type Phase = "writer" | "ready" | "review" | "verify" | "design-review" | "design-verify" | "onboard";
export type DesignStep = "review" | "verify";
// what the writer was started for; "rebase" is the run for a merge conflict, which merges the default branch in and
// never rebases (#103: every push is --force-with-lease against the head the host saw, push.ts, so a merge goes out
// as a fast-forward and a person's push in between is never overwritten; the name predates that decision and stays,
// so older lines still read)
// "cleanup" is the cleanup run after the implementer's done run: the same branch, its own role card. **Today:** no
// dispatcher rule starts one; an older ledger's cleanup lines still read
export type WriterMode = "test-first" | "fix" | "rework" | "ci" | "rebase" | "cleanup";

export type Task =
  | { readonly kind: "test-first"; readonly answers?: readonly Answer[] }
  | { readonly kind: "fix"; readonly answers?: readonly Answer[] }
  | { readonly kind: "ready-failed"; readonly head: string }
  | { readonly kind: "act-on"; readonly head: string }
  | { readonly kind: "ci-red"; readonly head: string }
  | { readonly kind: "verify-failed"; readonly head: string }
  | { readonly kind: "conflict"; readonly head: string }
  | { readonly kind: "cleanup"; readonly head: string; readonly evidence: readonly Evidence[] };

const MODE_OF: Readonly<Record<Task["kind"], WriterMode>> = {
  "test-first": "test-first",
  fix: "fix",
  "ready-failed": "rework",
  "act-on": "rework",
  "ci-red": "ci",
  "verify-failed": "ci",
  conflict: "rebase",
  cleanup: "cleanup",
};

export type ParkedTask =
  | { readonly kind: "test-first" | "fix" }
  | { readonly kind: "ready-failed" | "act-on" | "ci-red" | "verify-failed" | "conflict"; readonly head: string };

export function parkedTaskOf(task: Task): ParkedTask | undefined {
  if (task.kind === "cleanup") {
    return undefined;
  }
  return "head" in task ? { kind: task.kind, head: task.head } : { kind: task.kind };
}

export function modeOf(task: Task): WriterMode {
  return MODE_OF[task.kind];
}

export type Retried = "ready" | "review" | "verify";
export type NextTry = { readonly step: Retried; readonly at: string };

const FIRST_BACKOFF_MS = 10_000;
const MOST_BACKOFF_MS = 5 * 60_000;

export function backoffMs(n: number): number {
  return Math.min(FIRST_BACKOFF_MS * 2 ** Math.max(0, n - 1), MOST_BACKOFF_MS);
}

export function nextTryOf(retried: Retried, n: number, now: number): NextTry {
  return { step: retried, at: new Date(now + backoffMs(n)).toISOString() };
}

export type Event =
  | {
      readonly at: string;
      readonly kind: "started";
      readonly phase: Phase;
      readonly mode: WriterMode | "none";
      readonly head: string;
      readonly plugins?: readonly PluginHash[];
      readonly folder?: string;
      readonly cli?: string;
      readonly asks?: Asks;
    }
  | {
      readonly at: string;
      readonly kind: "writer-ended";
      readonly mode: WriterMode;
      readonly head: string;
      readonly outcome: "done" | "asked" | "blocked";
      readonly patch: string;
      readonly evidence: readonly Evidence[];
      readonly hung: boolean;
      readonly spend?: Spend;
      readonly copilot?: CopilotRuns;
      readonly card?: string;
      readonly deferred?: readonly string[];
      readonly stale?: readonly string[];
      readonly why?: string;
      readonly output?: string;
      readonly trace?: string;
      readonly runs?: readonly RunNamed[];
    }
  | {
      readonly at: string;
      readonly kind: "ready-ended";
      readonly head: string;
      readonly passed: boolean;
      readonly why: string;
      readonly human?: boolean;
      readonly nextTry?: NextTry;
      readonly lane?: Lane;
      readonly programs?: readonly string[];
    }
  | {
      readonly at: string;
      readonly kind: "verify-ended";
      readonly head: string;
      readonly passed: boolean;
      readonly nextTry?: NextTry;
    }
  | {
      readonly at: string;
      readonly kind: "review-ended";
      readonly head: string;
      readonly actOn: number;
      readonly nextTry?: NextTry;
      readonly spend?: Spend;
      readonly copilot?: CopilotRuns;
      readonly split?: RoundSpend;
      readonly acted?: Acted;
      readonly lenses?: Readonly<Record<string, number>>;
      readonly citesNotFound?: number;
      readonly found?: FoundByRule;
      readonly traces?: readonly string[];
      readonly runs?: readonly RunNamed[];
    }
  | {
      readonly at: string;
      readonly kind: "spent";
      readonly phase: Phase;
      readonly head: string;
      readonly spend: Spend;
      readonly copilot?: CopilotRuns;
      readonly split?: RoundSpend;
      readonly traces?: readonly string[];
      readonly runs?: readonly RunNamed[];
    }
  | {
      readonly at: string;
      readonly kind: "parked";
      readonly phase: Phase;
      readonly head: string;
      readonly until: string;
      readonly said: string;
      readonly task?: ParkedTask;
      readonly spend?: Spend;
      readonly copilot?: CopilotRuns;
      readonly trace?: string;
      readonly runs?: readonly RunNamed[];
    }
  | {
      readonly at: string;
      readonly kind: "design-ended";
      readonly step: DesignStep;
      readonly spec: string;
      readonly design?: string;
      readonly outcome: "done" | "failed";
      readonly why: string;
      readonly findings: readonly DesignFinding[];
      readonly kept: readonly Kept[];
      readonly card?: string;
      readonly spend?: Spend;
      readonly copilot?: CopilotRuns;
      readonly final?: true;
      readonly lane?: Lane;
      readonly planned?: readonly string[];
      readonly trace?: string;
      readonly runs?: readonly RunNamed[];
    }
  | {
      readonly at: string;
      readonly kind: "design-noted";
      readonly spec: string;
      readonly design?: string;
      readonly why: string;
    }
  | { readonly at: string; readonly kind: "pinged"; readonly head: string }
  | { readonly at: string; readonly kind: "turn"; readonly to: TurnLane }
  | { readonly at: string; readonly kind: "waiting"; readonly since: string }
  | { readonly at: string; readonly kind: "blocked"; readonly why: string }
  | { readonly at: string; readonly kind: "held"; readonly why: string }
  | { readonly at: string; readonly kind: "blockers-unread"; readonly why: string }
  | { readonly at: string; readonly kind: "shared"; readonly approval: string }
  | { readonly at: string; readonly kind: "answered"; readonly spec: string; readonly answers: readonly Answer[] }
  | { readonly at: string; readonly kind: "begun"; readonly by: string; readonly via: Via }
  | { readonly at: string; readonly kind: "approved"; readonly by: string; readonly via: Via; readonly spec: string }
  | {
      readonly at: string;
      readonly kind: "merged";
      readonly number: number;
      readonly sha: string;
      readonly by: string;
    }
  | {
      readonly at: string;
      readonly kind: "timeline";
      readonly number: number;
      readonly rounds: number;
      readonly found: FoundByRule;
      readonly acted: Readonly<Record<string, { readonly acted: number; readonly of: number }>>;
      readonly spend: Readonly<Partial<Record<RunKind, Spend>>>;
      readonly unmeasured: number;
      readonly rescues: readonly Rescue[];
    };

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

const TURN_LANE_KEYS: Readonly<Record<TurnLane, TurnLane>> = {
  "needs-you": "needs-you",
  "ready-to-merge": "ready-to-merge",
  factory: "factory",
};
const TURN_LANES: readonly TurnLane[] = Object.values(TURN_LANE_KEYS);
const PHASES = ["writer", "ready", "review", "verify", "design-review", "design-verify", "onboard"] as const;
const MODES = ["test-first", "fix", "rework", "ci", "rebase", "cleanup"] as const;
const OUTCOMES = ["done", "asked", "blocked"] as const;
const RETRIED = ["ready", "review", "verify"] as const;

type EventMap = { readonly [E in Event as E["kind"]]: E };
type Kind = keyof EventMap;

type Parse = (raw: unknown, at: string) => Event | Bad;
const isKind = (k: unknown): k is Kind => typeof k === "string" && Object.hasOwn(PARSE, k);

function startedOf(raw: unknown, at: string): Event | Bad {
  const phase = oneOf(raw, "phase", PHASES);
  const mode = oneOf(raw, "mode", [...MODES, "none"] as const);
  const head = str(raw, "head");
  if (phase === BAD || mode === BAD || head === BAD) {
    return BAD;
  }
  return { at, kind: "started", phase, mode, head, ...pluginsOf(raw), ...folderOf(raw), ...namedOf(raw) };
}

function namedOf(raw: unknown): { readonly cli?: string; readonly asks?: Asks } {
  const cli = prop(raw, "cli");
  const asks = asksOf(prop(raw, "asks"));
  return { ...(typeof cli === "string" ? { cli } : {}), ...(asks === undefined ? {} : { asks }) };
}

function runsIn(raw: unknown): { readonly runs?: readonly RunNamed[] } {
  return runsField(runsOf(prop(raw, "runs")));
}

function pluginsOf(raw: unknown): { readonly plugins?: readonly PluginHash[] } {
  const plugins = hashesIn(prop(raw, "plugins"));
  return plugins === undefined ? {} : { plugins };
}

function folderOf(raw: unknown): { readonly folder?: string } {
  const folder = prop(raw, "folder");
  return typeof folder === "string" ? { folder } : {};
}

function hashesIn(value: unknown): readonly PluginHash[] | undefined {
  const list = Array.isArray(value) ? value : [];
  const hashes = list.flatMap((h: unknown) => {
    const [ref, sha256] = [prop(h, "ref"), prop(h, "sha256")];
    return typeof ref === "string" && typeof sha256 === "string" ? [{ ref, sha256 }] : [];
  });
  return Array.isArray(value) ? hashes : undefined;
}

function rowOf(row: unknown): Evidence | Bad {
  const criterion = str(row, "criterion");
  const command = str(row, "command");
  const result = str(row, "result");
  return criterion === BAD || command === BAD || result === BAD ? BAD : { criterion, command, result };
}

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
  readonly hung: boolean;
};

function hungOf(raw: unknown): boolean | Bad {
  const hung = prop(raw, "hung");
  if (hung === undefined) {
    return false;
  }
  return typeof hung === "boolean" ? hung : BAD;
}

function writerParts(raw: unknown): WriterParts | Bad {
  const head = str(raw, "head");
  const patch = str(raw, "patch");
  const evidence = evidenceOf(raw);
  const hung = hungOf(raw);
  if (head === BAD || patch === BAD) {
    return BAD;
  }
  return evidence === BAD || hung === BAD ? BAD : { head, patch, evidence, hung };
}

function amount(value: unknown): number | Bad {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : BAD;
}

function spendField(raw: unknown): { readonly spend?: Spend; readonly copilot?: CopilotRuns } | Bad {
  const copilot = copilotField(raw);
  const spend = prop(raw, "spend");
  if (spend === undefined || copilot === BAD) {
    return copilot;
  }
  const usd = amount(prop(spend, "usd"));
  const tokens = amount(prop(spend, "tokens"));
  return usd === BAD || tokens === BAD ? BAD : { spend: { usd, tokens }, ...copilot };
}

function copilotField(raw: unknown): { readonly copilot?: CopilotRuns } | Bad {
  const copilot = prop(raw, "copilot");
  if (copilot === undefined) {
    return {};
  }
  const runs = prop(copilot, "runs");
  const seconds = prop(copilot, "seconds");
  return isCount(runs) && isCount(seconds) ? { copilot: { runs: Number(runs), seconds: Number(seconds) } } : BAD;
}

function spendIn(value: unknown): Spend | Bad {
  const usd = amount(prop(value, "usd"));
  const tokens = amount(prop(value, "tokens"));
  return usd === BAD || tokens === BAD ? BAD : { usd, tokens };
}

function findersIn(raw: unknown): Readonly<Record<string, Spend>> | Bad {
  return recordOf(raw, spendIn);
}

function splitField(line: unknown): { readonly split?: RoundSpend } | Bad {
  const split = prop(line, "split");
  if (split === undefined) {
    return {};
  }
  const verify = spendIn(prop(split, "verify"));
  const finders = findersIn(prop(split, "finders"));
  return verify === BAD || finders === BAD ? BAD : { split: { finders, verify } };
}

function spentOf(raw: unknown, at: string): Event | Bad {
  const phase = oneOf(raw, "phase", PHASES);
  const head = str(raw, "head");
  const spend = spendIn(prop(raw, "spend"));
  if (phase === BAD || head === BAD) {
    return BAD;
  }
  const extras = spentExtras(raw);
  return spend === BAD || extras === BAD ? BAD : { at, kind: "spent", phase, head, spend, ...extras, ...runsIn(raw) };
}

function spentExtras(raw: unknown): Pick<Extract<Event, { kind: "spent" }>, "split" | "traces" | "copilot"> | Bad {
  const split = splitField(raw);
  const traces = tracesField(raw);
  const copilot = copilotField(raw);
  return split === BAD || traces === BAD || copilot === BAD ? BAD : { ...split, ...traces, ...copilot };
}

function tracesField(raw: unknown): { readonly traces?: readonly string[] } | Bad {
  const traces = prop(raw, "traces");
  if (traces === undefined) {
    return {};
  }
  return Array.isArray(traces) && traces.every((t) => typeof t === "string") ? { traces } : BAD;
}

function cardField(raw: unknown): { readonly card?: string } | Bad {
  const card = prop(raw, "card");
  if (card === undefined) {
    return {};
  }
  return typeof card === "string" && /^[0-9a-f]{64}$/.test(card) ? { card } : BAD;
}

function deferredField(raw: unknown): { readonly deferred?: readonly string[] } | Bad {
  const deferred = prop(raw, "deferred");
  if (deferred === undefined) {
    return {};
  }
  return Array.isArray(deferred) && deferred.every((d) => typeof d === "string") ? { deferred } : BAD;
}

function staleField(raw: unknown): { readonly stale?: readonly string[] } | Bad {
  const stale = prop(raw, "stale");
  if (stale === undefined) {
    return {};
  }
  return Array.isArray(stale) && stale.every((s) => typeof s === "string") ? { stale } : BAD;
}

function textOf(raw: unknown, name: string): string | undefined | Bad {
  const value = prop(raw, name);
  return value === undefined || typeof value === "string" ? value : BAD;
}

function whyFields(raw: unknown): { readonly why?: string; readonly output?: string; readonly trace?: string } | Bad {
  const why = textOf(raw, "why");
  const output = textOf(raw, "output");
  const trace = textOf(raw, "trace");
  return why === BAD || output === BAD || trace === BAD
    ? BAD
    : { ...(why === undefined ? {} : { why }), ...outputAndTrace(output, trace) };
}

function outputAndTrace(
  output: string | undefined,
  trace: string | undefined,
): { readonly output?: string; readonly trace?: string } {
  return { ...(output === undefined ? {} : { output }), ...(trace === undefined ? {} : { trace }) };
}

function notesFields(
  raw: unknown,
):
  | { readonly stale?: readonly string[]; readonly why?: string; readonly output?: string; readonly trace?: string }
  | Bad {
  const stale = staleField(raw);
  const why = whyFields(raw);
  return stale === BAD || why === BAD ? BAD : { ...stale, ...why };
}

function writerExtras(
  raw: unknown,
):
  | Pick<
      Extract<Event, { kind: "writer-ended" }>,
      "spend" | "copilot" | "card" | "deferred" | "stale" | "why" | "output" | "trace"
    >
  | Bad {
  const spend = spendField(raw);
  const card = cardField(raw);
  const deferred = deferredField(raw);
  const notes = notesFields(raw);
  if (spend === BAD || card === BAD) {
    return BAD;
  }
  return deferred === BAD || notes === BAD ? BAD : { ...spend, ...card, ...deferred, ...notes };
}

const UNHEADED = ["test-first", "fix"] as const;
const HEADED = ["ready-failed", "act-on", "ci-red", "verify-failed", "conflict"] as const;

function parkedTaskField(raw: unknown): { readonly task?: ParkedTask } | Bad {
  const task = prop(raw, "task");
  if (task === undefined) {
    return {};
  }
  const unheaded = oneOf(task, "kind", UNHEADED);
  if (unheaded !== BAD) {
    return { task: { kind: unheaded } };
  }
  const kind = oneOf(task, "kind", HEADED);
  const head = str(task, "head");
  return kind === BAD || head === BAD ? BAD : { task: { kind, head } };
}

function untilOf(raw: unknown): string | Bad {
  const until = str(raw, "until");
  return until === "unknown" ||
    (until !== BAD && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(until) && !Number.isNaN(Date.parse(until)))
    ? until
    : BAD;
}

type ParkedParts = Pick<Extract<Event, { kind: "parked" }>, "phase" | "head" | "until" | "said">;
type ParkedExtras = Pick<Extract<Event, { kind: "parked" }>, "task" | "spend" | "copilot" | "trace">;

function parkedParts(raw: unknown): ParkedParts | Bad {
  const phase = oneOf(raw, "phase", PHASES);
  const head = str(raw, "head");
  const until = untilOf(raw);
  const said = str(raw, "said");
  return phase === BAD || head === BAD || until === BAD || said === BAD ? BAD : { phase, head, until, said };
}

function parkedExtras(raw: unknown): ParkedExtras | Bad {
  const task = parkedTaskField(raw);
  const spend = spendField(raw);
  const trace = textOf(raw, "trace");
  if (task === BAD || spend === BAD || trace === BAD) {
    return BAD;
  }
  return {
    ...task,
    ...spentAndTrace(spend.spend, trace),
    ...(spend.copilot === undefined ? {} : { copilot: spend.copilot }),
  };
}

export function spentAndTrace(
  spend: Spend | undefined,
  trace: string | undefined,
): Pick<ParkedExtras, "spend" | "trace"> {
  return { ...(spend === undefined ? {} : { spend }), ...(trace === undefined ? {} : { trace }) };
}

function parkedOf(raw: unknown, at: string): Event | Bad {
  const parts = parkedParts(raw);
  const extras = parkedExtras(raw);
  return parts === BAD || extras === BAD ? BAD : { at, kind: "parked", ...parts, ...extras, ...runsIn(raw) };
}

function writerEndedOf(raw: unknown, at: string): Event | Bad {
  const mode = oneOf(raw, "mode", MODES);
  const outcome = oneOf(raw, "outcome", OUTCOMES);
  const parts = writerParts(raw);
  const extras = writerExtras(raw);
  return mode === BAD || outcome === BAD || parts === BAD || extras === BAD
    ? BAD
    : { at, kind: "writer-ended", mode, outcome, ...parts, ...extras, ...runsIn(raw) };
}

type DesignParts = Pick<Extract<Event, { kind: "design-ended" }>, "step" | "spec" | "design" | "outcome" | "why">;

function designTexts(raw: unknown): Pick<DesignParts, "spec" | "design" | "why"> | Bad {
  const spec = str(raw, "spec");
  const design = optionalText(raw, "design");
  const why = str(raw, "why");
  return spec === BAD || design === "bad" || why === BAD ? BAD : { spec, ...design, why };
}

function designParts(raw: unknown): DesignParts | Bad {
  const which = oneOf(raw, "step", ["review", "verify"] as const);
  const outcome = oneOf(raw, "outcome", ["done", "failed"] as const);
  const texts = designTexts(raw);
  return which === BAD || outcome === BAD || texts === BAD ? BAD : { step: which, outcome, ...texts };
}

function designEndedOf(raw: unknown, at: string): Event | Bad {
  const parts = designParts(raw);
  const findings = recordedFindings(prop(raw, "findings"));
  const kept = recordedKept(prop(raw, "kept"));
  const extras = designExtras(raw);
  if (parts === BAD || extras === BAD) {
    return BAD;
  }
  return findings === undefined || kept === undefined
    ? BAD
    : { at, kind: "design-ended", ...parts, findings, kept, ...extras, ...runsIn(raw) };
}

function designExtras(raw: unknown): (ReturnType<typeof writerExtras> & DesignOptional) | Bad {
  const parts = [writerExtras(raw), finalField(raw), laneField(raw), plannedField(raw)];
  return parts.some((p) => p === BAD) ? BAD : Object.assign({}, ...parts);
}

type DesignOptional = { readonly final?: true; readonly lane?: Lane; readonly planned?: readonly string[] };

function plannedField(raw: unknown): { readonly planned?: readonly string[] } | Bad {
  const planned = prop(raw, "planned");
  if (planned === undefined) {
    return {};
  }
  return Array.isArray(planned) && planned.every((f) => typeof f === "string") ? { planned } : BAD;
}

function designNotedOf(raw: unknown, at: string): Event | Bad {
  const texts = designTexts(raw);
  return texts === BAD ? BAD : { at, kind: "design-noted", ...texts };
}

function finalField(raw: unknown): { readonly final?: true } | Bad {
  const final = prop(raw, "final");
  if (final !== undefined && typeof final !== "boolean") {
    return BAD;
  }
  return final === true ? { final: true } : {};
}

function nextTryField(raw: unknown): { readonly nextTry?: NextTry } | Bad {
  const next = prop(raw, "nextTry");
  if (next === undefined) {
    return {};
  }
  const retried = oneOf(next, "step", RETRIED);
  const at = str(next, "at");
  return retried === BAD || at === BAD || Number.isNaN(Date.parse(at)) ? BAD : { nextTry: { step: retried, at } };
}

function whyOf(raw: unknown): string | Bad {
  return prop(raw, "why") === undefined ? "" : str(raw, "why");
}

function laneField(raw: unknown): { readonly lane?: Lane } | Bad {
  const lane = prop(raw, "lane");
  if (lane === undefined) {
    return {};
  }
  const known = LANES.find((l) => l === lane);
  return known === undefined ? BAD : { lane: known };
}

function humanField(raw: unknown): { readonly human?: boolean } | Bad {
  const human = prop(raw, "human");
  if (human === undefined) {
    return {};
  }
  return typeof human === "boolean" ? { human } : BAD;
}

function programsField(raw: unknown): { readonly programs?: readonly string[] } | Bad {
  const programs = prop(raw, "programs");
  if (programs === undefined) {
    return {};
  }
  return Array.isArray(programs) && programs.every((p) => typeof p === "string")
    ? { programs: programs.map(String) }
    : BAD;
}

function readyExtras(raw: unknown):
  | {
      readonly nextTry?: NextTry;
      readonly lane?: Lane;
      readonly human?: boolean;
      readonly programs?: readonly string[];
    }
  | Bad {
  const next = nextTryField(raw);
  const lane = laneField(raw);
  const human = humanField(raw);
  const programs = programsField(raw);
  return next === BAD || lane === BAD || human === BAD || programs === BAD
    ? BAD
    : { ...next, ...lane, ...human, ...programs };
}

function readyEndedOf(raw: unknown, at: string): Event | Bad {
  const head = str(raw, "head");
  const passed = prop(raw, "passed");
  const why = whyOf(raw);
  const extras = readyExtras(raw);
  if (head === BAD || why === BAD || extras === BAD) {
    return BAD;
  }
  return typeof passed === "boolean" ? { at, kind: "ready-ended", head, passed, why, ...extras } : BAD;
}

function verifyEndedOf(raw: unknown, at: string): Event | Bad {
  const head = str(raw, "head");
  const passed = prop(raw, "passed");
  const next = nextTryField(raw);
  return head === BAD || next === BAD || typeof passed !== "boolean"
    ? BAD
    : { at, kind: "verify-ended", head, passed, ...next };
}

function actedField(raw: unknown): { readonly acted?: Acted } | Bad {
  const acted = prop(raw, "acted");
  if (acted === undefined) {
    return {};
  }
  const since = str(acted, "since");
  const rows = prop(acted, "rows");
  return since !== BAD && Array.isArray(rows) && rows.every(isActedRow) ? { acted: { since, rows } } : BAD;
}

function entriesOf(value: unknown): readonly [string, unknown][] {
  return typeof value === "object" && value !== null ? Object.entries(value) : [];
}

function lensesField(raw: unknown): { readonly lenses?: Readonly<Record<string, number>> } | Bad {
  const lenses = prop(raw, "lenses");
  if (lenses === undefined) {
    return {};
  }
  const entries = entriesOf(lenses);
  return entries.length > 0 && entries.every(([, n]) => Number.isSafeInteger(n))
    ? { lenses: Object.fromEntries(entries.map(([lens, n]) => [lens, Number(n)])) }
    : BAD;
}

function citesField(raw: unknown): { readonly citesNotFound?: number } | Bad {
  const n = prop(raw, "citesNotFound");
  if (n === undefined) {
    return {};
  }
  return isCount(n) ? { citesNotFound: Number(n) } : BAD;
}

const FOUND_BUCKETS: ReadonlySet<string> = new Set(BUCKETS);

function isCount(n: unknown): boolean {
  return Number.isSafeInteger(n) && Number(n) >= 0;
}

function isBucketCounts(value: unknown): boolean {
  const entries = entriesOf(value);
  return entries.length > 0 && entries.every(([bucket, n]) => FOUND_BUCKETS.has(bucket) && isCount(n));
}

function foundField(raw: unknown): { readonly found?: FoundByRule } | Bad {
  const found = prop(raw, "found");
  if (found === undefined) {
    return {};
  }
  const entries = entriesOf(found);
  return isPlain(found) && entries.every(([, per]) => isBucketCounts(per))
    ? {
        found: Object.fromEntries(
          entries.map(([rule, per]) => [rule, Object.fromEntries(entriesOf(per).map(([b, n]) => [b, Number(n)]))]),
        ),
      }
    : BAD;
}

function isActedCounts(value: unknown): boolean {
  const [acted, of] = [prop(value, "acted"), prop(value, "of")];
  return isCount(acted) && isCount(of) && Number(acted) <= Number(of);
}

function recordOf<T>(value: unknown, read: (v: unknown) => T | Bad): Readonly<Record<string, T>> | Bad {
  if (!isPlain(value)) {
    return BAD;
  }
  const out: Record<string, T> = {};
  for (const [k, v] of entriesOf(value)) {
    const got = read(v);
    if (got === BAD) {
      return BAD;
    }
    out[k] = got;
  }
  return out;
}

function isPlain(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byField(raw: unknown): { readonly by?: string } | Bad {
  const by = prop(raw, "by");
  if (by === undefined) {
    return {};
  }
  return typeof by === "string" ? { by } : BAD;
}

function rescueOf(raw: unknown): Rescue | Bad {
  const at = str(raw, "at");
  const why = str(raw, "why");
  const by = byField(raw);
  const waitedMs = prop(raw, "waitedMs");
  if (at === BAD || why === BAD || by === BAD) {
    return BAD;
  }
  return isCount(waitedMs) ? { at, why, waitedMs: Number(waitedMs), ...by } : BAD;
}

function actedCountsOf(v: unknown): { readonly acted: number; readonly of: number } | Bad {
  return isActedCounts(v) ? { acted: Number(prop(v, "acted")), of: Number(prop(v, "of")) } : BAD;
}

function rescuesOf(raw: unknown): readonly Rescue[] | Bad {
  const rescues = prop(raw, "rescues");
  const read = Array.isArray(rescues) ? rescues.map(rescueOf) : [BAD];
  return read.every((r): r is Rescue => r !== BAD) ? read : BAD;
}

function spendByKind(raw: unknown): Readonly<Partial<Record<RunKind, Spend>>> | Bad {
  const spend = recordOf(prop(raw, "spend"), spendIn);
  return spend !== BAD && Object.keys(spend).every((k) => RUN_KINDS.some((kind) => kind === k)) ? spend : BAD;
}

function countsIn(raw: unknown): { readonly rounds: number; readonly unmeasured: number } | Bad {
  const [rounds, unmeasured] = [prop(raw, "rounds"), prop(raw, "unmeasured")];
  return isCount(rounds) && isCount(unmeasured) ? { rounds: Number(rounds), unmeasured: Number(unmeasured) } : BAD;
}

function timelineParts(raw: unknown): Omit<Extract<Event, { kind: "timeline" }>, "at" | "kind" | "number"> | Bad {
  const found = isPlain(prop(raw, "found")) ? foundField(raw) : BAD;
  const parts = [
    found === BAD ? BAD : { found: found.found ?? {} },
    countsIn(raw),
    ...(
      [
        ["acted", recordOf(prop(raw, "acted"), actedCountsOf)],
        ["spend", spendByKind(raw)],
        ["rescues", rescuesOf(raw)],
      ] as const
    ).map(([name, v]) => (v === BAD ? BAD : { [name]: v })),
  ];
  return parts.includes(BAD) ? BAD : Object.assign({}, ...parts);
}

function reviewEndedOf(raw: unknown, at: string): Event | Bad {
  const head = str(raw, "head");
  const actOn = prop(raw, "actOn");
  const extras = [
    nextTryField(raw),
    spendField(raw),
    splitField(raw),
    actedField(raw),
    lensesField(raw),
    citesField(raw),
    foundField(raw),
    tracesField(raw),
  ];
  const good = extras.flatMap((e) => (e === BAD ? [] : [e]));
  return head === BAD || good.length < extras.length || !Number.isSafeInteger(actOn)
    ? BAD
    : { at, kind: "review-ended", head, actOn: Number(actOn), ...Object.assign({}, ...good), ...runsIn(raw) };
}

function optionalText(raw: unknown, name: "asked" | "chosen" | "design"): { readonly [k: string]: string } | "bad" {
  const v = prop(raw, name);
  if (v === undefined) {
    return {};
  }
  return typeof v === "string" ? { [name]: v } : "bad";
}

function readBack(raw: unknown): { readonly [k: string]: string } | "bad" {
  const [asked, chosen] = [optionalText(raw, "asked"), optionalText(raw, "chosen")];
  return asked === "bad" || chosen === "bad" ? "bad" : { ...asked, ...chosen };
}

function answerOf(raw: unknown): Answer | undefined {
  const [question, choice, text] = [prop(raw, "question"), prop(raw, "choice"), prop(raw, "text")];
  const back = readBack(raw);
  const ok = Number.isSafeInteger(question) && typeof choice === "string" && typeof text === "string";
  return ok && back !== "bad" ? { question: Number(question), choice, text, ...back } : undefined;
}

function answeredOf(raw: unknown, at: string): Event | Bad {
  const spec = str(raw, "spec");
  const list = prop(raw, "answers");
  const answers = Array.isArray(list) ? list.map(answerOf) : [undefined];
  return spec === BAD || answers.some((a) => a === undefined)
    ? BAD
    : { at, kind: "answered", spec, answers: answers.filter((a): a is Answer => a !== undefined) };
}

const PARSE: Readonly<Record<Kind, Parse>> = {
  started: startedOf,
  "writer-ended": writerEndedOf,
  "ready-ended": readyEndedOf,
  "review-ended": reviewEndedOf,
  "verify-ended": verifyEndedOf,
  spent: spentOf,
  parked: parkedOf,
  "design-ended": designEndedOf,
  "design-noted": designNotedOf,
  pinged: (raw, at) => {
    const head = str(raw, "head");
    return head === BAD ? BAD : { at, kind: "pinged", head };
  },
  turn: (raw, at) => {
    const to = oneOf(raw, "to", TURN_LANES);
    return to === BAD ? BAD : { at, kind: "turn", to };
  },
  waiting: (raw, at) => {
    const since = str(raw, "since");
    return since === BAD ? BAD : { at, kind: "waiting", since };
  },
  blocked: (raw, at) => {
    const why = str(raw, "why");
    return why === BAD ? BAD : { at, kind: "blocked", why };
  },
  held: (raw, at) => {
    const why = str(raw, "why");
    return why === BAD ? BAD : { at, kind: "held", why };
  },
  "blockers-unread": (raw, at) => {
    const why = str(raw, "why");
    return why === BAD ? BAD : { at, kind: "blockers-unread", why };
  },
  shared: (raw, at) => {
    const approval = str(raw, "approval");
    return approval === BAD ? BAD : { at, kind: "shared", approval };
  },
  answered: answeredOf,
  begun: (raw, at) => {
    const by = str(raw, "by");
    const via = prop(raw, "via");
    return by === BAD || !isVia(via) ? BAD : { at, kind: "begun", by, via };
  },
  merged: (raw, at) => {
    const n = prop(raw, "number");
    const sha = str(raw, "sha");
    const by = str(raw, "by");
    return sha === BAD || by === BAD || !Number.isSafeInteger(n)
      ? BAD
      : { at, kind: "merged", number: Number(n), sha, by };
  },
  timeline: (raw, at) => {
    const n = prop(raw, "number");
    const parts = timelineParts(raw);
    return parts === BAD || !Number.isSafeInteger(n) ? BAD : { at, kind: "timeline", number: Number(n), ...parts };
  },
  approved: (raw, at) => {
    const by = str(raw, "by");
    const via = prop(raw, "via");
    const spec = str(raw, "spec");
    return by === BAD || spec === BAD || !isVia(via) ? BAD : { at, kind: "approved", by, via, spec };
  },
};

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

function eventOf(line: string): Event | Bad {
  const raw = parseLine(line);
  const at = str(raw, "at");
  const kind = prop(raw, "kind");
  return at === BAD || !isKind(kind) ? BAD : PARSE[kind](raw, at);
}

function isEvent(e: Event | Bad): e is Event {
  return e !== BAD;
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
  spent: (s, e) => ({ ...s, spent: addSpend(s.spent, e.spend) }),
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
  merged: (s) => s,
  timeline: (s) => s,
};

function step<K extends Kind>(s: Summary, kind: K, e: EventMap[K]): Summary {
  return STEPS[kind](s, e);
}

export function isActivity(e: Event): boolean {
  return e.kind !== "turn" && e.kind !== "waiting";
}

export function summarize(input: { readonly events: readonly Event[]; readonly since: string }): Summary {
  const from = Date.parse(input.since);
  return input.events
    .filter((e) => !(Date.parse(e.at) < from))
    .reduce((s, e) => ({ ...step(s, e.kind, e), lastAt: isActivity(e) ? e.at : s.lastAt }), EMPTY);
}
