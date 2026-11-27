// parse-runs — reads the lines a model run writes (event-parse.ts): "started", a writer's "ended", "spent", "parked"
// and "setup-refused", and the writer's optional extras (spend, card, deferred, approach, open, stale, why) that a
// design line shares.

import type { Evidence } from "../report.js";
import type { PluginHash } from "../process/use.js";
import type { Spend } from "./spend.js";
import { prop } from "../field.js";
import { agrees, WRITER_REASONS, type EndReason, type WriterEnd } from "../end-reason.js";
import { asksOf, type Asks } from "../agent/ran.js";
import type { ParkedTask, Event } from "./event.js";
import {
  BAD,
  type Bad,
  str,
  oneOf,
  PHASES,
  MODES,
  OUTCOMES,
  runsIn,
  reasonOr,
  onlyReason,
  spendField,
  copilotField,
  spendIn,
  splitField,
  tracesField,
  textsOf,
  textOf,
} from "./parse-fields.js";

export function startedOf(raw: unknown, at: string): Event | Bad {
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

function writerEndOf(raw: unknown): WriterEnd | Bad {
  const outcome = oneOf(raw, "outcome", OUTCOMES);
  if (outcome === BAD) {
    return BAD;
  }
  const reason = reasonOr(raw, outcome === "blocked" ? "unknown" : outcome);
  if (reason === BAD) {
    return BAD;
  }
  const end = { outcome, reason };
  return agrees(WRITER_REASONS, end) ? end : BAD;
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

function spentEnd(raw: unknown): { readonly spend?: Spend; readonly reason: EndReason } | Bad {
  const spend = measuredField(raw);
  const reason = reasonOr(raw, "unknown");
  return spend === BAD || reason === BAD ? BAD : { ...spend, reason };
}

export function spentOf(raw: unknown, at: string): Event | Bad {
  const phase = oneOf(raw, "phase", PHASES);
  const head = str(raw, "head");
  const end = spentEnd(raw);
  if (phase === BAD || head === BAD) {
    return BAD;
  }
  const extras = spentExtras(raw);
  return end === BAD || extras === BAD ? BAD : { at, kind: "spent", phase, head, ...end, ...extras, ...runsIn(raw) };
}

function measuredField(raw: unknown): { readonly spend?: Spend } | Bad {
  const spend = prop(raw, "spend");
  if (spend === undefined) {
    return {};
  }
  const read = spendIn(spend);
  return read === BAD ? BAD : { spend: read };
}

export function setupRefusedOf(raw: unknown, at: string): Event | Bad {
  const phase = oneOf(raw, "phase", PHASES);
  const why = str(raw, "why");
  return phase === BAD || why === BAD ? BAD : { at, kind: "setup-refused", phase, why };
}

function spentExtras(raw: unknown): Pick<Extract<Event, { kind: "spent" }>, "split" | "traces" | "copilot"> | Bad {
  const split = splitField(raw);
  const traces = tracesField(raw);
  const copilot = copilotField(raw);
  return split === BAD || traces === BAD || copilot === BAD ? BAD : { ...split, ...traces, ...copilot };
}

function cardField(raw: unknown): { readonly card?: string } | Bad {
  const card = prop(raw, "card");
  if (card === undefined) {
    return {};
  }
  return typeof card === "string" && /^[0-9a-f]{64}$/.test(card) ? { card } : BAD;
}

type Left = { readonly deferred?: readonly string[]; readonly approach?: string; readonly open?: readonly string[] };

function leftFields(raw: unknown): Left | Bad {
  const deferred = textsOf(raw, "deferred");
  const approach = textOf(raw, "approach");
  const opened = textsOf(raw, "open");
  return deferred === BAD || approach === BAD || opened === BAD ? BAD : leftOf(deferred, approach, opened);
}

function leftOf(
  deferred: readonly string[] | undefined,
  approach: string | undefined,
  opened: readonly string[] | undefined,
): Left {
  return {
    ...(deferred === undefined ? {} : { deferred }),
    ...(approach === undefined ? {} : { approach }),
    ...(opened === undefined ? {} : { open: opened }),
  };
}

function staleField(raw: unknown): { readonly stale?: readonly string[] } | Bad {
  const stale = prop(raw, "stale");
  if (stale === undefined) {
    return {};
  }
  return Array.isArray(stale) && stale.every((s) => typeof s === "string") ? { stale } : BAD;
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

export function writerExtras(
  raw: unknown,
):
  | Pick<
      Extract<Event, { kind: "writer-ended" }>,
      "spend" | "copilot" | "card" | "deferred" | "approach" | "open" | "stale" | "why" | "output" | "trace"
    >
  | Bad {
  const spend = spendField(raw);
  const card = cardField(raw);
  const deferred = leftFields(raw);
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

export function parkedOf(raw: unknown, at: string): Event | Bad {
  const parts = parkedParts(raw);
  const extras = parkedExtras(raw);
  const reason = onlyReason(raw, "usage_limit");
  return parts === BAD || extras === BAD || reason === BAD
    ? BAD
    : { at, kind: "parked", ...parts, ...extras, ...runsIn(raw), ...reason };
}

export function writerEndedOf(raw: unknown, at: string): Event | Bad {
  const mode = oneOf(raw, "mode", MODES);
  const end = writerEndOf(raw);
  const parts = writerParts(raw);
  const extras = writerExtras(raw);
  return mode === BAD || end === BAD || parts === BAD || extras === BAD
    ? BAD
    : { at, kind: "writer-ended", mode, ...end, ...parts, ...extras, ...runsIn(raw) };
}
