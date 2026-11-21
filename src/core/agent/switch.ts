// switch — which Copilot run kinds may start (#690). Both are off: a project file that names copilot for a role is
// refused (project.ts agentsOf), because no Copilot run has been tried against a live CLI, and nothing claims a
// protection nobody has tried. Each kind is turned on in code, through its ticket, never by a setting. A leaf, so the
// project file's reader can import it.
//
// **Today:** the read-only kind is built and off until #697 checks a real run; the writer kind is not built (#698).

export const COPILOT_ON = { readOnly: false, writer: false } as const;

export const COPILOT_TICKET = { readOnly: "#697", writer: "#698" } as const;

export const COPILOT_ROLES = {
  readOnly: ["design-reviewer", "verify-pass", "onboarder", "finder"],
  writer: ["implementer", "test-first", "cleanup"],
} as const;

export type AgentRole = (typeof COPILOT_ROLES)["readOnly" | "writer"][number];
export type AgentName = "claude" | "copilot";
