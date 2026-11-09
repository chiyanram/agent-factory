// caps — the limits on what runs may spend (#131; docs/DESIGN.md section 3 "Limits"; ADR-0012 S16). Each is a cap-class
// settings key, so the lowest layer wins, read through settings/machine.ts settingOf:
//
//   per run          caps.usdPerRun: claude --max-budget-usd on each model run (writer/settings.ts, review/settings.ts)
//   per ticket       caps.usdPerTicket, caps.tokensPerTicket: what the ticket's runs spent since its START or approval;
//                    at the cap the ticket goes to needs-human with the spend shown (table.ts)
//   per project-day  caps.usdPerProjectDay, caps.tokensPerProjectDay: what the project's runs spent today (UTC); at the
//                    cap no new run starts that day, and one notice goes out (tick.ts)
//   the share        caps.windowTokens, caps.machineWindowTokens: the factory's share of a subscription window, per
//                    project and for every project on this machine; the share is the stop line: at it, no new run
//                    starts until the window (window.hours) has room again, and one notice goes out
//
// Nothing is killed mid-run: a cap only keeps the next run from starting, so a run may end past it. On a subscription
// the CLI's dollar figure is notional, so the token caps are the ones that count there. A run with no spend recorded
// (stopped before its result) adds nothing.

import type { Result } from "../forge/api.js";
import { settingName, settingOf } from "../settings/machine.js";
import type { MachineId } from "../settings/keys.js";
import type { Spend } from "./spend.js";
import { periodsAt, totalOf, WINDOW_HOURS, type Spent } from "./usage.js";

// a cap left unset is no cap
export type Limit = number | "none";

export type Caps = {
  readonly ticket: { readonly usd: Limit; readonly tokens: Limit };
  readonly day: { readonly usd: Limit; readonly tokens: Limit };
  readonly window: { readonly tokens: Limit; readonly machineTokens: Limit };
  readonly windowHours: number;
};

export const NO_CAPS: Caps = {
  ticket: { usd: "none", tokens: "none" },
  day: { usd: "none", tokens: "none" },
  window: { tokens: "none", machineTokens: "none" },
  windowHours: WINDOW_HOURS,
};

type Read = { readonly id: MachineId; readonly whole: boolean };

// amountOf : a cap's text as a number above 0, whole when it counts tokens, or "bad". Pure.
function amountOf(raw: string, whole: boolean): number | "bad" {
  const n = raw.trim() === "" ? Number.NaN : Number(raw);
  const ok = whole ? Number.isSafeInteger(n) : Number.isFinite(n);
  return ok && n > 0 ? n : "bad";
}

function limitOf(env: NodeJS.ProcessEnv, read: Read): Result<Limit> {
  const raw = settingOf(env, read.id);
  if (raw === undefined) {
    return { kind: "ok", value: "none" };
  }
  const n = amountOf(raw, read.whole);
  return n !== "bad"
    ? { kind: "ok", value: n }
    : {
        kind: "failed",
        reason: `${settingName(read.id)} must be ${read.whole ? "a whole number of tokens" : "a dollar amount"} above 0`,
      };
}

function hoursOf(env: NodeJS.ProcessEnv): Result<number> {
  const raw = settingOf(env, "window.hours") ?? String(WINDOW_HOURS);
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 && n <= 24
    ? { kind: "ok", value: n }
    : { kind: "failed", reason: `${settingName("window.hours")} must be a whole number of hours from 1 to 24` };
}

// the six limits, in the order Caps holds them
const READS: readonly Read[] = [
  { id: "caps.usdPerTicket", whole: false },
  { id: "caps.tokensPerTicket", whole: true },
  { id: "caps.usdPerProjectDay", whole: false },
  { id: "caps.tokensPerProjectDay", whole: true },
  { id: "caps.windowTokens", whole: true },
  { id: "caps.machineWindowTokens", whole: true },
];

// capsFrom : the six limits, in READS order, as Caps. Pure.
function capsFrom(limits: readonly Limit[], windowHours: number): Caps {
  const at = (i: number): Limit => limits[i] ?? "none";
  return {
    ticket: { usd: at(0), tokens: at(1) },
    day: { usd: at(2), tokens: at(3) },
    window: { tokens: at(4), machineTokens: at(5) },
    windowHours,
  };
}

// capsOf : the caps from the resolved settings, each checked; a bad one refuses the pass
export function capsOf(env: NodeJS.ProcessEnv): Result<Caps> {
  const read = READS.map((r) => limitOf(env, r));
  const bad = read.find((r) => r.kind === "failed");
  if (bad?.kind === "failed") {
    return bad;
  }
  const hours = hoursOf(env);
  const limits = read.map((r) => (r.kind === "ok" ? r.value : "none"));
  return hours.kind === "ok" ? { kind: "ok", value: capsFrom(limits, hours.value) } : hours;
}

function reached(spent: number, limit: Limit): boolean {
  return limit !== "none" && spent >= limit;
}

// spentLine : a spend as a person reads it. Pure.
export function spentLine(spend: Spend): string {
  return `$${spend.usd.toFixed(2)} and ${spend.tokens} tokens`;
}

// ticketCapped : why the ticket is at its cap, with what it spent since its START or approval; "" while it is under
// both. Pure.
export function ticketCapped(spent: Spend, caps: Caps): string {
  const { usd, tokens } = caps.ticket;
  const over = reached(spent.usd, usd)
    ? `$${String(usd)} (${settingName("caps.usdPerTicket")})`
    : reached(spent.tokens, tokens)
      ? `${String(tokens)} tokens (${settingName("caps.tokensPerTicket")})`
      : "";
  return over === "" ? "" : `the ticket spent ${spentLine(spent)} since its approval, at its cap of ${over}`;
}

// Stop : whether a new run may start in this project now; a stop names why, and the period its one notice is for
export type Stop = { readonly kind: "go" } | { readonly kind: "stop"; readonly why: string; readonly notice: string };

function stopFor(input: {
  readonly what: string;
  readonly spend: Spend;
  readonly limits: readonly (readonly [Limit, "usd" | "tokens", MachineId])[];
  readonly notice: string;
}): Stop {
  const hit = input.limits.find(([limit, unit]) => reached(input.spend[unit], limit));
  if (hit === undefined) {
    return { kind: "go" };
  }
  const [limit, unit, id] = hit;
  const cap = unit === "usd" ? `$${String(limit)}` : `${String(limit)} tokens`;
  return {
    kind: "stop",
    why: `${input.what} spent ${spentLine(input.spend)}, at the cap of ${cap} (${settingName(id)})`,
    notice: input.notice,
  };
}

// projectStop : the first cap the project's runs, or every project's runs on this machine, have reached now (ms):
// today's, then the project's share of the window, then the machine's. Pure.
export function projectStop(input: {
  readonly project: readonly Spent[];
  readonly machine: readonly Spent[];
  readonly now: number;
  readonly caps: Caps;
}): Stop {
  const { caps } = input;
  const p = periodsAt(input.now, caps.windowHours);
  const today = new Date(p.day).toISOString().slice(0, 10);
  // one notice per day, and per window length of time
  const slot = `window ${Math.floor(input.now / (caps.windowHours * 3_600_000))}`;
  const stops = [
    stopFor({
      what: `today (${today}, UTC) the project`,
      spend: totalOf(input.project, p.day).spend,
      limits: [
        [caps.day.usd, "usd", "caps.usdPerProjectDay"],
        [caps.day.tokens, "tokens", "caps.tokensPerProjectDay"],
      ],
      notice: `day ${today}`,
    }),
    stopFor({
      what: `in the last ${caps.windowHours} h the project`,
      spend: totalOf(input.project, p.window).spend,
      limits: [[caps.window.tokens, "tokens", "caps.windowTokens"]],
      notice: slot,
    }),
    stopFor({
      what: `in the last ${caps.windowHours} h every project on this machine`,
      spend: totalOf(input.machine, p.window).spend,
      limits: [[caps.window.machineTokens, "tokens", "caps.machineWindowTokens"]],
      notice: slot,
    }),
  ];
  return stops.find((s) => s.kind === "stop") ?? { kind: "go" };
}
