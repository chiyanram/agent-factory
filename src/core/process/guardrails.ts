// guardrails — the closed list of guardrail IDs a role card's enforced_guardrails may name (#424; docs/explanation/
// plugins-and-roles.md). Each ID names code that enforces it, so a card cannot claim a guardrail the engine does not
// have. Every role has a floor of IDs that always apply, whatever its card says; a card may name more from the IDs its
// role can have, never fewer. An ID a later ticket builds joins the list with its code: tests-read-only with #422,
// own-hunks with #423.

import type { Role } from "./cards.js";

// each ID, and the code that enforces it
export const GUARDRAILS = {
  "read-only": "the run gets Read, Grep and Glob alone (agent/claude.ts claudeArgs, process/cards.ts ROLE_TOOLS)",
  "no-push": "git push is denied to the run; the host pushes (agent/claude-writer.ts writerDenies, finish.ts)",
  "no-web": "WebFetch and curl are denied to the run (agent/claude-writer.ts writerDenies)",
  "no-credentials":
    "reads of the credential paths under the person's home are denied (agent/claude-writer.ts writerDenies)",
  "judge-files-locked": "a change to a judge file stops the ready check (ready/floor.ts)",
  "edit-scope":
    "an edit outside the card's Edit(…) globs, or test-first's outside the project's test files, is refused in the run and blocks it on the host (writer/scope.ts)",
} as const;

export type GuardrailId = keyof typeof GUARDRAILS;

const WRITER: readonly GuardrailId[] = ["no-push", "no-web", "no-credentials"];

// the IDs that always apply to a role's run
export const GUARDRAIL_FLOOR: Readonly<Record<Role, readonly GuardrailId[]>> = {
  implementer: [...WRITER, "judge-files-locked"],
  "test-first": [...WRITER, "edit-scope"],
  cleanup: [...WRITER, "judge-files-locked"],
  "design-reviewer": ["read-only"],
  "verify-pass": ["read-only"],
  onboarder: ["read-only"],
  retro: ["read-only"],
};

// testFilesOnly : whether the role may edit only the project's test files (ready.testFiles), whatever its card says:
// edit-scope in a role's floor names no globs of its own, so it means the test files, and the role's card needs no
// Edit(…) path (writer/scope.ts scopesOf). Pure.
export function testFilesOnly(role: Role): boolean {
  return GUARDRAIL_FLOOR[role].includes("edit-scope");
}

// the roles whose runs edit the clone
const EDITS: ReadonlySet<Role> = new Set(["implementer", "test-first", "cleanup"]);

// allowedGuardrails : the IDs a card may name for its role: its floor, and edit-scope for a role that edits. Pure.
export function allowedGuardrails(role: Role): readonly GuardrailId[] {
  const floor = GUARDRAIL_FLOOR[role];
  return EDITS.has(role) ? [...new Set<GuardrailId>([...floor, "edit-scope"])] : floor;
}

// isGuardrail : whether a name is an ID on the list. Pure.
export function isGuardrail(name: string): name is GuardrailId {
  return Object.hasOwn(GUARDRAILS, name);
}
