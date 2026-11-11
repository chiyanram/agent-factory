// lane-order — the lanes, lightest first, and how one lane compares to another (#230). Pure, and imports nothing, so
// the decision table can read it and stay pure (P1, #485); spec.ts and lane.ts re-export it.

export const LANES = ["tiny", "bug", "feature", "one-way door"] as const;
export type Lane = (typeof LANES)[number];

function rank(lane: Lane): number {
  return LANES.indexOf(lane);
}

// above : whether lane a needs more process than lane b. Pure.
export function above(a: Lane, b: Lane): boolean {
  return rank(a) > rank(b);
}

// heavier : the heavier of two lanes: a check only ever raises. Pure.
export function heavier(a: Lane, b: Lane): Lane {
  return above(b, a) ? b : a;
}

// raisedWhy : what a person reads about a raise that stops the ticket. Pure.
export function raisedWhy(raise: { readonly from: Lane; readonly to: Lane; readonly why: string }): string {
  return `the lane is raised from ${raise.from} to ${raise.to} (${raise.why}): the coordinator raises the spec's lane, and a human approves it`;
}
