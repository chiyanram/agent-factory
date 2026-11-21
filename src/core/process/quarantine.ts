// quarantine — a red check is a fail (#485; #456 decision 3): the factory never re-runs it on its own, and a red check
// goes back to the implementer as a CI round. Only a person quarantines a check, in the project's own settings layer,
// the project file, which no team file, user file, branch or rules pack can set (the rules pack ships knowledge only,
// K1):
//
//   <home>/projects/<project>.json
//   {"quarantine": {"checks": [{"check": "e2e-firefox", "owner": "ram", "added": "2026-11-11", "expires": "2026-11-25",
//                               "ticket": "#512"}],
//                   "maxDays": 14}}
//
// A quarantined check still runs, and still shows: the pass logs it, and the ping that the gate is green names each one
// with its expiry. It does not block: when every failed job at the head is quarantined and not expired, the gate reads
// as passed. An entry past its expiry day blocks again. Every field is required, and `expires` may be at most
// quarantine.maxDays after `added` (a cap: 14 by default, and a lower layer may only lower it), so a quarantine always
// names who owns it, when it began, until when, and the ticket that fixes it.
//
// Limit: an entry names a CI job, as the git host reports its failed jobs; the engine reads no test report, so it
// cannot quarantine one test inside a job. A job-wide entry also hides a new, real failure in that job until it
// expires, which is why the time cap is short.

import type { Result } from "../forge/api.js";
import { prop } from "../dispatch/records.js";
import { readProjectRaw } from "../project.js";

export const QUARANTINE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Quarantined = {
  readonly check: string;
  readonly owner: string;
  readonly added: string;
  readonly expires: string;
  readonly ticket: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function day(value: string): string {
  return DAY.test(value) && !Number.isNaN(Date.parse(value)) ? value : "";
}

function entryOf(raw: unknown): Quarantined | undefined {
  const q = {
    check: text(prop(raw, "check")),
    owner: text(prop(raw, "owner")),
    added: day(text(prop(raw, "added"))),
    expires: day(text(prop(raw, "expires"))),
    ticket: text(prop(raw, "ticket")),
  };
  return Object.values(q).every((v) => v !== "") ? q : undefined;
}

function tooLong(q: Quarantined, maxDays: number, now: number): string {
  if (Date.parse(q.added) > now) {
    return `the quarantine of ${q.check} is added on ${q.added}, a day still to come`;
  }
  const days = (Date.parse(q.expires) - Date.parse(q.added)) / DAY_MS;
  if (days < 0) {
    return `the quarantine of ${q.check} expires before it was added`;
  }
  return days > maxDays ? `the quarantine of ${q.check} lasts ${days} days; quarantine.maxDays allows ${maxDays}` : "";
}

export function quarantineOf(
  list: unknown,
  path: string,
  at: { readonly maxDays?: number; readonly now: number },
): Result<readonly Quarantined[]> {
  const maxDays = at.maxDays ?? QUARANTINE_DAYS;
  const read = Array.isArray(list) ? list.map(entryOf) : [undefined];
  const good = read.filter((q): q is Quarantined => q !== undefined);
  if (good.length !== read.length) {
    return {
      kind: "failed",
      reason: `${path}: "quarantine.checks" must list {"check", "owner", "added": "YYYY-MM-DD", "expires": "YYYY-MM-DD", "ticket"}, each set`,
    };
  }
  const long = good.map((q) => tooLong(q, maxDays, at.now)).filter((w) => w !== "");
  return long.length === 0 ? { kind: "ok", value: good } : { kind: "failed", reason: `${path}: ${long.join("; ")}` };
}

function maxDaysOf(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : QUARANTINE_DAYS;
}

export async function readQuarantine(input: {
  readonly home: string;
  readonly project: string;
  readonly now: number;
}): Promise<Result<readonly Quarantined[]>> {
  const raw = await readProjectRaw(input, "no quarantine");
  if (raw.kind !== "ok") {
    return raw.kind === "missing" ? { kind: "ok", value: [] } : raw;
  }
  const q = prop(raw.value, "quarantine");
  const checks = prop(q, "checks");
  return checks === undefined
    ? { kind: "ok", value: [] }
    : quarantineOf(checks, raw.path, { maxDays: maxDaysOf(prop(q, "maxDays")), now: input.now });
}

export function live(q: Quarantined, now: number): boolean {
  return now < Date.parse(`${q.expires}T00:00:00Z`) + 24 * 60 * 60 * 1000;
}

export type Held =
  | { readonly kind: "quarantined"; readonly shown: readonly Quarantined[] }
  | { readonly kind: "blocks" };

export function heldBy(failed: readonly string[], list: readonly Quarantined[], now: number): Held {
  const holding = list.filter((q) => live(q, now));
  const each = failed.map((name) => holding.find((q) => q.check === name));
  const shown = each.filter((q): q is Quarantined => q !== undefined);
  return failed.length > 0 && shown.length === failed.length ? { kind: "quarantined", shown } : { kind: "blocks" };
}

export function quarantineLine(shown: readonly Quarantined[]): string {
  const each = shown.map((q) => `${q.check} (owner ${q.owner}, until ${q.expires}, ${q.ticket})`);
  return `red, but quarantined by a person: ${each.join("; ")}; it does not block`;
}

export function quarantineItems(shown: readonly Quarantined[]): readonly string[] {
  return shown.map(
    (q) => `quarantined: ${q.check}, owner ${q.owner}, since ${q.added}, until ${q.expires}, ${q.ticket}`,
  );
}
