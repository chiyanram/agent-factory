// usage-limit — a provider's usage limit, read from what the agent CLI printed when it refused (#707; AO
// b5f4911 backend/internal/domain/usage_limit.go and adapters/chatdriver/acp/client.go). Pure.
//
// A limit is read only from the CLI's own refusal: the text of its last result event that is an error, or the first
// line of its stderr when there is no result event, must start with one of the refusals Claude Code prints or match
// the general wording. The model's own words never count, so a run that writes about limits is never parked.
//
// The reset time, in this order:
//   1 the stream's rate_limit_event lines: the latest window the provider rejected with no overage in use, its
//     resetsAt in epoch seconds, within 31 days; a later "allowed" for the same window clears it. An epoch time has no
//     time zone to misread
//   2 the refusal's text: an ISO time after "resets"; or a clock time ("resets 3pm (Europe/London)", "resets tomorrow
//     9am (UTC)") only when it names UTC or an IANA zone, anchored to when the run ended, never to now, so reading the
//     record again cannot move it; a clock time daylight saving skips or repeats is not guessed
//   3 else "unknown", which goes to a person
// **Today:** only the Claude writer reads a limit. Copilot has no writer kind yet (#698) and its refusal text is not
// known (#689 item 5); the read-only runs read none until #708.

import { atWall, wallAt, type Zone } from "../zone.js";

export type UsageLimit =
  | { readonly kind: "none" }
  // until: the reset, ISO 8601 UTC to the second, or "unknown"; said: the refusal as the CLI printed it
  | { readonly kind: "limited"; readonly until: string; readonly said: string };

export const NO_LIMIT: UsageLimit = { kind: "none" };

// each rejected window the stream named, by its kind: its reset in ms since the epoch, 0 when it gave none to use
export type Windows = Readonly<Record<string, number>>;

export const NO_WINDOWS: Windows = {};

// the refusals Claude Code prints (AO usage_limit.go:20-33)
const CLAUDE_REFUSALS = [
  "You've hit your",
  "You've reached your",
  "You're out of usage credits",
  "Your org is out of usage · add funds to continue",
  "Your org is out of usage · contact your admin",
  "Your seat type doesn't include usage credits",
  "Your seat type doesn't include usage",
  "Your usage allocation has been disabled by your admin",
  "Your group's usage limit is set to $0",
  "Fable 5 requires usage credits",
  "You're out of extra usage",
  "Your seat type doesn't include extra usage",
];

const GENERAL =
  /^(?:usage limit (?:reached|exceeded)\b|(?:session|weekly|daily) usage limit (?:reached|exceeded)\b|the Claude account has no available quota\b)/i;
const RESET_CLOCK = /\bresets?(?:\s+at)?\s+(?:(tomorrow)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i;
const RESET_ISO = /\bresets?(?:\s+at)?\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2}))/i;

// the longest wait a rate-limit event may name before it is read as no time (AO client.go:1432)
const MOST_WAIT_MS = 31 * 86_400_000;
const DAY_MS = 86_400_000;

// prop : a field of a parsed JSON value, undefined for anything that has none
function prop(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? (Reflect.get(value, name) as unknown) : undefined;
}

// isoSeconds : ms since the epoch as ISO 8601 UTC to the second
function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// overage : the window's overflow is paid for, so nothing is refused (AO client.go:1443-1447)
function overage(info: unknown): boolean {
  const status = prop(info, "overageStatus");
  return (
    status === "allowed" ||
    status === "allowed_warning" ||
    prop(info, "isUsingOverage") === true ||
    prop(info, "overageInUse") === true
  );
}

const ALLOWED: ReadonlySet<unknown> = new Set(["allowed", "allowed_warning"]);

// kindOf : the window a rate-limit event names
function kindOf(info: unknown): string {
  const kind = prop(info, "rateLimitType");
  return typeof kind === "string" ? kind : "unknown";
}

// resetOf : a rejected window's reset in ms since the epoch, 0 when it names none to use
function resetOf(info: unknown): number {
  const seconds = prop(info, "resetsAt");
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) * 1000 : 0;
}

// cleared : the windows without one
function cleared(windows: Windows, kind: string): Windows {
  const { [kind]: _cleared, ...rest } = windows;
  return rest;
}

// windowAfter : the windows after one rate-limit event's info: an allowed or paid-for window clears, a rejected one
// keeps its reset
function windowAfter(windows: Windows, info: unknown): Windows {
  const status = prop(info, "status");
  if (overage(info) || ALLOWED.has(status)) {
    return cleared(windows, kindOf(info));
  }
  return status === "rejected" ? { ...windows, [kindOf(info)]: resetOf(info) } : windows;
}

// windowsOf : the windows after one more stream event (AO client.go:1434-1465)
export function windowsOf(windows: Windows, event: unknown): Windows {
  return prop(event, "type") === "rate_limit_event" ? windowAfter(windows, prop(event, "rate_limit_info")) : windows;
}

// windowReset : the latest reset of the windows still rejected when the run ended; "none" when any has no time to use
function windowReset(windows: Windows, endedAt: number): number | "none" {
  const open = Object.values(windows).filter((reset) => reset === 0 || reset > endedAt);
  if (open.length === 0 || open.some((reset) => reset === 0 || reset - endedAt > MOST_WAIT_MS)) {
    return "none";
  }
  return Math.max(...open);
}

// refusal : the CLI's own refusal text, "" when what it printed is none it is known to print
export function refusal(text: string): string {
  const said = text.trim().replaceAll("’", "'");
  return GENERAL.test(said) || CLAUDE_REFUSALS.some((p) => said.startsWith(p)) ? said : "";
}

// zoneNamed : the zone a refusal names, when it is UTC or an IANA name the runtime knows
function zoneNamed(name: string): Zone | undefined {
  if (name !== "UTC" && !name.includes("/")) {
    return undefined;
  }
  try {
    return { name: new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone };
  } catch {
    return undefined;
  }
}

// dayAfter : the calendar day after a wall's day
function dayAfter(wall: { readonly year: number; readonly month: number; readonly day: number }): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
} {
  const next = new Date(Date.UTC(wall.year, wall.month - 1, wall.day) + DAY_MS);
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

type Clock = { readonly zone: Zone; readonly hour: number; readonly minute: number; readonly tomorrow: boolean };

// validClock : a 12-hour clock time. Pure.
function validClock(hour12: number, minute: number): boolean {
  return hour12 >= 1 && hour12 <= 12 && minute <= 59;
}

// clockOf : the clock time a refusal names, on a 24-hour clock, in its zone; none for one it cannot read
function clockOf(match: RegExpExecArray): Clock | undefined {
  const zone = zoneNamed(String(match[5]).trim());
  const hour12 = Number(match[2]);
  const minute = Number(match[3] ?? "0");
  if (zone === undefined || !validClock(hour12, minute)) {
    return undefined;
  }
  const pm = String(match[4]).toLowerCase() === "pm" ? 12 : 0;
  return { zone, hour: (hour12 % 12) + pm, minute, tomorrow: match[1] !== undefined };
}

// momentOf : a wall time's one moment, or "none" when daylight saving skips or repeats it
function momentOf(at: number | "skipped" | "repeated"): number | "none" {
  return typeof at === "number" ? at : "none";
}

// clockReset : a clock time in a named zone, on the day the run ended there, or the next day when "tomorrow" or when
// that time had passed; "none" for anything it cannot place once (AO usage_limit.go:57-93)
function clockReset(match: RegExpExecArray, endedAt: number): number | "none" {
  const clock = clockOf(match);
  if (clock === undefined) {
    return "none";
  }
  const { zone, hour, minute } = clock;
  const today = wallAt(endedAt, zone);
  const next = (): number | "none" => momentOf(atWall({ ...dayAfter(today), hour, minute }, zone));
  if (clock.tomorrow) {
    return next();
  }
  const first = atWall({ ...today, hour, minute }, zone);
  if (typeof first !== "number") {
    return "none";
  }
  return first > endedAt ? first : next();
}

// textReset : the reset a refusal's text names (AO usage_limit.go:50-93)
function textReset(said: string, endedAt: number): number | "none" {
  const iso = RESET_ISO.exec(said);
  if (iso !== null) {
    const ms = Date.parse(iso[1] ?? "");
    return Number.isNaN(ms) ? "none" : ms;
  }
  const clock = RESET_CLOCK.exec(said);
  return clock === null ? "none" : clockReset(clock, endedAt);
}

// Printed : what a run printed, as far as a limit is read from it: its last result event (undefined for none), its
// stderr, its stream's windows, and when it ended, in ms since the epoch
export type Printed = {
  readonly result: unknown;
  readonly stderr: string;
  readonly windows: Windows;
  readonly endedAt: number;
};

// printedText : what the CLI said when it stopped: its last result event's text when that is an error, or its stderr's
// first line when it printed no result event
function printedText(input: Printed): string {
  if (input.result === undefined) {
    return input.stderr.trim().split("\n")[0] ?? "";
  }
  const text = prop(input.result, "result");
  return prop(input.result, "is_error") === true && typeof text === "string" ? text : "";
}

// resetFrom : the reset from the stream's windows, else from the refusal's text
function resetFrom(input: Printed, said: string): number | "none" {
  const fromEvent = windowReset(input.windows, input.endedAt);
  return fromEvent === "none" ? textReset(said, input.endedAt) : fromEvent;
}

// claudeLimit : the limit a Claude run hit, from what it printed
export function claudeLimit(input: Printed): UsageLimit {
  const said = refusal(printedText(input));
  if (said === "") {
    return NO_LIMIT;
  }
  const reset = resetFrom(input, said);
  return { kind: "limited", until: reset === "none" ? "unknown" : isoSeconds(reset), said };
}

function parsed(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

// claudeUsageLimit : the limit a Claude run hit, from its whole stream-json stdout and its stderr
export function claudeUsageLimit(stdout: string, stderr: string, endedAt: number): UsageLimit {
  const events = stdout.split("\n").map(parsed);
  const windows = events.reduce<Windows>(windowsOf, NO_WINDOWS);
  const result = events.findLast((e) => prop(e, "type") === "result");
  return claudeLimit({ result, stderr, windows, endedAt });
}
