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

export const HANDOFF_MAX_CHARS = 32_000;

export const MAP_LABEL = "wayfinder:map";

export type MapRead = { readonly number: number; readonly title: string; readonly body: Result<string> };

export type HandoffInput = {
  readonly project: string;
  readonly at: number;
  readonly lines: Result<readonly BoardLine[]>;
  readonly maps: Result<readonly MapRead[]>;
  readonly zone: Zone;
  readonly mark: string;
  readonly maxChars?: number;
};

export type Handoff = { readonly text: string; readonly complete: boolean };

const IN_FLIGHT: readonly Lane[] = ["ready-to-merge", "factory"];

function fenceOf(text: string): string {
  return /^(`{3,}|~{3,})/.exec(text)?.[1] ?? "";
}

function closes(open: string, fence: string): boolean {
  return fence.startsWith(open[0] ?? "") && fence.length >= open.length;
}

function nextFence(open: string, fence: string): string {
  if (open === "") {
    return fence;
  }
  return closes(open, fence) ? "" : open;
}

function tableLine(text: string, inTable: boolean, kept: number): readonly string[] {
  return inTable || kept === 0 ? [text] : ["", text];
}

function isRow(open: string, fence: string, text: string): boolean {
  return open === "" && fence === "" && text.startsWith("|");
}

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
  readonly instead: readonly string[] | undefined;
  readonly failed: boolean;
};

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

type Keep = { flight: number; maps: number[] };

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

function mapRows(p: MapPart, keep: number): readonly string[] {
  if (p.instead !== undefined) {
    return p.instead;
  }
  const kept = p.rows.slice(0, keep);
  const left = p.rows.length - kept.length;
  return left === 0 ? kept : [...kept, `  (${left} more table lines: read #${p.number})`];
}

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

function shrinkMaps(keep: Keep, maps: readonly MapPart[], over: number): boolean {
  const last = keep.maps.findLastIndex((k) => k > 0);
  if (last < 0) {
    return false;
  }
  keep.maps[last] = keptLines(maps[last]?.rows ?? [], keep.maps[last] ?? 0, over);
  return true;
}

function keptLines(rows: readonly string[], keep: number, over: number): number {
  let k = keep;
  for (let freed = 0; k > 0 && freed < over; k -= 1) {
    freed += lineLength(rows, k - 1);
  }
  return k < 3 ? 0 : k;
}

function lineLength(rows: readonly string[], at: number): number {
  return (rows[at] ?? "").length + 1;
}

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

function keepAll(p: Parts): Keep {
  return {
    flight: p.flight.ok ? p.flight.tickets.length : 0,
    maps: p.maps.kind === "ok" ? p.maps.value.map((m) => m.rows.length) : [],
  };
}

function isComplete(input: HandoffInput, p: Parts): boolean {
  return input.lines.kind === "ok" && p.maps.kind === "ok" && p.maps.value.every((m) => !m.failed);
}

export function handoffNote(input: HandoffInput): Handoff {
  const p = partsOf(input);
  const keep = keepAll(p);
  let text = render(input, p, keep);
  while (text.length > p.max && shrink(keep, p, text.length - p.max)) {
    text = render(input, p, keep);
  }
  return { text, complete: isComplete(input, p) };
}
