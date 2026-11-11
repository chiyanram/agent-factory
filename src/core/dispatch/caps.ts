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
//   runs at once     caps.liveRuns: the most runs one dispatch pass starts (default 1), one after another, each only
//                    while the caps above still allow it; the review step also refuses a machine at this many live runs
//   run hours        runHours: the hours, in UTC, in which a pass may start a run (hours.ts); outside them none starts
//
// A review round starts several model runs: a finder per lens, at most review.maxFinders at once, and its verify passes
// (#237). It counts as one run against runs at once. Before it starts, its worst case, every finder it can pick and
// its verify passes each at caps.usdPerRun, must fit in the dollars left under the ticket's and the day's caps, or it
// is held (overCaps). The window caps count tokens, which no per-run cap bounds, so they hold the next run only; with
// no caps.usdPerRun the worst case is unbounded and only the caps above apply.
//
// Nothing is killed mid-run: a cap only keeps the next run from starting, so a run may end past it. On a subscription
// the CLI's dollar figure is notional, so the token caps are the ones that count there. A run with no spend recorded
// (stopped before its result) adds nothing.

import type { Result } from "../forge/api.js";
import { settingName, settingOf } from "../settings/machine.js";
import type { MachineId } from "../settings/keys.js";
import type { Spend } from "./spend.js";
import { HOURS_HINT, hoursOf, type RunHours } from "./hours.js";
import { reached, spentLine } from "./ticket-cap.js";
import { periodsAt, totalOf, WINDOW_HOURS, type Spent } from "./usage.js";

// a cap left unset is no cap
export type Limit = number | "none";

export type Caps = {
  readonly ticket: { readonly usd: Limit; readonly tokens: Limit };
  readonly day: { readonly usd: Limit; readonly tokens: Limit };
  readonly window: { readonly tokens: Limit; readonly machineTokens: Limit };
  readonly windowHours: number;
  // runs at once: the most runs one pass starts
  readonly runsAtOnce: number;
  // the hours a pass may start a run in; "any" when no layer sets them
  readonly runHours: RunHours | "any";
};

// runs at once when no layer sets it (ADR-0012 S16)
export const RUNS_AT_ONCE = 1;

export const NO_CAPS: Caps = {
  ticket: { usd: "none", tokens: "none" },
  day: { usd: "none", tokens: "none" },
  window: { tokens: "none", machineTokens: "none" },
  windowHours: WINDOW_HOURS,
  runsAtOnce: RUNS_AT_ONCE,
  runHours: "any",
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

function hoursOfWindow(env: NodeJS.ProcessEnv): Result<number> {
  const raw = settingOf(env, "window.hours") ?? String(WINDOW_HOURS);
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 && n <= 24
    ? { kind: "ok", value: n }
    : { kind: "failed", reason: `${settingName("window.hours")} must be a whole number of hours from 1 to 24` };
}

// runsAtOnceOf : runs at once, a whole number from 1
export function runsAtOnceOf(env: NodeJS.ProcessEnv): Result<number> {
  const raw = settingOf(env, "caps.liveRuns") ?? String(RUNS_AT_ONCE);
  return /^[1-9]\d{0,2}$/.test(raw)
    ? { kind: "ok", value: Number(raw) }
    : {
        kind: "failed",
        reason: `${settingName("caps.liveRuns")} must be a whole number from 1, got ${JSON.stringify(raw)}`,
      };
}

function runHoursOf(env: NodeJS.ProcessEnv): Result<RunHours | "any"> {
  const raw = settingOf(env, "runHours");
  const hours = raw === undefined ? "any" : hoursOf(raw);
  return hours !== "bad"
    ? { kind: "ok", value: hours }
    : { kind: "failed", reason: `${settingName("runHours")} must be ${HOURS_HINT}, got ${JSON.stringify(raw)}` };
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

type Runs = { readonly windowHours: number; readonly runsAtOnce: number; readonly runHours: RunHours | "any" };

// capsFrom : the six limits, in READS order, and the runs' limits, as Caps. Pure.
function capsFrom(limits: readonly Limit[], runs: Runs): Caps {
  const at = (i: number): Limit => limits[i] ?? "none";
  return {
    ticket: { usd: at(0), tokens: at(1) },
    day: { usd: at(2), tokens: at(3) },
    window: { tokens: at(4), machineTokens: at(5) },
    ...runs,
  };
}

function runsOf(env: NodeJS.ProcessEnv): Result<Runs> {
  const windowHours = hoursOfWindow(env);
  const runsAtOnce = runsAtOnceOf(env);
  const runHours = runHoursOf(env);
  if (windowHours.kind === "failed") {
    return windowHours;
  }
  if (runsAtOnce.kind === "failed") {
    return runsAtOnce;
  }
  return runHours.kind === "ok"
    ? { kind: "ok", value: { windowHours: windowHours.value, runsAtOnce: runsAtOnce.value, runHours: runHours.value } }
    : runHours;
}

// capsOf : the caps from the resolved settings, each checked; a bad one refuses the pass
export function capsOf(env: NodeJS.ProcessEnv): Result<Caps> {
  const read = READS.map((r) => limitOf(env, r));
  const bad = read.find((r) => r.kind === "failed");
  if (bad?.kind === "failed") {
    return bad;
  }
  const runs = runsOf(env);
  const limits = read.map((r) => (r.kind === "ok" ? r.value : "none"));
  return runs.kind === "ok" ? { kind: "ok", value: capsFrom(limits, runs.value) } : runs;
}

// reached, spentLine and ticketCapped live in ticket-cap.ts, which the decision table reads: it reaches no disk (P1)
export { spentLine, ticketCapped } from "./ticket-cap.js";

// Stop : whether a new run may start in this project now; a stop names why, the period its one notice is for, which
// cap it is (the day's or the window's), and the first time (ms) a run may start again
export type Stop =
  | { readonly kind: "go" }
  | {
      readonly kind: "stop";
      readonly why: string;
      readonly notice: string;
      readonly period: "day" | "window";
      readonly until: number;
    };

function stopFor(input: {
  readonly what: string;
  readonly spend: Spend;
  readonly limits: readonly (readonly [Limit, "usd" | "tokens", MachineId])[];
  readonly notice: string;
  readonly period: "day" | "window";
  readonly until: (limit: number, unit: "usd" | "tokens") => number;
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
    period: input.period,
    until: input.until(limit === "none" ? 0 : limit, unit),
  };
}

// roomAt : when a window of these hours, over these runs, next holds less than the limit: the oldest runs leave it one
// by one, and the window has room once the one that brings it under the limit has left. Pure.
export function roomAt(input: {
  readonly runs: readonly Spent[];
  readonly from: number;
  readonly hours: number;
  readonly limit: number;
  readonly unit: "usd" | "tokens";
}): number {
  const inside = input.runs
    .filter((r) => Date.parse(r.at) >= input.from && r.spend !== "unmeasured")
    .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let left = inside.reduce((sum, r) => sum + (r.spend === "unmeasured" ? 0 : r.spend[input.unit]), 0);
  for (const r of inside) {
    left -= r.spend === "unmeasured" ? 0 : r.spend[input.unit];
    if (left < input.limit) {
      return Date.parse(r.at) + input.hours * 3_600_000;
    }
  }
  return input.from + input.hours * 3_600_000;
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
      period: "day",
      until: () => p.day + 86_400_000,
    }),
    stopFor({
      what: `in the last ${caps.windowHours} h the project`,
      spend: totalOf(input.project, p.window).spend,
      limits: [[caps.window.tokens, "tokens", "caps.windowTokens"]],
      notice: slot,
      period: "window",
      until: (limit, unit) => roomAt({ runs: input.project, from: p.window, hours: caps.windowHours, limit, unit }),
    }),
    stopFor({
      what: `in the last ${caps.windowHours} h every project on this machine`,
      spend: totalOf(input.machine, p.window).spend,
      limits: [[caps.window.machineTokens, "tokens", "caps.machineWindowTokens"]],
      notice: slot,
      period: "window",
      until: (limit, unit) => roomAt({ runs: input.machine, from: p.window, hours: caps.windowHours, limit, unit }),
    }),
  ];
  return stops.find((s) => s.kind === "stop") ?? { kind: "go" };
}

// hhmm : a time as HH:MM UTC. Pure.
function hhmm(at: number): string {
  return `${new Date(at).toISOString().slice(11, 16)} UTC`;
}

// heldWords : why a cap holds the project's runs, and when to start the orchestrator loop again (#305). Pure.
export function heldWords(stop: Extract<Stop, { kind: "stop" }>, project: string): string {
  const again = `run \`agent-factory dispatch ${project}\` again`;
  return stop.period === "day"
    ? `the project-day cap is reached: ${stop.why}; ${again} tomorrow`
    : `the window is full until ${hhmm(stop.until)}: ${stop.why}; ${again} then`;
}

// overCaps : why a run whose worst case is `worst` dollars could pass the ticket's or the day's dollar cap, given what
// each has spent; "" when it fits, or when the worst case is unbounded. Pure.
export function overCaps(input: {
  readonly worst: number | "unbounded";
  readonly ticket: Spend;
  readonly day: Spend;
  readonly caps: Caps;
}): string {
  const { worst, caps } = input;
  if (worst === "unbounded") {
    return "";
  }
  const left: readonly (readonly [Limit, number, MachineId])[] = [
    [caps.ticket.usd, input.ticket.usd, "caps.usdPerTicket"],
    [caps.day.usd, input.day.usd, "caps.usdPerProjectDay"],
  ];
  const over = left.find(([limit, spent]) => limit !== "none" && spent + worst > limit);
  if (over === undefined) {
    return "";
  }
  const [limit, spent, id] = over;
  const room = Math.max(0, Number(limit) - spent);
  return `the review could spend up to $${worst.toFixed(2)} (every finder it can pick and its verify passes, each at ${settingName("caps.usdPerRun")}), more than the $${room.toFixed(2)} left under ${settingName(id)}`;
}
