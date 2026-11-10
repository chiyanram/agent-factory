// musts — the project's MUSTs, read by the engine itself from the repo's root AGENTS.md and CLAUDE.md (#383; the
// onboarder card's step 1). The model run never sees those files (review/code.ts prunes every rule file from its copy),
// so no model can leave a MUST out of the brief or say the file is not there: the engine finds each one and the brief
// carries it in "Project rules", one line each, cited to its line so every run checks it again (cites.ts).
//
// A MUST is
//   - every list item under a heading that says MUST (such as "## MUSTs"), until the next heading of that level or above
//   - anywhere else, a list item, table row or paragraph with MUST, MUST NOT, SHALL or NEVER in capitals (RFC 2119)
// A list item or paragraph that wraps is one MUST; it is cited at its first line (under a MUST heading) or at the line
// that holds the word. Fenced code is skipped. Pure.

// the root instruction files the engine reads, in the order the brief lists their MUSTs
export const RULE_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

export type Must = { readonly file: string; readonly line: number; readonly text: string };

const MOST_CHARS = 400;
const WORD = /\b(?:MUST|SHALL|NEVER)\b/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/;
const FENCE = /^\s*(?:```|~~~)/;

// a run of lines the reader takes as one statement: a list item, a table row or a paragraph, and whether it sits
// under a MUST heading
type Unit = { readonly first: number; readonly lines: string[]; readonly bullet: boolean; readonly must: boolean };

type Scan = { readonly out: Unit[]; open: Unit | undefined; fenced: boolean; mustLevel: number };

const isRow = (line: string): boolean => line.trimStart().startsWith("|");

function endUnit(scan: Scan): void {
  if (scan.open !== undefined) {
    scan.out.push(scan.open);
    scan.open = undefined;
  }
}

// levelAfter : the level of the MUST heading a heading leaves the scan under, or 0 for none
function levelAfter(current: number, heading: RegExpExecArray): number {
  const [, hashes = "", title = ""] = heading;
  if (/\bMUST[Ss]?\b/.test(title)) {
    return hashes.length;
  }
  return hashes.length > current ? current : 0;
}

// broken : a heading or a blank line ends the statement; a heading also sets the MUST level
function broken(scan: Scan, line: string): boolean {
  const heading = HEADING.exec(line);
  if (heading === null && line.trim() !== "") {
    return false;
  }
  endUnit(scan);
  if (heading !== null) {
    scan.mustLevel = levelAfter(scan.mustLevel, heading);
  }
  return true;
}

function startsUnit(scan: Scan, line: string): boolean {
  return BULLET.test(line) || isRow(line) || scan.open === undefined || isRow(scan.open.lines[0] ?? "");
}

function added(scan: Scan, line: string, at: number): void {
  if (scan.open !== undefined && !startsUnit(scan, line)) {
    scan.open.lines.push(line);
    return;
  }
  endUnit(scan);
  scan.open = { first: at, lines: [line], bullet: BULLET.test(line), must: scan.mustLevel > 0 };
}

function step(scan: Scan, line: string, at: number): void {
  if (FENCE.test(line)) {
    endUnit(scan);
    scan.fenced = !scan.fenced;
  } else if (!scan.fenced && !broken(scan, line)) {
    added(scan, line, at);
  }
}

// units : the file's statements; fenced code and headings are not statements
function units(lines: readonly string[]): readonly Unit[] {
  const scan: Scan = { out: [], open: undefined, fenced: false, mustLevel: 0 };
  lines.forEach((line, i) => step(scan, line, i + 1));
  endUnit(scan);
  return scan.out;
}

// oneLine : a statement as one line of the brief, its list marker gone, cut to a length a brief can hold
function oneLine(lines: readonly string[]): string {
  const text = lines.join(" ").replace(BULLET, "").replace(/\s+/g, " ").trim();
  return text.length > MOST_CHARS ? `${text.slice(0, MOST_CHARS - 1)}…` : text;
}

// mustsIn : every MUST one instruction file states, at its line
export function mustsIn(file: string, lines: readonly string[]): readonly Must[] {
  return units(lines).flatMap((u) => {
    const at = u.lines.findIndex((l) => WORD.test(l));
    if (u.must && u.bullet) {
      return [{ file, line: u.first, text: oneLine(u.lines) }];
    }
    return at < 0 ? [] : [{ file, line: u.first + at, text: oneLine(u.lines) }];
  });
}

// projectMusts : every MUST the root instruction files state, a MUST two files repeat word for word given once
export function projectMusts(lines: (path: string) => readonly string[] | undefined): readonly Must[] {
  const all = RULE_FILES.flatMap((f) => {
    const text = lines(f);
    return text === undefined ? [] : mustsIn(f, text);
  });
  return all.filter((m, i) => all.findIndex((n) => n.text === m.text) === i);
}
