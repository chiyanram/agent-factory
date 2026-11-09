// last-poll — when the orchestrator last polled the git host, so a stopped orchestrator loop shows (#103, #305; from
// chiyanram/skills#223 D6, "no turn ends blind"). Each pass writes, right after its poll,
// <FACTORY_HOME>/runs/<project>/last-poll.json: the time, the poll interval it was told (FACTORY_POLL_MINUTES), and the
// git host and repository it polled. `agent-factory status` reads it and puts "orchestrator last ran N min ago" at the
// head of its line. While an orchestrator loop is meant to be running (its loop.pid is there; orchestrator-loop.ts),
// the line is flagged LATE when that is more than three poll intervals ago while any change is claimed, so the
// coordinator sees a loop that stopped. With no loop meant to be running, nothing is late: the line says so, and, when
// a change is claimed, names the command that starts one.
//
// status knows the repository (FACTORY_PROJECT), not the factory's project name, so it reads every project's file and
// keeps the newest one for that git host and repository; that project's folder tells whether its loop is meant to be
// running. It sees the tickets in flight as the claimed changes, the ones the git host can list. A dry run writes
// nothing: it acts on none of its decisions.

import { access, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Done, Result } from "../forge/api.js";
import type { Forge, ForgeName } from "../forge/types.js";
import { plainName } from "../spec.js";
import { codeOf, prop } from "./records.js";

export const LAST_POLL_FILE = "last-poll.json";
// how many poll intervals may pass before status flags the orchestrator as late
export const LATE_INTERVALS = 3;
export const DEFAULT_POLL_MINUTES = 5;
// the file an orchestrator loop holds while it runs (orchestrator-loop.ts, LOOP_GUARD)
export const LOOP_PID_FILE = "loop.pid";

export type LastPoll = {
  // ISO 8601
  readonly at: string;
  readonly pollMinutes: number;
  readonly forge: ForgeName;
  // owner/name on GitHub, the full path on GitLab
  readonly repo: string;
};

function runsDir(home: string): string {
  return join(home, "runs");
}

// writeLastPoll : the pass's last-poll time, replaced in one rename so a reader never sees half a file
export async function writeLastPoll(input: {
  readonly home: string;
  readonly project: string;
  readonly poll: LastPoll;
}): Promise<Done> {
  if (!plainName(input.project)) {
    return { kind: "failed", reason: `the project must be a plain name, got ${JSON.stringify(input.project)}` };
  }
  const dir = join(runsDir(input.home), input.project);
  const path = join(dir, LAST_POLL_FILE);
  const temp = join(dir, `.${LAST_POLL_FILE}.${randomUUID()}`);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(temp, `${JSON.stringify(input.poll)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temp, path);
    return { kind: "ok" };
  } catch {
    return { kind: "failed", reason: `cannot write ${path}` };
  }
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const isTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const isMinutes = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const isForge = (v: unknown): v is ForgeName => v === "github" || v === "gitlab";

// lastPollOf : one file's record, or "bad" when it is not one. Pure.
export function lastPollOf(text: string): LastPoll | "bad" {
  const raw = parsed(text);
  const [at, pollMinutes, forge, repo] = ["at", "pollMinutes", "forge", "repo"].map((name) => prop(raw, name));
  const good = isTime(at) && isMinutes(pollMinutes) && isForge(forge) && typeof repo === "string";
  return good ? { at, pollMinutes, forge, repo } : "bad";
}

async function readOne(path: string): Promise<LastPoll | "none" | "bad"> {
  try {
    return lastPollOf(await readFile(path, "utf8"));
  } catch (error) {
    return codeOf(error) === "ENOENT" ? "none" : "bad";
  }
}

type Polled = { readonly project: string; readonly poll: LastPoll };

// polledHere : every project's last pass on this git host and repository; a file that is not a record fails the read,
// naming it, so a broken file is never read as "never ran"
async function polledHere(input: {
  readonly home: string;
  readonly forge: ForgeName;
  readonly repo: string;
}): Promise<Result<readonly Polled[]>> {
  const projects = await readdir(runsDir(input.home)).catch(() => [] as string[]);
  const ours: Polled[] = [];
  for (const project of projects.filter(plainName).toSorted()) {
    const path = join(runsDir(input.home), project, LAST_POLL_FILE);
    const read = await readOne(path);
    if (read === "bad") {
      return { kind: "failed", reason: `${path} is not a last-poll record; fix or remove it` };
    }
    ours.push(...(read === "none" ? [] : [{ project, poll: read }]));
  }
  return { kind: "ok", value: ours.filter((p) => p.poll.forge === input.forge && p.poll.repo === input.repo) };
}

// readLastPoll : the newest pass any project made on this git host and repository, or "none" when no pass has run
export async function readLastPoll(input: {
  readonly home: string;
  readonly forge: ForgeName;
  readonly repo: string;
}): Promise<Result<LastPoll | "none">> {
  const polled = await polledHere(input);
  if (polled.kind === "failed") {
    return polled;
  }
  const newest = newestOf(polled.value);
  return { kind: "ok", value: newest === "none" ? "none" : newest.poll };
}

// newestOf : the newest record, or "none". Pure.
function newestOf(polls: readonly Polled[]): Polled | "none" {
  return polls.reduce<Polled | "none">(
    (best, p) => (best === "none" || Date.parse(p.poll.at) > Date.parse(best.poll.at) ? p : best),
    "none",
  );
}

// the orchestrator loop as status sees it: whether one is meant to be running for the repository, and the project it
// runs for ("<project>" when no pass names one)
export type LoopView = { readonly meant: boolean; readonly project: string };

// readLoop : whether a loop is meant to be running for this git host and repository: a project that polled it holds
// its loop file
export async function readLoop(input: {
  readonly home: string;
  readonly forge: ForgeName;
  readonly repo: string;
}): Promise<LoopView> {
  const polled = await polledHere(input);
  const projects = polled.kind === "ok" ? polled.value : [];
  for (const { project } of projects) {
    const there = await access(join(runsDir(input.home), project, LOOP_PID_FILE)).then(
      () => true,
      () => false,
    );
    if (there) {
      return { meant: true, project };
    }
  }
  const newest = newestOf(projects);
  return { meant: false, project: newest === "none" ? "<project>" : newest.project };
}

// claimed changes: how many, or why the git host could not say
export type Claimed =
  | { readonly kind: "count"; readonly count: number }
  | { readonly kind: "unknown"; readonly reason: string };

function changes(count: number): string {
  return count === 1 ? "1 change" : `${count} changes`;
}

// claimedWords : what the flag says of the claims. Pure.
function claimedWords(claimed: Claimed): string {
  return claimed.kind === "count"
    ? `while ${changes(claimed.count)} ${claimed.count === 1 ? "is" : "are"} claimed`
    : `and the claimed changes could not be read: ${claimed.reason}`;
}

function anyClaimed(claimed: Claimed): boolean {
  return claimed.kind === "unknown" || claimed.count > 0;
}

function startWords(loop: LoopView): string {
  return `run \`agent-factory dispatch ${loop.project}\``;
}

// livenessLine : the head of status's line. While a loop is meant to be running: when the orchestrator last ran,
// flagged LATE when that is more than LATE_INTERVALS poll intervals ago while any change is claimed (a claim the git
// host cannot list counts as one). With no loop: that none runs, and the command that starts one while a change is
// claimed. Pure.
export function livenessLine(input: {
  readonly last: Result<LastPoll | "none">;
  readonly now: number;
  readonly claimed: Claimed;
  readonly loop: LoopView;
}): string {
  const { last, claimed, loop } = input;
  if (last.kind === "failed") {
    return `orchestrator last ran: cannot tell: ${last.reason}`;
  }
  if (!loop.meant) {
    return anyClaimed(claimed) ? `no orchestrator loop running; ${startWords(loop)}` : "no orchestrator loop running";
  }
  return last.value === "none" ? neverRan(claimed, loop) : ranLine(last.value, input.now, claimed, loop);
}

function neverRan(claimed: Claimed, loop: LoopView): string {
  return anyClaimed(claimed)
    ? `LATE: the orchestrator loop has never run here, ${claimedWords(claimed)}; ${startWords(loop)}`
    : "orchestrator has not run here yet";
}

function ranLine(last: LastPoll, now: number, claimed: Claimed, loop: LoopView): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(last.at)) / 60_000));
  const ran = `orchestrator last ran ${minutes} min ago`;
  const late = minutes > LATE_INTERVALS * last.pollMinutes && anyClaimed(claimed);
  return late
    ? `LATE: ${ran}, over ${LATE_INTERVALS} poll intervals of ${last.pollMinutes} min, ${claimedWords(claimed)}; the loop has stopped: ${startWords(loop)}`
    : ran;
}

// headed : status's line with the liveness line at its head: the last-poll time and the loop file for this git host
// and repository, and the open changes that carry the claim label
export async function headed(input: {
  readonly home: Result<string>;
  readonly forge: Forge;
  readonly label: string;
  readonly repo: string;
  readonly now: number;
  readonly line: string;
}): Promise<string> {
  const { home, forge } = input;
  const where = home.kind === "ok" ? { home: home.value, forge: forge.name, repo: input.repo } : home;
  const last = "home" in where ? await readLastPoll(where) : where;
  const loop = "home" in where ? await readLoop(where) : { meant: false, project: "<project>" };
  const found = await forge.claimed({ state: "opened", label: input.label });
  const claimed: Claimed =
    found.kind === "ok" ? { kind: "count", count: found.value.length } : { kind: "unknown", reason: found.reason };
  return `${livenessLine({ last, now: input.now, claimed, loop })}; ${input.line}`;
}
