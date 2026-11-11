// check-today — each safety **Today:** note names the ticket that closes it (#482; #460 step 2 item 12). A safety
// Today: note marks a decided guardrail the code does not enforce yet; a reader must be able to see what closes it. On
// the safety pages below, every **Today:** note is that kind, so each must name a ticket: #N or owner/repo#N. A note
// runs to the end of its table cell, or of its paragraph. "What is available now" notes need no ticket and live on the
// other pages.
//
//   node scripts/check-today.ts [ROOT]     (make lint)
//
// Runs on Node's type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// the safety pages: the safety explanation, the safety ADR, and the constitution
export const SAFETY_PAGES: readonly string[] = [
  "docs/explanation/safety.md",
  "docs/adr/0012-safety-design-for-unattended-runs.md",
  "docs/CONSTITUTION.md",
  "docs/constitution",
];

const MARK = "**Today:**";
const TICKET = /(^|[\s([,;:])([\w.-]+\/[\w.-]+)?#\d+\b/;

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

// noteAt : the note that starts at a line and column: in a table row, to the cell's end; else to the paragraph's end,
// or to the next note. Pure.
function noteAt(lines: readonly string[], i: number, from: number): string {
  const line = lines[i] ?? "";
  const rest = line.slice(from + MARK.length);
  return line.trimStart().startsWith("|")
    ? cut(rest.split("|")[0] ?? "")
    : cut([rest, ...paragraphAfter(lines, i)].join(" "));
}

// paragraphAfter : the lines that go on a paragraph after line i, up to a blank line or a heading. Pure.
function paragraphAfter(lines: readonly string[], i: number): readonly string[] {
  const after = lines.slice(i + 1);
  const end = after.findIndex((l) => l.trim() === "" || l.startsWith("#"));
  return end < 0 ? after : after.slice(0, end);
}

// cut : a note's text up to the next note. Pure.
function cut(text: string): string {
  const next = text.indexOf(MARK);
  return (next >= 0 ? text.slice(0, next) : text).trim();
}

// problems : each safety note with no ticket, as file:line and its start. Pure.
export function problems(notes: readonly Note[]): readonly string[] {
  return notes
    .filter((n) => !TICKET.test(n.text))
    .map((n) => `${n.file}:${n.line} a safety Today: note names no ticket: "${n.text.slice(0, 90)}"`);
}

// pageFiles : the safety pages that are there; a folder stands for its .md files
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

if (process.argv[1] === import.meta.filename) {
  const root = process.argv[2] ?? ".";
  const found = pageFiles(root).flatMap((file) => problems(notesIn(file, readFileSync(join(root, file), "utf8"))));
  for (const p of found) {
    console.error(p);
  }
  if (found.length > 0) {
    console.error(
      `check-today: ${found.length} safety Today: note(s) name no ticket; name the ticket that closes each, or the known safety gaps ticket`,
    );
    process.exit(1);
  }
}
