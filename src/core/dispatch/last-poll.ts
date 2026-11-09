// last-poll — when the orchestrator last polled the git host, so a dead cron or launchd job shows (#103; from
// chiyanram/skills#223 D6, "no turn ends blind"). Each pass writes, right after its poll,
// <FACTORY_HOME>/runs/<project>/last-poll.json: the time, the poll interval it was told (FACTORY_POLL_MINUTES), and the
// git host and repository it polled. `agent-factory status` reads it and puts "orchestrator last ran N min ago" at the
// head of its line, flagged LATE when that is more than three poll intervals ago while any change is claimed. The
// coordinator then sees a stopped orchestrator, instead of claimed changes that just sit there.
//
// status knows the repository (FACTORY_PROJECT), not the factory's project name, so it reads every project's file and
// keeps the newest one for that git host and repository. A dry run writes nothing: it acts on none of its decisions.

import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
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

// readLastPoll : the newest pass any project made on this git host and repository, or "none" when no pass has run.
// A file that is not a record fails the read, naming it, so a broken file is never read as "never ran".
export async function readLastPoll(input: {
  readonly home: string;
  readonly forge: ForgeName;
  readonly repo: string;
}): Promise<Result<LastPoll | "none">> {
  const projects = await readdir(runsDir(input.home)).catch(() => [] as string[]);
  const ours: LastPoll[] = [];
  for (const project of projects.filter(plainName).toSorted()) {
    const path = join(runsDir(input.home), project, LAST_POLL_FILE);
    const read = await readOne(path);
    if (read === "bad") {
      return { kind: "failed", reason: `${path} is not a last-poll record; fix or remove it` };
    }
    ours.push(...(read === "none" ? [] : [read]));
  }
  return { kind: "ok", value: newestOf(ours.filter((p) => p.forge === input.forge && p.repo === input.repo)) };
}

// newestOf : the newest record, or "none". Pure.
function newestOf(polls: readonly LastPoll[]): LastPoll | "none" {
  return polls.reduce<LastPoll | "none">(
    (best, p) => (best === "none" || Date.parse(p.at) > Date.parse(best.at) ? p : best),
    "none",
  );
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

// livenessLine : the head of status's line: when the orchestrator last ran, flagged LATE when that is more than
// LATE_INTERVALS poll intervals ago while any change is claimed (a claim the git host cannot list counts as one).
// Pure.
export function livenessLine(input: {
  readonly last: Result<LastPoll | "none">;
  readonly now: number;
  readonly claimed: Claimed;
}): string {
  const { last, claimed } = input;
  if (last.kind === "failed") {
    return `orchestrator last ran: cannot tell: ${last.reason}`;
  }
  return last.value === "none" ? neverRan(claimed) : ranLine(last.value, input.now, claimed);
}

function neverRan(claimed: Claimed): string {
  return anyClaimed(claimed)
    ? `LATE: the orchestrator has never run here, ${claimedWords(claimed)}; start its cron or launchd job`
    : "orchestrator has not run here yet";
}

function ranLine(last: LastPoll, now: number, claimed: Claimed): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(last.at)) / 60_000));
  const ran = `orchestrator last ran ${minutes} min ago`;
  const late = minutes > LATE_INTERVALS * last.pollMinutes && anyClaimed(claimed);
  return late
    ? `LATE: ${ran}, over ${LATE_INTERVALS} poll intervals of ${last.pollMinutes} min, ${claimedWords(claimed)}; check its cron or launchd job`
    : ran;
}

// headed : status's line with the liveness line at its head: the last-poll time for this git host and repository, and
// the open changes that carry the claim label
export async function headed(input: {
  readonly home: Result<string>;
  readonly forge: Forge;
  readonly label: string;
  readonly repo: string;
  readonly now: number;
  readonly line: string;
}): Promise<string> {
  const { home, forge } = input;
  const last =
    home.kind === "ok" ? await readLastPoll({ home: home.value, forge: forge.name, repo: input.repo }) : home;
  const found = await forge.claimed({ state: "opened", label: input.label });
  const claimed: Claimed =
    found.kind === "ok" ? { kind: "count", count: found.value.length } : { kind: "unknown", reason: found.reason };
  return `${livenessLine({ last, now: input.now, claimed })}; ${input.line}`;
}
