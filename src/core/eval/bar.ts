// bar — the bar a change to the factory must pass to be kept (ADR-0021, P11): no worse than the baseline on what it
// must hold, and better by more than the noise on what it aims at, quality or cost. The harness records a pass's aim
// (agent-factory eval reviewer --aim). A leaf with no runtime imports, so scripts/check-eval-proof.ts can load it on
// Node's type stripping. Pure.
//
// **Today:** only the aims are here; the noise and the bar follow in #488's next slice.

// what a change aims at (ADR-0021 N4)
export type Aim = "quality" | "cost";
export const AIMS: readonly Aim[] = ["quality", "cost"];
