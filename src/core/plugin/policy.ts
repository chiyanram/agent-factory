// policy — the write policy's names and defaults (ADR-0014 P5), in a file of their own so the settings layers
// (core/settings/) can name each policy key without importing the project file's readers.

// the writes whose text is a post.ts template, sent through the connector the project file maps them to (request.ts)
export const POST_POINTS = ["tracker.comment", "tracker.create", "notify"] as const;
export type PostPoint = (typeof POST_POINTS)[number];

// spec.body: a spec change in the issue store, the whole new issue body, sent through the project's forge (#542)
export const POLICY_POINTS = [...POST_POINTS, "spec.body"] as const;
export type PolicyPoint = (typeof POLICY_POINTS)[number];

export type Mode = "allow" | "confirm" | "deny";
// the modes from the loosest to the strictest, for the settings ladder
export const MODES: readonly Mode[] = ["allow", "confirm", "deny"];
// the writes that go out only on the person's yes, never at once: a spec body replaces what the person approves, so
// its policy is confirm or deny, never allow (ADR-0012 S2, #542)
export const CONFIRM_ONLY: readonly PolicyPoint[] = ["spec.body"];

// modesOf : the modes a write's policy may take, from the loosest to the strictest
export function modesOf(point: PolicyPoint): readonly Mode[] {
  return CONFIRM_ONLY.includes(point) ? MODES.filter((m) => m !== "allow") : MODES;
}

export type Rule = { readonly mode: Mode; readonly cap: number };
export type Policy = Readonly<Record<PolicyPoint, Rule>>;

// ADR-0014 P5
export const DEFAULT_POLICY: Policy = {
  "tracker.comment": { mode: "allow", cap: 5 },
  "tracker.create": { mode: "confirm", cap: 1 },
  notify: { mode: "allow", cap: 3 },
  "spec.body": { mode: "confirm", cap: 10 },
};
export const MAX_CAP = 20;
