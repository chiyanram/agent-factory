// loop — the coordinator's note commands: status, ask and its round of questions (#138). Each reads and writes the
// forge only through the seam, posts only through the template, and answers with the one line the command prints;
// FACTORY_DRY_RUN is the seam's own wrapper (forge/index.ts). The orchestrator loop claims, releases, labels
// needs-human and reconciles a merged change itself (dispatch/tick.ts).
//
//   status     one "[coordinator] <line>" note, refused when the head moved since the run started at <sha>
//   ask        one "[writer] OPEN: <question>" note, which poll counts as an open ask; the same head rule
//   grill      one "[coordinator] OPEN: N questions" note, an item per question; the same head rule

import { questionRound } from "./finish.js";
import type { Question } from "./report.js";
import type { Result } from "./forge/api.js";
import type { Change, Forge } from "./forge/types.js";
import type { Post, Seat } from "./post.js";

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function at(forge: Forge, number: number): string {
  return `${forge.mark}${number}`;
}

const SHA = /^[0-9a-f]{7,40}$/;

// oneLine : the text, when it is one line that says something
function oneLine(text: string): boolean {
  return text.trim() !== "" && !/[\r\n]/.test(text);
}

export type AtHead = {
  readonly forge: Forge;
  readonly number: number;
  // the head the run started at: 7 to 40 hex characters
  readonly sha: string;
  readonly text: string;
};

type Note = {
  readonly seat: Seat;
  readonly title: (text: string) => string;
  readonly what: string;
  readonly verb: string;
  // the note's fields and items, for a round of questions (grill); none for a one-line note
  readonly fields?: Post["fields"];
  readonly items?: Post["items"];
};

function checkAtHead(input: AtHead, note: Note): string {
  if (!SHA.test(input.sha)) {
    return `the run's head SHA must be 7 to 40 hex characters, got ${JSON.stringify(input.sha)}`;
  }
  return oneLine(input.text) ? "" : `${note.what} is one line of text`;
}

function moved(input: AtHead, change: Change, note: Note): string {
  return change.sha.startsWith(input.sha)
    ? ""
    : `${at(input.forge, input.number)} head moved: the run started at ${input.sha}, the head is now ${change.sha.slice(0, 8)}; ${note.what} not posted`;
}

async function postAt(input: AtHead, note: Note, change: Change): Promise<Result<string>> {
  const stale = moved(input, change, note);
  if (stale !== "") {
    return failed(stale);
  }
  const post: Post = {
    seat: note.seat,
    title: note.title(input.text),
    fields: note.fields ?? [],
    items: note.items ?? [],
  };
  const posted = await input.forge.note({ number: input.number, post });
  return posted.kind === "ok"
    ? { kind: "ok", value: `${note.verb} ${at(input.forge, input.number)} at ${change.sha.slice(0, 8)}` }
    : posted;
}

// noteAtHead : one note, when the change's head is still the one the run started at; a note about an old head once
// went out in public
async function noteAtHead(input: AtHead, note: Note): Promise<Result<string>> {
  const refused = checkAtHead(input, note);
  if (refused !== "") {
    return failed(refused);
  }
  const change = await input.forge.change({ number: input.number });
  return change.kind === "ok" ? postAt(input, note, change.value) : change;
}

export function status(input: AtHead): Promise<Result<string>> {
  return noteAtHead(input, { seat: "coordinator", title: (t) => t, what: "a status note", verb: "posted" });
}

export function ask(input: AtHead): Promise<Result<string>> {
  return noteAtHead(input, { seat: "writer", title: (t) => `OPEN: ${t}`, what: "a question", verb: "asked" });
}

// grill : the coordinator's round of questions (#517), one [coordinator] OPEN: N questions note with an item per
// question in the writer's form (finish.ts questionRound), so it stays open until a member answers each; the same head
// rule as status
export function grill(
  input: Omit<AtHead, "text"> & { readonly questions: readonly Question[] },
): Promise<Result<string>> {
  const round = questionRound(input.questions);
  return noteAtHead(
    { ...input, text: round.title },
    {
      seat: "coordinator",
      title: (t) => t,
      what: "a round of questions",
      verb: `asked ${input.questions.length} question(s) on`,
      fields: [round.answer],
      items: round.items,
    },
  );
}
