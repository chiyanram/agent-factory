// rules — what the reviewer is held to, read from the default branch only (ADR-0004; #22 Q3). For each touched file:
// the root AGENTS.md and every nested AGENTS.md on its path, the project files they link to, and each rulebook
// reference they point at ("use the `<domain>` skill (rulebook plugin) and read its `<reference>` reference"). A
// pointer or a link the pack cannot resolve stops it: a rule that named a missing skill was once skipped in silence
// (docs/archive/research/46 G9).

import { prose } from "./fence.js";

export type Pointer = { readonly domain: string; readonly reference: string };

// BASELINE : the review checks every pack carries, whatever the AGENTS.md files say (#226): the built-in default. A
// process plugin's review.json replaces it (process/read.ts, #232).
export const BASELINE: readonly Pointer[] = [
  { domain: "crq", reference: "review-process" },
  { domain: "crq", reference: "code-review" },
  { domain: "crq", reference: "verify-done" },
  { domain: "code", reference: "smells" },
];

export type FileRules = {
  readonly pointers: readonly Pointer[];
  // repo paths, already resolved against the file's folder
  readonly links: readonly string[];
};

export type Found =
  | { readonly kind: "ok"; readonly rules: FileRules }
  | { readonly kind: "failed"; readonly reason: string };

const POINTER = /`([A-Za-z0-9_-]*)` skill \(rulebook plugin\)[^`]*`([A-Za-z0-9_-]*)` reference/g;
const MENTION = /\(rulebook plugin\)/g;

// agentsChain : AGENTS.md at the root and in every folder on the path of each touched file, root first, once each
export function agentsChain(touched: readonly string[]): readonly string[] {
  const out = new Set<string>();
  for (const path of touched) {
    const parts = path.split("/").slice(0, -1);
    out.add("AGENTS.md");
    parts.forEach((_, i) => out.add(`${parts.slice(0, i + 1).join("/")}/AGENTS.md`));
  }
  return [...out];
}

// joinPath : the repo path a link names from a folder, with "." and ".." resolved
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

// a link worth reading: not a URL, not an anchor in the same file
function local(link: string): boolean {
  return link !== "" && !link.includes(":") && !link.startsWith("#");
}

function links(text: string, from: string): readonly string[] {
  // inline code and images are no links; a "title" after the path is ignored
  const plain = text.replace(/`[^`]*`/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  const angled = Array.from(plain.matchAll(/\]\(<([^>]*)>\)/g), (m) => m[1] ?? "");
  const bare = Array.from(plain.matchAll(/\]\(([^<) ][^) ]*)/g), (m) => m[1] ?? "");
  return [...angled, ...bare]
    .filter(local)
    .map((link) => joinPath(from, (link.split("#")[0] ?? "").replaceAll("%20", " ")));
}

// readRules : the pointers and links of one AGENTS.md. Fenced code blocks are examples, not rules, and the rest is read
// as one line, so a pointer that wraps still parses. A "(rulebook plugin)" that is not a full pointer stops the pack.
export function readRules(input: { readonly path: string; readonly text: string }): Found {
  const flat = prose(input.text).replaceAll("\n", " ");
  const pointers = Array.from(flat.matchAll(POINTER), (m) => ({ domain: m[1] ?? "", reference: m[2] ?? "" }));
  const mentions = (flat.match(MENTION) ?? []).length;
  if (mentions !== pointers.length) {
    return {
      kind: "failed",
      reason: `${input.path}: a rulebook pointer this pack cannot read; write each as: use the \`<domain>\` skill (rulebook plugin) and read its \`<reference>\` reference`,
    };
  }
  return { kind: "ok", rules: { pointers, links: links(flat, dirOf(input.path)) } };
}
