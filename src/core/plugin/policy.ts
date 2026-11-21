// policy — the write policy's names and defaults (ADR-0014 P5), in a file of their own so the settings layers
// (core/settings/) can name each policy key without importing the project file's readers. A spec.body write replaces
// what the person approves, so its mode is confirm or deny, never allow (ADR-0012 S2).

// the writes whose text is a post.ts template, sent through the connector the project file maps them to (request.ts)
export const POST_POINTS = ["tracker.comment", "tracker.create", "notify"] as const;
export type PostPoint = (typeof POST_POINTS)[number];

export const POLICY_POINTS = [...POST_POINTS, "spec.body"] as const;
export type PolicyPoint = (typeof POLICY_POINTS)[number];

export type Mode = "allow" | "confirm" | "deny";
export const MODES: readonly Mode[] = ["allow", "confirm", "deny"];
export const CONFIRM_ONLY: readonly PolicyPoint[] = ["spec.body"];

export function modesOf(point: PolicyPoint): readonly Mode[] {
  return CONFIRM_ONLY.includes(point) ? MODES.filter((m) => m !== "allow") : MODES;
}

export type Rule = { readonly mode: Mode; readonly cap: number };
export type Policy = Readonly<Record<PolicyPoint, Rule>>;

export const DEFAULT_POLICY: Policy = {
  "tracker.comment": { mode: "allow", cap: 5 },
  "tracker.create": { mode: "confirm", cap: 1 },
  notify: { mode: "allow", cap: 3 },
  "spec.body": { mode: "confirm", cap: 10 },
};
export const MAX_CAP = 20;
