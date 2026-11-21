// blockers — a spec's "## Blocked by" holds its build until each ticket it names is merged (#494; P1). Tickets that
// depend on each other would otherwise start together, and the later one would conflict with the earlier one's merge.
//
//   every blocker merged              the build may start; the first run clones a fresh default branch, with them in
//   a blocker not merged yet          wait, naming each blocker and where it stands
//   a blocker closed with no merge    needs-human: a person decides whether the ticket still waits on it
//   the ticket names itself, or the
//     blockers form a cycle           needs-human, naming the cycle
//
// A blocker that is a git host issue (a number) also counts by its issue (AC-9): closed as completed, by a person's
// change on any branch, it is merged; closed as not planned, it is closed with no merge; closed where the git host keeps
// no reason and no merged change closes or mentions it (GitLab), it is closed with no merge seen, for a person. A pass
// the git host does not answer leaves the ticket waiting; after repeated passes a person looks (AC-7).
//
// Only a ticket with no run yet is held: once its build began, its spec's blockers no longer stop it. No ticket ever
// builds on another ticket's open branch. Pure.

import type { BranchState, IssueState } from "../forge/types.js";

export type BlockerState = BranchState | "unseen";

export type BlockersView =
  | { readonly kind: "none" }
  | { readonly kind: "waiting"; readonly on: readonly { readonly ticket: string; readonly state: BlockerState }[] }
  | { readonly kind: "broken"; readonly why: string }
  | { readonly kind: "unread"; readonly why: string };

export type Blocker = {
  readonly ticket: string;
  readonly state: BlockerState;
  readonly blockedBy: readonly string[];
  readonly unread?: string;
};

const BY_ISSUE: Readonly<Record<IssueState, BlockerState | "branch">> = {
  open: "branch",
  completed: "merged",
  not_planned: "closed",
  closed: "unseen",
};

export function withIssue(branch: BranchState, issue: IssueState): BlockerState {
  const byIssue = BY_ISSUE[issue];
  return branch === "merged" || byIssue === "branch" ? branch : byIssue;
}

type Walk = {
  readonly ticket: string;
  readonly specs: ReadonlyMap<string, readonly string[]>;
  readonly done: Set<string>;
};

export function cycleFrom(ticket: string, specs: ReadonlyMap<string, readonly string[]>): readonly string[] {
  return walk({ ticket, specs, done: new Set() }, [ticket]);
}

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

const DEAD: ReadonlySet<BlockerState> = new Set(["closed", "unseen"]);

export function blockersView(ticket: string, blockedBy: readonly string[], read: readonly Blocker[]): BlockersView {
  if (blockedBy.length === 0) {
    return { kind: "none" };
  }
  const why = brokenWhy(ticket, blockedBy, read);
  if (why !== "") {
    return { kind: "broken", why };
  }
  const unread = read.filter((b) => blockedBy.includes(b.ticket) && b.unread !== undefined);
  return unread.length === 0
    ? waiting(blockedBy, read)
    : { kind: "unread", why: unread.map((b) => `${b.ticket}: ${b.unread ?? ""}`).join("; ") };
}

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

function waiting(blockedBy: readonly string[], read: readonly Blocker[]): BlockersView {
  const open = read.filter((b) => blockedBy.includes(b.ticket) && b.state !== "merged");
  return open.length === 0
    ? { kind: "none" }
    : { kind: "waiting", on: open.map((b) => ({ ticket: b.ticket, state: b.state })) };
}

export function waitingWhy(on: Extract<BlockersView, { kind: "waiting" }>["on"]): string {
  return `blocked by ${on.map((b) => `${b.ticket} (${STATE_WORDS[b.state]})`).join(", ")}: the build starts once each is merged`;
}
