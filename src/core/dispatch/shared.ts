// shared — the shared copy of an approval (docs/explanation/architecture.md section 4). Per project, the git host identity the
// factory posts with puts one templated note on the ticket's PR for each approval:
//
//   `[coordinator] approved by <human> via <door>, the hash <hash>`
//
// It goes through post.ts like every other note, so the human's name is cleaned. The note is for people to see: it
// never starts anything, and the orchestrator decides only from the local records. A reader trusts a copy only when the
// project's own factory identity posted it (sharedCopy), never because of what a note says. A note written when an
// approval also bound a design file's hash still reads, and an approval shared then keeps its old key (legacyKey), so
// it is not posted twice.

import type { ApprovalRecord } from "../approval.js";
import type { Note } from "../notes.js";
import type { Post } from "../post.js";
import { VIAS, type Via } from "../human-record.js";

export function approvalKey(record: ApprovalRecord): string {
  return `${record.spec_hash} ${record.at}`;
}

export function legacyKey(record: ApprovalRecord): string {
  return `${record.spec_hash} none ${record.at}`;
}

export function sharedNote(record: ApprovalRecord): Post {
  return {
    seat: "coordinator",
    title: `approved by ${record.by} via ${record.via}, the hash ${record.spec_hash}`,
    fields: [],
    items: [],
  };
}

export type SharedCopy = {
  readonly by: string;
  readonly via: Via;
  readonly spec: string;
  readonly at: string;
};

const LINE = new RegExp(
  `^\\[coordinator\\] approved by (.+) via (${VIAS.join("|")}), (?:the hash ([0-9a-f]{64})|spec ([0-9a-f]{64}), design (?:[0-9a-f]{64}|none))$`,
);

function copyOf(body: string, at: string): SharedCopy | "none" {
  const match = LINE.exec(body.trim());
  const via = VIAS.find((v) => v === match?.[2]);
  return match === null || via === undefined
    ? "none"
    : { by: String(match[1]), via, spec: String(match[3] ?? match[4]), at };
}

export function sharedCopy(note: Note, factory: string): SharedCopy | "none" {
  const ours = note.author.name.toLowerCase() === factory.toLowerCase();
  return ours ? copyOf(note.body, note.at) : "none";
}
