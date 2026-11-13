// check-adrs — a changed decision is a new ADR, and the old one says so (#482). Two checks over docs/adr/:
//
//   named-back   an ADR whose status says it amends, refines, supersedes, replaces, extends, widens or changes the
//                order in an earlier one must be named in that earlier ADR's header (the text before its first "## "
//                heading), so a reader of the old decision finds the new one
//   in-place     an ADR that is on the default branch keeps its decision: below its header, only its **Today:** notes
//                may change. A note runs from its marker to the end of its paragraph (a blank line, a heading, a table
//                row, a list item or a code fence ends it), or in a table row to the end of its cell; the text before
//                the marker stays frozen (#605). Anything else is a new ADR (FACTORY_BASE_REF, else
//                origin/<GITHUB_BASE_REF>, else origin/main, at the merge base, as check-musts reads it)
//
//   node scripts/check-adrs.ts [ROOT]     (make lint)
//
// git reads this repository's own files, not a project's, so it runs plain git, as check-musts does. Runs on Node's
// type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ADR_DIR = "docs/adr";
const ADR_FILE = /^(\d{4})-.*\.md$/;
const VERB = /\b(Amends|Refines|Supersedes|Replaces|Extends|widens|Changes the order in)\b([^.]*)/g;
const NUMBER = /\b(?:ADR-)?(00\d\d)\b/g;

export type Adr = { readonly number: string; readonly file: string; readonly text: string };

// headerOf : an ADR's text before its first "## " heading. Pure.
export function headerOf(text: string): string {
  const at = text.search(/^## /m);
  return at < 0 ? text : text.slice(0, at);
}

// bodyOf : an ADR's text from its first "## " heading. Pure.
export function bodyOf(text: string): string {
  return text.slice(headerOf(text).length);
}

// earlierOf : the ADRs this one's status says it changes. Pure.
export function earlierOf(adr: Adr): readonly string[] {
  const header = headerOf(adr.text);
  const found = [...header.matchAll(VERB)].flatMap((m) => [...(m[2] ?? "").matchAll(NUMBER)].map((n) => n[1] ?? ""));
  return [...new Set(found)].filter((n) => n !== adr.number);
}

// namedBack : each earlier ADR whose header does not name the later one that changes it. Pure.
export function namedBack(adrs: readonly Adr[]): readonly string[] {
  return adrs.flatMap((later) =>
    earlierOf(later).flatMap((n) => {
      const earlier = adrs.find((a) => a.number === n);
      const named = earlier !== undefined && headerOf(earlier.text).includes(`ADR-${later.number}`);
      return earlier === undefined || named
        ? []
        : [`${earlier.file}: ADR-${later.number} changes it; its header must name ADR-${later.number}`];
    }),
  );
}

const MARK = "**Today:**";

// ends : a line that ends a running note, and is itself frozen: a blank line, a table row, a heading, a list item or
// a code fence. Pure.
function ends(line: string): boolean {
  return /^\s*$|^\s*\||^#|^\s*([-*]|\d+\.)\s|^\s*```/.test(line);
}

// cellEnd : where the table cell that starts at `from` ends: its next "|" that no backslash escapes, or the line's
// end. Pure.
function cellEnd(line: string, from: number): number {
  const at = line.slice(from).search(/(?<!\\)\|/);
  return at < 0 ? line.length : from + at;
}

// cutNote : the frozen text of a line that holds a note, the note cut out: the text before its marker, and in a table
// row the cells after its own. runs: whether the note goes on to the next line, as a plain line's does. Pure.
function cutNote(line: string): { readonly frozen: string; readonly runs: boolean } {
  const at = line.indexOf(MARK);
  const before = line.slice(0, at);
  if (!line.trimStart().startsWith("|")) {
    return { frozen: before.trimEnd(), runs: true };
  }
  return { frozen: `${before.trimEnd()} ${line.slice(cellEnd(line, at)).trimStart()}`, runs: false };
}

// kept : a body's frozen text, the text that carries its decision: every line, each **Today:** note cut out from its
// marker to the end of its paragraph, or of its cell in a table row (#605). Blank lines and trailing spaces carry no
// decision, so a note removed with its paragraph leaves the rest the same. Pure.
function kept(body: string): readonly string[] {
  const out: string[] = [];
  let running = false;
  for (const line of body.split("\n")) {
    running = running && !ends(line);
    if (line.includes(MARK)) {
      const cut = cutNote(line);
      out.push(cut.frozen);
      running = cut.runs;
    } else if (!running) {
      out.push(line.trimEnd());
    }
  }
  return out.filter((l) => l !== "");
}

// inPlace : why an ADR's body changed from the default branch's, or "" when only its header or Today notes did. Pure.
export function inPlace(file: string, before: string, after: string): string {
  const was = kept(bodyOf(before));
  const now = kept(bodyOf(after));
  const same = was.length === now.length && was.every((l, i) => l === now[i]);
  return same
    ? ""
    : `${file}: its decision changed in place; write a new ADR, and name it in this one's header (only the header and **Today:** notes may change)`;
}

function git(root: string, args: readonly string[]): string | undefined {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return r.status === 0 ? r.stdout : undefined;
}

function baseRef(): string {
  const env = process.env;
  return env.FACTORY_BASE_REF || (env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : "origin/main");
}

function adrsIn(root: string): readonly Adr[] {
  return readdirSync(join(root, ADR_DIR)).flatMap((name) => {
    const m = ADR_FILE.exec(name);
    const file = `${ADR_DIR}/${name}`;
    return m === null ? [] : [{ number: m[1] ?? "", file, text: readFileSync(join(root, file), "utf8") }];
  });
}

// changedInPlace : each ADR on the merge base whose body changed; none when the base cannot be read
function changedInPlace(root: string, adrs: readonly Adr[]): readonly string[] {
  const base = git(root, ["merge-base", "HEAD", baseRef()])?.trim();
  if (base === undefined || base === "") {
    console.error(`check-adrs: no merge base with ${baseRef()}; the in-place check is skipped`);
    return [];
  }
  return adrs.flatMap((a) => {
    const before = git(root, ["show", `${base}:${a.file}`]);
    const problem = before === undefined ? "" : inPlace(a.file, before, a.text);
    return problem === "" ? [] : [problem];
  });
}

if (process.argv[1] === import.meta.filename) {
  const root = process.argv[2] ?? ".";
  const adrs = adrsIn(root);
  const found = [...namedBack(adrs), ...changedInPlace(root, adrs)];
  for (const p of found) {
    console.error(p);
  }
  if (found.length > 0) {
    console.error(`check-adrs: ${found.length} problem(s)`);
    process.exit(1);
  }
}
