// check-adrs — a changed decision is a new ADR, and the old one says so (#482). Two checks over docs/adr/:
//
//   named-back   an ADR whose status says it amends, refines, supersedes, replaces, extends, widens or changes the
//                order in an earlier one must be named in that earlier ADR's header (the text before its first "## "
//                heading), so a reader of the old decision finds the new one
//   in-place     an ADR that is on the default branch keeps its decision: below its header, only lines that hold a
//                **Today:** note may change. Anything else is a new ADR (FACTORY_BASE_REF, else
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

// kept : a body's lines that carry its decision: every line but those with a **Today:** note. Pure.
function kept(body: string): readonly string[] {
  return body.split("\n").filter((l) => !l.includes("**Today:**"));
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
