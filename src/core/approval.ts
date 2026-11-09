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
// The approval binds the design too (#227): the hash of the ticket's design file beside the spec, or "none" when it has
// none (spec.ts designHash). An edit to the spec or to the design makes the approval stale, and approve refuses unless
// the design on disk has exactly the design hash the human confirmed. The record names the front door it came through
// (`via`: terminal, discord or pr). A record written before #227 (version 1) bound no design and came from the terminal.
//
// Approval is what lets the build begin in the bug, feature and one-way-door lanes; tiny needs a START only (start.ts).
// The AI never approves: `agent-factory approve` is on the coordinator's deny list (coordinator.ts, #227), and the
// coordinator's settings deny any edit of the approvals folder. On the VM the folder belongs to the separate `factory`
// OS user, and `approve` writes it through a narrow sudo rule (GUIDE §Set up identity). The local store is the one this
// reads today; an issue-backed spec joins when the forge seam (#102) is ported.

import { join } from "node:path";
import { field, isVia, readRecordFile, writeRecordFile, type Via } from "./human-record.js";
import {
  checkSpec,
  designHash,
  NO_DESIGN,
  plainName,
  readSpec,
  type Refused,
  type Spec,
  type SpecStore,
  type Ticket,
} from "./spec.js";

export type ApprovalRecord = {
  readonly version: 2;
  readonly kind: "approval";
  readonly project: string;
  readonly ticket: string;
  readonly spec_hash: string;
  // the design file's hash, or "none"
  readonly design_hash: string;
  readonly by: string;
  readonly via: Via;
  readonly at: string;
};

export type Where = { readonly home: string } & Ticket;

export type ApproveRequest = {
  readonly where: Where;
  readonly seenHash: string;
  // the design hash the human confirmed; none given is "none"
  readonly seenDesign?: string;
  readonly by: string;
  // the front door; none given is the terminal
  readonly via?: Via;
  readonly at: string;
};

export type Approve = { readonly kind: "approved"; readonly record: ApprovalRecord; readonly path: string } | Refused;

export type ApprovalState =
  | { readonly kind: "approved"; readonly record: ApprovalRecord; readonly spec: Spec }
  | {
      readonly kind: "stale";
      // which of the two the human approved changed since
      readonly part: "spec" | "design";
      readonly approvedHash: string;
      readonly currentHash: string;
    }
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

function localStore(where: Where): SpecStore {
  return { kind: "local", root: join(where.home, "specs") };
}

export type Current =
  | { readonly kind: "spec"; readonly spec: Spec; readonly design: string }
  | { readonly kind: "missing" }
  | Refused;

// currentSpec : the ticket's spec as it is now, checked against the template, and its design's hash
export async function currentSpec(where: Where): Promise<Current> {
  const read = await readSpec({ store: localStore(where), project: where.project, ticket: where.ticket });
  if (read.kind !== "found") {
    return read.kind === "missing" ? { kind: "missing" } : read;
  }
  const checked = checkSpec(read.text);
  if (checked.kind !== "ok") {
    return { kind: "refused", reason: `the spec is not ready: ${checked.problems.join("; ")}` };
  }
  const design = await designHash({ store: localStore(where), project: where.project, ticket: where.ticket });
  return design.kind === "design" ? { kind: "spec", spec: checked.spec, design: design.hash } : design;
}

type Confirmed = { readonly kind: "spec"; readonly spec: Spec; readonly design: string } | Refused;

function seenDesign(request: ApproveRequest): string {
  return request.seenDesign ?? NO_DESIGN;
}

// sameAsSeen : the current spec, when both hashes are the ones the human confirmed
function sameAsSeen(request: ApproveRequest, current: Extract<Current, { kind: "spec" }>): Confirmed {
  if (current.spec.hash !== request.seenHash) {
    return {
      kind: "refused",
      reason: `the spec's hash is now ${current.spec.hash}, not the one you confirmed: it changed; look at it again`,
    };
  }
  return current.design === seenDesign(request)
    ? current
    : {
        kind: "refused",
        reason: `the design's hash is now ${current.design}, not the one you confirmed (${seenDesign(request)}): look at it again`,
      };
}

// confirmedSpec : the current spec, if it and its design have exactly the hashes the human confirmed.
async function confirmedSpec(request: ApproveRequest): Promise<Confirmed> {
  if (!FULL_HASH.test(request.seenHash)) {
    return { kind: "refused", reason: "give the full 64-character spec hash that `agent-factory spec` printed" };
  }
  const current = await currentSpec(request.where);
  if (current.kind !== "spec") {
    return current.kind === "missing"
      ? { kind: "refused", reason: `there is no spec for ${request.where.project}/${request.where.ticket}` }
      : current;
  }
  return sameAsSeen(request, current);
}

// approve : records the human's approval of the spec and the design they saw.
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
  const record: ApprovalRecord = {
    version: 2,
    kind: "approval",
    project,
    ticket,
    spec_hash: confirmed.spec.hash,
    design_hash: confirmed.design,
    by: request.by,
    via: request.via ?? "terminal",
    at: request.at,
  };
  const written = await writeRecordFile(path.path, record);
  return written.kind === "written" ? { kind: "approved", record, path: written.path } : written;
}

const hash = (v: unknown): boolean => typeof v === "string" && FULL_HASH.test(v);

// The fields a record must hold, and the value each must have, so isRecord is a table, not a chain of conditions.
function recordProblems(r: unknown, where: Where): readonly boolean[] {
  return [
    field(r, "project") === where.project,
    field(r, "ticket") === where.ticket,
    hash(field(r, "spec_hash")),
    typeof field(r, "by") === "string",
    typeof field(r, "at") === "string",
  ];
}

// the fields only a version 2 record has
function secondProblems(r: unknown): readonly boolean[] {
  const design = field(r, "design_hash");
  return [field(r, "kind") === "approval", design === NO_DESIGN || hash(design), isVia(field(r, "via"))];
}

// asRecord : a checked record; a version 1 record bound no design and came from the terminal
function asRecord(r: unknown): ApprovalRecord {
  const v = (name: string): string => String(field(r, name));
  const via = field(r, "via");
  const second = field(r, "version") === 2;
  return {
    version: 2,
    kind: "approval",
    project: v("project"),
    ticket: v("ticket"),
    spec_hash: v("spec_hash"),
    design_hash: second ? v("design_hash") : NO_DESIGN,
    by: v("by"),
    via: second && isVia(via) ? via : "terminal",
    at: v("at"),
  };
}

// recordOf : a version 2 record as it is, a version 1 record as one that bound no design and came from the terminal
function recordOf(value: unknown, where: Where): ApprovalRecord | "bad" {
  const version = field(value, "version");
  const checks = [...recordProblems(value, where), ...(version === 2 ? secondProblems(value) : [version === 1])];
  return checks.every(Boolean) ? asRecord(value) : "bad";
}

export type Stored =
  | { readonly kind: "record"; readonly record: ApprovalRecord }
  | { readonly kind: "missing" }
  | Refused;

async function readRecord(path: string, where: Where): Promise<Stored> {
  const file = await readRecordFile(path);
  if (file.kind !== "json") {
    return file;
  }
  const record = recordOf(file.value, where);
  return record === "bad"
    ? { kind: "refused", reason: `${path} is not an approval record for ${where.project}/${where.ticket}` }
    : { kind: "record", record };
}

function compare(record: ApprovalRecord, current: Current, where: Where): ApprovalState {
  if (current.kind !== "spec") {
    return current.kind === "missing"
      ? { kind: "refused", reason: `${where.project}/${where.ticket} is approved, but its spec is gone` }
      : current;
  }
  if (current.spec.hash !== record.spec_hash) {
    return { kind: "stale", part: "spec", approvedHash: record.spec_hash, currentHash: current.spec.hash };
  }
  return current.design === record.design_hash
    ? { kind: "approved", record, spec: current.spec }
    : { kind: "stale", part: "design", approvedHash: record.design_hash, currentHash: current.design };
}

// readApproval : the ticket's approval record as it is on disk, without a look at the spec; the reviewer's pack (#224)
// compares its hash with the spec it reads from the project's spec store
export async function readApproval(where: Where): Promise<Stored> {
  const path = approvalPath(where);
  return path.kind === "path" ? readRecord(path.path, where) : path;
}

// approvalState : what the dispatcher decides on. Approved only while the spec and the design still have the approved
// hashes.
export async function approvalState(where: Where): Promise<ApprovalState> {
  const stored = await readApproval(where);
  return stored.kind === "record" ? compare(stored.record, await currentSpec(where), where) : stored;
}
