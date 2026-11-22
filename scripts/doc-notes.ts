// doc-notes — how the doc checks find a **Today:** note in a line: its marker, where its paragraph or table cell ends,
// and the line's frozen text with the note cut out. check-adrs, check-today and check-history read notes through it.
// No imports, so each script loads it on Node's type stripping. Pure.

export const MARK = "**Today:**";

export function isRow(line: string): boolean {
  return line.trimStart().startsWith("|");
}

export function ends(line: string): boolean {
  return /^\s*$|^\s*\||^#{1,6}\s|^\s*([-*+]|\d+\.)\s|^\s*```/.test(line);
}

export function cellEnd(line: string, from: number): number {
  const at = line.slice(from).search(/(?<!\\)\|/);
  return at < 0 ? line.length : from + at;
}

export type NoteCut = { readonly frozen: string; readonly note: string; readonly inRow: boolean };

export function noteCut(raw: string): NoteCut {
  const line = raw.trimEnd();
  const at = line.indexOf(MARK);
  if (at < 0) {
    return { frozen: line, note: "", inRow: isRow(line) };
  }
  const before = line.slice(0, at).trimEnd();
  if (!isRow(line)) {
    return { frozen: before, note: line.slice(at), inRow: false };
  }
  const end = cellEnd(line, at);
  return { frozen: `${before} ${line.slice(end).trimStart()}`, note: line.slice(at, end), inRow: true };
}
