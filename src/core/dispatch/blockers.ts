// blockers — a spec's "## Blocked by" holds its build until each ticket it names is merged (#494; P1). Tickets that
// depend on each other would otherwise start together, and the later one would conflict with the earlier one's merge.
//
//   every blocker merged              the build may start; the first run clones a fresh default branch, with them in
//   a blocker not merged yet          wait, naming each blocker and where it stands
//   a blocker closed with no merge    needs-human: a person decides whether the ticket still waits on it
//
// A blocker that is a git host issue (a number) also counts by its issue (AC-9): closed as completed, by a person's
// change on any branch, it is merged; closed as not planned, it is closed with no merge; closed where the git host keeps
// no reason and no merged change closes or mentions it (GitLab), it is closed with no merge seen, for a person.
//   the ticket names itself, or the
//     blockers form a cycle            needs-human, naming the cycle
//
// Only a ticket with no run yet is held: once its build began, its spec's blockers no longer stop it. No ticket ever
// builds on another ticket's open branch. Pure.

import type { BranchState, IssueState } from "../forge/types.js";

// where a blocker stands: its branch's changes, or "unseen" for an issue closed with no merge seen (#494 AC-9)
export type BlockerState = BranchState | "unseen";

export type BlockersView =
  | { readonly kind: "none" }
  | { readonly kind: "waiting"; readonly on: readonly { readonly ticket: string; readonly state: BlockerState }[] }
  | { readonly kind: "broken"; readonly why: string };

// what the tick read of one blocker: where its change stands, and its own spec's blockers, for the cycle check
export type Blocker = {
  readonly ticket: string;
  readonly state: BlockerState;
  readonly blockedBy: readonly string[];
};

const BY_ISSUE: Readonly<Record<IssueState, BlockerState | "branch">> = {
  open: "branch",
  completed: "merged",
  not_planned: "closed",
  closed: "unseen",
};

// withIssue : a blocker's state once its issue is read: a merge on its branch stands; else a closed issue decides,
// and an open one leaves the branch's state (#494 AC-9). Pure.
export function withIssue(branch: BranchState, issue: IssueState): BlockerState {
  const byIssue = BY_ISSUE[issue];
  return branch === "merged" || byIssue === "branch" ? branch : byIssue;
}

type Walk = {
  readonly ticket: string;
  readonly specs: ReadonlyMap<string, readonly string[]>;
  // the tickets already walked to their end without finding the ticket: never walked again, so the walk is linear
  readonly done: Set<string>;
};

// cycleFrom : a path of blockers that leads back to the ticket, or none. Pure.
export function cycleFrom(ticket: string, specs: ReadonlyMap<string, readonly string[]>): readonly string[] {
  return walk({ ticket, specs, done: new Set() }, [ticket]);
}

// walk : the first path from the end of `path` back to the ticket at its start, or none
function walk(w: Walk, path: readonly string[]): readonly string[] {
  const at = path.at(-1) ?? "";
  for (const next of w.specs.get(at) ?? []) {
    const found = stepTo(w, path, next);
    if (found.length > 0) {
      return found;
    }
  }
  w.done.add(at);
  return [];
}

function stepTo(w: Walk, path: readonly string[], next: string): readonly string[] {
  if (next === w.ticket) {
    return [...path, next];
  }
  return path.includes(next) || w.done.has(next) ? [] : walk(w, [...path, next]);
}

const STATE_WORDS: Readonly<Record<BlockerState, string>> = {
  none: "not started",
  opened: "open, not merged",
  merged: "merged",
  closed: "closed without a merge",
  unseen: "closed, no merge seen",
};

// a blocker that can never merge: a person decides whether the ticket still waits on it
const DEAD: ReadonlySet<BlockerState> = new Set(["closed", "unseen"]);

// blockersView : where the ticket's blockers leave its build. Pure.
export function blockersView(ticket: string, blockedBy: readonly string[], read: readonly Blocker[]): BlockersView {
  if (blockedBy.length === 0) {
    return { kind: "none" };
  }
  const why = brokenWhy(ticket, blockedBy, read);
  return why === "" ? waiting(blockedBy, read) : { kind: "broken", why };
}

// brokenWhy : why a person must look at the ticket's blockers: itself, a cycle, or one closed with no merge; "". Pure.
function brokenWhy(ticket: string, blockedBy: readonly string[], read: readonly Blocker[]): string {
  if (blockedBy.includes(ticket)) {
    return `the spec's "Blocked by" names ${ticket} itself`;
  }
  const specs = new Map<string, readonly string[]>([
    [ticket, blockedBy],
    ...read.map((b) => [b.ticket, b.blockedBy] as const),
  ]);
  const cycle = cycleFrom(ticket, specs);
  if (cycle.length > 0) {
    return `the "Blocked by" sections form a cycle: ${cycle.join(" → ")}`;
  }
  const dead = read.filter((b) => blockedBy.includes(b.ticket) && DEAD.has(b.state));
  return dead.length > 0 ? `blocked by ${dead.map((b) => `${b.ticket}, ${STATE_WORDS[b.state]}`).join("; ")}` : "";
}

// waiting : the blockers not merged yet; none when every one is. Pure.
function waiting(blockedBy: readonly string[], read: readonly Blocker[]): BlockersView {
  const open = read.filter((b) => blockedBy.includes(b.ticket) && b.state !== "merged");
  return open.length === 0
    ? { kind: "none" }
    : { kind: "waiting", on: open.map((b) => ({ ticket: b.ticket, state: b.state })) };
}

// waitingWhy : what the wait says, each blocker with where it stands. Pure.
export function waitingWhy(on: Extract<BlockersView, { kind: "waiting" }>["on"]): string {
  return `blocked by ${on.map((b) => `${b.ticket} (${STATE_WORDS[b.state]})`).join(", ")}: the build starts once each is merged`;
}
