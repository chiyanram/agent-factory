// approval — the human's go-ahead for one ticket, bound to the exact spec they saw (#104; ADR-0012 S1, W1).
//
// An approval is a permission given on this machine, not a forge or Jira note. The human runs
// `agent-factory approve <project> <ticket> <hash>` at a front door (the terminal, or the Discord door's /approve);
// the coordinator's settings deny it, and the door seam refuses it from inside a model run. The
// record goes to <home>/approvals/<project>/<ticket>.json with the spec's hash, who approved and when.
//
// The dispatcher (#103) starts work only while the spec still has the approved hash: a spec edited after approval is
// stale, the same rule as a forge dismissing a PR approval when new commits arrive. The command line carries the full
// hash the human saw, and approve refuses unless the spec on disk has exactly that hash: a prefix could be matched by a
// second, different spec in minutes (a review of the first version found a 12-character collision).
//
// The design is the spec's own ## Design section (spec.ts), so the spec's hash is the one hash an approval binds. A
// record written when a design file beside the spec had its own hash reads through recordOf's mapping: version 1, or
// version 2 with design "none", is the spec's hash alone; version 2 with a real design hash reads as stale ("design
// moved"), because the person approved a text that is no longer read. Approve refuses a spec in a lane that needs a
// design and has none, and a design.md still beside the spec (spec.ts beforeApproval). The review reads a record that
// bound a design file as no approval at all (readBound). The record names the front door it came through (`via`:
// terminal, discord or pr); a version 1 record came from the terminal.
//
// Approval is what lets the build begin in the bug, feature and one-way-door lanes; tiny needs a START only (start.ts).
// The AI never approves: `agent-factory approve` is on the coordinator's deny list (coordinator.ts, #227), and the
// coordinator's settings deny any edit of the approvals folder. On the VM the folder belongs to the separate `factory`
// OS user, and `approve` writes it through a narrow sudo rule (GUIDE §Set up identity). The spec is read from the
// project's spec store (spec-store.ts, #381): <home>/specs, or the git host issue's body; the approval record is always
// local, so an edit to the issue makes the approval stale like an edit to a local spec.

import { join } from "node:path";
import { isVia, readRecordFile, writeRecordFile, type Via } from "./human-record.js";
import {
  beforeApproval,
  checkSpec,
  NO_DESIGN,
  plainName,
  readSpec,
  type Refused,
  type Spec,
  type SpecStore,
  type Ticket,
} from "./spec.js";
import { prop } from "./field.js";

export type ApprovalRecord = {
  readonly version: 3;
  readonly kind: "approval";
  readonly project: string;
  readonly ticket: string;
  readonly spec_hash: string;
  readonly by: string;
  readonly via: Via;
  readonly at: string;
};

export type Where = { readonly home: string; readonly store?: SpecStore } & Ticket;

export type ApproveRequest = {
  readonly where: Where;
  readonly seenHash: string;
  readonly by: string;
  readonly via?: Via;
  readonly at: string;
};

export type Approve = { readonly kind: "approved"; readonly record: ApprovalRecord; readonly path: string } | Refused;

export type ApprovalState =
  | { readonly kind: "approved"; readonly record: ApprovalRecord; readonly spec: Spec }
  | {
      readonly kind: "stale";
      readonly part: "spec" | "design moved";
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

function storeOf(where: Where): SpecStore {
  return where.store ?? { kind: "local", root: join(where.home, "specs") };
}

export type Current = { readonly kind: "spec"; readonly spec: Spec } | { readonly kind: "missing" } | Refused;

export async function currentSpec(where: Where): Promise<Current> {
  const read = await readSpec({ store: storeOf(where), project: where.project, ticket: where.ticket });
  if (read.kind !== "found") {
    return read.kind === "missing" ? { kind: "missing" } : read;
  }
  const checked = checkSpec(read.text);
  if (checked.kind !== "ok") {
    return { kind: "refused", reason: `the spec is not ready: ${checked.problems.join("; ")}` };
  }
  return { kind: "spec", spec: checked.spec };
}

type Confirmed = { readonly kind: "spec"; readonly spec: Spec } | Refused;

async function sameAsSeen(request: ApproveRequest, current: Extract<Current, { kind: "spec" }>): Promise<Confirmed> {
  if (current.spec.hash !== request.seenHash) {
    return {
      kind: "refused",
      reason: `the spec's hash is now ${current.spec.hash}, not the one you confirmed: it changed; look at it again`,
    };
  }
  const { where } = request;
  const problems = await beforeApproval(
    { store: storeOf(where), project: where.project, ticket: where.ticket },
    current.spec,
  );
  return problems.length === 0 ? current : { kind: "refused", reason: `the spec is not ready: ${problems.join("; ")}` };
}

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
    version: 3,
    kind: "approval",
    project,
    ticket,
    spec_hash: confirmed.spec.hash,
    by: request.by,
    via: request.via ?? "terminal",
    at: request.at,
  };
  const written = await writeRecordFile(path.path, record);
  return written.kind === "written" ? { kind: "approved", record, path: written.path } : written;
}

const hash = (v: unknown): boolean => typeof v === "string" && FULL_HASH.test(v);

function recordProblems(r: unknown, where: Where): readonly boolean[] {
  return [
    prop(r, "project") === where.project,
    prop(r, "ticket") === where.ticket,
    hash(prop(r, "spec_hash")),
    typeof prop(r, "by") === "string",
    typeof prop(r, "at") === "string",
  ];
}

function laterProblems(r: unknown): readonly boolean[] {
  return [prop(r, "kind") === "approval", isVia(prop(r, "via"))];
}

function versionProblems(r: unknown): readonly boolean[] {
  const design = prop(r, "design_hash");
  switch (prop(r, "version")) {
    case 1:
      return [];
    case 2:
      return [...laterProblems(r), design === NO_DESIGN || hash(design)];
    case 3:
      return [...laterProblems(r), design === undefined];
    default:
      return [false];
  }
}

function asRecord(r: unknown): ApprovalRecord {
  const v = (name: string): string => String(prop(r, name));
  const via = prop(r, "via");
  return {
    version: 3,
    kind: "approval",
    project: v("project"),
    ticket: v("ticket"),
    spec_hash: v("spec_hash"),
    by: v("by"),
    via: prop(r, "version") !== 1 && isVia(via) ? via : "terminal",
    at: v("at"),
  };
}

function movedOf(r: unknown): { readonly moved?: string } {
  const design = prop(r, "design_hash");
  return prop(r, "version") === 2 && design !== NO_DESIGN ? { moved: String(design) } : {};
}

type Mapped = { readonly record: ApprovalRecord; readonly moved?: string };

function recordOf(value: unknown, where: Where): Mapped | "bad" {
  const checks = [...recordProblems(value, where), ...versionProblems(value)];
  return checks.every(Boolean) ? { record: asRecord(value), ...movedOf(value) } : "bad";
}

export type Stored = ({ readonly kind: "record" } & Mapped) | { readonly kind: "missing" } | Refused;

async function readRecord(path: string, where: Where): Promise<Stored> {
  const file = await readRecordFile(path);
  if (file.kind !== "json") {
    return file;
  }
  const mapped = recordOf(file.value, where);
  return mapped === "bad"
    ? { kind: "refused", reason: `${path} is not an approval record for ${where.project}/${where.ticket}` }
    : { kind: "record", ...mapped };
}

function compare(stored: Mapped, current: Current, where: Where): ApprovalState {
  const { record } = stored;
  if (current.kind !== "spec") {
    return current.kind === "missing"
      ? { kind: "refused", reason: `${where.project}/${where.ticket} is approved, but its spec is gone` }
      : current;
  }
  if (current.spec.hash !== record.spec_hash) {
    return { kind: "stale", part: "spec", approvedHash: record.spec_hash, currentHash: current.spec.hash };
  }
  return stored.moved === undefined
    ? { kind: "approved", record, spec: current.spec }
    : { kind: "stale", part: "design moved", approvedHash: stored.moved, currentHash: current.spec.hash };
}

export async function readApproval(where: Where): Promise<Stored> {
  const path = approvalPath(where);
  return path.kind === "path" ? readRecord(path.path, where) : path;
}

export async function readBound(where: Where): Promise<Stored> {
  const stored = await readApproval(where);
  return stored.kind === "record" && stored.moved !== undefined ? { kind: "missing" } : stored;
}

export function staleWhy(name: string, state: Extract<ApprovalState, { kind: "stale" }>): string {
  return state.part === "design moved"
    ? `stale ${name}: the approval bound design ${state.approvedHash}, a file beside the spec; the design moved into the spec's ## Design; approve again`
    : `stale ${name}: approved the hash ${state.approvedHash}, now ${state.currentHash}; approve again`;
}

export async function approvalState(where: Where): Promise<ApprovalState> {
  const stored = await readApproval(where);
  return stored.kind === "record" ? compare(stored, await currentSpec(where), where) : stored;
}
