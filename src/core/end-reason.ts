// end-reason — the closed list of ways a run can end, one of which every ended record line names. It imports
// nothing, so the report, the agent adapters and the records parser can all name a reason with no import cycle.
// `launch_failed` also covers a CLI that exited with an error before it answered, `unknown` names an old line or a
// failure nothing classifies yet, and a wait for room is no end, so it is not on the list.
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

export function isEndReason(value: unknown): value is EndReason {
  return END_REASONS.some((r) => r === value);
}
