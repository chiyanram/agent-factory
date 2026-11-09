// spend — what one model run spent, as the agent CLI reports it (#131; docs/DESIGN.md section 3 "Limits"). Every run
// records its spend in its run record: the writer from the result event of its stream-json output, the reviewer from
// each pass's JSON answer. The tokens are what the CLI counted; the dollar figure is the CLI's own, which on a
// subscription need not be what the subscription is charged (an open check on #131), so the caps there count tokens.
//
// A run that ends with no result event (a stall, a timeout, a box that failed) reports nothing: its record carries no
// spend, and `usage` counts it as unmeasured, never as free.

// prop : one property of a parsed JSON value, or undefined (records.ts has the same; it imports this file)
function prop(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? (Reflect.get(value, name) as unknown) : undefined;
}

export type Spend = { readonly usd: number; readonly tokens: number };

export const NO_SPEND: Spend = { usd: 0, tokens: 0 };

const TOKEN_FIELDS = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"];

// tokensOf : every token a CLI answer's usage counts, cache reads and writes too. Pure.
export function tokensOf(answer: unknown): number {
  const usage = prop(answer, "usage");
  return TOKEN_FIELDS.map((k) => prop(usage, k)).reduce<number>(
    (sum, n) => sum + (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0),
    0,
  );
}

// spendOf : the spend a CLI answer (claude -p's JSON, or the result event of its stream-json) reports. Pure.
export function spendOf(answer: unknown): Spend {
  const usd = prop(answer, "total_cost_usd");
  return { usd: typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? usd : 0, tokens: tokensOf(answer) };
}

export function addSpend(a: Spend, b: Spend): Spend {
  return { usd: a.usd + b.usd, tokens: a.tokens + b.tokens };
}

// RoundSpend : an automated review round's spend per run (#337): each finder's by its lens, and the verify pass's (its
// rule and logic passes summed). Their sum is the round's spend.
export type RoundSpend = { readonly finders: Readonly<Record<string, Spend>>; readonly verify: Spend };

export const NO_ROUND_SPEND: RoundSpend = { finders: {}, verify: NO_SPEND };

// RoundPart : which run of a round a model answer belongs to (#337)
export type RoundPart = { readonly kind: "finder"; readonly lens: string } | { readonly kind: "verify pass" };

// addRoundSpend : the round's spend with one more answer's, added to its part. Pure.
export function addRoundSpend(round: RoundSpend, part: RoundPart, spend: Spend): RoundSpend {
  if (part.kind === "verify pass") {
    return { ...round, verify: addSpend(round.verify, spend) };
  }
  const was = round.finders[part.lens] ?? NO_SPEND;
  return { ...round, finders: { ...round.finders, [part.lens]: addSpend(was, spend) } };
}

// the longest output line kept while it is printed: a result event carries the run's last message, never a whole file
const MOST_LINE_CHARS = 1024 * 1024;

// Stream : what the reader holds of a stream-json output: the line still being printed, and the result event once seen
export type Stream = { readonly partial: string; readonly result: unknown };

export const NO_STREAM: Stream = { partial: "", result: undefined };

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

// streamOf : the reader after one more piece of output; the newest result event wins. A line longer than the most is
// dropped, never cut, since half of one is no event. Pure.
export function streamOf(stream: Stream, chunk: string): Stream {
  const lines = (stream.partial + chunk).split("\n");
  const partial = lines.pop() ?? "";
  const result = lines.map(resultEvent).findLast((e) => e !== undefined) ?? stream.result;
  return { partial: partial.length > MOST_LINE_CHARS ? "" : partial, result };
}

// streamSpend : the run's spend from its result event, or "unmeasured" with none. Pure.
export function streamSpend(stream: Stream): Spend | "unmeasured" {
  const result = stream.result ?? resultEvent(stream.partial);
  return result === undefined ? "unmeasured" : spendOf(result);
}
