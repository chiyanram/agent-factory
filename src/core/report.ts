// report — how a writer run ends (#109; ADR-0012 S13). The writer writes .factory/report.json in its worktree and exits;
// the file is never committed. The host reads it, checks it against the schema, and turns every run end into one of
// three outcomes:
//
//   status     done | asked | blocked                      required
//   evidence   [{criterion, command, result}], at least one  required when done
//   questions  ["…"], one to five                           required when asked
//   blocker    "…"                                          required when blocked
//
// Anything else is blocked, with the reason: a missing, unreadable or malformed report, an unknown status, a field the
// schema does not name, a non-zero exit, a timeout, a stall, a cap hit, or a box that failed. No outcome is guessed.
//
// The writer controls its worktree, so the read is careful: .factory and the report must be a real folder and a real
// regular file (never a symlink, which could point the host at ~/.ssh), at most 64 KiB. Decide from it only once the
// box has stopped: nothing of the writer's may still run and swap .factory between the checks and the open. A read
// while the writer runs only starts the completion window (#182). A reason never
// quotes the file, not even a key name, since it is posted on the change and a report could hold anything.

import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { cleanField } from "./post.js";

export const REPORT_PATH = ".factory/report.json";
export const MAX_REPORT_BYTES = 64 * 1024;
const MAX_TEXT = 2000;
const MAX_EVIDENCE = 50;
const MAX_QUESTIONS = 5;

export type Evidence = { readonly criterion: string; readonly command: string; readonly result: string };

export type Outcome =
  | { readonly kind: "done"; readonly evidence: readonly Evidence[] }
  | { readonly kind: "asked"; readonly questions: readonly string[] }
  // by: the writer said so, or the host decided it from how the run ended
  | { readonly kind: "blocked"; readonly reason: string; readonly by: "writer" | "host" };

// How the run ended, as the box (src/core/box) and the dispatcher's caps saw it.
export type RunEnd =
  | { readonly kind: "exited"; readonly code: number }
  // the writer wrote a valid report, then kept running past the completion window, and the host stopped its box
  // (#182): decided from the report, like a clean exit
  | { readonly kind: "hungAfterReport"; readonly windowSeconds: number }
  | { readonly kind: "timedOut"; readonly seconds: number }
  // the run printed nothing for the stall time and the host stopped its box (#228); last: its last output lines
  | { readonly kind: "stalled"; readonly seconds: number; readonly last: readonly string[] }
  | { readonly kind: "cap"; readonly what: string }
  | { readonly kind: "failed"; readonly reason: string };

// how a run ended, for the post: on its own; stopped by the host after the completion window, and decided from its
// report; or stopped by the host for printing nothing, with the last lines it printed (#228)
export type Ending =
  | { readonly kind: "clean" }
  | { readonly kind: "hung"; readonly windowSeconds: number }
  | { readonly kind: "stalled"; readonly last: readonly string[] };

export const CLEAN: Ending = { kind: "clean" };

// endingOf : the ending a run end gives the outcome. Pure.
export function endingOf(end: RunEnd): Ending {
  if (end.kind === "hungAfterReport") {
    return { kind: "hung", windowSeconds: end.windowSeconds };
  }
  return end.kind === "stalled" ? { kind: "stalled", last: end.last } : CLEAN;
}

// hungLine : what a person reads about a hung run. Pure.
export function hungLine(ending: Ending): string {
  return ending.kind === "hung"
    ? `the writer hung after its report; the host stopped it after the ${ending.windowSeconds} s completion window`
    : "";
}

// validReport : a report the schema accepts, as the writer wrote it; the host's own refusals are not one
export function validReport(file: ReportFile): boolean {
  if (file.kind !== "text") {
    return false;
  }
  const outcome = parseReport(file.text);
  return outcome.kind !== "blocked" || outcome.by === "writer";
}

export type ReportFile =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable"; readonly reason: string };

// The words the writer's prompt carries, so the writer knows the schema it is held to.
export const REPORT_INSTRUCTIONS = `When you stop, write ${REPORT_PATH} in the worktree and exit. Never commit it. It is JSON with one "status":
- "done": add "evidence", a list of {"criterion", "command", "result"}, one row per acceptance criterion: the command you ran and what it showed. Start each "criterion" with the criterion's id, AC-1 for the first, AC-2 for the second, and so on: a criterion with no row fails the ready check.
- "asked": add "questions", one to five questions the spec does not answer. Never guess an answer.
- "blocked": add "blocker", what stops you. Commit the work you have first.
No other field. A missing or malformed report counts as blocked.`;

type Field = Record<string, unknown>;

function hostBlocked(reason: string): Outcome {
  return { kind: "blocked", reason, by: "host" };
}

// One checked part of a report. A problem names the part, never its content: the reason is posted on the change.
type Check<T> = { readonly kind: "ok"; readonly value: T } | { readonly kind: "bad"; readonly problem: string };

function ok<T>(value: T): Check<T> {
  return { kind: "ok", value };
}

function bad<T>(problem: string): Check<T> {
  return { kind: "bad", problem };
}

// text : non-empty once every control and invisible character is gone, as the posting template removes them
function text(value: unknown, what: string): Check<string> {
  if (typeof value !== "string" || cleanField(value) === "") {
    return bad(`${what} must be non-empty text`);
  }
  return value.length > MAX_TEXT ? bad(`${what} is longer than ${MAX_TEXT} characters`) : ok(value.trim());
}

function isRecord(value: unknown): value is Field {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// extras : how many keys the schema does not name; counted, never quoted
function extras(record: Field, named: readonly string[]): number {
  return Object.keys(record).filter((k) => !named.includes(k)).length;
}

function all<T>(checks: readonly Check<T>[]): Check<readonly T[]> {
  const first = checks.find((c) => c.kind === "bad");
  return first?.kind === "bad" ? bad(first.problem) : ok(checks.map((c) => (c as { readonly value: T }).value));
}

const CELLS = ["criterion", "command", "result"] as const;

function evidenceRow(row: unknown, i: number): Check<Evidence> {
  const what = `evidence ${i + 1}`;
  if (!isRecord(row)) {
    return bad(`${what} must be {criterion, command, result}`);
  }
  const extra = extras(row, CELLS);
  const cells = all(CELLS.map((c) => text(row[c], `${what} ${c}`)));
  if (extra > 0 || cells.kind === "bad") {
    return bad(
      extra > 0
        ? `${what} has ${extra} field(s) the schema does not name`
        : (cells as { readonly problem: string }).problem,
    );
  }
  const [criterion, command, result] = cells.value as [string, string, string];
  return ok({ criterion, command, result });
}

function listOf<T>(
  value: unknown,
  what: string,
  max: number,
  each: (item: unknown, i: number) => Check<T>,
): Check<readonly T[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return bad(`${what} must be a list with at least one entry`);
  }
  return value.length > max ? bad(`${what} has more than ${max} entries`) : all(value.map(each));
}

function malformed(problem: string): Outcome {
  return hostBlocked(`the report is malformed: ${problem}`);
}

// the one field each status requires; a Map, so "constructor" or "__proto__" is never a status
const FIELDS: ReadonlyMap<string, string> = new Map([
  ["done", "evidence"],
  ["asked", "questions"],
  ["blocked", "blocker"],
]);

const READ: Readonly<Record<string, (body: Field) => Outcome>> = {
  done: (body) => {
    const evidence = listOf(body.evidence, "evidence", MAX_EVIDENCE, evidenceRow);
    return evidence.kind === "ok" ? { kind: "done", evidence: evidence.value } : malformed(evidence.problem);
  },
  asked: (body) => {
    const questions = listOf(body.questions, "questions", MAX_QUESTIONS, (q, i) => text(q, `question ${i + 1}`));
    return questions.kind === "ok" ? { kind: "asked", questions: questions.value } : malformed(questions.problem);
  },
  blocked: (body) => {
    const blocker = text(body.blocker, "blocker");
    return blocker.kind === "ok"
      ? { kind: "blocked", reason: blocker.value, by: "writer" }
      : malformed(blocker.problem);
  },
};

function json(text: string): Check<unknown> {
  try {
    // a byte-order mark is no reason to block a run
    return ok(JSON.parse(text.replace(/^\uFEFF/, "")));
  } catch {
    return bad("the report is not JSON");
  }
}

// parseReport : the outcome a report's text says, or blocked with the reason it cannot be trusted.
export function parseReport(text: string): Outcome {
  const raw = json(text);
  if (raw.kind === "bad" || !isRecord(raw.value)) {
    return hostBlocked(raw.kind === "bad" ? raw.problem : "the report must be one JSON object");
  }
  const body = raw.value;
  const status = typeof body.status === "string" ? body.status : "";
  const field = FIELDS.get(status);
  if (field === undefined) {
    return hostBlocked("the report's status must be done, asked or blocked");
  }
  const extra = extras(body, ["status", field]);
  return extra > 0
    ? hostBlocked(`the report has ${extra} field(s) the schema does not name for ${status}`)
    : READ[status]!(body);
}

// spoken : a stall time in minutes when it is whole minutes, else in seconds. Pure.
function spoken(seconds: number): string {
  return seconds > 0 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
}

function ended(end: RunEnd): string {
  switch (end.kind) {
    case "exited":
      return `the run exited ${end.code}`;
    case "hungAfterReport":
      return `the writer hung after its report for ${end.windowSeconds} s`;
    case "timedOut":
      return `the run was stopped after ${end.seconds}s`;
    case "stalled":
      return `the run printed nothing for ${spoken(end.seconds)}; the host stopped it`;
    case "cap":
      return `the run hit a cap: ${end.what}`;
    case "failed":
      return `the box failed: ${end.reason}`;
  }
}

// cleanEnd : a run decided from its report: it exited 0, or it hung after a valid report (#182; ADR-0012 S13)
function cleanEnd(end: RunEnd): boolean {
  return (end.kind === "exited" && end.code === 0) || end.kind === "hungAfterReport";
}

// decide : the outcome of one writer run. A run that did not exit 0 is blocked whatever its report says, unless it
// hung after a valid report: that one is decided from the report, read again after the box stopped.
export function decide(input: { readonly end: RunEnd; readonly file: ReportFile }): Outcome {
  if (!cleanEnd(input.end)) {
    return hostBlocked(ended(input.end));
  }
  switch (input.file.kind) {
    case "missing":
      return hostBlocked(`the run wrote no ${REPORT_PATH}`);
    case "unreadable":
      return hostBlocked(`${REPORT_PATH} cannot be read: ${input.file.reason}`);
    case "text":
      return parseReport(input.file.text);
  }
}

type Dir =
  | { readonly kind: "dir"; readonly dev: number; readonly ino: number }
  | { readonly kind: "missing" }
  | { readonly kind: "other" };

// a folder that is a real folder, not a symlink
async function realDir(path: string): Promise<Dir> {
  try {
    const s = await lstat(path);
    return s.isDirectory() && !s.isSymbolicLink() ? { kind: "dir", dev: s.dev, ino: s.ino } : { kind: "other" };
  } catch (error) {
    return (error as { code?: string }).code === "ENOENT" ? { kind: "missing" } : { kind: "other" };
  }
}

function sameDir(a: Dir, b: Dir): boolean {
  return a.kind === "dir" && b.kind === "dir" && a.dev === b.dev && a.ino === b.ino;
}

// readCapped : the file's text when it is a regular file of at most MAX_REPORT_BYTES, even if it grew since a check
async function readCapped(handle: FileHandle): Promise<ReportFile> {
  const s = await handle.stat();
  if (!s.isFile()) {
    return { kind: "unreadable", reason: "it is not a regular file" };
  }
  const buffer = Buffer.alloc(MAX_REPORT_BYTES + 1);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  return bytesRead > MAX_REPORT_BYTES
    ? { kind: "unreadable", reason: `it is larger than ${MAX_REPORT_BYTES} bytes` }
    : { kind: "text", text: buffer.subarray(0, bytesRead).toString("utf8") };
}

function openFailure(error: unknown): ReportFile {
  const code = (error as { code?: string }).code;
  return code === "ENOENT"
    ? { kind: "missing" }
    : { kind: "unreadable", reason: code === "ELOOP" ? "it is a symlink" : "it cannot be opened" };
}

// openReport : the report under a .factory already checked; O_NOFOLLOW refuses a symlink in the last step, O_NONBLOCK
// keeps a FIFO from hanging the host
async function openReport(worktree: string, before: Dir): Promise<ReportFile> {
  try {
    const handle = await open(
      join(worktree, REPORT_PATH),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      // .factory is still the folder that was checked, so the file opened is the one inside it
      const after = await realDir(join(worktree, ".factory"));
      return sameDir(before, after)
        ? await readCapped(handle)
        : { kind: "unreadable", reason: ".factory changed while it was read" };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return openFailure(error);
  }
}

// loadReport : the report in a worktree, read without following a symlink and at most MAX_REPORT_BYTES. Decide a run
// only from a read after the box has stopped: while the writer runs, a read (run.ts's poll) only starts the completion
// window, since the writer can still change the folder between the checks and the open.
export async function loadReport(input: { readonly worktree: string }): Promise<ReportFile> {
  const dir = await realDir(join(input.worktree, ".factory"));
  if (dir.kind !== "dir") {
    return dir.kind === "missing"
      ? { kind: "missing" }
      : { kind: "unreadable", reason: ".factory is not a plain folder" };
  }
  return openReport(input.worktree, dir);
}
