// writes — the coordinator's writes on one ticket, counted for the cap (#134; ADR-0014 P5). Each write is logged in
// <home>/writes/<project>/<ticket>.jsonl before it is sent: a "reserved" line names its capability and the approval it
// counts against, and an outcome line follows. A cap counts the reserved lines of the ticket's current approval, so
// approving again starts the count afresh, and a write that failed or never got its outcome still counts: a plugin
// that timed out may have posted. One ticket's writes run one at a time behind <ticket>.lock. A log that does not
// read is refused, never read as empty. Nothing here throws.

import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Done, Result } from "../forge/api.js";
import { codeOf, prop } from "../dispatch/records.js";
import { attempt } from "../review/safe.js";
import { isPolicyPoint, type PolicyPoint } from "./config.js";

export type Where = { readonly home: string; readonly project: string; readonly ticket: string };

export type Reserved = {
  readonly kind: "reserved";
  readonly id: string;
  readonly capability: PolicyPoint;
  // the approval this write counts against (approvalKey)
  readonly approval: string;
  readonly at: string;
  // the sha256 of the text sent
  readonly sha256: string;
};

export type Ended = {
  readonly kind: "done" | "failed";
  readonly id: string;
  readonly at: string;
  readonly detail: string;
};

export type Line = Reserved | Ended;

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

export function logPath(where: Where): string {
  return join(where.home, "writes", where.project, `${where.ticket}.jsonl`);
}

// approvalKey : one approval, by when it was given and the spec it approved; a new approval is a new key
export function approvalKey(record: { readonly at: string; readonly spec_hash: string }): string {
  return `${record.at} ${record.spec_hash}`;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function allTexts(raw: unknown, names: readonly string[]): boolean {
  return names.every((k) => text(prop(raw, k)));
}

function str(raw: unknown, name: string): string {
  return String(prop(raw, name));
}

function reservedOf(raw: unknown): Reserved | "bad" {
  const capability = prop(raw, "capability");
  return isPolicyPoint(capability) && allTexts(raw, ["id", "approval", "at", "sha256"])
    ? {
        kind: "reserved",
        id: str(raw, "id"),
        capability,
        approval: str(raw, "approval"),
        at: str(raw, "at"),
        sha256: str(raw, "sha256"),
      }
    : "bad";
}

function endKind(value: unknown): Ended["kind"] | "bad" {
  return value === "done" || value === "failed" ? value : "bad";
}

function endedOf(raw: unknown): Ended | "bad" {
  const kind = endKind(prop(raw, "kind"));
  const detail = prop(raw, "detail");
  return kind !== "bad" && allTexts(raw, ["id", "at"]) && typeof detail === "string"
    ? { kind, id: str(raw, "id"), at: str(raw, "at"), detail }
    : "bad";
}

function lineOf(raw: unknown): Line | "bad" {
  return prop(raw, "kind") === "reserved" ? reservedOf(raw) : endedOf(raw);
}

function parsed(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

function linesOf(file: string, content: string): Result<readonly Line[]> {
  const read = content
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => lineOf(parsed(l)));
  return read.includes("bad")
    ? failed(`${file} has a line that is not a write record; no write goes out until it is fixed`)
    : { kind: "ok", value: read.filter((l): l is Line => l !== "bad") };
}

// readLog : every line of the ticket's write log; no log is no writes
export async function readLog(where: Where): Promise<Result<readonly Line[]>> {
  const file = logPath(where);
  try {
    return linesOf(file, await readFile(file, "utf8"));
  } catch (error) {
    return codeOf(error) === "ENOENT" ? { kind: "ok", value: [] } : failed(`cannot read ${file}`);
  }
}

// counted : the writes of one capability against one approval
export function counted(lines: readonly Line[], capability: PolicyPoint, approval: string): number {
  return lines.filter((l) => l.kind === "reserved" && l.capability === capability && l.approval === approval).length;
}

export function appendLine(where: Where, line: Line): Promise<Done> {
  const file = logPath(where);
  return attempt(async () => {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await appendFile(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
  }, `cannot write ${file}`);
}

// onTicket : the change, while no other write on the same ticket runs; the lock file is the guard
export async function onTicket<T>(where: Where, change: () => Promise<Result<T>>): Promise<Result<T>> {
  const lock = join(where.home, "writes", where.project, `${where.ticket}.lock`);
  const took = await attempt(async () => {
    await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
    await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  }, `another write on ${where.project}/${where.ticket} is running (${lock}); remove that file if none is`);
  if (took.kind === "failed") {
    return took;
  }
  try {
    return await change();
  } finally {
    await rm(lock, { force: true }).catch(() => undefined);
  }
}
