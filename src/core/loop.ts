// loop — the coordinator's forge commands, ported from claim.sh, release.sh, status.sh, ask.sh, block.sh and
// reconcile.sh (#138). Each reads and writes the forge only through the seam, posts only through the template (#126),
// and answers with the one line the command prints; FACTORY_DRY_RUN is the seam's own wrapper (forge/index.ts).
//
//   claim      adds the claim label to an open change that does not carry it yet: one run at a time (ADR-0002)
//   release    removes the claim label; a change with no claim is not an error
//   status     one "[coordinator] <line>" note, refused when the head moved since the run started at <sha>
//   ask        one "[writer] OPEN: <question>" note, which poll counts as an open ask; the same head rule
//   block      needs-human first, then one "[coordinator] blocked: <reason>" note, then the claim released (ADR-0011
//              D14): a note without the label would leave the change in the queue
//   reconcile  after a restart: a claim with no live run, or left on a merged change, is released; a run's worktree
//              with no live run is removed (#39)

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { NEEDS_HUMAN } from "./finish.js";
import type { Done, Result } from "./forge/api.js";
import type { Change, Forge } from "./forge/types.js";
import { hostGit } from "./git.js";
import type { Post, Seat } from "./post.js";
import { liveRuns, type Sessions } from "./review/live.js";
import { attempt } from "./review/safe.js";

type Claimed = { readonly forge: Forge; readonly number: number; readonly label: string };

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function at(forge: Forge, number: number): string {
  return `${forge.mark}${number}`;
}

// claim : the label on an open change that does not carry it yet
export async function claim(input: Claimed): Promise<Result<string>> {
  const change = await input.forge.change({ number: input.number });
  if (change.kind === "failed") {
    return change;
  }
  const where = at(input.forge, input.number);
  if (change.value.state !== "opened") {
    return failed(`${where} is ${change.value.state}; only an open change is claimed`);
  }
  if (change.value.labels.includes(input.label)) {
    return failed(`${where} is already claimed (${input.label})`);
  }
  const added = await input.forge.addLabel({ number: input.number, label: input.label });
  return added.kind === "ok" ? { kind: "ok", value: `claimed ${where}` } : added;
}

// release : the label off an open or a merged change; none to remove is not an error
export async function release(input: Claimed): Promise<Result<string>> {
  const change = await input.forge.change({ number: input.number });
  if (change.kind === "failed") {
    return change;
  }
  const where = at(input.forge, input.number);
  if (!change.value.labels.includes(input.label)) {
    return { kind: "ok", value: `${where} was not claimed` };
  }
  const removed = await input.forge.removeLabel({ number: input.number, label: input.label });
  return removed.kind === "ok" ? { kind: "ok", value: `released ${where}` } : removed;
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
  const post: Post = { seat: note.seat, title: note.title(input.text), fields: [], items: [] };
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

export type Block = Claimed & { readonly reason: string; readonly log: string };

function blockPost(input: Block): Post {
  const fields = input.log === "" ? [] : [{ label: "log", value: input.log }];
  return { seat: "coordinator", title: `blocked: ${input.reason}`, fields, items: [] };
}

// seq : the steps in order; the first that fails stops the rest
async function seq(steps: readonly (() => Promise<Done>)[]): Promise<Done> {
  for (const step of steps) {
    const done = await step();
    if (done.kind === "failed") {
      return done;
    }
  }
  return { kind: "ok" };
}

async function blockSteps(input: Block, change: Change): Promise<Result<string>> {
  const done = await seq([
    () => input.forge.addLabel({ number: input.number, label: NEEDS_HUMAN }),
    () => input.forge.note({ number: input.number, post: blockPost(input) }),
    () =>
      change.labels.includes(input.label)
        ? input.forge.removeLabel({ number: input.number, label: input.label })
        : Promise.resolve({ kind: "ok" }),
  ]);
  return done.kind === "ok" ? { kind: "ok", value: `blocked ${at(input.forge, input.number)}` } : done;
}

// block : needs-human, the reason, then the claim released; the label goes first
export async function block(input: Block): Promise<Result<string>> {
  if (!oneLine(input.reason) || /[\r\n]/.test(input.log)) {
    return failed("say why the change is blocked, in one line; the log path is one line too");
  }
  const change = await input.forge.change({ number: input.number });
  return change.kind === "ok" ? blockSteps(input, change.value) : change;
}

export type Reconcile = {
  readonly forge: Forge;
  readonly label: string;
  // the project's clone: runs keep their worktrees in <repo>/.claude/worktrees/
  readonly repo: string;
  readonly env: NodeJS.ProcessEnv;
  readonly sessions: Sessions;
  // a dry run removes no worktree: it says which it would
  readonly dryRun: boolean;
};

const RUN = /^(writer|reviewer)-(\d+)$/;

function hasRun(runs: readonly string[], number: number): boolean {
  return runs.includes(`writer-${number}`) || runs.includes(`reviewer-${number}`);
}

async function releaseAll(input: Reconcile, numbers: readonly number[], why: string): Promise<Result<string[]>> {
  const lines: string[] = [];
  for (const number of numbers) {
    const removed = await input.forge.removeLabel({ number, label: input.label });
    if (removed.kind === "failed") {
      return removed;
    }
    lines.push(`released ${at(input.forge, number)} (${why})`);
  }
  return { kind: "ok", value: lines };
}

async function mergedClaims(input: Reconcile): Promise<Result<string[]>> {
  const merged = await input.forge.claimed({ state: "merged", label: input.label });
  return merged.kind === "ok" ? releaseAll(input, merged.value, "merged") : merged;
}

async function claims(input: Reconcile, runs: readonly string[]): Promise<Result<string[]>> {
  const open = await input.forge.claimed({ state: "opened", label: input.label });
  if (open.kind === "failed") {
    return open;
  }
  const idle = await releaseAll(
    input,
    open.value.filter((n) => !hasRun(runs, n)),
    "no live run",
  );
  if (idle.kind === "failed") {
    return idle;
  }
  const merged = await mergedClaims(input);
  return merged.kind === "ok" ? { kind: "ok", value: [...idle.value, ...merged.value] } : merged;
}

// removeWorktree : git's worktree and anything left in it; the clone's worktree list is pruned after
async function removeWorktree(input: Reconcile, path: string): Promise<Done> {
  const git = (args: readonly string[]) =>
    hostGit({
      args,
      repo: { kind: "repo", path: input.repo },
      env: input.env,
      ownHelper: { kind: "none" },
      stdin: { kind: "none" },
    });
  await git(["worktree", "remove", "--force", path]);
  const gone = await attempt(() => rm(path, { recursive: true, force: true }), `cannot remove ${path}`);
  const pruned = await git(["worktree", "prune"]);
  if (gone.kind === "failed") {
    return gone;
  }
  return pruned.kind === "ok" ? { kind: "ok" } : failed(`cannot prune the worktrees of ${input.repo}`);
}

async function worktrees(input: Reconcile, runs: readonly string[]): Promise<Result<string[]>> {
  const dir = join(input.repo, ".claude", "worktrees");
  const names = await readdir(dir).catch(() => [] as string[]);
  const lines: string[] = [];
  for (const name of names.filter((n) => RUN.test(n) && !runs.includes(n)).toSorted()) {
    if (input.dryRun) {
      lines.push(`would remove worktree ${name} (no live run)`);
      continue;
    }
    const removed = await removeWorktree(input, join(dir, name));
    if (removed.kind === "failed") {
      return removed;
    }
    lines.push(`removed worktree ${name} (no live run)`);
  }
  return { kind: "ok", value: lines };
}

// reconcile : every line of what it did, or "nothing to reconcile"; a live-run list it cannot read stops it, so
// "unknown" is never read as "none" and a live run's claim is never released
// isClone : FACTORY_REPO must be a clone: a wrong path would show no pid file, so a live run's claim would go
async function isClone(input: Reconcile): Promise<Done> {
  const ran = await hostGit({
    args: ["rev-parse", "--git-dir"],
    repo: { kind: "repo", path: input.repo },
    env: input.env,
    ownHelper: { kind: "none" },
    stdin: { kind: "none" },
  });
  return ran.kind === "ok"
    ? { kind: "ok" }
    : failed(`FACTORY_REPO must be a local clone of the project, got ${JSON.stringify(input.repo)}`);
}

// runsIn : the live runs, read from the clone; never from a path that is not one
async function runsIn(input: Reconcile): Promise<Result<readonly string[]>> {
  const clone = await isClone(input);
  return clone.kind === "ok" ? liveRuns({ repo: input.repo, sessions: input.sessions }) : clone;
}

export async function reconcile(input: Reconcile): Promise<Result<readonly string[]>> {
  const runs = await runsIn(input);
  if (runs.kind === "failed") {
    return runs;
  }
  const released = await claims(input, runs.value);
  if (released.kind === "failed") {
    return released;
  }
  const removed = await worktrees(input, runs.value);
  if (removed.kind === "failed") {
    return removed;
  }
  const all = [...released.value, ...removed.value];
  return { kind: "ok", value: all.length === 0 ? ["nothing to reconcile"] : all };
}
