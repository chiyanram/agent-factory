// review-again — a person's word "review once more" at the design-review round cap (dispatch/design.ts). The person
// runs `agent-factory review-again <project> <ticket> <hash>` at a front door (the terminal, or the Discord door's
// /review-again), through the door seam (door/write.ts), so the record names who said it and through which door. The
// record goes to <home>/review-again/<project>/<ticket>.json: { project, ticket, spec_hash, by, via, at }. A word given
// again replaces it; the run record keeps each one (dispatch/tick.ts heardLines).
//
// The word binds the full hash of the spec the person saw, and is refused unless the spec has that hash now. At the cap
// it lets exactly one more design-review round run at that hash; an edit after it is a new hash, and the cap holds
// again until the person says it again. A word at a ticket that is not at the cap changes nothing.
//
// The AI never says it: `agent-factory review-again` is on the coordinator's deny list (coordinator.ts), its settings
// deny any edit of the folder, and on the VM the folder belongs to the separate `factory` OS user.

import { join } from "node:path";
import { currentSpec, type Where } from "./approval.js";
import { isVia, readRecordFile, writeRecordFile, type Via } from "./human-record.js";
import { plainName, type Refused } from "./spec.js";
import { prop } from "./field.js";

export type ReviewAgainRecord = {
  readonly version: 1;
  readonly kind: "review-again";
  readonly project: string;
  readonly ticket: string;
  readonly spec_hash: string;
  readonly by: string;
  readonly via: Via;
  readonly at: string;
};

export type ReviewAgainRequest = {
  readonly where: Where;
  readonly seenHash: string;
  readonly by: string;
  readonly via: Via;
  readonly at: string;
};

export type ReviewAgain =
  | { readonly kind: "review-again"; readonly record: ReviewAgainRecord; readonly path: string }
  | Refused;

export type StoredReviewAgain =
  | { readonly kind: "record"; readonly record: ReviewAgainRecord }
  | { readonly kind: "missing" }
  | Refused;

const FULL_HASH = /^[0-9a-f]{64}$/;

type PathResult = { readonly kind: "path"; readonly path: string } | Refused;

export function reviewAgainPath(where: Where): PathResult {
  return plainName(where.project) && plainName(where.ticket)
    ? { kind: "path", path: join(where.home, "review-again", where.project, `${where.ticket}.json`) }
    : {
        kind: "refused",
        reason: `a project and a ticket must be plain names, got ${JSON.stringify(where.project)} ${JSON.stringify(where.ticket)}`,
      };
}

async function seenIsCurrent(request: ReviewAgainRequest): Promise<Refused | undefined> {
  if (!FULL_HASH.test(request.seenHash)) {
    return { kind: "refused", reason: "give the full 64-character spec hash that `agent-factory spec` printed" };
  }
  const current = await currentSpec(request.where);
  if (current.kind === "missing") {
    return { kind: "refused", reason: `there is no spec for ${request.where.project}/${request.where.ticket}` };
  }
  if (current.kind === "refused") {
    return current;
  }
  return current.spec.hash === request.seenHash
    ? undefined
    : {
        kind: "refused",
        reason: `the spec's hash is now ${current.spec.hash}, not the one you gave: it changed; look at it again`,
      };
}

export async function reviewAgain(request: ReviewAgainRequest): Promise<ReviewAgain> {
  const path = reviewAgainPath(request.where);
  if (path.kind === "refused") {
    return path;
  }
  const stale = await seenIsCurrent(request);
  if (stale !== undefined) {
    return stale;
  }
  const { project, ticket } = request.where;
  const record: ReviewAgainRecord = {
    version: 1,
    kind: "review-again",
    project,
    ticket,
    spec_hash: request.seenHash,
    by: request.by,
    via: request.via,
    at: request.at,
  };
  const written = await writeRecordFile(path.path, record);
  return written.kind === "written" ? { kind: "review-again", record, path: written.path } : written;
}

function isRecord(value: unknown, where: Where): value is ReviewAgainRecord {
  return [
    prop(value, "version") === 1,
    prop(value, "kind") === "review-again",
    prop(value, "project") === where.project,
    prop(value, "ticket") === where.ticket,
    FULL_HASH.test(String(prop(value, "spec_hash"))),
    typeof prop(value, "by") === "string",
    isVia(prop(value, "via")),
    !Number.isNaN(Date.parse(String(prop(value, "at")))),
  ].every(Boolean);
}

export async function readReviewAgain(where: Where): Promise<StoredReviewAgain> {
  const path = reviewAgainPath(where);
  if (path.kind === "refused") {
    return path;
  }
  const file = await readRecordFile(path.path);
  if (file.kind !== "json") {
    return file;
  }
  return isRecord(file.value, where)
    ? { kind: "record", record: file.value }
    : { kind: "refused", reason: `${path.path} is not a review-again record for ${where.project}/${where.ticket}` };
}
