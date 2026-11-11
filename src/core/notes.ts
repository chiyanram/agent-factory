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
// An ask is an agent note whose first line starts "[coordinator] OPEN:" or "[writer] OPEN:". It stays open until the
// notes of project members after it name a choice for every question it asks (answers.ts, #486): a reply that answers
// some, a note that is itself a question, or a bot's note keeps it open. Logins are compared without case, and notes are ordered by the
// instant they were written.
//
// Agent commits carry an "Agent: <seat>" trailer, so the history shows which commits an agent made even under the
// developer's own login. commitKind reads it as git reads trailers, so what it counts is what `git log` shows.

import { questionsIn, roundOf, type Answer, type Round } from "./answers.js";
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

// A login is compared without case: GitHub and GitLab both treat "Ram" and "ram" as one account.
function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

const SEAT_LINE = /^\[(writer|reviewer|coordinator)\] /;
// The reviewer's line findings were once posted as "`file:line` [reviewer] …"; a note in that form is still the factory's.
const OLD_LINE_FINDING = /^`[^`\n]+` \[(reviewer)\] /;
const ASK_LINE = /^\[(coordinator|writer)\] OPEN:/;

function firstLine(body: string): string {
  return body.split(/\r?\n/, 1)[0] ?? "";
}

function seatOf(line: string): Seat | undefined {
  return (SEAT_LINE.exec(line)?.[1] ?? OLD_LINE_FINDING.exec(line)?.[1]) as Seat | undefined;
}

// classify : one note, by its author and its first line.
export function classify(request: { readonly note: Note; readonly readers: Readers }): NoteKind {
  const { note, readers } = request;
  const line = firstLine(note.body);
  const seat = seatOf(line);
  if (seat !== undefined && same(note.author.name, readers.factory)) {
    return { kind: "agent", seat, ask: ASK_LINE.test(line) };
  }
  const member = [...readers.members].some((name) => same(name, note.author.name));
  return { kind: "person", member };
}

function isAsk(kind: NoteKind): boolean {
  return kind.kind === "agent" && kind.ask;
}

function isMemberReply(kind: NoteKind): boolean {
  return kind.kind === "person" && kind.member;
}

// A note's place in time. A time the forge sent that does not parse is put where it keeps an ask open: an ask last,
// any other note first, so a bad timestamp never closes an ask.
function when(at: string, kind: NoteKind): number {
  const time = Date.parse(at);
  if (!Number.isNaN(time)) {
    return time;
  }
  return isAsk(kind) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
}

type Read = { readonly note: Note; readonly kind: NoteKind; readonly time: number };

// inOrder : every note with its kind, by the instant it was written, not the text of its time, since a forge may
// write "+01:00" or leave out the milliseconds
function inOrder(request: { readonly notes: readonly Note[]; readonly readers: Readers }): readonly Read[] {
  return request.notes
    .map((note) => {
      const kind = classify({ note, readers: request.readers });
      return { note, kind, time: when(note.at, kind) };
    })
    .toSorted((a, b) => a.time - b.time);
}

// rounds : each ask, in time order, with where its round stands: answered once the members' notes after it name a
// choice for every question it asked (answers.ts, #486)
function rounds(request: { readonly notes: readonly Note[]; readonly readers: Readers }): readonly Round[] {
  const read = inOrder(request);
  return read.flatMap((r, i) => {
    if (!isAsk(r.kind)) {
      return [];
    }
    const replies = read
      .slice(i + 1)
      .filter((x) => isMemberReply(x.kind))
      .map((x) => x.note.body);
    return [roundOf(questionsIn(r.note.body), replies)];
  });
}

// openAsks : how many asks are not answered yet: a member's note after an ask closes it only when, with the members'
// other notes after it, it names a choice for every question the ask holds (#486; answers.ts)
export function openAsks(request: { readonly notes: readonly Note[]; readonly readers: Readers }): number {
  return rounds(request).filter((r) => r.kind === "open").length;
}

// lastAnswers : the newest ask's answers, when it is answered; none while it is open, or with no ask at all. The next
// writer run receives them as a typed field (#486).
export function lastAnswers(request: {
  readonly notes: readonly Note[];
  readonly readers: Readers;
}): readonly Answer[] {
  const last = rounds(request).at(-1);
  return last?.kind === "answered" ? last.answers : [];
}

const SEATS: readonly Seat[] = ["writer", "reviewer", "coordinator"];

// agentTrailer : the trailer line an agent commit carries.
export function agentTrailer(request: { readonly seat: Seat }): string {
  return `Agent: ${request.seat}`;
}

export type CommitKind = { readonly kind: "agent"; readonly seat: Seat } | { readonly kind: "person" };

// A trailer line as git reads one: a key of letters, digits and "-", optional space, ":", the value. A line that
// starts with white space continues the trailer above it.
const TRAILER = /^([A-Za-z0-9-]+)\s*:\s*(.*)$/;
const CONTINUED = /^\s+\S/;
// the lines git itself writes, which let a block with other lines in it still count (git interpret-trailers)
const GIT_WRITTEN = /^(Signed-off-by\s*:|\(cherry picked from commit )/i;

type Trailer = { readonly key: string; readonly value: string };
type Block = { readonly trailers: readonly Trailer[]; readonly other: number; readonly gitWritten: boolean };

function readBlock(lines: readonly string[]): Block {
  const trailers: Trailer[] = [];
  let other = 0;
  for (const line of lines) {
    const match = TRAILER.exec(line);
    const last = trailers.at(-1);
    if (match !== null) {
      trailers.push({ key: match[1]!, value: match[2]!.trim() });
    } else if (CONTINUED.test(line) && last !== undefined) {
      trailers[trailers.length - 1] = { key: last.key, value: `${last.value} ${line.trim()}` };
    } else {
      other += 1;
    }
  }
  return { trailers, other, gitWritten: lines.some((line) => GIT_WRITTEN.test(line)) };
}

// git's rule: the last paragraph is the trailer block when every line in it is a trailer, or when a quarter of it is
// and one of those is a line git writes. The first paragraph is the subject and never one.
function trailerBlock(message: string): readonly Trailer[] {
  const paragraphs = message
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n(?:[ \t]*\n)+/);
  if (paragraphs.length < 2) {
    return [];
  }
  const block = readBlock((paragraphs.at(-1) ?? "").split("\n"));
  const all = block.other === 0;
  const enough = block.gitWritten && block.trailers.length * 3 >= block.other;
  return all || enough ? block.trailers : [];
}

// commitKind : an agent commit has an "Agent: <seat>" trailer, read as git reads trailers; the key is matched without
// case, and an unknown seat makes it a person's commit.
export function commitKind(request: { readonly message: string }): CommitKind {
  const agent = trailerBlock(request.message).find((t) => t.key.toLowerCase() === "agent");
  const seat = SEATS.find((s) => s === agent?.value);
  return seat !== undefined ? { kind: "agent", seat } : { kind: "person" };
}
