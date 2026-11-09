// waiver — a human's waiver of the test checks at one head (#231; docs/DESIGN.md section 5, "Tests are judged twice").
//
// The test checks (ready/floor.ts) stop a change that removes a test, adds a skip, removes assertions or changes a judge
// file. Such a stop goes to a person (needs-human) with the hits listed, never back to the writer. A person who agrees
// with the change clears it with `agent-factory waive <project> <ticket> <head>`, through the same front doors as a
// START or an approval (human-record.ts). The record goes to <home>/waivers/<project>/<ticket>.json:
// { ticket, kind: "test-change", head, by, via, at }. A waiver given again replaces it.
//
// A waiver is scoped to its head. On a later head the test checks look again only at the files the new interdiff (the
// waiver's head to the new head) touches: a file the waiver cleared is flagged again only if it changes again.
//
// The AI never waives: `agent-factory waive` is on the coordinator's deny list (coordinator.ts), its settings deny any
// edit of the waivers folder, and on the VM the folder belongs to the separate `factory` OS user.

import { join } from "node:path";
import { field, isVia, readRecordFile, writeRecordFile, type Via } from "./human-record.js";
import { plainName, type Refused, type Ticket } from "./spec.js";

export type WaiverRecord = {
  readonly version: 1;
  readonly kind: "test-change";
  readonly project: string;
  readonly ticket: string;
  // the full commit id the human saw the hits at
  readonly head: string;
  readonly by: string;
  readonly via: Via;
  readonly at: string;
};

export type Where = { readonly home: string } & Ticket;

export type WaiveRequest = {
  readonly where: Where;
  readonly head: string;
  readonly by: string;
  readonly via: Via;
  readonly at: string;
};

export type Waive = { readonly kind: "waived"; readonly record: WaiverRecord; readonly path: string } | Refused;

export type StoredWaiver =
  | { readonly kind: "record"; readonly record: WaiverRecord }
  | { readonly kind: "missing" }
  | Refused;

// a full commit id: SHA-1 or SHA-256, never a prefix another commit could match
const FULL_HEAD = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

type PathResult = { readonly kind: "path"; readonly path: string } | Refused;

export function waiverPath(where: Where): PathResult {
  return plainName(where.project) && plainName(where.ticket)
    ? { kind: "path", path: join(where.home, "waivers", where.project, `${where.ticket}.json`) }
    : {
        kind: "refused",
        reason: `a project and a ticket must be plain names, got ${JSON.stringify(where.project)} ${JSON.stringify(where.ticket)}`,
      };
}

// waive : records the human's waiver of the test checks at the head they saw
export async function waive(request: WaiveRequest): Promise<Waive> {
  const path = waiverPath(request.where);
  if (path.kind === "refused") {
    return path;
  }
  if (!FULL_HEAD.test(request.head)) {
    return { kind: "refused", reason: "give the full commit id of the head the hits were listed at" };
  }
  const { project, ticket } = request.where;
  const record: WaiverRecord = {
    version: 1,
    kind: "test-change",
    project,
    ticket,
    head: request.head,
    by: request.by,
    via: request.via,
    at: request.at,
  };
  const written = await writeRecordFile(path.path, record);
  return written.kind === "written" ? { kind: "waived", record, path: written.path } : written;
}

function isWaiver(value: unknown, where: Where): value is WaiverRecord {
  return [
    field(value, "version") === 1,
    field(value, "kind") === "test-change",
    field(value, "project") === where.project,
    field(value, "ticket") === where.ticket,
    FULL_HEAD.test(String(field(value, "head"))),
    typeof field(value, "by") === "string",
    isVia(field(value, "via")),
    !Number.isNaN(Date.parse(String(field(value, "at")))),
  ].every(Boolean);
}

// readWaiver : the ticket's waiver as it is on disk
export async function readWaiver(where: Where): Promise<StoredWaiver> {
  const path = waiverPath(where);
  if (path.kind === "refused") {
    return path;
  }
  const file = await readRecordFile(path.path);
  if (file.kind !== "json") {
    return file;
  }
  return isWaiver(file.value, where)
    ? { kind: "record", record: file.value }
    : { kind: "refused", reason: `${path.path} is not a waiver record for ${where.project}/${where.ticket}` };
}
