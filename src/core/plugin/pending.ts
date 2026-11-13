// pending — the kept writes: one file per request the policy holds for the person's confirm, in
// <home>/pending/<hex>.json (#134; ADR-0014 P5). request.ts decides what is kept and checks it again at confirm; this
// module only names, writes, reads and removes those files, and reads a request id back. A file is written once
// (never over another), readable only by its owner, and read back only when it is the request its id names. Nothing
// here throws.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseJson, type Done, type Result } from "../forge/api.js";
import { prop } from "../dispatch/records.js";
import { attempt } from "../review/safe.js";
import { plainName } from "../spec.js";
import { isPolicyPoint, type PolicyPoint } from "./config.js";
import type { Where } from "./writes.js";

const HEX = /^[0-9a-f]{12}$/;

// one kept request: its id, the plugin and the approval it was made under, the draft as its schema holds it, and the
// text the person checks
export type Pending = {
  readonly id: string;
  readonly plugin: string;
  readonly approval: string;
  readonly draft: unknown;
  readonly text: string;
  // spec.body: the sha256 of the issue's body when the request was kept, so confirm never writes over a later edit
  readonly base?: string;
};

// a request id, read back: where the write goes, its capability and the hex that names its file
export type Id = { readonly where: Where; readonly capability: PolicyPoint; readonly hex: string };

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

export function pendingFile(home: string, hex: string): string {
  return join(home, "pending", `${hex}.json`);
}

// keepPending : the request in its own new file, with the time it was kept; a file already there is never written over
export function keepPending(home: string, hex: string, record: Pending, at: string): Promise<Done> {
  const file = pendingFile(home, hex);
  return attempt(async () => {
    await mkdir(join(home, "pending"), { recursive: true, mode: 0o700 });
    await writeFile(file, `${JSON.stringify({ version: 1, ...record, at }, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  }, `cannot write ${file}`);
}

// dropPending : the request's file removed, so it cannot go out twice
export function dropPending(home: string, hex: string): Promise<Done> {
  return attempt(() => rm(pendingFile(home, hex)), "cannot remove the pending request");
}

// parseId : <project>/<ticket>/<capability>/<12 hex>, as request printed it
export function parseId(home: string, id: string): Result<Id> {
  const parts = id.split("/");
  const [project, ticket, capability, hex] = four(parts);
  return parts.length === 4 && [project, ticket].every(plainName) && HEX.test(hex) && isPolicyPoint(capability)
    ? { kind: "ok", value: { where: { home, project, ticket }, capability, hex } }
    : failed(`${JSON.stringify(id)} is not a request id; give the id request printed`);
}

function four(parts: readonly string[]): readonly [string, string, string, string] {
  return [parts[0] ?? "", parts[1] ?? "", parts[2] ?? "", parts[3] ?? ""];
}

// baseOf : a spec.body request's base, none for any other request
function baseOf(value: unknown): { readonly base?: string } | "bad" {
  if (value === undefined) {
    return {};
  }
  return typeof value === "string" ? { base: value } : "bad";
}

function pendingOf(raw: unknown): Pending | "bad" {
  const [id, plugin, approval, text] = ["id", "plugin", "approval", "text"].map((k) => prop(raw, k));
  const base = baseOf(prop(raw, "base"));
  const strings = [id, plugin, approval, text].every((v) => typeof v === "string");
  return strings && prop(raw, "version") === 1 && base !== "bad"
    ? {
        id: String(id),
        plugin: String(plugin),
        approval: String(approval),
        draft: prop(raw, "draft"),
        text: String(text),
        ...base,
      }
    : "bad";
}

// readPending : the kept request the id names, when its file holds that very request
export async function readPending(id: Id, given: string): Promise<Result<Pending>> {
  const file = pendingFile(id.where.home, id.hex);
  const text = await attempt(
    () => readFile(file, "utf8"),
    `no pending request ${given}; it went out, or was never made`,
  );
  if (text.kind === "failed") {
    return text;
  }
  const raw = parseJson(text.value);
  const pending = pendingOf(raw.kind === "ok" ? raw.value : undefined);
  if (pending === "bad") {
    return failed(`${file} is not a pending request`);
  }
  return pending.id === given ? { kind: "ok", value: pending } : failed(`${file} is not the request ${given}`);
}
