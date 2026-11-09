// start — the human's START for one ticket (#227; docs/DESIGN.md section 3, P8: nothing starts unless a human starts
// it). START opens a ticket: the coordinator researches, asks and writes the spec, and the design and its review run
// where the lane needs them. In the tiny lane START is also what lets the build begin; the bug, feature and one-way-door
// lanes need an approval as well (approval.ts), and the approval floor never drops it.
//
// The record goes to <home>/starts/<project>/<ticket>.json: { ticket, kind: "start", by, via, at }. A START given again
// replaces it, and its new time is the one the orchestrator counts from, so a tiny ticket a person took back from
// needs-human starts afresh (#151 gap 1).
//
// Several factories may work on one project, so if a factory/<ticket> branch is already on the git host, START asks
// first: the caller passes what the git host said, and a START over an existing branch needs the human's yes.
//
// The AI never STARTs: `agent-factory start` is on the coordinator's deny list (coordinator.ts), its settings deny any
// edit of the starts folder, and on the VM the folder belongs to the separate `factory` OS user.

import { join } from "node:path";
import { field, isVia, readRecordFile, writeRecordFile, type Via } from "./human-record.js";
import { approvalState, currentSpec } from "./approval.js";
import { plainName, type Refused, type Spec, type Ticket } from "./spec.js";

export type StartRecord = {
  readonly version: 1;
  readonly kind: "start";
  readonly project: string;
  readonly ticket: string;
  readonly by: string;
  readonly via: Via;
  readonly at: string;
};

export type Where = { readonly home: string } & Ticket;

export type StartRequest = {
  readonly where: Where;
  readonly by: string;
  readonly via: Via;
  readonly at: string;
  // whether factory/<ticket> is already on the git host
  readonly branch: "absent" | "present";
  // the human's yes to START over that branch
  readonly confirmed: boolean;
};

export type Start =
  | { readonly kind: "started"; readonly record: StartRecord; readonly path: string }
  // factory/<ticket> is already on the git host: START again with the human's yes
  | { readonly kind: "ask"; readonly question: string }
  | Refused;

export type StoredStart =
  | { readonly kind: "record"; readonly record: StartRecord }
  | { readonly kind: "missing" }
  | Refused;

type PathResult = { readonly kind: "path"; readonly path: string } | Refused;

export function startPath(where: Where): PathResult {
  return plainName(where.project) && plainName(where.ticket)
    ? { kind: "path", path: join(where.home, "starts", where.project, `${where.ticket}.json`) }
    : {
        kind: "refused",
        reason: `a project and a ticket must be plain names, got ${JSON.stringify(where.project)} ${JSON.stringify(where.ticket)}`,
      };
}

// start : records the human's START; asks first when the ticket's branch is already on the git host
export async function start(request: StartRequest): Promise<Start> {
  const path = startPath(request.where);
  if (path.kind === "refused") {
    return path;
  }
  const { project, ticket } = request.where;
  if (request.branch === "present" && !request.confirmed) {
    return {
      kind: "ask",
      question: `factory/${ticket} is already on the git host: another factory may be working on ${project}/${ticket}`,
    };
  }
  const record: StartRecord = {
    version: 1,
    kind: "start",
    project,
    ticket,
    by: request.by,
    via: request.via,
    at: request.at,
  };
  const written = await writeRecordFile(path.path, record);
  return written.kind === "written" ? { kind: "started", record, path: written.path } : written;
}

function isStart(value: unknown, where: Where): value is StartRecord {
  return [
    field(value, "version") === 1,
    field(value, "kind") === "start",
    field(value, "project") === where.project,
    field(value, "ticket") === where.ticket,
    typeof field(value, "by") === "string",
    isVia(field(value, "via")),
    !Number.isNaN(Date.parse(String(field(value, "at")))),
  ].every(Boolean);
}

// readStart : the ticket's START as it is on disk
export async function readStart(where: Where): Promise<StoredStart> {
  const path = startPath(where);
  if (path.kind === "refused") {
    return path;
  }
  const file = await readRecordFile(path.path);
  if (file.kind !== "json") {
    return file;
  }
  return isStart(file.value, where)
    ? { kind: "record", record: file.value }
    : { kind: "refused", reason: `${path.path} is not a START record for ${where.project}/${where.ticket}` };
}

// What lets a ticket's build begin, for the steps that run it (the implementer's run, the automated review): its
// current approval in any lane, or its START in the tiny lane, with the spec as it is now. A START binds no hash: the
// tiny lane builds the spec as the coordinator left it.
export type GoAhead =
  | {
      readonly kind: "go";
      readonly said: "approved" | "started";
      readonly spec: Spec;
      readonly by: string;
      readonly at: string;
    }
  | { readonly kind: "held"; readonly why: string }
  | Refused;

async function tinyStart(where: Where, held: string): Promise<GoAhead> {
  const stored = await readStart(where);
  if (stored.kind !== "record") {
    return stored.kind === "missing" ? { kind: "held", why: held } : stored;
  }
  const current = await currentSpec(where);
  const tiny = current.kind === "spec" && current.spec.lane === "tiny";
  return tiny
    ? { kind: "go", said: "started", spec: current.spec, by: stored.record.by, at: stored.record.at }
    : { kind: "held", why: `${held}, and a START alone builds only the tiny lane` };
}

// goAhead : whether the ticket's build may begin, and on whose word
export async function goAhead(where: Where): Promise<GoAhead> {
  const approval = await approvalState(where);
  switch (approval.kind) {
    case "approved":
      return { kind: "go", said: "approved", spec: approval.spec, by: approval.record.by, at: approval.record.at };
    case "refused":
      return approval;
    case "stale":
    case "missing":
      return tinyStart(where, `the approval is ${approval.kind}`);
  }
}
