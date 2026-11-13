// trace — a run's whole stream-json output, kept 30 days beside the ticket's records (#487; P4, P10). A writer run's
// output streams into one file as it comes, a line at a time, each line scrubbed before it is written: a JSON event
// with scrubbedJson, so it still reads back, and any other text with scrubSecrets. A trace stops growing at
// TRACE_MAX_BYTES, and its last line then says it was cut. The record line of the run names its trace by its plain file
// name, never a path: <home>/runs/<project>/<ticket>/<kind>[-<lens>]-<time>.jsonl. A trace older than TRACE_DAYS, by
// the time in its name, is deleted at the start of each orchestrator pass. Traces are local and private to this user,
// as the records are. Nothing here throws.

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Result } from "../forge/api.js";
import { scrubbedJson, scrubSecrets } from "../scrub.js";
import { plainName } from "../spec.js";
import { codeOf, recordPath, type Where } from "./records.js";

export type TraceKind = "writer" | "finder" | "verify" | "design-review" | "design-verify" | "onboard";
// a plain file name in the ticket's folder, never a path
export type TraceName = string;
export type TraceAt = Where & { readonly kind: TraceKind; readonly lens?: string; readonly at: number };
export type TraceKept = { readonly name: TraceName; readonly bytes: number; readonly cut: boolean };
export type TraceSink = { write(chunk: string): void; close(): Promise<Result<TraceKept>> };

export const TRACE_DAYS = 30;
export const TRACE_MAX_BYTES = 50 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60_000;

// a sink for a run that keeps no trace: it takes every chunk and keeps none
export const NO_TRACE: TraceSink = {
  write: () => undefined,
  close: async () => ({ kind: "failed", reason: "no trace was opened" }),
};

const KINDS: readonly TraceKind[] = ["writer", "finder", "verify", "design-review", "design-verify", "onboard"];
// <kind>[-<lens>]-<YYYY-MM-DDTHH-MM-SS-mmmZ>.jsonl: the kind, a lens of plain words, and the time
const NAME = new RegExp(
  `^(${KINDS.join("|")})(?:-([a-z0-9][a-z0-9-]*))?-(\\d{4}-\\d\\d-\\d\\dT\\d\\d-\\d\\d-\\d\\d-\\d{3}Z)\\.jsonl$`,
);

// traceName : the file name of a trace, the time with no ":" or ".", so it is a plain name everywhere. Pure.
export function traceName(at: Pick<TraceAt, "kind" | "lens" | "at">): TraceName {
  const time = new Date(at.at).toISOString().replace(/[:.]/g, "-");
  return `${at.kind}${at.lens === undefined ? "" : `-${at.lens}`}-${time}.jsonl`;
}

// nameParts : a trace's kind and time, from its name; none for a name that is not a trace's. Pure.
function nameParts(name: string): { readonly kind: TraceKind; readonly at: string } | undefined {
  const m = NAME.exec(name);
  const kind = KINDS.find((k) => k === m?.[1]);
  const time = m?.[3];
  if (kind === undefined || time === undefined) {
    return undefined;
  }
  const iso = time.replace(/^(.{10}T\d\d)-(\d\d)-(\d\d)-(\d{3}Z)$/, "$1:$2:$3.$4");
  return Number.isNaN(Date.parse(iso)) ? undefined : { kind, at: iso };
}

// traceLine : one output line as a trace keeps it: a JSON event with every string scrubbed, any other text scrubbed.
// Pure.
export function traceLine(line: string): string {
  try {
    return scrubbedJson(JSON.parse(line) as unknown);
  } catch {
    return scrubSecrets(line);
  }
}

// ticketDir : the ticket's folder beside its record file
function ticketDir(where: Where): Result<string> {
  const path = recordPath(where);
  return path.kind === "ok" ? { kind: "ok", value: path.value.slice(0, -".jsonl".length) } : path;
}

// Held : what a trace holds while the run prints: the line still being printed, the bytes written, whether it was cut
export type Held = { readonly partial: string; readonly bytes: number; readonly cut: boolean };

export const NOTHING_HELD: Held = { partial: "", bytes: 0, cut: false };

function cutLine(max: number): string {
  return `${JSON.stringify({ type: "trace", cut: true, bytes: max })}\n`;
}

// put : complete lines added, each scrubbed, and the text they add to the file; at the cap, one last line that says it
// was cut. Pure.
function put(held: Held, lines: readonly string[], max: number): { readonly held: Held; readonly text: string } {
  let bytes = held.bytes;
  let text = "";
  for (const line of lines) {
    const kept = `${traceLine(line)}\n`;
    const size = Buffer.byteLength(kept);
    if (held.cut || bytes + size > max) {
      return { held: { partial: "", bytes, cut: true }, text: held.cut ? text : text + cutLine(max) };
    }
    bytes += size;
    text += kept;
  }
  return { held: { partial: held.partial, bytes, cut: held.cut }, text };
}

// traceStep : one more piece of output, and the text it adds to the file. Once the trace is cut, every piece is
// dropped; a line still being printed that is already past the room left cuts the trace at once, so a long line with
// no newline never grows in memory. Pure.
export function traceStep(held: Held, chunk: string, max: number): { readonly held: Held; readonly text: string } {
  if (held.cut) {
    return { held, text: "" };
  }
  const lines = (held.partial + chunk).split("\n");
  const after = put({ ...held, partial: lines.pop() ?? "" }, lines, max);
  const room = max - after.held.bytes;
  return after.held.cut || Buffer.byteLength(after.held.partial) <= room
    ? after
    : { held: { ...after.held, partial: "", cut: true }, text: after.text + cutLine(max) };
}

// the trace being written: what it holds, and the first error
type Open = { held: Held; error: string };

// closed : the trace's file ended, then what it kept; a run that printed nothing, such as one whose box never started,
// keeps no trace, and its empty file is removed
async function closed(file: WriteStream, open: Open, path: string, max: number): Promise<Result<TraceKept>> {
  const last = put(open.held, open.held.partial.trim() === "" ? [] : [open.held.partial], max);
  file.write(last.text);
  await new Promise<void>((resolve) => file.end(resolve));
  const { bytes, cut } = last.held;
  if (open.error !== "") {
    return { kind: "failed", reason: open.error };
  }
  if (bytes === 0 && !cut) {
    await rm(path).catch(() => undefined);
    return { kind: "failed", reason: "the run printed nothing" };
  }
  return { kind: "ok", value: { name: basename(path), bytes, cut } };
}

// sinkOf : the sink that writes a new trace file at path, as the run prints
function sinkOf(path: string, max: number): TraceSink {
  const file = createWriteStream(path, { flags: "wx", mode: 0o600 });
  const open: Open = { held: NOTHING_HELD, error: "" };
  file.on("error", (e) => {
    open.error ||= `cannot write the trace ${basename(path)}: ${codeOf(e) || "error"}`;
  });
  return {
    write: (chunk) => {
      const step = traceStep(open.held, chunk, max);
      open.held = step.held;
      if (step.text !== "") {
        file.write(step.text);
      }
    },
    close: () => closed(file, open, path, max),
  };
}

// openTrace : a new trace file for a run, written as the run prints; the cap is a parameter for the tests
export async function openTrace(at: TraceAt, max: number = TRACE_MAX_BYTES): Promise<Result<TraceSink>> {
  const dir = ticketDir(at);
  if (dir.kind === "failed") {
    return dir;
  }
  const made = await mkdir(dir.value, { recursive: true, mode: 0o700 }).then(
    () => true,
    () => false,
  );
  return made
    ? { kind: "ok", value: sinkOf(join(dir.value, traceName(at)), max) }
    : { kind: "failed", reason: `cannot make ${dir.value}` };
}

// old : whether a trace's time is past TRACE_DAYS at now. Pure.
function old(at: string, now: number): boolean {
  return now - Date.parse(at) > TRACE_DAYS * DAY_MS;
}

// prunedIn : one folder's traces past TRACE_DAYS deleted; each that could not be deleted, by its path
async function prunedIn(dir: string, now: number): Promise<{ deleted: number; problems: string[] }> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const due = names.filter((n) => {
    const parts = nameParts(n);
    return parts !== undefined && old(parts.at, now);
  });
  const gone = await Promise.all(
    due.map((n) =>
      rm(join(dir, n)).then(
        () => "",
        () => join(dir, n),
      ),
    ),
  );
  const problems = gone.filter((p) => p !== "").map((p) => `cannot delete the trace ${p}`);
  return { deleted: due.length - problems.length, problems };
}

// pruneTraces : every trace of the project older than TRACE_DAYS deleted; what could not be deleted is named
export async function pruneTraces(input: {
  readonly home: string;
  readonly project: string;
  readonly now: number;
}): Promise<{ readonly deleted: number; readonly problems: readonly string[] }> {
  if (!plainName(input.project)) {
    return { deleted: 0, problems: [`${JSON.stringify(input.project)} is not a plain name`] };
  }
  const root = join(input.home, "runs", input.project);
  const tickets = await readdir(root, { withFileTypes: true }).catch(() => []);
  const each = await Promise.all(
    tickets.filter((t) => t.isDirectory()).map((t) => prunedIn(join(root, t.name), input.now)),
  );
  return { deleted: each.reduce((n, e) => n + e.deleted, 0), problems: each.flatMap((e) => e.problems) };
}
