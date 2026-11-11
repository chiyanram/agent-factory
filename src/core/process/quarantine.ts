// quarantine — a red check is a fail (#485; #456 decision 3): the factory never re-runs it on its own, and a red check
// goes back to the implementer as a CI round. Only a person quarantines a check, in the project's process plugin, which
// a person changes by a pull request:
//
//   <plugin>/skills/<skill>/process/quarantine.json
//   {"quarantine": [{"check": "e2e-firefox", "owner": "ram", "expires": "2026-12-01", "ticket": "#512"}]}
//
// A quarantined check still runs, and still shows: the pass logs it and the ticket's status names it. It does not
// block: when every failed job at the head is quarantined and not expired, the gate reads as passed. An entry past its
// expiry day blocks again. Every field is required, so a quarantine always names who owns it, until when, and the
// ticket that fixes it. Pure.

import type { Result } from "../forge/api.js";
import { prop } from "../dispatch/records.js";

export type Quarantined = {
  // the job's name as the git host reports it
  readonly check: string;
  readonly owner: string;
  // the last day it holds, YYYY-MM-DD, in UTC
  readonly expires: string;
  // the ticket that fixes it: "#512", "owner/repo#512" or a tracker key
  readonly ticket: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// day : a YYYY-MM-DD that is a real day, or "". Pure.
function day(value: string): string {
  return DAY.test(value) && !Number.isNaN(Date.parse(value)) ? value : "";
}

function entryOf(raw: unknown): Quarantined | undefined {
  const q = {
    check: text(prop(raw, "check")),
    owner: text(prop(raw, "owner")),
    expires: day(text(prop(raw, "expires"))),
    ticket: text(prop(raw, "ticket")),
  };
  return Object.values(q).every((v) => v !== "") ? q : undefined;
}

// quarantineOf : the file's entries; refused when one is not {"check", "owner", "expires": "YYYY-MM-DD", "ticket"}
export function quarantineOf(raw: unknown, path: string): Result<readonly Quarantined[]> {
  const list = prop(raw, "quarantine");
  const read = Array.isArray(list) ? list.map(entryOf) : [undefined];
  const good = read.filter((q): q is Quarantined => q !== undefined);
  return good.length === read.length
    ? { kind: "ok", value: good }
    : {
        kind: "failed",
        reason: `${path}: "quarantine" must list {"check", "owner", "expires": "YYYY-MM-DD", "ticket"}, each set`,
      };
}

// live : whether an entry still holds at this time: through the end of its expiry day, UTC
export function live(q: Quarantined, now: number): boolean {
  return now < Date.parse(`${q.expires}T00:00:00Z`) + 24 * 60 * 60 * 1000;
}

export type Held =
  // every failed job is quarantined: the gate reads as passed, and these are shown
  | { readonly kind: "quarantined"; readonly shown: readonly Quarantined[] }
  // at least one failed job blocks
  | { readonly kind: "blocks" };

// heldBy : what the failed jobs at a head mean with the quarantine in force; none failed blocks, since the git host
// said red and named nothing a person put aside
export function heldBy(failed: readonly string[], list: readonly Quarantined[], now: number): Held {
  const holding = list.filter((q) => live(q, now));
  const each = failed.map((name) => holding.find((q) => q.check === name));
  const shown = each.filter((q): q is Quarantined => q !== undefined);
  return failed.length > 0 && shown.length === failed.length ? { kind: "quarantined", shown } : { kind: "blocks" };
}

// quarantineLine : the quarantined checks as a person reads them in the log and the status. Pure.
export function quarantineLine(shown: readonly Quarantined[]): string {
  const each = shown.map((q) => `${q.check} (owner ${q.owner}, until ${q.expires}, ${q.ticket})`);
  return `red, but quarantined by a person: ${each.join("; ")}; it does not block`;
}
