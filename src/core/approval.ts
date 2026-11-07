// approval — the human's go-ahead for one ticket, bound to the exact spec they saw (#104; ADR-0012 S1, W1).
//
// An approval is a permission given on this machine, not a forge or Jira note ([review 3 on map #30]). The human says
// "approve PROJ-123"; the coordinator runs `agent-factory approve <project> <ticket> <hash>`, which sits in the
// harness `ask` list only, so the prompt shows the ticket and the spec hash and only the human can confirm it. The
// record goes to <home>/approvals/<project>/<ticket>.json with the spec's hash, who approved and when.
//
// The dispatcher (#103) starts work only while the spec still has the approved hash: a spec edited after approval is
// stale, the same rule as a forge dismissing a PR approval when new commits arrive. The command line carries the hash
// the human saw, and approve refuses when the spec on disk no longer has it, so nobody approves a spec that changed
// between showing it and confirming it.
//
// The coordinator must never write the approvals folder itself: its settings deny it (#106). On the VM the folder
// belongs to the separate `factory` OS user, and `approve` writes it through a narrow sudo rule (GUIDE §Set up identity).

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { checkSpec, plainName, readSpec, type Spec } from "./spec.js";

export type ApprovalRecord = {
  readonly version: 1;
  readonly project: string;
  readonly ticket: string;
  readonly spec_hash: string;
  readonly by: string;
  readonly at: string;
};

export type Refused = { readonly kind: "refused"; readonly reason: string };

export type Approve = { readonly kind: "approved"; readonly record: ApprovalRecord; readonly path: string } | Refused;

export type ApprovalState =
  | { readonly kind: "approved"; readonly record: ApprovalRecord; readonly spec: Spec }
  | { readonly kind: "stale"; readonly approvedHash: string; readonly currentHash: string }
  | { readonly kind: "missing" }
  | Refused;

// The shortest hash prefix a human may confirm: 12 hex characters is 48 bits, more than enough to tell two edits apart.
export const MIN_CONFIRM = 12;

type Where = { readonly home: string; readonly project: string; readonly ticket: string };

export function approvalPath(where: Where): { readonly kind: "path"; readonly path: string } | Refused {
  return plainName(where.project) && plainName(where.ticket)
    ? { kind: "path", path: join(where.home, "approvals", where.project, `${where.ticket}.json`) }
    : { kind: "refused", reason: `a project and a ticket must be plain names, got ${JSON.stringify(where.project)} ${JSON.stringify(where.ticket)}` };
}

type Checked = { readonly kind: "spec"; readonly spec: Spec } | Refused | { readonly kind: "missing" };

async function currentSpec(where: Where): Promise<Checked> {
  const read = await readSpec({ kind: "local", root: join(where.home, "specs") }, where.project, where.ticket);
  if (read.kind !== "found") {
    return read;
  }
  const checked = checkSpec(read.text);
  return checked.kind === "ok"
    ? { kind: "spec", spec: checked.spec }
    : { kind: "refused", reason: `the spec is not ready: ${checked.problems.join("; ")}` };
}

function confirms(seen: string, actual: string): boolean {
  return /^[0-9a-f]+$/.test(seen) && seen.length >= MIN_CONFIRM && actual.startsWith(seen);
}

// approve : records the human's approval of the spec they saw. Refuses a spec that is missing, breaks the template, or
// no longer has the hash the human confirmed. The record is written to a temp file and renamed, so a reader never sees
// half a record.
export async function approve(where: Where, seenHash: string, by: string, at: string): Promise<Approve> {
  const path = approvalPath(where);
  if (path.kind === "refused") {
    return path;
  }
  const current = await currentSpec(where);
  switch (current.kind) {
    case "missing":
      return { kind: "refused", reason: `there is no spec for ${where.project}/${where.ticket}` };
    case "refused":
      return current;
    case "spec":
      break;
    default: {
      const unreachable: never = current;
      return unreachable;
    }
  }
  if (!confirms(seenHash.toLowerCase(), current.spec.hash)) {
    return {
      kind: "refused",
      reason: `the spec's hash is ${current.spec.hash.slice(0, MIN_CONFIRM)}, not the ${seenHash} you confirmed: it changed, or the hash is shorter than ${MIN_CONFIRM}; look at it again`,
    };
  }
  const record: ApprovalRecord = { version: 1, project: where.project, ticket: where.ticket, spec_hash: current.spec.hash, by, at };
  await mkdir(dirname(path.path), { recursive: true });
  const temp = `${path.path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
  await rename(temp, path.path);
  return { kind: "approved", record, path: path.path };
}

function isRecord(value: unknown, where: Where): value is ApprovalRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const r = value as Record<string, unknown>;
  return (
    r.version === 1 &&
    r.project === where.project &&
    r.ticket === where.ticket &&
    typeof r.spec_hash === "string" &&
    /^[0-9a-f]{64}$/.test(r.spec_hash) &&
    typeof r.by === "string" &&
    typeof r.at === "string"
  );
}

async function readRecord(path: string, where: Where): Promise<{ readonly kind: "record"; readonly record: ApprovalRecord } | Refused | { readonly kind: "missing" }> {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch (error: unknown) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    return missing ? { kind: "missing" } : { kind: "refused", reason: `cannot read ${path}: ${String(error)}` };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed, where) ? { kind: "record", record: parsed } : { kind: "refused", reason: `${path} is not an approval record for ${where.project}/${where.ticket}` };
  } catch {
    return { kind: "refused", reason: `${path} is not valid JSON` };
  }
}

// approvalState : what the dispatcher decides on. Approved only while the spec still has the approved hash.
export async function approvalState(where: Where): Promise<ApprovalState> {
  const path = approvalPath(where);
  if (path.kind === "refused") {
    return path;
  }
  const record = await readRecord(path.path, where);
  if (record.kind !== "record") {
    return record;
  }
  const current = await currentSpec(where);
  switch (current.kind) {
    case "missing":
      return { kind: "refused", reason: `${where.project}/${where.ticket} is approved, but its spec is gone` };
    case "refused":
      return current;
    case "spec":
      return current.spec.hash === record.record.spec_hash
        ? { kind: "approved", record: record.record, spec: current.spec }
        : { kind: "stale", approvedHash: record.record.spec_hash, currentHash: current.spec.hash };
    default: {
      const unreachable: never = current;
      return unreachable;
    }
  }
}
