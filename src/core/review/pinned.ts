// pinned — the automated review's models and the eval judge's, each a full model id, never an alias (ADR-0015 E9;
// #213). A new model reaches the review only through a PR that changes this file, and scripts/check-eval-proof.ts
// counts this file as a reviewer input: that PR adds an eval pass whose results ran with these ids (E8, E10). A layer
// may still set another id (review.findModel and the rest); a pass run with it is no proof for this file.
// A leaf with no import: the proof check loads it with Node's type stripping.

// the finder's, the rule finder's and the logic finder's models (#22 Q4: Sonnet, Sonnet, Opus)
export const REVIEW_MODELS = {
  find: "claude-sonnet-5-5",
  rule: "claude-sonnet-5-5",
  logic: "claude-opus-5-5",
} as const;

// the eval judge's model
export const JUDGE_MODEL = "claude-sonnet-5-5";
