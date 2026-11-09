// hours — the run hours: the hours of the day, in UTC as the day caps are, in which the orchestrator may start a run
// (#299; ADR-0012 S16). Written "HH-HH": from the first hour up to the second, so "22-06" is the night across midnight
// and "00-24" is the whole day. Outside them no new run starts; a run already going is never stopped, as with the caps.
// A leaf: settings/variables.ts reads its checks, so it imports no module at run time.

export const HOURS_FORM = /^([01]\d|2[0-4])-([01]\d|2[0-4])$/;

export const HOURS_HINT = 'hours in UTC as "HH-HH", from 00 to 24, such as "22-06"; not empty';

// the run hours: from (inclusive) to (exclusive); from > to wraps past midnight
export type RunHours = { readonly from: number; readonly to: number; readonly text: string };

// hoursOf : the run hours a setting's text gives, or "bad". Pure.
export function hoursOf(text: unknown): RunHours | "bad" {
  const form = typeof text === "string" && HOURS_FORM.test(text) ? text : "00-00";
  const from = Number(form.slice(0, 2)) % 24;
  const to = Number(form.slice(3));
  return from === to ? "bad" : { from, to, text: form };
}

// hourSet : each hour of the day the run hours hold. Pure.
function hourSet(h: RunHours): ReadonlySet<number> {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return new Set(hours.filter((i) => (h.from < h.to ? i >= h.from && i < h.to : i >= h.from || i < h.to % 24)));
}

// openAt : whether a run may start at `now` (ms), by its UTC hour. Pure.
export function openAt(h: RunHours, now: number): boolean {
  return hourSet(h).has(new Date(now).getUTCHours());
}

// within : whether every hour of `lower` is one of `upper`'s, so a lower layer only narrows the run hours. Pure.
export function within(lower: unknown, upper: unknown): boolean {
  const [l, u] = [hoursOf(lower), hoursOf(upper)];
  if (l === "bad" || u === "bad") {
    return false;
  }
  const outer = hourSet(u);
  return [...hourSet(l)].every((i) => outer.has(i));
}
