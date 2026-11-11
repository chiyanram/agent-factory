// records — what the dispatcher has done for each ticket, so a restart loses nothing (#103; ADR-0012 S3). One
// append-only JSON-lines file per ticket: <FACTORY_HOME>/runs/<project>/<ticket>.jsonl. The dispatcher writes a line
// before a run starts and one after it ends; the counts the table needs (ready-check failures, review rounds, CI
// rounds: writer runs started for a red pipeline) are summed from the lines written since the human's START or approval
// that let the build begin (#227), so a new one starts afresh.
//
// A "started" line with no "ended" after it means the dispatcher died during that run: the summary says so, and the
// table blocks the ticket for a person rather than guess whether the run pushed.
//
// A check that fails (a ready check, a review with Act on findings, the local verifier) records nextTry{step, at} on
// its "ended" line (#228): the writer's retry for it waits until then, at = now + min(10 s × 2^(n−1), 5 min) for the
// step's n-th failure since the approval. The newest check line's nextTry is the one that holds.
//
// A writer or review "ended" line carries the run's spend{usd, tokens} (#131), as the agent CLI reported it; a line
// with none was not measured (an older line, or a run stopped before its result). A run that failed after it spent
// writes a "spent" line instead: it ends nothing, so the start still reads as a run that never ended and goes to a
// person, but its spend counts. `usage` and the caps sum them all. A review round's line, ended or spent, also carries
// split{finders, verify}: each finder's spend by its lens and the verify pass's, which sum to its spend (#337); an
// older line has none.
//
// A design review (#236) runs before the human's approval: a design-reviewer run, then a verify pass, each recorded by
// a "started" line and a "design-ended" line that names the spec and design hashes it read, the role card's hash, its
// findings or what the verify pass kept, and its spend, whether it finished or failed. design.ts reads them per hashes.

import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LANES, plainName, type Lane } from "../spec.js";
import type { Done, Result } from "../forge/api.js";
import type { Answer } from "../answers.js";
import type { Evidence } from "../report.js";
import type { PluginHash } from "../process/use.js";
import { scrubbedJson } from "../scrub.js";
import { addSpend, NO_SPEND, type RoundSpend, type Spend } from "./spend.js";
import { recordedFindings, recordedKept, type DesignFinding, type Kept } from "../design/findings.js";
import { isActedRow, type Acted } from "../review/acted-on.js";

// "onboard" is the onboarder's run (#235), which belongs to no ticket: its spend goes in the project's onboarder.jsonl
export type Phase = "writer" | "ready" | "review" | "verify" | "design-review" | "design-verify" | "onboard";
// the two runs of a design review (#236)
export type DesignStep = "review" | "verify";
// what the writer was started for; "rebase" is the run for a merge conflict, which merges the default branch in and
// never rebases (#103: every push is --force-with-lease against the head the host saw, push.ts, so a merge goes out
// as a fast-forward and a person's push in between is never overwritten; the name predates that decision and stays,
// so older lines still read)
// "cleanup" is the cleanup run after the implementer's done run (#236): the same branch, its own role card
export type WriterMode = "test-first" | "fix" | "rework" | "ci" | "rebase" | "cleanup";

// what one writer run is for, and so what the host hands the writer (#171). The record keeps only its mode.
// answers: the person's answers to the writer's questions, when the run follows an answered round (#486; answers.ts)
export type Task =
  | { readonly kind: "test-first"; readonly answers?: readonly Answer[] }
  | { readonly kind: "fix"; readonly answers?: readonly Answer[] }
  // the ready check failed at this head; why it failed is kept with the head (kept.ts, #199)
  | { readonly kind: "ready-failed"; readonly head: string }
  // the factory's review at this head left Act on findings
  | { readonly kind: "act-on"; readonly head: string }
  // CI is red at this head
  | { readonly kind: "ci-red"; readonly head: string }
  // the local verifier failed at this head (a local gate, #91); its output is kept with the head (kept.ts)
  | { readonly kind: "verify-failed"; readonly head: string }
  // the change does not merge into the default branch at this head: merge the default branch in (#103)
  | { readonly kind: "conflict"; readonly head: string }
  // the implementer's run ended done at this head: the cleanup run tidies the branch's own lines, and runs its evidence
  // rows again (#236)
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

// modeOf : the mode a task is recorded as. Pure.
export function modeOf(task: Task): WriterMode {
  return MODE_OF[task.kind];
}

// the checks whose failure sends the writer back, and so back off before it goes (#228)
export type Retried = "ready" | "review" | "verify";
export type NextTry = { readonly step: Retried; readonly at: string };

const FIRST_BACKOFF_MS = 10_000;
const MOST_BACKOFF_MS = 5 * 60_000;

// backoffMs : how long the writer waits after a step's n-th failure: 10 s, doubling, at most 5 minutes. Pure.
export function backoffMs(n: number): number {
  return Math.min(FIRST_BACKOFF_MS * 2 ** Math.max(0, n - 1), MOST_BACKOFF_MS);
}

// nextTryOf : the next try after a step's n-th failure, from now (ms since the epoch). Pure.
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
      // each plugin the run used and its hash (#232); absent on older lines
      readonly plugins?: readonly PluginHash[];
    }
  | {
      readonly at: string;
      readonly kind: "writer-ended";
      readonly mode: WriterMode;
      readonly head: string;
      readonly outcome: "done" | "asked" | "blocked";
      readonly patch: string;
      // the rows the ready check runs again; none unless the outcome is done
      readonly evidence: readonly Evidence[];
      // the writer hung after its report and was stopped after the completion window (#182); false on older lines
      readonly hung: boolean;
      // what the run spent (#131); none when it was not measured
      readonly spend?: Spend;
      // the role card's hash, for a run started from a card (#236: cleanup)
      readonly card?: string;
      // what a cleanup run left for a person, as each would change behaviour (#236)
      readonly deferred?: readonly string[];
      // each cite of the project's brief that went stale, for the retro (#235); none on a line that has none
      readonly stale?: readonly string[];
      // why a run that is not done stopped, scrubbed and cut (writer/why.ts, #62); none on a done line or an older one
      readonly why?: string;
      // the file under <home>/runs/<project>/<ticket>/ that keeps the end of a host-blocked run's output (#62)
      readonly output?: string;
    }
  // why: the first row that failed, "" when it passed
  | {
      readonly at: string;
      readonly kind: "ready-ended";
      readonly head: string;
      readonly passed: boolean;
      readonly why: string;
      // a test check stopped it for a person, not the writer (#231); absent on older lines, which are false
      readonly human?: boolean;
      // only when it failed (#228)
      readonly nextTry?: NextTry;
      // the lane the diff needs (#230); none on a line older than the lane check
      readonly lane?: Lane;
      // every program the check let a row start with (#444); none on an older line
      readonly programs?: readonly string[];
    }
  // the local verifier's run (#91); its result is the commit status it posted
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
      // what the round's model runs spent (#131); none when it was not measured
      readonly spend?: Spend;
      // the same spend per run: each finder's by its lens, and the verify pass's (#337); none on an older line
      readonly split?: RoundSpend;
      // the last full round's Act on and Consider findings at its head, each acted on or not by this head (#220);
      // none on a first round, a reused one, or an older line
      readonly acted?: Acted;
      // per lens that ran, its verified findings no other lens reported (#237); none when the round ran no lens
      readonly lenses?: Readonly<Record<string, number>>;
      // the findings the cite check noted as "cite not found" (#485); none on an older line
      readonly citesNotFound?: number;
    }
  // what a run that failed spent (#131): a review round whose pass failed; or what the onboarder's run spent, finished
  // or failed (#235)
  | {
      readonly at: string;
      readonly kind: "spent";
      readonly phase: Phase;
      readonly head: string;
      readonly spend: Spend;
      // a review round's spend per run (#337); none on another phase's line or an older one
      readonly split?: RoundSpend;
    }
  // one run of a design review (#236), at the spec and design hashes it read
  | {
      readonly at: string;
      readonly kind: "design-ended";
      readonly step: DesignStep;
      readonly spec: string;
      readonly design: string;
      readonly outcome: "done" | "failed";
      // why it failed, "" when it finished
      readonly why: string;
      // the design-reviewer's findings, one per decision
      readonly findings: readonly DesignFinding[];
      // what the verify pass kept
      readonly kept: readonly Kept[];
      // the role card's hash; none when the run failed before it read one
      readonly card?: string;
      readonly spend?: Spend;
      // a failure no retry fixes, such as a cite that does not hold: the step stops at once (#489); absent otherwise
      readonly final?: true;
      // the spec's lane and its Planned files when the run read it, so a later edit that raises the lane or changes
      // the files is reviewed again (#489); absent on older lines
      readonly lane?: Lane;
      readonly planned?: readonly string[];
    }
  // a person was told why the design review holds or ends at these hashes (a raised lane, the round cap), once (#489)
  | {
      readonly at: string;
      readonly kind: "design-noted";
      readonly spec: string;
      readonly design: string;
      readonly why: string;
    }
  | { readonly at: string; readonly kind: "pinged"; readonly head: string }
  // the dispatcher handed the ticket to a person, for this reason; the same stop is never posted twice
  | { readonly at: string; readonly kind: "blocked"; readonly why: string }
  // the ticket's build is held by its spec's "Blocked by" for this reason; a person was pinged when it changed (#494)
  | { readonly at: string; readonly kind: "held"; readonly why: string }
  // the git host did not answer for a blocker on one pass, with its reason (#494 AC-7)
  | { readonly at: string; readonly kind: "blockers-unread"; readonly why: string }
  // the shared copy of this approval (shared.ts approvalKey) is on the ticket's PR (#227); it is posted once
  | { readonly at: string; readonly kind: "shared"; readonly approval: string }
  // a person's answers to the writer's questions, as their own event, tied to the spec version they answered (#486,
  // P13): the spec's hash, or "" when the ticket's lane needs no approval record
  | { readonly at: string; readonly kind: "answered"; readonly spec: string; readonly answers: readonly Answer[] };

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
    // every string the line keeps is scrubbed: no record holds a secret, whatever a run or a person wrote (P4, #485)
    const line = scrubbedJson(input.event);
    await appendFile(path.value, `${line}\n`, { mode: 0o600 });
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

const PHASES = ["writer", "ready", "review", "verify", "design-review", "design-verify", "onboard"] as const;
const MODES = ["test-first", "fix", "rework", "ci", "rebase", "cleanup"] as const;
const OUTCOMES = ["done", "asked", "blocked"] as const;
const RETRIED = ["ready", "review", "verify"] as const;

// each event by its kind, so a handler per kind is typed without an assertion (TypeScript's correlated unions)
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
  const plugins = hashesIn(prop(raw, "plugins"));
  return plugins === undefined
    ? { at, kind: "started", phase, mode, head }
    : { at, kind: "started", phase, mode, head, plugins };
}

// hashesIn : a started line's plugins and their hashes; none on an older line, or one that holds no list
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
  readonly hung: boolean;
};

// hungOf : whether the writer hung after its report; a line written before #182 says nothing, which is false
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

// amount : a spend figure: a finite number, never below 0
function amount(value: unknown): number | Bad {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : BAD;
}

// spendField : an ended line's spend, as a field to spread: none on a line that has none (#131)
function spendField(raw: unknown): { readonly spend?: Spend } | Bad {
  const spend = prop(raw, "spend");
  if (spend === undefined) {
    return {};
  }
  const usd = amount(prop(spend, "usd"));
  const tokens = amount(prop(spend, "tokens"));
  return usd === BAD || tokens === BAD ? BAD : { spend: { usd, tokens } };
}

// spendIn : one spend figure, or BAD
function spendIn(value: unknown): Spend | Bad {
  const usd = amount(prop(value, "usd"));
  const tokens = amount(prop(value, "tokens"));
  return usd === BAD || tokens === BAD ? BAD : { usd, tokens };
}

// findersIn : each finder's spend by its lens, or BAD when it is not an object of spends
function findersIn(raw: unknown): Readonly<Record<string, Spend>> | Bad {
  const isMap = typeof raw === "object" && raw !== null && !Array.isArray(raw);
  const entries = entriesOf(raw);
  const finders = entries.flatMap(([lens, s]) => {
    const spend = spendIn(s);
    return spend === BAD ? [] : [[lens, spend] as const];
  });
  return isMap && finders.length === entries.length ? Object.fromEntries(finders) : BAD;
}

// splitField : a review round's spend per run (#337), as a field to spread: none on a line that has none
function splitField(line: unknown): { readonly split?: RoundSpend } | Bad {
  const split = prop(line, "split");
  if (split === undefined) {
    return {};
  }
  const verify = spendIn(prop(split, "verify"));
  const finders = findersIn(prop(split, "finders"));
  return verify === BAD || finders === BAD ? BAD : { split: { finders, verify } };
}

// spentOf : a spent line: its phase, head and spend, and a review round's spend per run (#337)
function spentOf(raw: unknown, at: string): Event | Bad {
  const phase = oneOf(raw, "phase", PHASES);
  const head = str(raw, "head");
  const spend = spendIn(prop(raw, "spend"));
  const split = splitField(raw);
  if (phase === BAD || head === BAD) {
    return BAD;
  }
  return spend === BAD || split === BAD ? BAD : { at, kind: "spent", phase, head, spend, ...split };
}

// cardField : a line's role card hash, as a field to spread: none on a line that has none (#236)
function cardField(raw: unknown): { readonly card?: string } | Bad {
  const card = prop(raw, "card");
  if (card === undefined) {
    return {};
  }
  return typeof card === "string" && /^[0-9a-f]{64}$/.test(card) ? { card } : BAD;
}

// deferredField : a cleanup run's deferred list, as a field to spread: none on a line that has none (#236)
function deferredField(raw: unknown): { readonly deferred?: readonly string[] } | Bad {
  const deferred = prop(raw, "deferred");
  if (deferred === undefined) {
    return {};
  }
  return Array.isArray(deferred) && deferred.every((d) => typeof d === "string") ? { deferred } : BAD;
}

// staleField : a writer line's stale cites, as a field to spread: none on a line that has none (#235)
function staleField(raw: unknown): { readonly stale?: readonly string[] } | Bad {
  const stale = prop(raw, "stale");
  if (stale === undefined) {
    return {};
  }
  return Array.isArray(stale) && stale.every((s) => typeof s === "string") ? { stale } : BAD;
}

// textOf : a line's optional text field: undefined on a line that has none, or BAD
function textOf(raw: unknown, name: string): string | undefined | Bad {
  const value = prop(raw, name);
  return value === undefined || typeof value === "string" ? value : BAD;
}

// whyFields : a writer line's why and output file, as fields to spread: none on a line that has none (#62)
function whyFields(raw: unknown): { readonly why?: string; readonly output?: string } | Bad {
  const why = textOf(raw, "why");
  const output = textOf(raw, "output");
  if (why === BAD || output === BAD) {
    return BAD;
  }
  return { ...(why === undefined ? {} : { why }), ...(output === undefined ? {} : { output }) };
}

// notesFields : a writer line's stale cites, why and output file, as fields to spread, or BAD
function notesFields(
  raw: unknown,
): { readonly stale?: readonly string[]; readonly why?: string; readonly output?: string } | Bad {
  const stale = staleField(raw);
  const why = whyFields(raw);
  return stale === BAD || why === BAD ? BAD : { ...stale, ...why };
}

// writerExtras : a writer line's optional fields, its spend, card, deferred list, stale cites, why and output file, as
// fields to spread, or BAD
function writerExtras(
  raw: unknown,
): Pick<Extract<Event, { kind: "writer-ended" }>, "spend" | "card" | "deferred" | "stale" | "why" | "output"> | Bad {
  const spend = spendField(raw);
  const card = cardField(raw);
  const deferred = deferredField(raw);
  const notes = notesFields(raw);
  if (spend === BAD || card === BAD) {
    return BAD;
  }
  return deferred === BAD || notes === BAD ? BAD : { ...spend, ...card, ...deferred, ...notes };
}

function writerEndedOf(raw: unknown, at: string): Event | Bad {
  const mode = oneOf(raw, "mode", MODES);
  const outcome = oneOf(raw, "outcome", OUTCOMES);
  const parts = writerParts(raw);
  const extras = writerExtras(raw);
  return mode === BAD || outcome === BAD || parts === BAD || extras === BAD
    ? BAD
    : { at, kind: "writer-ended", mode, outcome, ...parts, ...extras };
}

type DesignParts = Pick<Extract<Event, { kind: "design-ended" }>, "step" | "spec" | "design" | "outcome" | "why">;

function designTexts(raw: unknown): Pick<DesignParts, "spec" | "design" | "why"> | Bad {
  const spec = str(raw, "spec");
  const design = str(raw, "design");
  const why = str(raw, "why");
  return spec === BAD || design === BAD || why === BAD ? BAD : { spec, design, why };
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
    : { at, kind: "design-ended", ...parts, findings, kept, ...extras };
}

// designExtras : a design line's optional fields: card and spend, the final mark, the lane and Planned files
function designExtras(raw: unknown): (ReturnType<typeof writerExtras> & DesignOptional) | Bad {
  const parts = [writerExtras(raw), finalField(raw), laneField(raw), plannedField(raw)];
  return parts.some((p) => p === BAD) ? BAD : Object.assign({}, ...parts);
}

type DesignOptional = { readonly final?: true; readonly lane?: Lane; readonly planned?: readonly string[] };

// plannedField : a design line's Planned files, as a field to spread: none on an older line, BAD when not strings
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

// finalField : a design line's final mark, as a field to spread: none when absent or false, BAD when not a boolean
function finalField(raw: unknown): { readonly final?: true } | Bad {
  const final = prop(raw, "final");
  if (final !== undefined && typeof final !== "boolean") {
    return BAD;
  }
  return final === true ? { final: true } : {};
}

// nextTryField : a check line's nextTry, as a field to spread: none on a line that has none (a pass, or older than
// #228), BAD when it is there but not one
function nextTryField(raw: unknown): { readonly nextTry?: NextTry } | Bad {
  const next = prop(raw, "nextTry");
  if (next === undefined) {
    return {};
  }
  const retried = oneOf(next, "step", RETRIED);
  const at = str(next, "at");
  return retried === BAD || at === BAD || Number.isNaN(Date.parse(at)) ? BAD : { nextTry: { step: retried, at } };
}

// whyOf : a ready line's reason; a line older than the reasons has none
function whyOf(raw: unknown): string | Bad {
  return prop(raw, "why") === undefined ? "" : str(raw, "why");
}

// laneField : a ready or design line's lane, as a field to spread: none on a line older than the lane check (#230,
// #489), BAD when it is there but not a lane
function laneField(raw: unknown): { readonly lane?: Lane } | Bad {
  const lane = prop(raw, "lane");
  if (lane === undefined) {
    return {};
  }
  const known = LANES.find((l) => l === lane);
  return known === undefined ? BAD : { lane: known };
}

// humanField : a ready line's human flag, as a field to spread: none on a line that has none (#231)
function humanField(raw: unknown): { readonly human?: boolean } | Bad {
  const human = prop(raw, "human");
  if (human === undefined) {
    return {};
  }
  return typeof human === "boolean" ? { human } : BAD;
}

// programsField : a ready line's programs, as a field to spread: none on a line older than #444, BAD when it is there
// but not a list of words
function programsField(raw: unknown): { readonly programs?: readonly string[] } | Bad {
  const programs = prop(raw, "programs");
  if (programs === undefined) {
    return {};
  }
  return Array.isArray(programs) && programs.every((p) => typeof p === "string")
    ? { programs: programs.map(String) }
    : BAD;
}

// readyExtras : a ready line's optional fields, its nextTry, its lane, its human flag and its programs, as fields to
// spread, or BAD
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

// actedField : a review line's acted-on rows, as a field to spread: none on a line that has none (#220)
function actedField(raw: unknown): { readonly acted?: Acted } | Bad {
  const acted = prop(raw, "acted");
  if (acted === undefined) {
    return {};
  }
  const since = str(acted, "since");
  const rows = prop(acted, "rows");
  return since !== BAD && Array.isArray(rows) && rows.every(isActedRow) ? { acted: { since, rows } } : BAD;
}

// entriesOf : an object's own entries; none for anything else. Pure.
function entriesOf(value: unknown): readonly [string, unknown][] {
  return typeof value === "object" && value !== null ? Object.entries(value) : [];
}

// lensesField : a review line's per-lens unique findings (#237), as a field to spread; none on an older line
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

// citesField : a review line's count of findings whose cite was not found (#485), as a field to spread
function citesField(raw: unknown): { readonly citesNotFound?: number } | Bad {
  const n = prop(raw, "citesNotFound");
  if (n === undefined) {
    return {};
  }
  return Number.isSafeInteger(n) && Number(n) >= 0 ? { citesNotFound: Number(n) } : BAD;
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
  ];
  const good = extras.flatMap((e) => (e === BAD ? [] : [e]));
  return head === BAD || good.length < extras.length || !Number.isSafeInteger(actOn)
    ? BAD
    : { at, kind: "review-ended", head, actOn: Number(actOn), ...Object.assign({}, ...good) };
}

// optionalText : an optional string field, as a field to spread; "bad" when it is there and not a string. Pure.
function optionalText(raw: unknown, name: "asked" | "chosen"): { readonly [k: string]: string } | "bad" {
  const v = prop(raw, name);
  if (v === undefined) {
    return {};
  }
  return typeof v === "string" ? { [name]: v } : "bad";
}

// readBack : the question and the chosen choice's text an answer carries, or "bad" when either is not a string. Pure.
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
  "design-ended": designEndedOf,
  "design-noted": designNotedOf,
  pinged: (raw, at) => {
    const head = str(raw, "head");
    return head === BAD ? BAD : { at, kind: "pinged", head };
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

// one line of a record file, and where it starts in the file
type Line = { readonly text: string; readonly start: number };

// linesOf : the file's non-empty lines with their byte offsets. Pure.
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

// tornPath : the side file a torn last line is moved to, beside the ticket's record; not a .jsonl name, so `usage`
// never reads it as a ticket. Pure.
export function tornPath(recordFile: string): string {
  return `${recordFile}.torn`;
}

// setAside : move a torn last line to the side file and cut it from the record, so the next line appended starts on a
// line of its own. The cut is made only while the file is still the size it was read at. This assumes one dispatcher
// writes a ticket's file at a time (the pass lock, tick.ts): between the size check and the cut, an append from a
// second process could otherwise be lost. So only the pass that holds the lock asks for the cut (readRecords).
async function setAside(file: string, size: number, line: Line): Promise<Done> {
  try {
    await appendFile(tornPath(file), `${line.text}\n`, { mode: 0o600 });
    const handle = await open(file, "r+");
    try {
      const now = await handle.stat();
      if (now.size !== size) {
        return { kind: "failed", reason: `${file} grew while its torn last line was set aside` };
      }
      await handle.truncate(line.start);
      return { kind: "ok" };
    } finally {
      await handle.close();
    }
  } catch {
    return { kind: "failed", reason: `cannot set aside the torn last line of ${file}` };
  }
}

// how a reader treats a torn last line: the pass that holds the lock sets it aside; every other reader (usage, a
// command run by hand) skips it with a warning and writes nothing
export type ReadOptions = {
  readonly warn?: (line: string) => void;
  readonly setAside?: boolean;
};

// readRecords : every line of the ticket's file, oldest first; no file is no events. A bad line fails the read with
// its line number, since a count summed past it could let a run go on that should have stopped. The one exception is a
// torn last line (#483): a write cut short, which leaves the file without its closing newline and the line not JSON.
// It is read past with a warning, and the run it belonged to reads as one that never ended, so the table counts it as
// a failed try (or hands it to a person when it may have pushed), as for any run the dispatcher died during. With
// setAside (only the pass, which holds the lock) it is also moved to <ticket>.jsonl.torn and cut from the record.
export async function readRecords(where: Where, options: ReadOptions = {}): Promise<Result<readonly Event[]>> {
  const path = recordPath(where);
  if (path.kind === "failed") {
    return path;
  }
  const text = await recordText(path.value);
  return text.kind === "ok" ? eventsIn(path.value, text.value, options) : text;
}

// recordText : the record file's text; "" when there is none
async function recordText(path: string): Promise<Result<string>> {
  try {
    return { kind: "ok", value: await readFile(path, "utf8") };
  } catch (error) {
    return codeOf(error) === "ENOENT" ? { kind: "ok", value: "" } : { kind: "failed", reason: `cannot read ${path}` };
  }
}

// tornLine : the line at `index` when it is a write cut short: the last line, the file has no closing newline, and the
// line is not JSON; none for any other bad line. Pure.
function tornLine(text: string, lines: readonly Line[], index: number): Line | undefined {
  const line = index === lines.length - 1 && !text.endsWith("\n") ? lines[index] : undefined;
  return line !== undefined && parseLine(line.text) === undefined ? line : undefined;
}

function warnOf(options: ReadOptions): (line: string) => void {
  return options.warn ?? ((line) => process.stderr.write(`${line}\n`));
}

// tornRead : the events before a torn last line, with a warning; the line set aside when the caller holds the lock
async function tornRead(path: string, text: string, torn: Line, options: ReadOptions): Promise<Done> {
  const aside =
    options.setAside === true ? await setAside(path, Buffer.byteLength(text), torn) : { kind: "ok" as const };
  const where = options.setAside === true ? `it is moved to ${tornPath(path)}` : "it is skipped";
  if (aside.kind === "ok") {
    warnOf(options)(
      `warning: the last line of ${path} was torn (a write cut short); ${where}, and its run counts as one that never ended`,
    );
  }
  return aside;
}

// eventsIn : the events of a record file's text; a torn last line read past, any other bad line refused
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
      // when it ended (#444); none in a summary built by hand
      readonly at?: string;
    };

export type Summary = {
  // a run whose start has no end: the dispatcher died during it
  readonly interrupted:
    | { readonly kind: "none" }
    | { readonly kind: "interrupted"; readonly phase: Phase; readonly at: string };
  readonly lastWriter: LastWriter;
  // the implementer's patch before its last one, to catch the same patch twice; a cleanup run's is never one (#236)
  readonly previousPatch: string;
  // the implementer's last patch
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
        // a test check stopped it for a person (#231)
        readonly human: boolean;
        // the lane the diff needs (#230); none on a line older than the lane check
        readonly lane?: Lane;
        // the rows it ran: the last writer's when it ended (#444); none in a summary built by hand
        readonly evidence?: readonly Evidence[];
        // every program it let a row start with (#444); none on a line older than that
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
  // reviews with Act on findings, and local verifier runs that failed: each one's n for its backoff (#228)
  readonly reviewFailures: number;
  readonly verifyFailures: number;
  // when the writer may retry the step the newest check failed (#228)
  readonly nextTry: { readonly kind: "none" } | ({ readonly kind: "set" } & NextTry);
  readonly rebaseRuns: number;
  readonly pingedAt: string;
  // every reason the dispatcher already handed the ticket to a person for
  readonly blocked: readonly string[];
  // why the newest "held" line held the build, "" for none; and the passes since it on which the git host did not
  // answer for a blocker (#494)
  readonly heldWhy: string;
  readonly unreadPasses: number;
  // the git host's reason on the first of those passes, and when it was, so a person reads one stable reason per outage
  readonly unreadFirst: string;
  readonly unreadSince: string;
  // the time of the newest line, or "" for none
  readonly lastAt: string;
  // what the ticket's runs spent since the approval, for its cap (#131); an unmeasured run adds nothing
  readonly spent: Spend;
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
  blocked: [],
  heldWhy: "",
  unreadPasses: 0,
  unreadFirst: "",
  unreadSince: "",
  lastAt: "",
  spent: NO_SPEND,
};

// patches : the same-patch check's two patches after a writer run: a cleanup run leaves them as they were (#236)
function patches(
  s: Summary,
  e: Extract<Event, { kind: "writer-ended" }>,
): Pick<Summary, "previousPatch" | "implementerPatch"> {
  return e.mode === "cleanup"
    ? { previousPatch: s.previousPatch, implementerPatch: s.implementerPatch }
    : { previousPatch: s.implementerPatch, implementerPatch: e.patch };
}

function writerEnded(s: Summary, e: Extract<Event, { kind: "writer-ended" }>): Summary {
  const testFirst = e.mode === "test-first" && e.outcome === "done";
  return {
    ...s,
    interrupted: { kind: "none" },
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
    testFirstDone: s.testFirstDone || testFirst,
    rebaseRuns: s.rebaseRuns + Number(e.mode === "rebase"),
    ciRounds: s.ciRounds + Number(e.mode === "ci"),
    spent: addSpend(s.spent, e.spend ?? NO_SPEND),
  };
}

// nextTryView : the summary's nextTry from a check line. Pure.
function nextTryView(next: NextTry | undefined): Summary["nextTry"] {
  return next === undefined ? { kind: "none" } : { kind: "set", ...next };
}

type Steps = { readonly [K in Kind]: (s: Summary, e: EventMap[K]) => Summary };

const STEPS: Steps = {
  started: (s, e) => ({ ...s, interrupted: { kind: "interrupted", phase: e.phase, at: e.at } }),
  "writer-ended": writerEnded,
  "ready-ended": (s, e) => ({
    ...s,
    interrupted: { kind: "none" },
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
    lastReview: { kind: "ended", head: e.head, actOn: e.actOn },
    reviewRounds: s.reviewRounds + 1,
    reviewFailures: s.reviewFailures + Number(e.actOn > 0),
    nextTry: nextTryView(e.nextTry),
    spent: addSpend(s.spent, e.spend ?? NO_SPEND),
  }),
  "verify-ended": (s, e) => ({
    ...s,
    interrupted: { kind: "none" },
    lastVerify: { kind: "ended", head: e.head, passed: e.passed },
    verifyFailures: s.verifyFailures + Number(!e.passed),
    nextTry: nextTryView(e.nextTry),
  }),
  // a failed run's spend counts toward the ticket's cap; it ends nothing
  spent: (s, e) => ({ ...s, spent: addSpend(s.spent, e.spend) }),
  // a design review's run ends its start; what it spent counts toward the ticket's cap (#236)
  "design-ended": (s, e) => ({ ...s, interrupted: { kind: "none" }, spent: addSpend(s.spent, e.spend ?? NO_SPEND) }),
  // a note to a person counts nothing; design.ts reads it so the note is sent once
  "design-noted": (s) => s,
  pinged: (s, e) => ({ ...s, pingedAt: e.head }),
  blocked: (s, e) => ({ ...s, blocked: [...s.blocked, e.why] }),
  // a read that held the build again starts the count of passes the git host did not answer afresh
  held: (s, e) => ({ ...s, heldWhy: e.why, unreadPasses: 0, unreadFirst: "", unreadSince: "" }),
  "blockers-unread": (s, e) => ({
    ...s,
    unreadPasses: s.unreadPasses + 1,
    unreadFirst: s.unreadFirst === "" ? e.why : s.unreadFirst,
    unreadSince: s.unreadSince === "" ? e.at : s.unreadSince,
  }),
  // the copy counts nothing; tick reads it from every line, so a later START never posts it twice
  shared: (s) => s,
  answered: (s) => s,
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
