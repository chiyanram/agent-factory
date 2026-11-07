// notes — which notes on a change are the factory's and which are people's, and which asks are still open (#128;
// ADR-0012 S14).
//
// At work the factory posts with the developer's own login, so a note's author no longer says whether an agent wrote
// it: the developer's own reply and the dispatcher's post share one name. The factory's notes are told apart by their
// first line instead, which the posting template (#126) always writes as "[writer] …", "[reviewer] …" or
// "[coordinator] …". A seat prefix alone is not enough, because anyone who can comment can type one: a stranger's
// "[writer] OPEN:" would then hold the change as an open ask (#85, item 2). So a note is the factory's only when it
// has a seat prefix AND comes from the identity the factory posts with (the developer's login, or the project's bot).
//
//   agent   the factory's identity, and a seat prefix on line 1
//   person  anyone else, or the factory's identity with no seat prefix (the developer typing a reply)
// An ask is an agent note whose first line starts "[coordinator] OPEN:" or "[writer] OPEN:". It stays open until a
// person who is a project member writes after it.
//
// Agent commits carry an "Agent: <seat>" trailer, so the history shows which commits an agent made even under the
// developer's own login.

import type { Seat } from "./post.js";

export type Author = { readonly name: string };
export type Note = { readonly body: string; readonly author: Author; readonly at: string };

export type NoteKind =
  | { readonly kind: "agent"; readonly seat: Seat; readonly ask: boolean }
  | { readonly kind: "person"; readonly member: boolean };

export type Readers = {
  // the login the factory posts with: the developer's own, or the project's bot
  readonly factory: string;
  // the people who may answer an ask: the project's members
  readonly members: ReadonlySet<string>;
};

const SEAT_LINE = /^\[(writer|reviewer|coordinator)\] /;
const ASK_LINE = /^\[(coordinator|writer)\] OPEN:/;

function firstLine(body: string): string {
  return body.split(/\r?\n/, 1)[0] ?? "";
}

// classify : one note, by its author and its first line.
export function classify(request: { readonly note: Note; readonly readers: Readers }): NoteKind {
  const { note, readers } = request;
  const line = firstLine(note.body);
  const seat = SEAT_LINE.exec(line)?.[1] as Seat | undefined;
  if (seat !== undefined && note.author.name === readers.factory) {
    return { kind: "agent", seat, ask: ASK_LINE.test(line) };
  }
  return { kind: "person", member: readers.members.has(note.author.name) };
}

function isAsk(kind: NoteKind): boolean {
  return kind.kind === "agent" && kind.ask;
}

function isMemberReply(kind: NoteKind): boolean {
  return kind.kind === "person" && kind.member;
}

// openAsks : how many asks have no member's note after them. Notes are taken in time order.
export function openAsks(request: { readonly notes: readonly Note[]; readonly readers: Readers }): number {
  const kinds = [...request.notes]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((note) => classify({ note, readers: request.readers }));
  const lastReply = kinds.map(isMemberReply).lastIndexOf(true);
  return kinds.filter((kind, i) => i > lastReply && isAsk(kind)).length;
}

const SEATS: readonly Seat[] = ["writer", "reviewer", "coordinator"];

// agentTrailer : the trailer line an agent commit carries.
export function agentTrailer(seat: Seat): string {
  return `Agent: ${seat}`;
}

export type CommitKind = { readonly kind: "agent"; readonly seat: Seat } | { readonly kind: "person" };

// commitKind : an agent commit has an "Agent: <seat>" line in its last paragraph, the trailer block git reads; the
// subject alone never counts.
export function commitKind(message: string): CommitKind {
  const paragraphs = message.replace(/\r\n?/g, "\n").trim().split(/\n\s*\n/);
  // the subject is never a trailer block
  const trailers = paragraphs.length > 1 ? (paragraphs.at(-1) ?? "").split("\n") : [];
  const seat = trailers.map((line) => /^Agent: (\S+)\s*$/.exec(line)?.[1]).find((s) => s !== undefined);
  return seat !== undefined && (SEATS as readonly string[]).includes(seat) ? { kind: "agent", seat: seat as Seat } : { kind: "person" };
}
