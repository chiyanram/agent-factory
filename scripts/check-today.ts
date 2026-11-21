// check-today — each **Today:** note names a ticket that can still close it (#750). Two checks:
//
//   no-ticket   a safety Today: note marks a decided guardrail the code does not enforce yet; a reader must be able to
//               see what closes it. On the safety pages below, every note is that kind, so each must name a ticket:
//               #N or owner/repo#N. "What is available now" notes need no ticket and live on the other pages.
//   closed      a note in docs/, prompts/ or src/ that names tickets of this repo, none of them open, is stale: its gap
//               is closed, or it names the wrong ticket. The open tickets come from the JSON list FACTORY_OPEN_TICKETS
//               names, [{"number": N}, ...], which CI writes with the workflow's own token (.github/workflows/ci.yml).
//               make lint makes no network call, so without that file this check is skipped and says so.
//               An empty list is refused, because this repo always has an open ticket. A note that names only another
//               repo's ticket is not judged.
//
// A note runs to the end of its table cell, or of its paragraph: a blank line, a heading, a table row, a list item or
// a code fence ends it, as check-adrs reads it. In a code comment it also ends where the comment does.
//
//   node scripts/check-today.ts [ROOT]     (make lint)
//
// Runs on Node's type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type * as DocNotes from "./doc-notes.js";

const { cellEnd, ends, MARK }: typeof DocNotes = await import(new URL("./doc-notes.ts", import.meta.url).href);

export const SAFETY_PAGES: readonly string[] = [
  "docs/explanation/safety.md",
  "docs/adr/0012-safety-design-for-unattended-runs.md",
  "docs/CONSTITUTION.md",
  "docs/constitution",
];

const TICKET = /(^|[\s([,;:])([\w.-]+\/[\w.-]+)?#\d+\b/;
const TICKETS = /(^|[\s([,;:])([\w.-]+\/[\w.-]+)?#(\d+)\b/g;

const NOTE_DIRS: readonly string[] = ["docs", "prompts", "src"];
const NOTE_FILE = /\.(md|ts)$/;
const THIS_REPO = "chiyanram/agent-factory";

export type Note = { readonly file: string; readonly line: number; readonly text: string };

// notesIn : every **Today:** note of a page's text, each to the end of its table cell or its paragraph. Pure.
export function notesIn(file: string, text: string): readonly Note[] {
  const lines = text.split("\n");
  const notes: Note[] = [];
  lines.forEach((line, i) => {
    let from = line.indexOf(MARK);
    while (from >= 0) {
      notes.push({ file, line: i + 1, text: noteAt(lines, i, from) });
      from = line.indexOf(MARK, from + MARK.length);
    }
  });
  return notes;
}

function noteAt(lines: readonly string[], i: number, from: number): string {
  const line = lines[i] ?? "";
  const rest = line.slice(from + MARK.length);
  return line.trimStart().startsWith("|")
    ? cut(line.slice(from + MARK.length, cellEnd(line, from)))
    : cut([rest, ...paragraphAfter(lines, i)].join(" "));
}

function paragraphAfter(lines: readonly string[], i: number): readonly string[] {
  const inComment = COMMENT.test(lines[i] ?? "");
  const after = lines.slice(i + 1);
  const end = after.findIndex((l) => (inComment && !COMMENT.test(l)) || ends(inComment ? uncomment(l) : l));
  const run = end < 0 ? after : after.slice(0, end);
  return inComment ? run.map(uncomment) : run;
}

const COMMENT = /^\s*\/\//;

function uncomment(line: string): string {
  return line.replace(/^\s*\/\/\s?/, "");
}

function cut(text: string): string {
  const next = text.indexOf(MARK);
  return (next >= 0 ? text.slice(0, next) : text).trim();
}

export function problems(notes: readonly Note[]): readonly string[] {
  return notes
    .filter((n) => !TICKET.test(n.text))
    .map((n) => `${n.file}:${n.line} a safety Today: note names no ticket: "${n.text.slice(0, 90)}"`);
}

export function closedProblems(notes: readonly Note[], open: ReadonlySet<number>): readonly string[] {
  return notes.flatMap((n) => {
    const own = [...n.text.matchAll(TICKETS)]
      .filter((m) => m[2] === undefined || m[2].toLowerCase() === THIS_REPO)
      .map((m) => Number(m[3]));
    if (own.length === 0 || own.some((t) => open.has(t))) {
      return [];
    }
    const named = own.map((t) => `#${t}`).join(", ");
    return [`${n.file}:${n.line} a Today: note names only closed tickets (${named}): "${n.text.slice(0, 90)}"`];
  });
}

export function openTickets(json: string): ReadonlySet<number> {
  const list: unknown = JSON.parse(json);
  const numbers = Array.isArray(list) ? list.map((t: { readonly number?: unknown }) => t?.number) : [];
  const tickets = numbers.filter((n): n is number => typeof n === "number" && Number.isInteger(n));
  if (!Array.isArray(list) || tickets.length !== numbers.length) {
    throw new Error('open tickets: want a JSON list of {"number": N}');
  }
  if (tickets.length === 0) {
    throw new Error("open tickets: the list holds no open ticket, so it was not read");
  }
  return new Set(tickets);
}

export function staleNotes(
  root: string,
  openFile: string | undefined,
): { readonly skipped: boolean; readonly problems: readonly string[] } {
  if (openFile === undefined || openFile === "") {
    return { skipped: true, problems: [] };
  }
  if (!existsSync(openFile)) {
    throw new Error(`open tickets: FACTORY_OPEN_TICKETS names ${openFile}, which is not there`);
  }
  const open = openTickets(readFileSync(openFile, "utf8"));
  const notes = noteFiles(root).flatMap((file) => notesIn(file, readFileSync(join(root, file), "utf8")));
  return { skipped: false, problems: closedProblems(notes, open) };
}

function noteFiles(root: string): readonly string[] {
  return NOTE_DIRS.filter((dir) => existsSync(join(root, dir)))
    .flatMap((dir) => readdirSync(join(root, dir), { recursive: true, encoding: "utf8" }).map((f) => join(dir, f)))
    .filter((f) => NOTE_FILE.test(f))
    .toSorted();
}

function pageFiles(root: string): readonly string[] {
  return SAFETY_PAGES.flatMap((page) => {
    const path = join(root, page);
    if (!existsSync(path)) {
      return [];
    }
    return page.endsWith(".md") ? [page] : markdownIn(root, page);
  });
}

function markdownIn(root: string, dir: string): readonly string[] {
  return readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `${dir}/${f}`);
}

function closedCheck(root: string): ReturnType<typeof staleNotes> {
  try {
    return staleNotes(root, process.env.FACTORY_OPEN_TICKETS);
  } catch (e) {
    console.error(`check-today: ${e instanceof Error ? e.message : String(e)}`);
    return process.exit(1);
  }
}

if (process.argv[1] === import.meta.filename) {
  const root = process.argv[2] ?? ".";
  const found = pageFiles(root).flatMap((file) => problems(notesIn(file, readFileSync(join(root, file), "utf8"))));
  const stale = closedCheck(root);
  for (const p of [...found, ...stale.problems]) {
    console.error(p);
  }
  if (stale.skipped) {
    console.error("check-today: FACTORY_OPEN_TICKETS is not set, so the closed-ticket check is skipped (CI runs it)");
  }
  if (found.length > 0) {
    console.error(
      `check-today: ${found.length} safety Today: note(s) name no ticket; name the ticket that closes each, or the known safety gaps ticket`,
    );
  }
  if (stale.problems.length > 0) {
    console.error(
      `check-today: ${stale.problems.length} Today: note(s) name only closed tickets; drop the note if its gap is closed, else name the open ticket that closes it, or #674`,
    );
  }
  if (found.length > 0 || stale.problems.length > 0) {
    process.exit(1);
  }
}
