// check-words — fails on an old word from GLOSSARY.md's "Old words, do not use" table in the prose of the main docs
// (#144 phase 3), so they stay in the glossary's words. A finding names file:line, the old word and the word to use.
//
// Only the words that have one meaning here are checked: forge, box, dispatcher, writer, reviewer (not
// design-reviewer), MR, merge request, seat and worker. issue, session, runner, plugin and pack also have a meaning
// that is right (a GitHub issue, a Claude Code session, the machine, a Claude Code plugin, the context pack), so a
// person reads those. Skipped, because they name an identifier, a path or a quote that phase 4 renames: fenced code
// blocks, `inline code`, link targets, link text that is a path, and bare URLs.
//
//   node scripts/check-words.ts [ROOT]     (make lint)
//
// Runs on Node's type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const OLD: readonly { readonly word: RegExp; readonly use: string }[] = [
  { word: /\bforges?\b/i, use: "git host" },
  { word: /\bbox(?:es)?\b/i, use: "runner" },
  { word: /\bdispatchers?\b/i, use: "orchestrator" },
  { word: /\bwriters?\b/i, use: "implementer" },
  { word: /(?<!design-)\breviewers?\b/i, use: "automated review, finder or verify pass" },
  { word: /\bMRs?\b/, use: "PR" },
  { word: /\bmerge requests?\b/i, use: "PR" },
  { word: /\bseats?\b/i, use: "the role's name" },
  { word: /\bworkers?\b/i, use: "run" },
];

// DOCS : the files checked, from ROOT, with every role card
export function docs(root: string): readonly string[] {
  const roles = join(root, "prompts", "roles");
  const cards = existsSync(roles)
    ? readdirSync(roles)
        .filter((f) => f.endsWith(".md"))
        .toSorted()
        .map((f) => `prompts/roles/${f}`)
    : [];
  return ["README.md", "GUIDE.md", "AGENTS.md", "CONTRIBUTING.md", "docs/DESIGN.md", ...cards];
}

// prose : one line with what names an identifier, a path or a link taken out
export function prose(line: string): string {
  return line
    .replace(/`[^`]*`/g, " ")
    .replace(/\[[^\]]*\/[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, " ");
}

// findings : file:line, the old word and the word to use, for each old word in the prose of one file's text
export function findings(file: string, text: string): readonly string[] {
  const out: string[] = [];
  let fenced = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) {
      return;
    }
    const words = prose(line);
    for (const { word, use } of OLD) {
      const hit = word.exec(words);
      if (hit !== null) {
        out.push(`${file}:${i + 1}: "${hit[0]}": use ${use} (GLOSSARY.md, old words)`);
      }
    }
  });
  return out;
}

if (process.argv[1] === import.meta.filename) {
  const root = process.argv[2] ?? ".";
  const all = docs(root)
    .filter((f) => existsSync(join(root, f)))
    .flatMap((f) => findings(f, readFileSync(join(root, f), "utf8")));
  for (const f of all) {
    console.log(f);
  }
  if (all.length > 0) {
    console.log(`check-words: ${all.length} old word(s); put an identifier in backticks`);
    process.exit(1);
  }
}
