// trace — a run's whole stream-json output, kept 30 days beside the ticket's records (#487; P4, P10). A writer run's
// output streams into one file as it comes, a line at a time, each line scrubbed before it is written: a JSON event
// with scrubbedJson, so it still reads back, and any other text with scrubSecrets. A trace stops growing at
// TRACE_MAX_BYTES, and its last line then says it was cut. The record line of the run names its trace by its plain file
// name, never a path: <home>/runs/<project>/<ticket>/<kind>[-<lens>]-<time>.jsonl. A trace older than TRACE_DAYS, by
// the time in its name, is deleted at the start of each orchestrator pass and by `agent-factory trace`. Traces are
// local and private to this user, as the records are. Nothing here throws.

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Result } from "../forge/api.js";
import { scrubbedJson, scrubSecrets } from "../scrub.js";
import { plainName } from "../spec.js";
import { codeOf, prop } from "../field.js";
import { readRecords, recordPath, type Event, type Where } from "./records.js";

export type TraceKind = "writer" | "finder" | "verify" | "design-review" | "design-verify" | "onboard" | "retro";
export type TraceName = string;
export type TraceAt = Where & { readonly kind: TraceKind; readonly lens?: string; readonly at: number };
export type TraceKept = { readonly name: TraceName; readonly bytes: number; readonly cut: boolean };
export type TraceSink = { write(chunk: string): void; close(): Promise<Result<TraceKept>> };
export type TraceListed = {
  readonly name: TraceName;
  readonly at: string;
  readonly kind: TraceKind;
  readonly bytes: number;
  readonly line?: string;
};

export const TRACE_DAYS = 30;
export const TRACE_MAX_BYTES = 50 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60_000;

export const NO_TRACE: TraceSink = {
  write: () => undefined,
  close: async () => ({ kind: "failed", reason: "no trace was opened" }),
};

const KINDS: readonly TraceKind[] = [
  "writer",
  "finder",
  "verify",
  "design-review",
  "design-verify",
  "onboard",
  "retro",
];
const NAME = new RegExp(
  `^(${KINDS.join("|")})(?:-([a-z0-9][a-z0-9-]*))?-(\\d{4}-\\d\\d-\\d\\dT\\d\\d-\\d\\d-\\d\\d-\\d{3}Z)\\.jsonl$`,
);

export function traceName(at: Pick<TraceAt, "kind" | "lens" | "at">): TraceName {
  const time = new Date(at.at).toISOString().replace(/[:.]/g, "-");
  return `${at.kind}${at.lens === undefined ? "" : `-${at.lens}`}-${time}.jsonl`;
}

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

export function traceLine(line: string): string {
  try {
    return scrubbedJson(JSON.parse(line) as unknown);
  } catch {
    return inert(scrubSecrets(line));
  }
}

// control : a C0 or C1 control character but the tab, or DEL: a terminal acts on it, and ESC starts CSI and OSC
// sequences, so printing it can move the cursor or set the title.
// https://www.man7.org/linux/man-pages/man4/console_codes.4.html
function control(code: number): boolean {
  return code !== 0x09 && (code < 0x20 || (code >= 0x7f && code <= 0x9f));
}

function inert(text: string): string {
  return Array.from(text, (c) =>
    control(c.charCodeAt(0)) ? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}` : c,
  ).join("");
}

export function inertText(text: string): string {
  const keep = (i: number): boolean => text[i] === "\n" || (text[i] === "\r" && text[i + 1] === "\n");
  return text
    .split("")
    .map((c, i) => (keep(i) ? c : inert(c)))
    .join("");
}

function ticketDir(where: Where): Result<string> {
  const path = recordPath(where);
  return path.kind === "ok" ? { kind: "ok", value: path.value.slice(0, -".jsonl".length) } : path;
}

export type Held = { readonly partial: string; readonly bytes: number; readonly cut: boolean };

export const NOTHING_HELD: Held = { partial: "", bytes: 0, cut: false };

function cutLine(max: number): string {
  return `${JSON.stringify({ type: "trace", cut: true, bytes: max })}\n`;
}

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

type Open = { held: Held; error: string };

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

export async function openTrace(at: TraceAt, max: number = TRACE_MAX_BYTES): Promise<Result<TraceSink>> {
  const dir = ticketDir(at);
  if (dir.kind === "failed") {
    return dir;
  }
  return openIn(dir.value, at, max);
}

async function openIn(dir: string, at: Pick<TraceAt, "kind" | "lens" | "at">, max: number): Promise<Result<TraceSink>> {
  const made = await mkdir(dir, { recursive: true, mode: 0o700 }).then(
    () => true,
    () => false,
  );
  return made
    ? { kind: "ok", value: sinkOf(join(dir, traceName(at)), max) }
    : { kind: "failed", reason: `cannot make ${dir}` };
}

export async function keepTraceIn(
  dir: string,
  at: Pick<TraceAt, "kind" | "at">,
  stdout: string,
): Promise<Result<TraceKept>> {
  const opened = await openIn(dir, at, TRACE_MAX_BYTES);
  if (opened.kind === "failed") {
    return opened;
  }
  opened.value.write(stdout);
  return opened.value.close();
}

export async function keepTrace(at: TraceAt, stdout: string): Promise<Result<TraceKept>> {
  const opened = await openTrace(at);
  if (opened.kind === "failed") {
    return opened;
  }
  opened.value.write(stdout);
  return opened.value.close();
}

function lineOf(events: readonly Event[], name: TraceName): { readonly line?: string } {
  const e = events.find((x) => traceNames(x).includes(name));
  return e === undefined ? {} : { line: wordsOf(e) };
}

function traceNames(e: Event): readonly string[] {
  const one = prop(e, "trace");
  const many = prop(e, "traces");
  const list: readonly unknown[] = Array.isArray(many) ? many : [];
  return [...(typeof one === "string" ? [one] : []), ...list.filter((n): n is string => typeof n === "string")];
}

const WORD_FIELDS = ["mode", "step", "phase", "outcome"] as const;

function wordsOf(e: Event): string {
  const words = WORD_FIELDS.map((f) => prop(e, f)).filter((v): v is string => typeof v === "string");
  return [e.kind, ...words].join(" ");
}

async function listedOf(dir: string, name: string, events: readonly Event[]): Promise<readonly TraceListed[]> {
  const parts = nameParts(name);
  const size = parts === undefined ? undefined : await stat(join(dir, name)).catch(() => undefined);
  return parts === undefined || size === undefined
    ? []
    : [{ name, ...parts, bytes: size.size, ...lineOf(events, name) }];
}

export async function listTraces(where: Where): Promise<Result<readonly TraceListed[]>> {
  const dir = ticketDir(where);
  if (dir.kind === "failed") {
    return dir;
  }
  const names = await readdir(dir.value).catch(() => [] as string[]);
  const events = await readRecords(where, { warn: () => undefined });
  const read = events.kind === "ok" ? events.value : [];
  const listed = (await Promise.all(names.map((n) => listedOf(dir.value, n, read)))).flat();
  return { kind: "ok", value: listed.toSorted((a, b) => b.at.localeCompare(a.at)) };
}

function old(at: string, now: number): boolean {
  return now - Date.parse(at) > TRACE_DAYS * DAY_MS;
}

export async function readTrace(
  where: Where,
  name: string,
  now: number,
): Promise<Result<string> | { readonly kind: "deleted" }> {
  const parts = nameParts(name);
  const dir = ticketDir(where);
  if (parts === undefined || dir.kind === "failed") {
    return { kind: "failed", reason: `${JSON.stringify(name)} is not a trace's name` };
  }
  return readFile(join(dir.value, name), "utf8").then(
    (value) => ({ kind: "ok", value }),
    (e: unknown) => unread(name, codeOf(e), old(parts.at, now)),
  );
}

function unread(name: string, code: string, past: boolean): Result<string> | { readonly kind: "deleted" } {
  return code === "ENOENT" && past
    ? { kind: "deleted" }
    : { kind: "failed", reason: `cannot read the trace ${name}: ${code || "error"}` };
}

export async function prunedIn(dir: string, now: number): Promise<{ deleted: number; problems: string[] }> {
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
