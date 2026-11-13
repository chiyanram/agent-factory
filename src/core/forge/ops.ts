// ops — the forge seam as plugin ops (#134 PR C; ADR-0014 P1). Each Forge method is one op of forge.read or forge.write;
// its input is the method's input with the project added, and its answer is:
//
//   a read     { kind: "ok", value }      the method's value, in the seam's own shapes (shapes.ts)
//   a write    { kind: "done" }           openChange adds value: the change's number
//   either     { kind: "failed", reason }
//
// A plugin that answers anything else has failed. The core never sends a write as a read, so a plugin that declares
// forge.read alone can never be made to write.

export const FORGE_OPS = {
  me: "forge.read",
  change: "forge.read",
  landed: "forge.read",
  defaultBranch: "forge.read",
  branchExists: "forge.read",
  branchState: "forge.read",
  issueState: "forge.read",
  issueBody: "forge.read",
  notes: "forge.read",
  ciConfig: "forge.read",
  claimed: "forge.read",
  changes: "forge.read",
  failedJobs: "forge.read",
  addLabel: "forge.write",
  removeLabel: "forge.write",
  note: "forge.write",
  setBody: "forge.write",
  setIssueBody: "forge.write",
  lineFinding: "forge.write",
  status: "forge.write",
  openChange: "forge.write",
} as const satisfies Readonly<Record<string, "forge.read" | "forge.write">>;

export type ForgeOp = keyof typeof FORGE_OPS;

export function isForgeOp(value: string): value is ForgeOp {
  return Object.hasOwn(FORGE_OPS, value);
}
