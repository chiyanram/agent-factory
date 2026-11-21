// act-on — the Act on findings of a full review round, kept with its head, so a rework run hands the writer the
// factory's own findings and never a forge thread anyone can write (#171 Q1). The round
// writes the file before it posts its threads; the writer's host reads it back. A reused round writes none: its Act on
// goes to a person (round.ts), never to a rework run.

import type { Result } from "../forge/api.js";
import { keepJson, keptPath, readKept, type At } from "../kept.js";
import type { Sorted } from "./verdicts.js";

export const ACT_ON_FILE = "act-on.json";

export type ActOn = Pick<Sorted, "id" | "file" | "line" | "rule" | "severity" | "finding" | "fix">;

export function actOnPath(at: At): string {
  return keptPath(at, ACT_ON_FILE);
}

export function actOnOf(sorted: readonly Sorted[]): readonly ActOn[] {
  return sorted
    .filter((f) => f.bucket === "act_on")
    .map(({ id, file, line, rule, severity, finding, fix }) => ({ id, file, line, rule, severity, finding, fix }));
}

export function keepActOn(input: At & { readonly sorted: readonly Sorted[] }): Promise<Result<string>> {
  return keepJson(input, ACT_ON_FILE, actOnOf(input.sorted));
}

const FIELDS = ["id", "file", "rule", "severity", "finding", "fix"] as const;

export function isActOn(raw: unknown): raw is ActOn {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }
  const rec: Record<string, unknown> = { ...raw };
  return FIELDS.every((f) => typeof rec[f] === "string") && Number.isInteger(rec.line);
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function readActOn(at: At): Promise<Result<readonly ActOn[]>> {
  const text = await readKept(at, ACT_ON_FILE);
  const raw = text.kind === "ok" ? parsed(text.value) : undefined;
  return Array.isArray(raw) && raw.length > 0 && raw.every(isActOn)
    ? { kind: "ok", value: raw }
    : { kind: "failed", reason: `no Act on findings kept at ${actOnPath(at)}` };
}
