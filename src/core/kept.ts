// kept — what the factory keeps per change and head in the project's clone, <FACTORY_REPO>/.claude/runs/<change>/<head>/
// (ADR-0011 D16): the review's pass answers and Act on findings, the local verifier's output (#171), and why a ready
// check failed (#199). A writer run reads its task from here, the factory's own record, before it would read the forge.
// Nothing here throws.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "./forge/api.js";
import { attempt } from "./review/safe.js";

// the lines kept of a log: enough to see a failure, never a whole build (#171 Q2)
export const MAX_LOG_LINES = 200;
// and the characters kept of those lines, so a log of a few huge lines is bounded too (#199)
export const MAX_LOG_CHARS = 20_000;

export type At = { readonly recordsDir: string; readonly change: number; readonly head: string };

// recordsDirOf : where a project's clone keeps its records; the review, the verifier and the writer share it. Pure.
export function recordsDirOf(repo: string): string {
  return join(repo, ".claude", "runs");
}

// keptPath : one kept file of a change at a head. Pure.
export function keptPath(at: At, file: string): string {
  return join(at.recordsDir, String(at.change), at.head, file);
}

// keepText : one file kept with the head, private to this user
export async function keepText(at: At, file: string, text: string): Promise<Result<string>> {
  const path = keptPath(at, file);
  return attempt(async () => {
    await mkdir(join(at.recordsDir, String(at.change), at.head), { recursive: true, mode: 0o700 });
    await writeFile(path, text, { mode: 0o600 });
    return path;
  }, `cannot keep ${path}`);
}

// readKept : one kept file; a missing or empty one fails with where it looked
export async function readKept(at: At, file: string): Promise<Result<string>> {
  const path = keptPath(at, file);
  const text = await readFile(path, "utf8").catch(() => "");
  return text === "" ? { kind: "failed", reason: `nothing kept at ${path}` } : { kind: "ok", value: text };
}

// a terminal colour or cursor code, which a log carries and a reader never needs
const ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");

// any character that is not a line break, a tab, or printable: the other control codes a log carries
const UNSEEN = /[^\n\t -~\u0080-￿]/g;

// tailOf : the last lines of a log, plain. Pure.
export function tailOf(log: string): string {
  const plain = log.replace(/\r\n?/g, "\n").replace(ESCAPE, "").replace(UNSEEN, "");
  const tail = plain.trimEnd().split("\n").slice(-MAX_LOG_LINES).join("\n");
  return tail.length <= MAX_LOG_CHARS ? tail : tail.slice(-MAX_LOG_CHARS);
}
