// rules — what the reviewer is held to, read from the default branch only (ADR-0004; #22 Q3). For each touched file:
// the root AGENTS.md and every nested AGENTS.md on its path, the project files they link to, and each rulebook skill
// they point at. A pointer names a skill, never a file inside it (docs/adr/0026-the-engine-owns-its-process.md), in
// one of two forms:
//   one line   "use the `<skill>` skill (rulebook plugin)"
//   a list     a "(rulebook plugin)" line with no skill on it, then "the `<skill>` skill" for each skill the file names
// A pointer that still names a reference ("… and read its `<reference>` reference") keeps its skill, and the reference
// is dropped, since a skill may move its files. A "(rulebook plugin)" line that names no skill, or a pointer or a link
// the pack cannot resolve, stops it: a rule that named a missing skill was once skipped in silence
// (docs/archive/research/46 G9). The baseline every review is held to is the skills BASELINE names. Fenced code
// blocks are examples, not rules. The rest is read as one line, so a pointer that wraps still parses.

import { prose } from "./fence.js";

export type Pointer = { readonly skill: string; readonly dropped: readonly string[] };

export const BASELINE: readonly string[] = ["crq", "code"];

export type FileRules = {
  readonly pointers: readonly Pointer[];
  readonly links: readonly string[];
};

export type Found =
  | { readonly kind: "ok"; readonly rules: FileRules }
  | { readonly kind: "failed"; readonly reason: string };

const NAMED = /`([A-Za-z0-9_-]+)` skill \(rulebook plugin\)([^.]*?\breferences?\b)?/g;
const LISTED = /\bthe `([A-Za-z0-9_-]+)` skill\b(?! \(rulebook plugin\))/g;
const MENTION = /\(rulebook plugin\)/g;
const TICKED = /`([A-Za-z0-9_-]+)`/g;

export function agentsChain(touched: readonly string[]): readonly string[] {
  const out = new Set<string>();
  for (const path of touched) {
    const parts = path.split("/").slice(0, -1);
    out.add("AGENTS.md");
    parts.forEach((_, i) => out.add(`${parts.slice(0, i + 1).join("/")}/AGENTS.md`));
  }
  return [...out];
}

export function joinPath(dir: string, link: string): string {
  const parts: string[] = [];
  for (const part of `${dir}/${link}`.split("/")) {
    if (part === "..") {
      parts.pop();
    } else if (part !== "" && part !== ".") {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function dirOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

function local(link: string): boolean {
  return link !== "" && !link.includes(":") && !link.startsWith("#");
}

function links(text: string, from: string): readonly string[] {
  const plain = text.replace(/`[^`]*`/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  const angled = Array.from(plain.matchAll(/\]\(<([^>]*)>\)/g), (m) => m[1] ?? "");
  const bare = Array.from(plain.matchAll(/\]\(([^<) ][^) ]*)/g), (m) => m[1] ?? "");
  return [...angled, ...bare]
    .filter(local)
    .map((link) => joinPath(from, (link.split("#")[0] ?? "").replaceAll("%20", " ")));
}

function named(flat: string): readonly Pointer[] {
  return Array.from(flat.matchAll(NAMED), (m) => ({
    skill: m[1] ?? "",
    dropped: Array.from((m[2] ?? "").matchAll(TICKED), (r) => r[1] ?? ""),
  }));
}

export function mergePointers(pointers: readonly Pointer[]): readonly Pointer[] {
  const by = new Map<string, string[]>();
  for (const p of pointers) {
    by.set(p.skill, [...new Set([...(by.get(p.skill) ?? []), ...p.dropped])]);
  }
  return [...by].map(([skill, dropped]) => ({ skill, dropped }));
}

export function readRules(input: { readonly path: string; readonly text: string }): Found {
  const flat = prose(input.text).replaceAll("\n", " ");
  const one = named(flat);
  const bare = (flat.match(MENTION) ?? []).length - one.length;
  const listed = bare > 0 ? Array.from(flat.matchAll(LISTED), (m) => ({ skill: m[1] ?? "", dropped: [] })) : [];
  if (bare > 0 && listed.length === 0) {
    return {
      kind: "failed",
      reason: `${input.path}: a "(rulebook plugin)" line names no skill; write each as: use the \`<skill>\` skill (rulebook plugin)`,
    };
  }
  return { kind: "ok", rules: { pointers: mergePointers([...one, ...listed]), links: links(flat, dirOf(input.path)) } };
}
