// parse-checks — reads the lines a check writes (event-parse.ts): "ready-ended", "verify-ended" and "review-ended",
// with the review's acted-on findings, lenses and found counts, and the "timeline" line the merge writes from them.

import type { Lane } from "../spec.js";
import { RUN_KINDS, type RunKind, type Spend } from "./spend.js";
import { isActedRow, type Acted, type FoundByRule } from "../review/acted-on.js";
import { BUCKETS } from "../finding.js";
import type { Rescue } from "./timeline.js";
import { prop } from "../field.js";
import type { NextTry, Event } from "./event.js";
import {
  BAD,
  type Bad,
  str,
  runsIn,
  onlyReason,
  spendField,
  spendIn,
  splitField,
  tracesField,
  nextTryField,
  whyOf,
  laneField,
  entriesOf,
  isCount,
  recordOf,
  isPlain,
} from "./parse-fields.js";

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

function readyEnd(raw: unknown): { readonly why: string; readonly reason: "done" } | Bad {
  const why = whyOf(raw);
  const reason = onlyReason(raw, "done");
  return why === BAD || reason === BAD ? BAD : { why, ...reason };
}

export function readyEndedOf(raw: unknown, at: string): Event | Bad {
  const head = str(raw, "head");
  const passed = prop(raw, "passed");
  const end = readyEnd(raw);
  const extras = readyExtras(raw);
  if (head === BAD || end === BAD || extras === BAD) {
    return BAD;
  }
  return typeof passed === "boolean" ? { at, kind: "ready-ended", head, passed, ...end, ...extras } : BAD;
}

export function verifyEndedOf(raw: unknown, at: string): Event | Bad {
  const head = str(raw, "head");
  const passed = prop(raw, "passed");
  const next = nextTryField(raw);
  const reason = onlyReason(raw, "done");
  return head === BAD || next === BAD || reason === BAD || typeof passed !== "boolean"
    ? BAD
    : { at, kind: "verify-ended", head, passed, ...next, ...reason };
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

function skillsMissingField(raw: unknown): { readonly skillsMissing?: readonly string[] } | Bad {
  const names = prop(raw, "skillsMissing");
  if (names === undefined) {
    return {};
  }
  return Array.isArray(names) && names.length > 0 && names.every((n) => typeof n === "string" && n !== "")
    ? { skillsMissing: names }
    : BAD;
}

const FOUND_BUCKETS: ReadonlySet<string> = new Set(BUCKETS);

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

export function timelineParts(
  raw: unknown,
): Omit<Extract<Event, { kind: "timeline" }>, "at" | "kind" | "number"> | Bad {
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

export function reviewEndedOf(raw: unknown, at: string): Event | Bad {
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
    skillsMissingField(raw),
    tracesField(raw),
  ];
  const good = extras.flatMap((e) => (e === BAD ? [] : [e]));
  const reason = onlyReason(raw, "done");
  return head === BAD || reason === BAD || good.length < extras.length || !Number.isSafeInteger(actOn)
    ? BAD
    : {
        at,
        kind: "review-ended",
        head,
        actOn: Number(actOn),
        ...Object.assign({}, ...good),
        ...runsIn(raw),
        ...reason,
      };
}
