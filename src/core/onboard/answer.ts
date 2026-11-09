// answer — what the onboarder's model run gives (#235): the stack, the modules, the gotchas and the domain terms, each
// marked verified or inferred and cited where it can be. Model output is data: every field is checked, and every text
// is cut to a length a brief can hold. The engine writes the rest of the brief itself (brief.ts).

import { prop } from "../dispatch/records.js";
import type { Result } from "../forge/api.js";

// a cite: a path in the repo, and a line, or 0 for the file as a whole; "" for none
export type Cite = { readonly file: string; readonly line: number };

export type Item = Cite & { readonly text: string; readonly verified: boolean };
export type Module = Cite & { readonly name: string; readonly job: string; readonly verified: boolean };
export type Term = Cite & {
  readonly term: string;
  readonly meaning: string;
  readonly avoid: readonly string[];
  readonly verified: boolean;
};

export type Answer = {
  readonly stack: readonly Item[];
  readonly modules: readonly Module[];
  readonly gotchas: readonly Item[];
  readonly terms: readonly Term[];
};

const MOST_ITEMS = 40;
const MOST_CHARS = 400;

const CITE = { file: { type: "string" }, line: { type: "integer" }, verified: { type: "boolean" } };
const list = (required: readonly string[], properties: object) => ({
  type: "array",
  items: {
    type: "object",
    required: [...required, "file", "line", "verified"],
    properties: { ...properties, ...CITE },
  },
});

export const ANSWER_SCHEMA = JSON.stringify({
  type: "object",
  required: ["stack", "modules", "gotchas", "terms"],
  properties: {
    stack: list(["text"], { text: { type: "string" } }),
    modules: list(["name", "job"], { name: { type: "string" }, job: { type: "string" } }),
    gotchas: list(["text"], { text: { type: "string" } }),
    terms: list(["term", "meaning", "avoid"], {
      term: { type: "string" },
      meaning: { type: "string" },
      avoid: { type: "array", items: { type: "string" } },
    }),
  },
});

function text(raw: unknown, name: string): string | undefined {
  const v = prop(raw, name);
  return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, MOST_CHARS) : undefined;
}

// citeOf : the cite and mark every item carries, or undefined
function citeOf(raw: unknown): (Cite & { readonly verified: boolean }) | undefined {
  const file = prop(raw, "file");
  const line = prop(raw, "line");
  const verified = prop(raw, "verified");
  const ok =
    typeof file === "string" && Number.isSafeInteger(line) && Number(line) >= 0 && typeof verified === "boolean";
  return ok ? { file: file.trim(), line: Number(line), verified } : undefined;
}

function itemOf(raw: unknown): Item | undefined {
  const t = text(raw, "text");
  const c = citeOf(raw);
  return t === undefined || c === undefined ? undefined : { ...c, text: t };
}

function moduleOf(raw: unknown): Module | undefined {
  const name = text(raw, "name");
  const job = text(raw, "job");
  const c = citeOf(raw);
  return name === undefined || job === undefined || c === undefined ? undefined : { ...c, name, job };
}

function avoidOf(raw: unknown): readonly string[] | undefined {
  const avoid = prop(raw, "avoid");
  return Array.isArray(avoid) && avoid.every((a) => typeof a === "string")
    ? avoid.map((a: string) => a.trim().slice(0, MOST_CHARS)).filter((a) => a !== "")
    : undefined;
}

function termOf(raw: unknown): Term | undefined {
  const term = text(raw, "term");
  const meaning = text(raw, "meaning");
  const avoid = avoidOf(raw);
  const c = citeOf(raw);
  const all = term !== undefined && meaning !== undefined && avoid !== undefined && c !== undefined;
  return all ? { ...c, term, meaning, avoid } : undefined;
}

function each<T>(output: unknown, name: string, one: (raw: unknown) => T | undefined): readonly T[] | undefined {
  const raw = prop(output, name);
  const read = Array.isArray(raw) && raw.length <= MOST_ITEMS ? raw.map(one) : [undefined];
  return read.every((r) => r !== undefined) ? read.filter((r) => r !== undefined) : undefined;
}

// readAnswer : the onboarder's answer, every field checked, or why it is not one
export function readAnswer(output: unknown): Result<Answer> {
  const stack = each(output, "stack", itemOf);
  const modules = each(output, "modules", moduleOf);
  const gotchas = each(output, "gotchas", itemOf);
  const terms = each(output, "terms", termOf);
  if (stack === undefined || modules === undefined) {
    return { kind: "failed", reason: "the onboarder's stack or modules are not a list of checked items" };
  }
  return gotchas === undefined || terms === undefined
    ? { kind: "failed", reason: "the onboarder's gotchas or terms are not a list of checked items" }
    : { kind: "ok", value: { stack, modules, gotchas, terms } };
}
