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
// schema does not name, a non-zero exit, a timeout, a cap hit, or a box that failed. No outcome is guessed.
//
// The writer controls its worktree, so the read is careful: .factory and the report must be a real folder and a real
// regular file (never a symlink, which could point the host at ~/.ssh), at most 64 KiB. A reason never quotes the
// file, since a malformed report could be anything the writer read.

import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";

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
  | { readonly kind: "timedOut"; readonly seconds: number }
  | { readonly kind: "cap"; readonly what: string }
  | { readonly kind: "failed"; readonly reason: string };

export type ReportFile =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable"; readonly reason: string };

// The words the writer's prompt carries, so the writer knows the schema it is held to.
export const REPORT_INSTRUCTIONS = `When you stop, write ${REPORT_PATH} in the worktree and exit. Never commit it. It is JSON with one "status":
- "done": add "evidence", a list of {"criterion", "command", "result"}, one row per acceptance criterion: the command you ran and what it showed.
- "asked": add "questions", one to five questions the spec does not answer. Never guess an answer.
- "blocked": add "blocker", what stops you. Commit the work you have first.
No other field. A missing or malformed report counts as blocked.`;

type Field = Record<string, unknown>;

function hostBlocked(reason: string): Outcome {
  return { kind: "blocked", reason, by: "host" };
}

function text(value: unknown, what: string): string | { readonly problem: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { problem: `${what} must be non-empty text` };
  }
  return value.length > MAX_TEXT ? { problem: `${what} is longer than ${MAX_TEXT} characters` } : value.trim();
}

function evidenceRow(row: unknown, i: number): Evidence | { readonly problem: string } {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return { problem: `evidence ${i + 1} must be {criterion, command, result}` };
  }
  const extra = Object.keys(row).filter((k) => !["criterion", "command", "result"].includes(k));
  if (extra.length > 0) {
    return { problem: `evidence ${i + 1} has fields the schema does not name: ${extra.join(", ")}` };
  }
  const r = row as Field;
  const cells = [text(r.criterion, `evidence ${i + 1} criterion`), text(r.command, `evidence ${i + 1} command`), text(r.result, `evidence ${i + 1} result`)];
  const bad = cells.find((c) => typeof c !== "string");
  return bad !== undefined && typeof bad !== "string" ? bad : { criterion: cells[0] as string, command: cells[1] as string, result: cells[2] as string };
}

function listOf<T>(value: unknown, what: string, max: number, each: (item: unknown, i: number) => T | { readonly problem: string }): readonly T[] | { readonly problem: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { problem: `${what} must be a list with at least one entry` };
  }
  if (value.length > max) {
    return { problem: `${what} has more than ${max} entries` };
  }
  const items = value.map(each);
  const bad = items.find((x) => typeof x === "object" && x !== null && "problem" in x);
  return bad !== undefined ? (bad as { readonly problem: string }) : (items as T[]);
}

function problem(value: unknown): value is { readonly problem: string } {
  return typeof value === "object" && value !== null && "problem" in value;
}

const FIELDS: Readonly<Record<string, string>> = { done: "evidence", asked: "questions", blocked: "blocker" };

function outcomeOf(status: string, body: Field): Outcome {
  if (status === "done") {
    const evidence = listOf(body.evidence, "evidence", MAX_EVIDENCE, evidenceRow);
    return problem(evidence) ? hostBlocked(`the report is malformed: ${evidence.problem}`) : { kind: "done", evidence };
  }
  if (status === "asked") {
    const questions = listOf(body.questions, "questions", MAX_QUESTIONS, (q, i) => text(q, `question ${i + 1}`));
    return problem(questions) ? hostBlocked(`the report is malformed: ${questions.problem}`) : { kind: "asked", questions };
  }
  const blocker = text(body.blocker, "blocker");
  return problem(blocker) ? hostBlocked(`the report is malformed: ${blocker.problem}`) : { kind: "blocked", reason: blocker, by: "writer" };
}

// parseReport : the outcome a report's text says, or blocked with the reason it cannot be trusted.
export function parseReport(text: string): Outcome {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return hostBlocked("the report is not JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return hostBlocked("the report must be one JSON object");
  }
  const body = raw as Field;
  const status = body.status;
  const field = typeof status === "string" ? FIELDS[status] : undefined;
  if (typeof status !== "string" || field === undefined) {
    return hostBlocked(`the report's status must be done, asked or blocked, got ${JSON.stringify(typeof status === "string" ? status.slice(0, 40) : typeof status)}`);
  }
  const extra = Object.keys(body).filter((k) => k !== "status" && k !== field);
  return extra.length > 0 ? hostBlocked(`the report has fields the schema does not name for ${status}: ${extra.slice(0, 5).join(", ")}`) : outcomeOf(status, body);
}

function ended(end: RunEnd): string {
  switch (end.kind) {
    case "exited":
      return `the run exited ${end.code}`;
    case "timedOut":
      return `the run was stopped after ${end.seconds}s`;
    case "cap":
      return `the run hit a cap: ${end.what}`;
    case "failed":
      return `the box failed: ${end.reason}`;
  }
}

// decide : the outcome of one writer run. A run that did not exit 0 is blocked whatever its report says.
export function decide(input: { readonly end: RunEnd; readonly file: ReportFile }): Outcome {
  if (input.end.kind !== "exited" || input.end.code !== 0) {
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

// a folder that is a real folder, not a symlink; missing is "missing"
async function realDir(path: string): Promise<"dir" | "missing" | "other"> {
  try {
    const s = await lstat(path);
    return s.isDirectory() && !s.isSymbolicLink() ? "dir" : "other";
  } catch {
    return "missing";
  }
}

// loadReport : the report in a worktree, read without following a symlink and at most MAX_REPORT_BYTES.
export async function loadReport(input: { readonly worktree: string }): Promise<ReportFile> {
  const dir = await realDir(join(input.worktree, ".factory"));
  if (dir !== "dir") {
    return dir === "missing" ? { kind: "missing" } : { kind: "unreadable", reason: ".factory is not a plain folder" };
  }
  try {
    // O_NOFOLLOW: a symlink in the last step fails here instead of being read; O_NONBLOCK: a FIFO cannot hang the host
    const handle = await open(join(input.worktree, REPORT_PATH), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const s = await handle.stat();
      if (!s.isFile() || s.size > MAX_REPORT_BYTES) {
        return { kind: "unreadable", reason: s.isFile() ? `it is larger than ${MAX_REPORT_BYTES} bytes` : "it is not a regular file" };
      }
      // read no more than the cap allows, even if the file grew since the check above
      const buffer = Buffer.alloc(MAX_REPORT_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return bytesRead > MAX_REPORT_BYTES
        ? { kind: "unreadable", reason: `it is larger than ${MAX_REPORT_BYTES} bytes` }
        : { kind: "text", text: buffer.subarray(0, bytesRead).toString("utf8") };
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code === "ENOENT" ? { kind: "missing" } : { kind: "unreadable", reason: code === "ELOOP" ? "it is a symlink" : "it cannot be opened" };
  }
}
