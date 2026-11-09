// human-record — the files that hold a human's word: a START (start.ts) and an approval (approval.ts) (#227; ADR-0012
// S1). Each is one small JSON file under the factory home, written whole through a temp file and a rename, so a reader
// never sees half of one. Every front door writes the same records; `via` names the door.
//
// The coordinator never writes these files: its settings deny `agent-factory start`, `agent-factory approve` and any
// edit of the folders (coordinator.ts), and on the VM the folders belong to the separate `factory` OS user.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Refused } from "./spec.js";

// the front doors a human can START or approve from: the terminal, the Discord bot, a spec PR's approval
export const VIAS = ["terminal", "discord", "pr"] as const;
export type Via = (typeof VIAS)[number];

export function isVia(value: unknown): value is Via {
  return VIAS.some((v) => v === value);
}

export type Written = { readonly kind: "written"; readonly path: string } | Refused;

// writeRecordFile : the record, through a temp file and a rename. A failure is a refusal, and the temp file is removed.
export async function writeRecordFile(path: string, record: object): Promise<Written> {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
    await rename(temp, path);
    return { kind: "written", path };
  } catch (error: unknown) {
    await rm(temp, { force: true }).catch(() => undefined); // best effort: the temp may never have been made
    return {
      kind: "refused",
      reason: `cannot write ${path}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export type RecordFile = { readonly kind: "json"; readonly value: unknown } | { readonly kind: "missing" } | Refused;

function parsed(text: string, path: string): RecordFile {
  try {
    return { kind: "json", value: JSON.parse(text) as unknown };
  } catch {
    return { kind: "refused", reason: `${path} is not valid JSON` };
  }
}

// readRecordFile : the file's JSON; no file is missing, and anything else that stops the read is a refusal
export async function readRecordFile(path: string): Promise<RecordFile> {
  try {
    return parsed(await readFile(path, "utf8"), path);
  } catch (error: unknown) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    return missing ? { kind: "missing" } : { kind: "refused", reason: `cannot read ${path}: ${String(error)}` };
  }
}

// field : one property of a parsed record, or undefined
export function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? (Reflect.get(value, name) as unknown) : undefined;
}
