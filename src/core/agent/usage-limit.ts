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
  | { readonly kind: "limited"; readonly until: string; readonly said: string };

export const NO_LIMIT: UsageLimit = { kind: "none" };

export type Windows = Readonly<Record<string, number>>;

export const NO_WINDOWS: Windows = {};

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

const MOST_WAIT_MS = 31 * 86_400_000;
const DAY_MS = 86_400_000;

function prop(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? (Reflect.get(value, name) as unknown) : undefined;
}

function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

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

function kindOf(info: unknown): string {
  const kind = prop(info, "rateLimitType");
  return typeof kind === "string" ? kind : "unknown";
}

function resetOf(info: unknown): number {
  const seconds = prop(info, "resetsAt");
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) * 1000 : 0;
}

function cleared(windows: Windows, kind: string): Windows {
  const { [kind]: _cleared, ...rest } = windows;
  return rest;
}

function windowAfter(windows: Windows, info: unknown): Windows {
  const status = prop(info, "status");
  if (overage(info) || ALLOWED.has(status)) {
    return cleared(windows, kindOf(info));
  }
  return status === "rejected" ? { ...windows, [kindOf(info)]: resetOf(info) } : windows;
}

export function windowsOf(windows: Windows, event: unknown): Windows {
  return prop(event, "type") === "rate_limit_event" ? windowAfter(windows, prop(event, "rate_limit_info")) : windows;
}

function windowReset(windows: Windows, endedAt: number): number | "none" {
  const open = Object.values(windows).filter((reset) => reset === 0 || reset > endedAt);
  if (open.length === 0 || open.some((reset) => reset === 0 || reset - endedAt > MOST_WAIT_MS)) {
    return "none";
  }
  return Math.max(...open);
}

export function refusal(text: string): string {
  const said = text.trim().replaceAll("’", "'");
  return GENERAL.test(said) || CLAUDE_REFUSALS.some((p) => said.startsWith(p)) ? said : "";
}

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

function dayAfter(wall: { readonly year: number; readonly month: number; readonly day: number }): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
} {
  const next = new Date(Date.UTC(wall.year, wall.month - 1, wall.day) + DAY_MS);
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

type Clock = { readonly zone: Zone; readonly hour: number; readonly minute: number; readonly tomorrow: boolean };

function validClock(hour12: number, minute: number): boolean {
  return hour12 >= 1 && hour12 <= 12 && minute <= 59;
}

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

function momentOf(at: number | "skipped" | "repeated"): number | "none" {
  return typeof at === "number" ? at : "none";
}

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

function textReset(said: string, endedAt: number): number | "none" {
  const iso = RESET_ISO.exec(said);
  if (iso !== null) {
    const ms = Date.parse(iso[1] ?? "");
    return Number.isNaN(ms) ? "none" : ms;
  }
  const clock = RESET_CLOCK.exec(said);
  return clock === null ? "none" : clockReset(clock, endedAt);
}

export type Printed = {
  readonly result: unknown;
  readonly stderr: string;
  readonly windows: Windows;
  readonly endedAt: number;
};

function printedText(input: Printed): string {
  if (input.result === undefined) {
    return input.stderr.trim().split("\n")[0] ?? "";
  }
  const text = prop(input.result, "result");
  return prop(input.result, "is_error") === true && typeof text === "string" ? text : "";
}

function resetFrom(input: Printed, said: string): number | "none" {
  const fromEvent = windowReset(input.windows, input.endedAt);
  return fromEvent === "none" ? textReset(said, input.endedAt) : fromEvent;
}

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

export function claudeUsageLimit(stdout: string, stderr: string, endedAt: number): UsageLimit {
  const events = stdout.split("\n").map(parsed);
  const windows = events.reduce<Windows>(windowsOf, NO_WINDOWS);
  const result = events.findLast((e) => prop(e, "type") === "result");
  return claudeLimit({ result, stderr, windows, endedAt });
}
