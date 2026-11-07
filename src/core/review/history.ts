// history — the rounds so far, read from the reviewer's own summary notes (#22 Q2, Q5). A note counts only when it is
// the factory's (its login and the [reviewer] seat, notes.ts), so a stranger's "[reviewer] round" line is no round.
//
//   [reviewer] round N · head <sha> · patch-id <id> · Act on a · Consider b · Noted c · Dismissed d
//   [reviewer] round N reused · head <sha> · patch-id <id>

import { classify, type Note } from "../notes.js";
import { cleanField } from "../post.js";

export type Last =
  | { readonly kind: "none" }
  | { readonly kind: "round"; readonly round: number; readonly head: string; readonly patchId: string };

export type History = {
  // full rounds: a reuse line is no round
  readonly rounds: number;
  readonly last: Last;
  // the Act on count of the last full round at each patch-id
  readonly actOn: ReadonlyMap<string, number>;
  // every "- " line of the factory's summaries, to tell a protected file listed before from a new one
  readonly listed: ReadonlySet<string>;
};

const FULL = /^\[reviewer\] round (\d+) · head ([0-9a-f]{40}) · patch-id ([0-9a-f]+) · Act on (\d+)/;
const ANY = /^\[reviewer\] round (\d+)(?: reused)? · head ([0-9a-f]{40}) · patch-id ([0-9a-f]+)/;

function firstLine(body: string): string {
  return body.split(/\r?\n/, 1)[0] ?? "";
}

function reviewerNotes(notes: readonly Note[], factory: string): readonly Note[] {
  return notes.filter((note) => {
    const kind = classify({ note, readers: { factory, members: new Set() } });
    return kind.kind === "agent" && kind.seat === "reviewer";
  });
}

function lastOf(lines: readonly string[]): Last {
  const m = lines.map((l) => ANY.exec(l)).findLast((x) => x !== null);
  return m === undefined || m === null
    ? { kind: "none" }
    : { kind: "round", round: Number(m[1]), head: m[2] ?? "", patchId: m[3] ?? "" };
}

// history : rounds, the last reviewed head, and the Act on count per patch-id, from the factory's notes oldest first
export function history(input: { readonly notes: readonly Note[]; readonly factory: string }): History {
  const mine = reviewerNotes(input.notes, input.factory);
  const firsts = mine.map((n) => firstLine(n.body));
  const full = firsts.map((l) => FULL.exec(l)).filter((m): m is RegExpExecArray => m !== null);
  const actOn = new Map(full.map((m) => [m[3] ?? "", Number(m[4])] as const));
  const listed = new Set(
    mine.flatMap((n) =>
      n.body
        .split("\n")
        .filter((l) => l.startsWith("- "))
        .map((l) => l.slice(2)),
    ),
  );
  return { rounds: full.length, last: lastOf(firsts), actOn, listed };
}

// the line a protected file gets in the summary, exactly as the post template writes it
export function protectedLine(path: string): string {
  return cleanField(`Protected · ${path}`);
}
