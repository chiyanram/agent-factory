// cites — every file:line the brief and glossary keep, checked again on each run (#235; the onboarder card's step 8).
// A cite is stale when the default branch no longer holds its file, or its line no longer reads as it did when the
// brief was written; when that text is now at another line, the report says where. A stale cite is reported in the
// run record for the retro; the brief itself changes only when the onboarder runs again and a human accepts it. Pure.

import type { KeptCite } from "./brief.js";

// staleCites : one line per stale cite, as a person reads it
export function staleCites(
  cites: readonly KeptCite[],
  lines: (path: string) => readonly string[] | undefined,
): readonly string[] {
  return cites.flatMap((c) => staleOne(c, lines(c.file)));
}

// staleOne : why one cite is stale, or nothing
function staleOne(c: KeptCite, now: readonly string[] | undefined): readonly string[] {
  if (now === undefined) {
    return [`${c.line === 0 ? c.file : `${c.file}:${c.line}`} is stale: the file is gone`];
  }
  if (c.line === 0 || now[c.line - 1] === c.text) {
    return [];
  }
  return [`${c.file}:${c.line} is stale: ${movedTo(now, c.text)}`];
}

// movedTo : where a cite's line went, as a person reads it
function movedTo(now: readonly string[], text: string): string {
  const moved = now.indexOf(text);
  return moved < 0 ? "its line changed" : `its line is now at ${moved + 1}`;
}
