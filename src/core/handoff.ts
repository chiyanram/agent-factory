// handoff — the project coordinator's reset note (#711): built by code from the records, never by a model, so a fresh
// coordinator starts from what the factory holds and not from a summary of the chat. Sections, in order: what waits on
// the operator (the board's needs-you lane, never cut), what is in flight (its other lanes), each open map's tables,
// and where to read more. Over the cap, the maps' table lines go first, from the last map back, then the in-flight
// tickets from the last one back; each cut says how much it left out. Only what is never cut (what waits on the
// operator, the headings) can take the note over the cap. A section that cannot be read is one line naming why.

import { laneHead, laneText, ticketText, type BoardLine } from "./dispatch/board.js";
import type { Lane } from "./dispatch/next-step.js";
import type { Result } from "./forge/api.js";
import type { Zone } from "./zone.js";

// the note's length cap, as Agent Orchestrator caps its handoff note
export const HANDOFF_MAX_CHARS = 32_000;

// the label an open map carries (docs/agents/issue-tracker.md)
export const MAP_LABEL = "wayfinder:map";

export type MapRead = { readonly number: number; readonly title: string; readonly body: Result<string> };

export type HandoffInput = {
  readonly project: string;
  // ms since the epoch; the marker shows it in UTC
  readonly at: number;
  readonly lines: Result<readonly BoardLine[]>;
  readonly maps: Result<readonly MapRead[]>;
  readonly zone: Zone;
  // the change's prefix on the project's git host: # or !
  readonly mark: string;
  readonly maxChars?: number;
};

// complete is false when a section could not be read, so the command exits 1
export type Handoff = { readonly text: string; readonly complete: boolean };

// the lanes the in-flight section shows, in the board's order
const IN_FLIGHT: readonly Lane[] = ["ready-to-merge", "factory"];

// fenceOf : the fence a line opens or closes (its character run, three or more of ` or ~), or "" for none. Pure.
function fenceOf(text: string): string {
  return /^(`{3,}|~{3,})/.exec(text)?.[1] ?? "";
}

// closes : whether a fence line closes the open fence: the same character, at least as long. Pure.
function closes(open: string, fence: string): boolean {
  return fence.startsWith(open[0] ?? "") && fence.length >= open.length;
}

// nextFence : the fence open after a fence line: it opens one when none is open, and closes the open one only with
// the same character at least as long. Pure.
function nextFence(open: string, fence: string): string {
  if (open === "") {
    return fence;
  }
  return closes(open, fence) ? "" : open;
}

// tableLine : what one table line adds to the lines kept: a blank line first when it opens a table apart from the
// last one. Pure.
function tableLine(text: string, inTable: boolean, kept: number): readonly string[] {
  return inTable || kept === 0 ? [text] : ["", text];
}

// isRow : whether a trimmed line is a table line outside any code fence. Pure.
function isRow(open: string, fence: string, text: string): boolean {
  return open === "" && fence === "" && text.startsWith("|");
}

// mapTables : a map body's table lines, trimmed, outside code fences; tables apart in the body stay apart. Pure.
export function mapTables(body: string): readonly string[] {
  const out: string[] = [];
  let open = "";
  let inTable = false;
  for (const text of body.split("\n").map((l) => l.trim())) {
    const fence = fenceOf(text);
    open = fence === "" ? open : nextFence(open, fence);
    const row = isRow(open, fence, text);
    out.push(...(row ? tableLine(text, inTable, out.length) : []));
    inTable = row;
  }
  return out;
}

type MapPart = {
  readonly number: number;
  readonly head: string;
  readonly rows: readonly string[];
  // the line that stands for the rows: why the map could not be read, or that it holds no table
  readonly instead: readonly string[] | undefined;
  readonly failed: boolean;
};

// mapPart : one map's heading and its table lines, or the line that says why there are none. Pure.
function mapPart(m: MapRead): MapPart {
  const head = `### #${m.number} ${m.title}`;
  if (m.body.kind === "failed") {
    return {
      number: m.number,
      head,
      rows: [],
      instead: [`  could not read #${m.number}: ${m.body.reason}`],
      failed: true,
    };
  }
  const rows = mapTables(m.body.value);
  const instead = rows.length === 0 ? [`  no table: read #${m.number}`] : undefined;
  return { number: m.number, head, rows, instead, failed: false };
}

// the in-flight tickets, in lane order
type Flight =
  | { readonly ok: true; readonly tickets: readonly BoardLine[] }
  | { readonly ok: false; readonly reason: string };

type Parts = {
  readonly at: string;
  readonly max: number;
  readonly waits: readonly string[];
  readonly flight: Flight;
  readonly maps: Result<readonly MapPart[]>;
};

// how much of each cuttable part is kept
type Keep = { flight: number; maps: number[] };

// partsOf : the note's sections from the records, uncut. Pure.
function partsOf(input: HandoffInput): Parts {
  const read = input.lines;
  const ok = read.kind === "ok";
  return {
    at: new Date(input.at).toISOString().replace(/\.\d{3}Z$/, "Z"),
    max: input.maxChars ?? HANDOFF_MAX_CHARS,
    waits: ok
      ? laneText({ lane: "needs-you", lines: read.value, zone: input.zone, mark: input.mark })
      : [`  could not read the board: ${read.reason}`],
    flight: ok
      ? { ok, tickets: IN_FLIGHT.flatMap((lane) => read.value.filter((l) => l.lane === lane)) }
      : { ok, reason: read.reason },
    maps: input.maps.kind === "ok" ? { kind: "ok", value: input.maps.value.map(mapPart) } : input.maps,
  };
}

// flightSection : each in-flight lane with its whole count, the tickets kept, then how many were left out. Pure.
function flightSection(project: string, input: HandoffInput, flight: Flight, keep: number): readonly string[] {
  if (!flight.ok) {
    return [`  could not read the board: ${flight.reason}`];
  }
  const kept = new Set(flight.tickets.slice(0, keep));
  const lanes = IN_FLIGHT.flatMap((lane) => {
    const all = flight.tickets.filter((l) => l.lane === lane);
    const shown = all.filter((l) => kept.has(l));
    const rows = all.length === 0 ? ["  nothing"] : shown.flatMap((l) => ticketText(l, input.zone, input.mark));
    return [laneHead(lane, all.length)].concat(rows);
  });
  const left = flight.tickets.length - kept.size;
  return left === 0 ? lanes : [...lanes, `  (${left} more tickets: run agent-factory board ${project})`];
}

// mapRows : a map's table lines kept, then how many were left out; never a table's head alone. Pure.
function mapRows(p: MapPart, keep: number): readonly string[] {
  if (p.instead !== undefined) {
    return p.instead;
  }
  const kept = p.rows.slice(0, keep);
  const left = p.rows.length - kept.length;
  return left === 0 ? kept : [...kept, `  (${left} more table lines: read #${p.number})`];
}

// mapsSection : the open maps, each cut to the lines kept, or the line that says they cannot be listed. Pure.
function mapsSection(maps: Result<readonly MapPart[]>, keep: readonly number[]): readonly string[] {
  if (maps.kind === "failed") {
    return ["## Open maps", `  could not list the open maps: ${maps.reason}`];
  }
  return [
    `## Open maps (${maps.value.length})`,
    ...(maps.value.length === 0 ? ["  none open"] : []),
    ...maps.value.flatMap((p, i) => [p.head, ...mapRows(p, keep[i] ?? 0)]),
  ];
}

// render : the note with the lines and tickets kept. Pure.
function render(input: HandoffInput, p: Parts, keep: Keep): string {
  const project = input.project;
  return [
    `factory handoff: ${project} at ${p.at}; this note replaces the earlier conversation`,
    `built by code from the board and the open maps, with no model summary; at most ${p.max} characters`,
    "",
    "## Waits on you",
    ...p.waits,
    "",
    "## In flight",
    ...flightSection(project, input, p.flight, keep.flight),
    "",
    ...mapsSection(p.maps, keep.maps),
    "",
    "## Read more",
    `  agent-factory board ${project}: every ticket in flight, now`,
    `  agent-factory approval ${project} <ticket>: a ticket's spec and approval`,
    "  each map's own issue: its prose and decisions",
    "",
  ].join("\n");
}

// shrinkMaps : cut enough table lines off the last map that still has some to free `over` characters, never leaving a
// table's head and separator alone; false when no map has a line left. Mutates keep.
function shrinkMaps(keep: Keep, maps: readonly MapPart[], over: number): boolean {
  const last = keep.maps.findLastIndex((k) => k > 0);
  if (last < 0) {
    return false;
  }
  keep.maps[last] = keptLines(maps[last]?.rows ?? [], keep.maps[last] ?? 0, over);
  return true;
}

// keptLines : how many of the first `keep` lines stay once enough lines from the end are cut to free `over`
// characters; none when only a table's head and separator would stay. Pure.
function keptLines(rows: readonly string[], keep: number, over: number): number {
  let k = keep;
  for (let freed = 0; k > 0 && freed < over; k -= 1) {
    freed += lineLength(rows, k - 1);
  }
  return k < 3 ? 0 : k;
}

// lineLength : one kept line's length, with its newline. Pure.
function lineLength(rows: readonly string[], at: number): number {
  return (rows[at] ?? "").length + 1;
}

// shrink : a step smaller, the maps' lines first, then the last in-flight ticket; false when nothing is left to cut.
// Mutates keep.
function shrink(keep: Keep, p: Parts, over: number): boolean {
  if (p.maps.kind === "ok" && shrinkMaps(keep, p.maps.value, over)) {
    return true;
  }
  if (keep.flight === 0) {
    return false;
  }
  keep.flight -= 1;
  return true;
}

// keepAll : every line and ticket kept. Pure.
function keepAll(p: Parts): Keep {
  return {
    flight: p.flight.ok ? p.flight.tickets.length : 0,
    maps: p.maps.kind === "ok" ? p.maps.value.map((m) => m.rows.length) : [],
  };
}

// isComplete : whether every section was read. Pure.
function isComplete(input: HandoffInput, p: Parts): boolean {
  return input.lines.kind === "ok" && p.maps.kind === "ok" && p.maps.value.every((m) => !m.failed);
}

// handoffNote : the reset note for a fresh project coordinator, under the cap where what is never cut allows. Each
// step frees at least what is over, so the note is rendered a few times, not once per line. Pure: the same records
// and time give the same note.
export function handoffNote(input: HandoffInput): Handoff {
  const p = partsOf(input);
  const keep = keepAll(p);
  let text = render(input, p, keep);
  while (text.length > p.max && shrink(keep, p, text.length - p.max)) {
    text = render(input, p, keep);
  }
  return { text, complete: isComplete(input, p) };
}
