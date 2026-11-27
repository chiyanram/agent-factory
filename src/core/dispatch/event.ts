// event — the kinds of line a ticket's record holds (records.ts), and the task and retry shapes they carry. The writer
// of a line, its parse (event-parse.ts) and the read model over the lines (summarize) all share these types, so they
// live apart from each of them.

import type { Lane } from "../spec.js";
import type { Answer } from "../answers.js";
import type { Via } from "../human-record.js";
import type { Evidence } from "../report.js";
import type { PluginHash } from "../process/use.js";
import type { CopilotRuns, RoundSpend, RunKind, Spend } from "./spend.js";
import type { DesignFinding, Kept } from "../design/findings.js";
import type { Acted, FoundByRule } from "../review/acted-on.js";
import type { Rescue } from "./timeline.js";
import type { Lane as TurnLane } from "./next-step.js";
import type { DesignEnd, EndReason, WriterEnd } from "../end-reason.js";
import type { Asks, RunNamed } from "../agent/ran.js";

export type Phase = "writer" | "ready" | "review" | "verify" | "design-review" | "design-verify" | "onboard";
export type DesignStep = "review" | "verify";
// what the writer was started for; "rebase" is the run for a merge conflict, which merges the default branch in and
// never rebases (every push is --force-with-lease against the head the host saw, push.ts, so a merge goes out as a
// fast-forward and a person's push in between is never overwritten; the name stays, so older lines still read)
// "cleanup" is the cleanup run after the implementer's done run: the same branch, its own role card. **Today:** no
// dispatcher rule starts one; an older ledger's cleanup lines still read
export type WriterMode = "test-first" | "fix" | "rework" | "ci" | "rebase" | "cleanup";

export type Task =
  | { readonly kind: "test-first"; readonly answers?: readonly Answer[] }
  | { readonly kind: "fix"; readonly answers?: readonly Answer[] }
  | { readonly kind: "ready-failed"; readonly head: string }
  | { readonly kind: "act-on"; readonly head: string }
  | { readonly kind: "ci-red"; readonly head: string }
  | { readonly kind: "verify-failed"; readonly head: string }
  | { readonly kind: "conflict"; readonly head: string }
  | { readonly kind: "cleanup"; readonly head: string; readonly evidence: readonly Evidence[] };

const MODE_OF: Readonly<Record<Task["kind"], WriterMode>> = {
  "test-first": "test-first",
  fix: "fix",
  "ready-failed": "rework",
  "act-on": "rework",
  "ci-red": "ci",
  "verify-failed": "ci",
  conflict: "rebase",
  cleanup: "cleanup",
};

export type ParkedTask =
  | { readonly kind: "test-first" | "fix" }
  | { readonly kind: "ready-failed" | "act-on" | "ci-red" | "verify-failed" | "conflict"; readonly head: string };

export function parkedTaskOf(task: Task): ParkedTask | undefined {
  if (task.kind === "cleanup") {
    return undefined;
  }
  return "head" in task ? { kind: task.kind, head: task.head } : { kind: task.kind };
}

export function modeOf(task: Task): WriterMode {
  return MODE_OF[task.kind];
}

export type Retried = "ready" | "review" | "verify";
export type NextTry = { readonly step: Retried; readonly at: string };

const FIRST_BACKOFF_MS = 10_000;
const MOST_BACKOFF_MS = 5 * 60_000;

export function backoffMs(n: number): number {
  return Math.min(FIRST_BACKOFF_MS * 2 ** Math.max(0, n - 1), MOST_BACKOFF_MS);
}

export function nextTryOf(retried: Retried, n: number, now: number): NextTry {
  return { step: retried, at: new Date(now + backoffMs(n)).toISOString() };
}

export type Event =
  | {
      readonly at: string;
      readonly kind: "started";
      readonly phase: Phase;
      readonly mode: WriterMode | "none";
      readonly head: string;
      readonly plugins?: readonly PluginHash[];
      readonly folder?: string;
      readonly cli?: string;
      readonly asks?: Asks;
    }
  | ({
      readonly at: string;
      readonly kind: "writer-ended";
      readonly mode: WriterMode;
      readonly head: string;
      readonly patch: string;
      readonly evidence: readonly Evidence[];
      readonly hung: boolean;
      readonly spend?: Spend;
      readonly copilot?: CopilotRuns;
      readonly card?: string;
      readonly deferred?: readonly string[];
      readonly approach?: string;
      readonly open?: readonly string[];
      readonly stale?: readonly string[];
      readonly why?: string;
      readonly output?: string;
      readonly trace?: string;
      readonly runs?: readonly RunNamed[];
    } & WriterEnd)
  | {
      readonly at: string;
      readonly kind: "ready-ended";
      readonly head: string;
      readonly passed: boolean;
      readonly why: string;
      readonly human?: boolean;
      readonly nextTry?: NextTry;
      readonly lane?: Lane;
      readonly programs?: readonly string[];
      readonly reason: "done";
    }
  | {
      readonly at: string;
      readonly kind: "verify-ended";
      readonly head: string;
      readonly passed: boolean;
      readonly nextTry?: NextTry;
      readonly reason: "done";
    }
  | {
      readonly at: string;
      readonly kind: "review-ended";
      readonly head: string;
      readonly actOn: number;
      readonly nextTry?: NextTry;
      readonly spend?: Spend;
      readonly copilot?: CopilotRuns;
      readonly split?: RoundSpend;
      readonly acted?: Acted;
      readonly lenses?: Readonly<Record<string, number>>;
      readonly citesNotFound?: number;
      readonly found?: FoundByRule;
      readonly traces?: readonly string[];
      readonly runs?: readonly RunNamed[];
      readonly reason: "done";
    }
  | {
      readonly at: string;
      readonly kind: "spent";
      readonly phase: Phase;
      readonly head: string;
      readonly spend?: Spend;
      readonly copilot?: CopilotRuns;
      readonly split?: RoundSpend;
      readonly traces?: readonly string[];
      readonly runs?: readonly RunNamed[];
      readonly reason: EndReason;
    }
  | {
      readonly at: string;
      readonly kind: "parked";
      readonly phase: Phase;
      readonly head: string;
      readonly until: string;
      readonly said: string;
      readonly task?: ParkedTask;
      readonly spend?: Spend;
      readonly copilot?: CopilotRuns;
      readonly trace?: string;
      readonly runs?: readonly RunNamed[];
      readonly reason: "usage_limit";
    }
  | ({
      readonly at: string;
      readonly kind: "design-ended";
      readonly step: DesignStep;
      readonly spec: string;
      readonly design?: string;
      readonly why: string;
      readonly findings: readonly DesignFinding[];
      readonly kept: readonly Kept[];
      readonly card?: string;
      readonly spend?: Spend;
      readonly copilot?: CopilotRuns;
      readonly final?: true;
      readonly lane?: Lane;
      readonly planned?: readonly string[];
      readonly trace?: string;
      readonly runs?: readonly RunNamed[];
    } & DesignEnd)
  | { readonly at: string; readonly kind: "setup-refused"; readonly phase: Phase; readonly why: string }
  | {
      readonly at: string;
      readonly kind: "design-noted";
      readonly spec: string;
      readonly design?: string;
      readonly why: string;
    }
  | { readonly at: string; readonly kind: "pinged"; readonly head: string }
  | { readonly at: string; readonly kind: "turn"; readonly to: TurnLane }
  | { readonly at: string; readonly kind: "waiting"; readonly since: string }
  | { readonly at: string; readonly kind: "blocked"; readonly why: string }
  | { readonly at: string; readonly kind: "held"; readonly why: string }
  | { readonly at: string; readonly kind: "blockers-unread"; readonly why: string }
  | { readonly at: string; readonly kind: "shared"; readonly approval: string }
  | { readonly at: string; readonly kind: "answered"; readonly spec: string; readonly answers: readonly Answer[] }
  | { readonly at: string; readonly kind: "begun"; readonly by: string; readonly via: Via }
  | { readonly at: string; readonly kind: "approved"; readonly by: string; readonly via: Via; readonly spec: string }
  | {
      readonly at: string;
      readonly kind: "merged";
      readonly number: number;
      readonly sha: string;
      readonly by: string;
    }
  | {
      readonly at: string;
      readonly kind: "timeline";
      readonly number: number;
      readonly rounds: number;
      readonly found: FoundByRule;
      readonly acted: Readonly<Record<string, { readonly acted: number; readonly of: number }>>;
      readonly spend: Readonly<Partial<Record<RunKind, Spend>>>;
      readonly unmeasured: number;
      readonly rescues: readonly Rescue[];
    };

export type EventMap = { readonly [E in Event as E["kind"]]: E };
export type Kind = keyof EventMap;
