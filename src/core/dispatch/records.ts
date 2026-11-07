// records — what the dispatcher has done for each ticket, so a restart loses nothing (#103; ADR-0012 S3). One
// append-only JSON-lines file per ticket: <FACTORY_HOME>/runs/<project>/<ticket>.jsonl. The dispatcher writes a line
// before a run starts and one after it ends; the counts the table needs (ready-check failures, review rounds, CI
// rounds: writer runs started for a red pipeline) are summed from the lines written since the ticket's latest approval, so approving again starts afresh.
//
// A "started" line with no "ended" after it means the dispatcher died during that run: the summary says so, and the
// table blocks the ticket for a person rather than guess whether the run pushed.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { plainName } from "../spec.js";
import type { Done, Result } from "../forge/api.js";

export type Phase = "writer" | "ready" | "review";
// what the writer was started for
export type WriterMode = "test-first" | "fix" | "rework" | "ci" | "rebase";

export type Event =
  | { readonly at: string; readonly kind: "started"; readonly phase: Phase; readonly mode: WriterMode | "none"; readonly head: string }
  | { readonly at: string; readonly kind: "writer-ended"; readonly mode: WriterMode; readonly head: string; readonly outcome: "done" | "asked" | "blocked"; readonly patch: string }
  | { readonly at: string; readonly kind: "ready-ended"; readonly head: string; readonly passed: boolean }
  | { readonly at: string; readonly kind: "review-ended"; readonly head: string; readonly actOn: number }
  | { readonly at: string; readonly kind: "pinged"; readonly head: string }
  // the dispatcher handed the ticket to a person, for this reason; the same stop is never posted twice
  | { readonly at: string; readonly kind: "blocked"; readonly why: string };

export type Where = { readonly home: string; readonly project: string; readonly ticket: string };

export function recordPath(where: Where): Result<string> {
  return plainName(where.project) && plainName(where.ticket)
    ? { kind: "ok", value: join(where.home, "runs", where.project, `${where.ticket}.jsonl`) }
    : { kind: "failed", reason: `a project and a ticket must be plain names, got ${JSON.stringify(where.project)} ${JSON.stringify(where.ticket)}` };
}

// record : one line, appended; the folder is made on first use, readable by this user alone
export async function record(input: { readonly where: Where; readonly event: Event }): Promise<Done> {
  const path = recordPath(input.where);
  if (path.kind === "failed") {
    return path;
  }
  try {
    await mkdir(dirname(path.value), { recursive: true, mode: 0o700 });
    await appendFile(path.value, `${JSON.stringify(input.event)}\n`, { mode: 0o600 });
    return { kind: "ok" };
  } catch {
    return { kind: "failed", reason: `cannot write ${path.value}` };
  }
}

const KINDS = new Set(["started", "writer-ended", "ready-ended", "review-ended", "pinged", "blocked"]);

function eventOf(line: string): Event | "bad" {
  try {
    const raw = JSON.parse(line) as { kind?: unknown; at?: unknown };
    return typeof raw.at === "string" && typeof raw.kind === "string" && KINDS.has(raw.kind) ? (raw as Event) : "bad";
  } catch {
    return "bad";
  }
}

// readRecords : every line of the ticket's file, oldest first; no file is no events. A line that is not an event fails
// the read, since a count summed past it could let a run go on that should have stopped.
export async function readRecords(where: Where): Promise<Result<readonly Event[]>> {
  const path = recordPath(where);
  if (path.kind === "failed") {
    return path;
  }
  let text = "";
  try {
    text = await readFile(path.value, "utf8");
  } catch (error) {
    return (error as { code?: string }).code === "ENOENT" ? { kind: "ok", value: [] } : { kind: "failed", reason: `cannot read ${path.value}` };
  }
  const events = text.split("\n").filter((l) => l.trim() !== "").map(eventOf);
  const bad = events.indexOf("bad");
  return bad < 0 ? { kind: "ok", value: events as Event[] } : { kind: "failed", reason: `${path.value} line ${bad + 1} is not a record; fix or remove it` };
}

export type LastWriter =
  | { readonly kind: "none" }
  | { readonly kind: "ended"; readonly mode: WriterMode; readonly head: string; readonly outcome: "done" | "asked" | "blocked"; readonly patch: string };

export type Summary = {
  // a run whose start has no end: the dispatcher died during it
  readonly interrupted: { readonly kind: "none" } | { readonly kind: "interrupted"; readonly phase: Phase; readonly at: string };
  readonly lastWriter: LastWriter;
  // the writer's patch before the last one, to catch the same patch twice
  readonly previousPatch: string;
  readonly testFirstDone: boolean;
  readonly readyFailures: number;
  readonly lastReady: { readonly kind: "none" } | { readonly kind: "ended"; readonly head: string; readonly passed: boolean };
  readonly reviewRounds: number;
  readonly lastReview: { readonly kind: "none" } | { readonly kind: "ended"; readonly head: string; readonly actOn: number };
  readonly ciRounds: number;
  readonly rebaseRuns: number;
  readonly pingedAt: string;
  // every reason the dispatcher already handed the ticket to a person for
  readonly blocked: readonly string[];
  // the time of the newest line, or "" for none
  readonly lastAt: string;
};

export const EMPTY: Summary = {
  interrupted: { kind: "none" },
  lastWriter: { kind: "none" },
  previousPatch: "",
  testFirstDone: false,
  readyFailures: 0,
  lastReady: { kind: "none" },
  reviewRounds: 0,
  lastReview: { kind: "none" },
  ciRounds: 0,
  rebaseRuns: 0,
  pingedAt: "",
  blocked: [],
  lastAt: "",
};

type Step = (s: Summary, e: Event) => Summary;

const STEPS: Readonly<Record<Event["kind"], Step>> = {
  started: (s, e) => (e.kind === "started" ? { ...s, interrupted: { kind: "interrupted", phase: e.phase, at: e.at } } : s),
  "writer-ended": (s, e) =>
    e.kind === "writer-ended"
      ? {
          ...s,
          interrupted: { kind: "none" },
          previousPatch: s.lastWriter.kind === "ended" ? s.lastWriter.patch : "",
          lastWriter: { kind: "ended", mode: e.mode, head: e.head, outcome: e.outcome, patch: e.patch },
          testFirstDone: s.testFirstDone || (e.mode === "test-first" && e.outcome === "done"),
          rebaseRuns: s.rebaseRuns + (e.mode === "rebase" ? 1 : 0),
          ciRounds: s.ciRounds + (e.mode === "ci" ? 1 : 0),
        }
      : s,
  "ready-ended": (s, e) =>
    e.kind === "ready-ended" ? { ...s, interrupted: { kind: "none" }, lastReady: { kind: "ended", head: e.head, passed: e.passed }, readyFailures: s.readyFailures + (e.passed ? 0 : 1) } : s,
  "review-ended": (s, e) =>
    e.kind === "review-ended" ? { ...s, interrupted: { kind: "none" }, lastReview: { kind: "ended", head: e.head, actOn: e.actOn }, reviewRounds: s.reviewRounds + 1 } : s,
  pinged: (s, e) => ({ ...s, pingedAt: e.kind === "pinged" ? e.head : s.pingedAt }),
  blocked: (s, e) => (e.kind === "blocked" ? { ...s, blocked: [...s.blocked, e.why] } : s),
};

// summarize : the counts since the approval at `since` (ISO 8601); older lines belong to an earlier approval.
export function summarize(input: { readonly events: readonly Event[]; readonly since: string }): Summary {
  const from = Date.parse(input.since);
  return input.events
    .filter((e) => !(Date.parse(e.at) < from))
    .reduce((s, e) => ({ ...STEPS[e.kind](s, e), lastAt: e.at }), EMPTY);
}
