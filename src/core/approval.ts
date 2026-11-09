// approval — the human's go-ahead for one ticket, bound to the exact spec they saw (#104; ADR-0012 S1, W1).
//
// An approval is a permission given on this machine, not a forge or Jira note ([review 3 on map #30]). The human says
// "approve PROJ-123"; the coordinator runs `agent-factory approve <project> <ticket> <hash>`, which sits in the
// harness `ask` list only, so the prompt shows the ticket and the spec hash and only the human can confirm it. The
// record goes to <home>/approvals/<project>/<ticket>.json with the spec's hash, who approved and when.
//
// The dispatcher (#103) starts work only while the spec still has the approved hash: a spec edited after approval is
// stale, the same rule as a forge dismissing a PR approval when new commits arrive. The command line carries the full
// hash the human saw, and approve refuses unless the spec on disk has exactly that hash: a prefix could be matched by a
// second, different spec in minutes (a review of the first version found a 12-character collision).
//
// The coordinator must never write the approvals folder itself: its settings deny it (#106). On the VM the folder
// belongs to the separate `factory` OS user, and `approve` writes it through a narrow sudo rule (GUIDE §Set up identity).
// The local store is the one this reads today; an issue-backed spec joins when the forge seam (#102) is ported.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { checkSpec, plainName, readSpec, type Refused, type Spec, type Ticket } from "./spec.js";

export type ApprovalRecord = {
  readonly version: 1;
  readonly project: string;
  readonly ticket: string;
  readonly spec_hash: string;
  readonly by: string;
  readonly at: string;
};

export type Where = { readonly home: string } & Ticket;

export type ApproveRequest = {
  readonly where: Where;
  readonly seenHash: string;
  readonly by: string;
  readonly at: string;
};

export type Approve = { readonly kind: "approved"; readonly record: ApprovalRecord; readonly path: string } | Refused;

export type ApprovalState =
  | { readonly kind: "approved"; readonly record: ApprovalRecord; readonly spec: Spec }
  | { readonly kind: "stale"; readonly approvedHash: string; readonly currentHash: string }
  | { readonly kind: "missing" }
  | Refused;

const FULL_HASH = /^[0-9a-f]{64}$/;

type PathResult = { readonly kind: "path"; readonly path: string } | Refused;

export function approvalPath(where: Where): PathResult {
  return plainName(where.project) && plainName(where.ticket)
    ? { kind: "path", path: join(where.home, "approvals", where.project, `${where.ticket}.json`) }
    : {
        kind: "refused",
        reason: `a project and a ticket must be plain names, got ${JSON.stringify(where.project)} ${JSON.stringify(where.ticket)}`,
      };
}

type Current = { readonly kind: "spec"; readonly spec: Spec } | { readonly kind: "missing" } | Refused;

async function currentSpec(where: Where): Promise<Current> {
  const read = await readSpec({
    store: { kind: "local", root: join(where.home, "specs") },
    project: where.project,
    ticket: where.ticket,
  });
  if (read.kind !== "found") {
    return read.kind === "missing" ? { kind: "missing" } : read;
  }
  const checked = checkSpec(read.text);
  return checked.kind === "ok"
    ? { kind: "spec", spec: checked.spec }
    : { kind: "refused", reason: `the spec is not ready: ${checked.problems.join("; ")}` };
}

// confirmedSpec : the current spec, if it has exactly the hash the human confirmed.
async function confirmedSpec(
  request: ApproveRequest,
): Promise<{ readonly kind: "spec"; readonly spec: Spec } | Refused> {
  if (!FULL_HASH.test(request.seenHash)) {
    return { kind: "refused", reason: "give the full 64-character spec hash that `agent-factory spec` printed" };
  }
  const current = await currentSpec(request.where);
  if (current.kind !== "spec") {
    return current.kind === "missing"
      ? { kind: "refused", reason: `there is no spec for ${request.where.project}/${request.where.ticket}` }
      : current;
  }
  return current.spec.hash === request.seenHash
    ? current
    : {
        kind: "refused",
        reason: `the spec's hash is now ${current.spec.hash}, not the one you confirmed: it changed; look at it again`,
      };
}

// writeRecord : the record, through a temp file and a rename so a reader never sees half of it. A failure is a
// refusal, and the temp file is removed.
async function writeRecord(path: string, record: ApprovalRecord): Promise<Approve> {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
    await rename(temp, path);
    return { kind: "approved", record, path };
  } catch (error: unknown) {
    await rm(temp, { force: true }).catch(() => undefined); // best effort: the temp may never have been made
    return {
      kind: "refused",
      reason: `cannot write ${path}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// approve : records the human's approval of the spec they saw.
export async function approve(request: ApproveRequest): Promise<Approve> {
  const path = approvalPath(request.where);
  if (path.kind === "refused") {
    return path;
  }
  const confirmed = await confirmedSpec(request);
  if (confirmed.kind === "refused") {
    return confirmed;
  }
  const { project, ticket } = request.where;
  return writeRecord(path.path, {
    version: 1,
    project,
    ticket,
    spec_hash: confirmed.spec.hash,
    by: request.by,
    at: request.at,
  });
}

// The fields a record must hold, and the value each must have, so isRecord is a table, not a chain of conditions.
function recordProblems(r: Readonly<Record<string, unknown>>, where: Where): readonly boolean[] {
  return [
    r.version === 1,
    r.project === where.project,
    r.ticket === where.ticket,
    typeof r.spec_hash === "string" && FULL_HASH.test(r.spec_hash),
    typeof r.by === "string",
    typeof r.at === "string",
  ];
}

function isRecord(value: unknown, where: Where): value is ApprovalRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    recordProblems(value as Record<string, unknown>, where).every(Boolean)
  );
}

export type Stored =
  | { readonly kind: "record"; readonly record: ApprovalRecord }
  | { readonly kind: "missing" }
  | Refused;

function parseRecord(text: string, path: string, where: Where): Stored {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed, where)
      ? { kind: "record", record: parsed }
      : { kind: "refused", reason: `${path} is not an approval record for ${where.project}/${where.ticket}` };
  } catch {
    return { kind: "refused", reason: `${path} is not valid JSON` };
  }
}

async function readRecord(path: string, where: Where): Promise<Stored> {
  try {
    return parseRecord(await readFile(path, "utf8"), path, where);
  } catch (error: unknown) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    return missing ? { kind: "missing" } : { kind: "refused", reason: `cannot read ${path}: ${String(error)}` };
  }
}

function compare(record: ApprovalRecord, current: Current, where: Where): ApprovalState {
  if (current.kind !== "spec") {
    return current.kind === "missing"
      ? { kind: "refused", reason: `${where.project}/${where.ticket} is approved, but its spec is gone` }
      : current;
  }
  return current.spec.hash === record.spec_hash
    ? { kind: "approved", record, spec: current.spec }
    : { kind: "stale", approvedHash: record.spec_hash, currentHash: current.spec.hash };
}

// readApproval : the ticket's approval record as it is on disk, without a look at the spec; the reviewer's pack (#224)
// compares its hash with the spec it reads from the project's spec store
export async function readApproval(where: Where): Promise<Stored> {
  const path = approvalPath(where);
  return path.kind === "path" ? readRecord(path.path, where) : path;
}

// approvalState : what the dispatcher decides on. Approved only while the spec still has the approved hash.
export async function approvalState(where: Where): Promise<ApprovalState> {
  const stored = await readApproval(where);
  return stored.kind === "record" ? compare(stored.record, await currentSpec(where), where) : stored;
}
