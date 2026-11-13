// trace — a run's whole stream-json output, kept 30 days beside the ticket's records (#487; P4, P10). A writer run's
// output streams into one file as it comes, a line at a time, each line scrubbed before it is written: a JSON event
// with scrubbedJson, so it still reads back, and any other text with scrubSecrets. A trace stops growing at
// TRACE_MAX_BYTES, and its last line then says it was cut. The record line of the run names its trace by its plain file
// name, never a path: <home>/runs/<project>/<ticket>/<kind>[-<lens>]-<time>.jsonl. Traces are local and private to
// this user, as the records are. Nothing here throws. **Today:** nothing deletes a trace yet, nor lists or reads one;
// #487's next slice adds both, with the 30 days.

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Result } from "../forge/api.js";
import { scrubbedJson, scrubSecrets } from "../scrub.js";
import { codeOf, recordPath, type Where } from "./records.js";

export type TraceKind = "writer" | "finder" | "verify" | "design-review" | "design-verify" | "onboard";
// a plain file name in the ticket's folder, never a path
export type TraceName = string;
export type TraceAt = Where & { readonly kind: TraceKind; readonly lens?: string; readonly at: number };
export type TraceKept = { readonly name: TraceName; readonly bytes: number; readonly cut: boolean };
export type TraceSink = { write(chunk: string): void; close(): Promise<Result<TraceKept>> };

export const TRACE_MAX_BYTES = 50 * 1024 * 1024;

// a sink for a run that keeps no trace: it takes every chunk and keeps none
export const NO_TRACE: TraceSink = {
  write: () => undefined,
  close: async () => ({ kind: "failed", reason: "no trace was opened" }),
};

// traceName : the file name of a trace, the time with no ":" or ".", so it is a plain name everywhere. Pure.
export function traceName(at: Pick<TraceAt, "kind" | "lens" | "at">): TraceName {
  const time = new Date(at.at).toISOString().replace(/[:.]/g, "-");
  return `${at.kind}${at.lens === undefined ? "" : `-${at.lens}`}-${time}.jsonl`;
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

// the trace being written: the line still being printed, the bytes so far, whether it was cut, and the first error
type Open = { partial: string; bytes: number; cut: boolean; error: string };

function cutLine(max: number): string {
  return `${JSON.stringify({ type: "trace", cut: true, bytes: max })}\n`;
}

// put : complete lines into the file, each scrubbed; at the cap, one last line that says it was cut
function put(file: WriteStream, open: Open, lines: readonly string[], max: number): void {
  for (const line of lines) {
    if (open.cut) {
      return;
    }
    const text = `${traceLine(line)}\n`;
    const size = Buffer.byteLength(text);
    if (open.bytes + size > max) {
      open.cut = true;
      file.write(cutLine(max));
      return;
    }
    open.bytes += size;
    file.write(text);
  }
}

// closed : the trace's file ended, then what it kept; a run that printed nothing, such as one whose box never started,
// keeps no trace, and its empty file is removed
async function closed(file: WriteStream, open: Open, path: string, max: number): Promise<Result<TraceKept>> {
  put(file, open, open.partial.trim() === "" ? [] : [open.partial], max);
  await new Promise<void>((resolve) => file.end(resolve));
  if (open.error !== "") {
    return { kind: "failed", reason: open.error };
  }
  if (open.bytes === 0 && !open.cut) {
    await rm(path).catch(() => undefined);
    return { kind: "failed", reason: "the run printed nothing" };
  }
  return { kind: "ok", value: { name: basename(path), bytes: open.bytes, cut: open.cut } };
}

// sinkOf : the sink that writes a new trace file at path, as the run prints
function sinkOf(path: string, max: number): TraceSink {
  const file = createWriteStream(path, { flags: "wx", mode: 0o600 });
  const open: Open = { partial: "", bytes: 0, cut: false, error: "" };
  file.on("error", (e) => {
    open.error ||= `cannot write the trace ${basename(path)}: ${codeOf(e) || "error"}`;
  });
  return {
    write: (chunk) => {
      const lines = (open.partial + chunk).split("\n");
      open.partial = lines.pop() ?? "";
      put(file, open, lines, max);
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
