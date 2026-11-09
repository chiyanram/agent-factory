// policy — the write policy's names and defaults (ADR-0014 P5), in a file of their own so the settings layers
// (core/settings/) can name each policy key without importing the project file's readers.

export const POLICY_POINTS = ["tracker.comment", "tracker.create", "notify"] as const;
export type PolicyPoint = (typeof POLICY_POINTS)[number];

export type Mode = "allow" | "confirm" | "deny";
// the modes from the loosest to the strictest, for the settings ladder
export const MODES: readonly Mode[] = ["allow", "confirm", "deny"];
export type Rule = { readonly mode: Mode; readonly cap: number };
export type Policy = Readonly<Record<PolicyPoint, Rule>>;

// ADR-0014 P5
export const DEFAULT_POLICY: Policy = {
  "tracker.comment": { mode: "allow", cap: 5 },
  "tracker.create": { mode: "confirm", cap: 1 },
  notify: { mode: "allow", cap: 3 },
};
export const MAX_CAP = 20;
