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
//   - on a line of an ADR's body whose text outside its **Today:** note is on the default branch already, that text:
//     check-adrs froze it, so the change wrote the note alone, and only the note is judged; the same line with its
//     note taken out passes
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
import type * as DocNotes from "./doc-notes.js";

const { cellEnd, isRow, noteCut }: typeof DocNotes = await import(new URL("./doc-notes.ts", import.meta.url).href);

export type Rule = "ticket" | "decided-by" | "person-date";

const WHY = "say what and why; history goes in the commit, the PR or an ADR";

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

export function applies(file: string): boolean {
  return (CODE.test(file) || file.endsWith(".md")) && !SKIP.some((s) => s.test(file));
}

type Line = { readonly text: string | undefined; readonly scope: number | undefined; readonly breaks: boolean };

function plain(text: string): string {
  return text
    .replace(/`[^`]*`/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, " ");
}

export function commentOf(line: string): string | undefined {
  if (COMMENT_LINE.test(line)) {
    return line;
  }
  const code = line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
  const at = code.search(/(?:^|\s)\/\//);
  return at < 0 ? undefined : code.slice(at);
}

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
  return isRow(text) ? text.slice(0, at) + text.slice(cellEnd(text, at)) : text.slice(0, at);
}

// opensNote : whether a Today: note starts on a line and runs on to the end of its paragraph
const opensNote = (text: string | undefined): boolean => text !== undefined && TODAY.test(text) && !isRow(text);

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

function ticketsBy(lines: readonly Read[]): ReadonlyMap<number, ReadonlySet<string>> {
  const out = new Map<number, ReadonlySet<string>>();
  for (const l of lines) {
    if (l.scope !== undefined) {
      out.set(l.scope, new Set([...(out.get(l.scope) ?? []), ...tickets(l.loose)]));
    }
  }
  return out;
}

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

function bodyStart(raws: readonly string[]): number {
  const at = raws.findIndex((r) => r.startsWith("## "));
  return at < 0 ? raws.length : at;
}

type Frozen = { readonly counts: ReadonlyMap<string, number>; readonly noted: ReadonlySet<string> };

function frozenIn(raws: readonly string[]): Frozen {
  const cuts = raws.slice(bodyStart(raws)).map(noteCut);
  const counts = new Map<string, number>();
  for (const c of cuts) {
    counts.set(c.frozen, (counts.get(c.frozen) ?? 0) + 1);
  }
  return { counts, noted: new Set(cuts.filter((c) => c.note !== "").map((c) => c.frozen)) };
}

function keptCut(raw: string, was: Frozen, now: Frozen): DocNotes.NoteCut | undefined {
  const cut = noteCut(raw);
  const held = cut.note !== "" || was.noted.has(cut.frozen);
  const copied = countOf(now, cut.frozen) > countOf(was, cut.frozen);
  return held && !copied ? cut : undefined;
}

const countOf = (f: Frozen, frozen: string): number => f.counts.get(frozen) ?? 0;

const dateBy = (dates: string, people: string): boolean => DATE.test(dates) && PERSON.test(people);

function noteRules(cut: DocNotes.NoteCut): readonly Rule[] {
  const note = plain(cut.note);
  const line = `${plain(cut.frozen)} ${note}`;
  const dated = dateBy(note, line) || dateBy(line, note);
  return [...(DECIDED_BY.test(note) ? (["decided-by"] as const) : []), ...(dated ? (["person-date"] as const) : [])];
}

function rulesOn(l: Read, cut: DocNotes.NoteCut | undefined, pointed: boolean): readonly Rule[] {
  if (cut !== undefined) {
    return noteRules(cut);
  }
  return rulesOf(l.text ?? "", tickets(l.loose).length > 0 && !pointed);
}

export function scan(file: string, text: string, added: ReadonlySet<number>, base?: string): readonly string[] {
  if (!applies(file)) {
    return [];
  }
  const raws = text.split("\n");
  const body = bodyStart(raws);
  const both =
    ADR.test(file) && base !== undefined ? ([frozenIn(base.split("\n")), frozenIn(raws)] as const) : undefined;
  const lines = withLoose(file, CODE.test(file) ? codeLines(text) : mdLines(text));
  const scopes = ticketsBy(lines);
  const cutAt = (i: number): DocNotes.NoteCut | undefined =>
    both === undefined || i < body ? undefined : keptCut(raws[i] ?? "", ...both);
  return lines.flatMap((l, i) => {
    if (!added.has(i + 1) || l.text === undefined || statusLine(file, l.text)) {
      return [];
    }
    return rulesOn(l, cutAt(i), pointer(scopes, l.scope)).map((r) => `${file}:${i + 1}: history-note: ${r}: ${WHY}`);
  });
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

function hunkLines(line: string): readonly number[] {
  const hunk = HUNK.exec(line);
  if (hunk === null) {
    return [];
  }
  const from = Number(hunk[1]);
  return Array.from({ length: hunk[2] === undefined ? 1 : Number(hunk[2]) }, (_, k) => from + k);
}

function fileOf(out: Map<string, Set<number>>, path: string): Set<number> | undefined {
  if (path === "/dev/null") {
    return undefined;
  }
  const lines = new Set<number>();
  out.set(path.replace(/^b\//, ""), lines);
  return lines;
}

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
    "--src-prefix=a/",
    "--dst-prefix=b/",
    base.out.trim(),
  ]);
  const added = new Map(addedLines(diff.out));
  const untracked = git(root, ["ls-files", "-z", "-o", "--exclude-standard"]).out.split("\0");
  for (const file of untracked.filter((f) => f !== "" && existsSync(join(root, f)))) {
    const count = readFileSync(join(root, file), "utf8").split("\n").length;
    added.set(file, new Set(Array.from({ length: count }, (_, i) => i + 1)));
  }
  const at = base.out.trim();
  const baseOf = (file: string): string | undefined => {
    const shown = ADR.test(file) ? git(root, ["show", `${at}:${file}`]) : undefined;
    return shown?.code === 0 ? shown.out : undefined;
  };
  return [...added]
    .filter(([file]) => applies(file) && existsSync(join(root, file)))
    .flatMap(([file, lines]) => scan(file, readFileSync(join(root, file), "utf8"), lines, baseOf(file)));
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
