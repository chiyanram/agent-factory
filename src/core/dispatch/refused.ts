// refused — when a step that cannot run writes its "setup-refused" line (records.ts). It writes one per cause: none
// while the ticket's newest refusal since its last started line names the same step and why, so a pass that retries
// every few minutes does not fill the ticket's records. The key is the ticket's own records, not a second file.

import type { Event, Phase, Summary } from "./records.js";

export function refusedLine(runs: Summary, phase: Phase, why: string, at: string): Event | undefined {
  const last = runs.refused;
  return last !== "none" && last.phase === phase && last.why === why
    ? undefined
    : { at, kind: "setup-refused", phase, why };
}
