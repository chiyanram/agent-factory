// poll — one record of facts per open change, read from the forge as it is now (#36, #102). The dispatcher (#103)
// decides; poll only reports. It keeps no state between runs, so a restart loses nothing (ADR-0002).
//
//   !12 head=1a2b3c4d draft=yes claimed=no pipeline=success needs_human=no stop=no asks=0
//   !9 merged claimed=yes
//
//   claimed      the change carries the claim label (FACTORY_CLAIM_LABEL, default agent::claimed)
//   pipeline     the head's pipeline: success, failed, running, canceled, skipped, manual, none, or unknown:<what the
//                forge said> (#124)
//   needs_human  the change carries needs-human
//   stop         the time of a maintainer's last "/stop" (a note whose first line is exactly that), else no. The
//                dispatcher holds the change while that stop is newer than the ticket's local approval, so approving
//                again lifts it.
//   asks         [coordinator] OPEN: and [writer] OPEN: notes with no note from a project member after them (#128)
//
// There is no approved field: an approval is a local permission (`agent-factory approve`, ADR-0012 S1), never a note.
// Who wrote a note is told by notes.ts: the factory's login AND a seat prefix make an agent note; everything else is a
// person's. A project member is a GitLab Developer or more, or a GitHub collaborator with write access; a maintainer is
// a GitLab Maintainer or more, or a GitHub collaborator with write access.

import { classify, openAsks, type Note, type Readers } from "./notes.js";
import type { Result } from "./forge/api.js";
import type { Changes, Forge, OpenChange, Person, Pipeline } from "./forge/types.js";

export type Stop = { readonly kind: "none" } | { readonly kind: "stopped"; readonly at: string };

export type OpenLine = {
  readonly kind: "open";
  readonly number: number;
  readonly head: string;
  readonly draft: boolean;
  readonly claimed: boolean;
  readonly pipeline: Pipeline;
  readonly needsHuman: boolean;
  readonly stop: Stop;
  readonly asks: number;
};

export type MergedLine = { readonly kind: "merged"; readonly number: number };

export type PollLine = OpenLine | MergedLine;

export const DEFAULT_CLAIM_LABEL = "agent::claimed";

function names(team: readonly Person[], keep: (p: Person) => boolean): ReadonlySet<string> {
  return new Set(team.filter(keep).map((p) => p.name.toLowerCase()));
}

// A time that does not parse is taken as the newest, so a garbled /stop still stops.
function instant(at: string): number {
  const time = Date.parse(at);
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function firstLine(body: string): string {
  return (body.split(/\r?\n/, 1)[0] ?? "").trim();
}

// stop : a maintainer's last /stop. An agent note never counts: the template never starts a post with "/".
export function stop(input: { readonly comments: readonly Note[]; readonly readers: Readers; readonly maintainers: ReadonlySet<string> }): Stop {
  const stops = input.comments.filter(
    (note) =>
      firstLine(note.body) === "/stop" &&
      input.maintainers.has(note.author.name.toLowerCase()) &&
      classify({ note, readers: input.readers }).kind === "person",
  );
  const last = stops.reduce<Note | "none">((best, note) => (best === "none" || instant(note.at) >= instant(best.at) ? note : best), "none");
  return last === "none" ? { kind: "none" } : { kind: "stopped", at: last.at };
}

function openLine(change: OpenChange, label: string, readers: Readers, maintainers: ReadonlySet<string>): OpenLine {
  return {
    kind: "open",
    number: change.number,
    head: change.head,
    draft: change.draft,
    claimed: change.labels.includes(label),
    pipeline: change.pipeline,
    needsHuman: change.labels.includes("needs-human"),
    stop: stop({ comments: change.comments, readers, maintainers }),
    asks: openAsks({ notes: change.comments, readers }),
  };
}

// decide : the lines for what the forge answered, in change-number order.
export function decide(input: { readonly changes: Changes; readonly label: string; readonly factory: string }): readonly PollLine[] {
  const { changes, label } = input;
  const readers: Readers = { factory: input.factory, members: names(changes.team, (p) => p.level !== "guest") };
  const maintainers = names(changes.team, (p) => p.level === "maintainer");
  const lines: PollLine[] = [
    ...changes.open.map((c) => openLine(c, label, readers, maintainers)),
    ...changes.merged.map((number): MergedLine => ({ kind: "merged", number })),
  ];
  return lines.sort((a, b) => a.number - b.number);
}

function yn(value: boolean): string {
  return value ? "yes" : "no";
}

function pipelineWord(p: Pipeline): string {
  // what an unknown state said, kept to plain characters so it cannot break the line
  return p.kind === "unknown" ? `unknown:${p.raw.replace(/[^A-Za-z0-9_]/g, "_")}` : p.kind;
}

// format : one line, as the coordinator and the human read it.
export function format(input: { readonly line: PollLine; readonly mark: string }): string {
  const { line, mark } = input;
  if (line.kind === "merged") {
    return `${mark}${line.number} merged claimed=yes`;
  }
  const stopped = line.stop.kind === "stopped" ? line.stop.at : "no";
  return (
    `${mark}${line.number} head=${line.head.slice(0, 8)} draft=${yn(line.draft)} claimed=${yn(line.claimed)}` +
    ` pipeline=${pipelineWord(line.pipeline)} needs_human=${yn(line.needsHuman)} stop=${stopped} asks=${line.asks}`
  );
}

// poll : the forge's open and merged changes, decided. The factory's login comes from the forge (or FACTORY_LOGIN).
export async function poll(input: { readonly forge: Forge; readonly label: string }): Promise<Result<readonly PollLine[]>> {
  const me = await input.forge.me();
  if (me.kind === "failed") {
    return me;
  }
  const changes = await input.forge.changes({ label: input.label });
  if (changes.kind === "failed") {
    return changes;
  }
  return { kind: "ok", value: decide({ changes: changes.value, label: input.label, factory: me.value }) };
}
