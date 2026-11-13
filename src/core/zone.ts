// zone — the reader's time zone, for the views a person reads (#487, Q8): `usage` and `trace` show times and days in
// it. Records stay in UTC, and so do the caps and run hours, which say so. The zone is TZ when it names one the runtime
// knows, else the system's own. Nothing here throws.

export type Zone = { readonly name: string };

export const UTC: Zone = { name: "UTC" };

// known : whether the runtime knows a zone by this name. Pure.
function known(name: string): boolean {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
}

// readerZone : TZ when it names a zone the runtime knows, else the system's zone, else UTC
export function readerZone(env: NodeJS.ProcessEnv): Zone {
  const tz = env.TZ ?? "";
  if (known(tz)) {
    return { name: tz };
  }
  const system = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return known(system) ? { name: system } : UTC;
}

type Wall = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
};

// wallAt : the date and time on a clock in the zone at ms since the epoch. Pure.
function wallAt(ms: number, zone: Zone): Wall {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone.name,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ms);
  const n = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: n("year"), month: n("month"), day: n("day"), hour: n("hour"), minute: n("minute") };
}

// offsetAt : how far the zone's clock is ahead of UTC at ms, in ms. Pure.
function offsetAt(ms: number, zone: Zone): number {
  const w = wallAt(ms, zone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - Math.floor(ms / 60_000) * 60_000;
}

const two = (n: number): string => String(n).padStart(2, "0");

// shownAt : a time as a person reads it in the zone: "2026-11-13 14:05 Europe/Berlin"; an unreadable time as it is.
// Pure.
export function shownAt(iso: string, zone: Zone): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return iso;
  }
  const w = wallAt(ms, zone);
  return `${w.year}-${two(w.month)}-${two(w.day)} ${two(w.hour)}:${two(w.minute)} ${zone.name}`;
}

// dayStart : the start of the zone's day that holds now, in ms since the epoch. Pure.
export function dayStart(now: number, zone: Zone): number {
  const w = wallAt(now, zone);
  return Date.UTC(w.year, w.month - 1, w.day) - offsetAt(now, zone);
}

// monthStart : the start of the zone's month that holds now, in ms since the epoch. Pure.
export function monthStart(now: number, zone: Zone): number {
  const w = wallAt(now, zone);
  return Date.UTC(w.year, w.month - 1, 1) - offsetAt(now, zone);
}

// shownFor : a span of ms as a person reads it: "3d 4h", "2h 05m", "7m". Pure.
export function shownFor(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const [d, h, m] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60];
  if (d > 0) {
    return `${d}d ${h}h`;
  }
  return h > 0 ? `${h}h ${two(m)}m` : `${m}m`;
}
