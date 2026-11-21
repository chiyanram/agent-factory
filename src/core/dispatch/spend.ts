// spend — what one model run spent, as the agent CLI reports it (#131; docs/DESIGN.md section 3 "Limits"). Every run
// records its spend in its run record: the writer from the result event of its stream-json output, the reviewer from
// each pass's JSON answer. The tokens are what the CLI counted; the dollar figure is the CLI's own, which on a
// subscription need not be what the subscription is charged, so the caps there count tokens.
//
// A run that ends with no result event (a stall, a timeout, a box that failed) reports nothing: its record carries no
// spend, and `usage` counts it as unmeasured, never as free.
//
// RunKind and RUN_KINDS live here, a leaf, so the records parser can import them with no import cycle.

import { NO_WINDOWS, windowsOf, type Windows } from "../agent/usage-limit.js";
import { prop } from "../field.js";

export type Spend = { readonly usd: number; readonly tokens: number };

export const NO_SPEND: Spend = { usd: 0, tokens: 0 };

export type CopilotRuns = { readonly runs: number; readonly seconds: number };

export type RunKind =
  | "design-reviewer"
  | "test-first"
  | "implementer"
  | "cleanup"
  | "finder"
  | "verify pass"
  | "onboarder"
  | "automated review"
  | "ready check"
  | "local verifier";

export const RUN_KINDS: readonly RunKind[] = [
  "design-reviewer",
  "test-first",
  "implementer",
  "cleanup",
  "finder",
  "verify pass",
  "onboarder",
  "automated review",
  "ready check",
  "local verifier",
];

export type FailedSpent = {
  readonly kind: "failed";
  readonly reason: string;
  readonly spend?: Spend;
  readonly split?: RoundSpend;
  readonly traces?: readonly string[];
};

export function spentFailure(reason: string, spend: Spend | "unmeasured"): FailedSpent {
  return spend === "unmeasured" ? { kind: "failed", reason } : { kind: "failed", reason, spend };
}

const TOKEN_FIELDS = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"];

export function tokensOf(answer: unknown): number {
  const usage = prop(answer, "usage");
  return TOKEN_FIELDS.map((k) => prop(usage, k)).reduce<number>(
    (sum, n) => sum + (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0),
    0,
  );
}

// spendOf : the spend claude -p reports: total_cost_usd and usage in its JSON, or in the result event that ends its
// stream-json.
// https://code.claude.com/docs/en/headless
export function spendOf(answer: unknown): Spend {
  const usd = prop(answer, "total_cost_usd");
  return { usd: typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? usd : 0, tokens: tokensOf(answer) };
}

export function addSpend(a: Spend, b: Spend): Spend {
  return { usd: a.usd + b.usd, tokens: a.tokens + b.tokens };
}

export type RoundSpend = { readonly finders: Readonly<Record<string, Spend>>; readonly verify: Spend };

export const NO_ROUND_SPEND: RoundSpend = { finders: {}, verify: NO_SPEND };

export type RoundPart = { readonly kind: "finder"; readonly lens: string } | { readonly kind: "verify pass" };

export function addRoundSpend(round: RoundSpend, part: RoundPart, spend: Spend): RoundSpend {
  if (part.kind === "verify pass") {
    return { ...round, verify: addSpend(round.verify, spend) };
  }
  const was = round.finders[part.lens] ?? NO_SPEND;
  return { ...round, finders: { ...round.finders, [part.lens]: addSpend(was, spend) } };
}

const MOST_LINE_CHARS = 1024 * 1024;

export type Stream = { readonly partial: string; readonly result: unknown; readonly windows: Windows };

export const NO_STREAM: Stream = { partial: "", result: undefined, windows: NO_WINDOWS };

function parsed(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

function resultEvent(line: string): unknown {
  const event = line.includes('"result"') ? parsed(line) : undefined;
  return prop(event, "type") === "result" ? event : undefined;
}

export function streamOf(stream: Stream, chunk: string): Stream {
  const lines = (stream.partial + chunk).split("\n");
  const partial = lines.pop() ?? "";
  const result = lines.map(resultEvent).findLast((e) => e !== undefined) ?? stream.result;
  const windows = lines
    .filter((l) => l.includes('"rate_limit_event"'))
    .map(parsed)
    .reduce(windowsOf, stream.windows);
  return { partial: partial.length > MOST_LINE_CHARS ? "" : partial, result, windows };
}

export function streamSpend(stream: Stream): Spend | "unmeasured" {
  const result = stream.result ?? resultEvent(stream.partial);
  return result === undefined ? "unmeasured" : spendOf(result);
}
