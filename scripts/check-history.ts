// check-history — a comment or doc line says what and why, never who decided, when, or on which ticket. History
// lives in the git log, the PR, the ADRs and the map. This check fails each history note on a line the change ADDS,
// against the merge base with the default branch; old notes go when a file is touched anyway. A note is:
//
//   ticket       a ticket reference: a hash and a number, alone or after owner/repo
//   decided-by   approved, decided, agreed or signed off, then "by"
//   person-date  an ISO date on the same line as a person or a decision: operator, maintainer, @login, decided, ...
//
// Judged: the comment text of a code file (.ts .mts .cts .js .mjs .cjs), and the prose of a .md file, with inline
// code, link targets, URLs, headings and fenced blocks taken out. Not judged: the files that record or list history
// (SKIP below) and the planted input in tests/fixtures/. Allowed:
//
//   - a ticket in a Today: note, to the end of its paragraph or table cell, since the note names what closes it
//   - one pointer per module header or doc section: a code file's leading comment block, or a markdown section, may
//     hold one distinct ticket; outside its header block, code holds none
//   - an ADR's Status: line, and the last cell of an ADR table row (its "from" column)
//
//   node scripts/check-history.ts [ROOT]     (make lint)
//
// The default branch is FACTORY_BASE_REF, else origin/<GITHUB_BASE_REF> on a pull request, else origin/main, as
// check-musts reads it; CI checks out with fetch-depth 0, so it is there. Uncommitted and untracked files count, so a
// local run sees the change before it is committed. Runs on Node's type stripping (Node 22.18+), so it uses only
// erasable TypeScript.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Rule = "ticket" | "decided-by" | "person-date";

const WHY = "say what and why; history goes in the commit, the PR or an ADR";

// the files that record or list history, or hold planted input
const SKIP: readonly RegExp[] = [
  /^CHANGELOG\.md$/,
  /^\.github\//,
  /^tests\/fixtures\//,
  /^evals\//,
  /^plugins\/[^/]+\/lib\//,
  /^docs\/explanation\/roadmap\.md$/,
  /^docs\/agents\//,
];

const CODE = /\.(?:ts|mts|cts|js|mjs|cjs)$/;
const ADR = /^docs\/adr\/\d{4}-.*\.md$/;

const TICKET = /(?:^|[\s([,;:])((?:[\w.-]+\/[\w.-]+)?#\d+)\b/g;
const DECIDED_BY = /\b(?:approved|decided|agreed|signed off)\s+by\b/i;
const DATE = /\b20\d\d-\d\d-\d\d\b/;
const PERSON = /\b(?:operator|maintainer|decided|approved|agreed)\b|@[\w-]+/i;
const TODAY = /\bToday:/;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
const ITEM = /^\s*(?:[-*+]|\d+\.)\s/;

// applies : whether a file is judged at all
export function applies(file: string): boolean {
  return (CODE.test(file) || file.endsWith(".md")) && !SKIP.some((s) => s.test(file));
}

// a line as the check reads it: its judged text (undefined when not judged), its scope for the one-pointer rule
// (undefined when no ticket may stand outside a Today note) and whether it ends a paragraph
type Line = { readonly text: string | undefined; readonly scope: number | undefined; readonly breaks: boolean };

// plain : what names a path, a link, a URL or code taken out of a line, as check-words does
function plain(text: string): string {
  return text
    .replace(/`[^`]*`/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, " ");
}

// commentOf : the comment text of one code line: the whole line for a comment line, else what follows a trailing //
// once the line's string literals are taken out; undefined when there is none. Pure.
export function commentOf(line: string): string | undefined {
  if (COMMENT_LINE.test(line)) {
    return line;
  }
  const code = line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
  const at = code.search(/(?:^|\s)\/\//);
  return at < 0 ? undefined : code.slice(at);
}

// codeLine : one code line as the check reads it; HEADER says whether it is in the file's leading comment block
function codeLine(raw: string, header: boolean): Line {
  const comment = commentOf(raw);
  const scope = header ? 0 : undefined;
  if (comment === undefined) {
    return { text: undefined, scope, breaks: true };
  }
  const body = comment.replace(/^\s*(?:\/\/+|\/\*+|\*+\/?)/, "").trim();
  return { text: plain(comment), scope, breaks: body === "" || ITEM.test(body) };
}

function codeLines(text: string): readonly Line[] {
  let header = true;
  return text.split("\n").map((raw) => {
    header &&= raw.trim() === "" || COMMENT_LINE.test(raw);
    return codeLine(raw, header);
  });
}

function mdLines(text: string): readonly Line[] {
  let fenced = false;
  let section = 0;
  return text.split("\n").map((raw) => {
    if (/^\s*(?:```|~~~)/.test(raw)) {
      fenced = !fenced;
      return { text: undefined, scope: section, breaks: true };
    }
    if (fenced) {
      return { text: undefined, scope: section, breaks: false };
    }
    if (/^#{1,6}\s/.test(raw)) {
      section += 1;
      return { text: undefined, scope: section, breaks: true };
    }
    return { text: plain(raw), scope: section, breaks: raw.trim() === "" || ITEM.test(raw) };
  });
}

const isRow = (text: string): boolean => text.trimStart().startsWith("|");

// withoutFrom : an ADR's table row without its last cell, the "from" column; any other line as it is
function withoutFrom(file: string, text: string): string {
  return ADR.test(file) && isRow(text) ? text.replace(/\|[^|]*\|\s*$/, "|") : text;
}

// beforeToday : a line without the Today: note that starts on it: to the end of its cell in a table row, else to the
// end of the line
function beforeToday(text: string): string {
  const at = text.search(TODAY);
  if (at < 0) {
    return text;
  }
  const cellEnd = text.indexOf("|", at);
  return isRow(text) && cellEnd >= 0 ? text.slice(0, at) + text.slice(cellEnd) : text.slice(0, at);
}

// opensNote : whether a Today: note starts on a line and runs on to the end of its paragraph
const opensNote = (text: string | undefined): boolean => text !== undefined && TODAY.test(text) && !isRow(text);

// a line with the part of it that may not hold a ticket
type Read = Line & { readonly loose: string };

// withLoose : each line with the part that may not hold a ticket: none while it goes on a Today: note
function withLoose(file: string, lines: readonly Line[]): readonly Read[] {
  let note = false;
  return lines.map((l) => {
    const inNote = note && !l.breaks;
    note = inNote || opensNote(l.text);
    return { ...l, loose: l.text === undefined || inNote ? "" : beforeToday(withoutFrom(file, l.text)) };
  });
}

function tickets(text: string): readonly string[] {
  return [...text.matchAll(TICKET)].map((m) => m[1] ?? "");
}

// ticketsBy : the distinct tickets of each scope, a header block or a doc section
function ticketsBy(lines: readonly Read[]): ReadonlyMap<number, ReadonlySet<string>> {
  const out = new Map<number, ReadonlySet<string>>();
  for (const l of lines) {
    if (l.scope !== undefined) {
      out.set(l.scope, new Set([...(out.get(l.scope) ?? []), ...tickets(l.loose)]));
    }
  }
  return out;
}

// pointer : whether a ticket on a line in this scope is the scope's one pointer
function pointer(scopes: ReadonlyMap<number, ReadonlySet<string>>, scope: number | undefined): boolean {
  return scope !== undefined && (scopes.get(scope)?.size ?? 0) <= 1;
}

function rulesOf(text: string, ticketed: boolean): readonly Rule[] {
  return [
    ...(ticketed ? (["ticket"] as const) : []),
    ...(DECIDED_BY.test(text) ? (["decided-by"] as const) : []),
    ...(DATE.test(text) && PERSON.test(text) ? (["person-date"] as const) : []),
  ];
}

const statusLine = (file: string, text: string): boolean => ADR.test(file) && text.startsWith("Status:");

// scan : file:line, the rule and the reason, for each history note on an added line of one file's text. The context
// (Today notes, the header block, a section's pointer, fences) is read from the whole text; only lines whose number
// is in ADDED are reported. Pure.
export function scan(file: string, text: string, added: ReadonlySet<number>): readonly string[] {
  if (!applies(file)) {
    return [];
  }
  const lines = withLoose(file, CODE.test(file) ? codeLines(text) : mdLines(text));
  const scopes = ticketsBy(lines);
  return lines.flatMap((l, i) => {
    if (!added.has(i + 1) || l.text === undefined || statusLine(file, l.text)) {
      return [];
    }
    const ticketed = tickets(l.loose).length > 0 && !pointer(scopes, l.scope);
    return rulesOf(l.text, ticketed).map((r) => `${file}:${i + 1}: history-note: ${r}: ${WHY}`);
  });
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

// hunkLines : the line numbers a -U0 hunk header adds; none when the line is not a hunk header. Pure.
function hunkLines(line: string): readonly number[] {
  const hunk = HUNK.exec(line);
  if (hunk === null) {
    return [];
  }
  const from = Number(hunk[1]);
  return Array.from({ length: hunk[2] === undefined ? 1 : Number(hunk[2]) }, (_, k) => from + k);
}

// fileOf : the set that collects a file's added lines, from a "+++ " path; none for a deleted file
function fileOf(out: Map<string, Set<number>>, path: string): Set<number> | undefined {
  if (path === "/dev/null") {
    return undefined;
  }
  const lines = new Set<number>();
  out.set(path.replace(/^b\//, ""), lines);
  return lines;
}

// addedLines : the added line numbers of each file in a -U0 diff's output. Pure.
export function addedLines(diff: string): ReadonlyMap<string, ReadonlySet<number>> {
  const out = new Map<string, Set<number>>();
  let current: Set<number> | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      current = fileOf(out, line.slice(4));
      continue;
    }
    for (const n of hunkLines(line)) {
      current?.add(n);
    }
  }
  return out;
}

// baseRef : the default branch to compare with
export function baseRef(env: NodeJS.ProcessEnv): string {
  const pr = env.GITHUB_BASE_REF ?? "";
  return env.FACTORY_BASE_REF || (pr === "" ? "origin/main" : `origin/${pr}`);
}

function git(root: string, args: readonly string[]): { readonly code: number; readonly out: string } {
  const r = spawnSync("git", ["-C", root, "-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status ?? -1, out: r.stdout };
}

// problems : each history note on a line the working tree adds against the merge base, or why it cannot tell
function problems(root: string, env: NodeJS.ProcessEnv): readonly string[] {
  const ref = baseRef(env);
  const base = git(root, ["merge-base", ref, "HEAD"]);
  if (base.code !== 0) {
    return [`check-history: cannot find the default branch ${ref}; fetch it or set FACTORY_BASE_REF`];
  }
  const diff = git(root, [
    "diff",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--no-renames",
    "--diff-filter=AM",
    base.out.trim(),
  ]);
  const added = new Map(addedLines(diff.out));
  const untracked = git(root, ["ls-files", "-z", "-o", "--exclude-standard"]).out.split("\0");
  for (const file of untracked.filter((f) => f !== "" && existsSync(join(root, f)))) {
    const count = readFileSync(join(root, file), "utf8").split("\n").length;
    added.set(file, new Set(Array.from({ length: count }, (_, i) => i + 1)));
  }
  return [...added]
    .filter(([file]) => applies(file) && existsSync(join(root, file)))
    .flatMap(([file, lines]) => scan(file, readFileSync(join(root, file), "utf8"), lines));
}

if (process.argv[1] === import.meta.filename) {
  const found = problems(process.argv[2] ?? ".", process.env);
  for (const f of found) {
    console.log(f);
  }
  if (found.length > 0) {
    console.log(`check-history: ${found.length} history note(s) on added lines; ${WHY}`);
    process.exit(1);
  }
}
