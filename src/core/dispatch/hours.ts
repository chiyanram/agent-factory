// hours — the run hours: the hours of the day, in UTC as the day caps are, in which the orchestrator may start a run
// (#299; ADR-0012 S16). Written "HH-HH": from the first hour up to the second, so "22-06" is the night across midnight
// and "00-24" is the whole day. Outside them no new run starts, and dispatch ends with when to run it again (tick.ts
// runHoursEnd); a run already going is never stopped, as with the caps.
// A leaf: settings/variables.ts reads its checks, so it imports no module at run time.

export const HOURS_FORM = /^([01]\d|2[0-4])-([01]\d|2[0-4])$/;

export const HOURS_HINT = 'hours in UTC as "HH-HH", from 00 to 24, such as "22-06"; not empty';

export type RunHours = { readonly from: number; readonly to: number; readonly text: string };

export function hoursOf(text: unknown): RunHours | "bad" {
  const form = typeof text === "string" && HOURS_FORM.test(text) ? text : "00-00";
  const from = Number(form.slice(0, 2)) % 24;
  const to = Number(form.slice(3));
  return from === to ? "bad" : { from, to, text: form };
}

function hourSet(h: RunHours): ReadonlySet<number> {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return new Set(hours.filter((i) => (h.from < h.to ? i >= h.from && i < h.to : i >= h.from || i < h.to % 24)));
}

export function openAt(h: RunHours, now: number): boolean {
  return hourSet(h).has(new Date(now).getUTCHours());
}

export function within(lower: unknown, upper: unknown): boolean {
  const [l, u] = [hoursOf(lower), hoursOf(upper)];
  if (l === "bad" || u === "bad") {
    return false;
  }
  const outer = hourSet(u);
  return [...hourSet(l)].every((i) => outer.has(i));
}
