// end-reason — the closed list of ways a run can end, one of which every ended record line names, and which reasons
// each outcome may carry. It imports nothing, so the report, the agent adapters and the records parser can all name a
// reason with no import cycle. `launch_failed` also covers a CLI that exited with an error before it answered,
// `unknown` names an old line or a failure nothing classifies yet, and a wait for room is no end, so it is not on the
// list.
//
// The reason says how the run ended; the outcome says what the host made of it. They differ only where the host
// stops a run that ended well: a writer run that finished or asked, whose push the host then refused, is blocked with
// reason done or asked. A done or asked outcome takes only its own word, a failed design run never takes done, and
// usage_limit belongs to the parked line alone. The pair types refuse any other pair at compile time, and agrees
// refuses it at read time.
//
// **Today:** nothing writes `oom_killed` (#855) or `stopped` (#770); both are on the list so a line that names them
// reads.

export const END_REASONS = [
  "done",
  "asked",
  "blocked",
  "setup_refused",
  "launch_failed",
  "timed_out",
  "stalled",
  "usage_limit",
  "output_invalid",
  "oom_killed",
  "stopped",
  "unknown",
] as const;

export type EndReason = (typeof END_REASONS)[number];

const FAILED_REASONS = [
  "setup_refused",
  "launch_failed",
  "timed_out",
  "stalled",
  "output_invalid",
  "oom_killed",
  "stopped",
  "unknown",
] as const;

export type FailedReason = (typeof FAILED_REASONS)[number];

type Table = { readonly [outcome: string]: readonly EndReason[] };

export const WRITER_REASONS = {
  done: ["done"],
  asked: ["asked"],
  blocked: ["done", "asked", "blocked", ...FAILED_REASONS],
} as const satisfies Table;

export const DESIGN_REASONS = { done: ["done"], failed: FAILED_REASONS } as const satisfies Table;

type Paired<T extends Table> = {
  readonly [O in keyof T]: { readonly outcome: O; readonly reason: T[O][number] };
}[keyof T];

export type WriterEnd = Paired<typeof WRITER_REASONS>;
export type DesignEnd = Paired<typeof DESIGN_REASONS>;
export type BlockedReason = Extract<WriterEnd, { outcome: "blocked" }>["reason"];

export function isEndReason(value: unknown): value is EndReason {
  return END_REASONS.some((r) => r === value);
}

export function agrees<T extends Table>(
  table: T,
  end: { readonly outcome: keyof T; readonly reason: EndReason },
): end is Paired<T> {
  const allowed: readonly EndReason[] = table[end.outcome] ?? [];
  return allowed.includes(end.reason);
}
