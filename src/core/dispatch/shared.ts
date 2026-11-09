// shared — the shared copy of an approval (#227; docs/DESIGN.md section 4). Per project, the git host identity the
// factory posts with puts one templated note on the ticket's PR for each approval:
//
//   [coordinator] approved by <human> via <door>, spec <hash>, design <hash or none>
//
// It goes through post.ts like every other note, so the human's name is cleaned. The note is for people to see: it
// never starts anything, and the orchestrator decides only from the local records. A reader trusts a copy only when the
// project's own factory identity posted it (sharedCopy), never because of what a note says.

import type { ApprovalRecord } from "../approval.js";
import type { Note } from "../notes.js";
import type { Post } from "../post.js";
import { VIAS, type Via } from "../human-record.js";

// approvalKey : one approval, as the run records name it: its two hashes and when it was given. Pure.
export function approvalKey(record: ApprovalRecord): string {
  return `${record.spec_hash} ${record.design_hash} ${record.at}`;
}

// sharedNote : the note for one approval. Pure.
export function sharedNote(record: ApprovalRecord): Post {
  return {
    seat: "coordinator",
    title: `approved by ${record.by} via ${record.via}, spec ${record.spec_hash}, design ${record.design_hash}`,
    fields: [],
    items: [],
  };
}

export type SharedCopy = {
  // the name as the note shows it, cleaned
  readonly by: string;
  readonly via: Via;
  readonly spec: string;
  readonly design: string;
  readonly at: string;
};

const LINE = new RegExp(
  `^\\[coordinator\\] approved by (.+) via (${VIAS.join("|")}), spec ([0-9a-f]{64}), design ([0-9a-f]{64}|none)$`,
);

// copyOf : the copy a note's text holds, or "none". Pure.
function copyOf(body: string, at: string): SharedCopy | "none" {
  const match = LINE.exec(body.trim());
  const via = VIAS.find((v) => v === match?.[2]);
  return match === null || via === undefined
    ? "none"
    : { by: String(match[1]), via, spec: String(match[3]), design: String(match[4]), at };
}

// sharedCopy : the approval a note copies, only when the project's own factory identity posted it; "none" for any
// other note. Logins are compared without case, as the git hosts do. Pure.
export function sharedCopy(note: Note, factory: string): SharedCopy | "none" {
  const ours = note.author.name.toLowerCase() === factory.toLowerCase();
  return ours ? copyOf(note.body, note.at) : "none";
}
