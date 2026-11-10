// cites — every file:line the brief and glossary keep, checked again on each run (#235; the onboarder card's step 8).
// A cite is stale when the default branch no longer holds its file, or its line no longer reads as it did when the
// brief was written; when that text is now at another line, the report says where. A stale cite is reported in the
// run record for the retro; the brief itself changes only when the onboarder runs again and a human accepts it. Pure.

import type { KeptCite } from "./brief.js";

// staleCites : one line per stale cite, as a person reads it
export function staleCites(
  cites: readonly KeptCite[],
  lines: (path: string) => readonly string[] | undefined,
): readonly string[] {
  return cites.flatMap((c) => staleOne(c, lines(c.file)));
}

// staleOne : why one cite is stale, or nothing
function staleOne(c: KeptCite, now: readonly string[] | undefined): readonly string[] {
  if (now === undefined) {
    return [`${c.line === 0 ? c.file : `${c.file}:${c.line}`} is stale: the file is gone`];
  }
  if (c.line === 0 || now[c.line - 1] === c.text) {
    return [];
  }
  return [`${c.file}:${c.line} is stale: ${movedTo(now, c.text)}`];
}

// movedTo : where a cite's line went, as a person reads it
function movedTo(now: readonly string[], text: string): string {
  const moved = now.indexOf(text);
  return moved < 0 ? "its line changed" : `its line is now at ${moved + 1}`;
}

// --- what a verified line's cite can show (#383) ---
//
// A cite shows what a line of a file says; it cannot show that some other file is not there. So a line that says a
// file is absent ("there is no AGENTS.md") is never verified by its cite: it is checked against the default branch's
// file list instead. The engine reads each file it names and
//   holds  a file it names   the claim is false, and the brief that would carry it is refused, with the reason
//   holds none of them       verified against the file list, with no cite
//   names none it can check  inferred, with the reason
// A line about its own cited file ("LoanRepository.java has no index") is a claim about that file's text, not an
// absence claim.

const ABSENT = [
  /\bthere(?: is|'s| are) no\b/i,
  /\bno such (?:file|folder|directory)\b/i,
  /\b(?:is|are) (?:absent|missing)\b/i,
  /\b(?:does|do)(?: not|n't) exist\b/i,
  /\b(?:repo|repository|project|root|tree) (?:has|have|holds|contains) no\b/i,
  /\bnot in the (?:repo|repository|tree)\b/i,
] as const;

// the file names a claim can name without an extension (CONTRIBUTING for CONTRIBUTING.md)
const BARE = [
  "AGENTS",
  "CLAUDE",
  "CONTRIBUTING",
  "README",
  "LICENSE",
  "CHANGELOG",
  "CODEOWNERS",
  "SECURITY",
  "GLOSSARY",
  "Dockerfile",
  "Makefile",
  "Jenkinsfile",
];

// a named thing, and how to find it in the file list
type Named = { readonly name: string; readonly found: (files: readonly string[]) => readonly string[] };

const base = (f: string): string => f.slice(f.lastIndexOf("/") + 1);
const stem = (f: string): string => base(f).replace(/\.[^.]*$/, "");

function pathNamed(token: string): Named {
  const t = token.replace(/\/$/, "");
  const lower = t.toLowerCase();
  return {
    name: t,
    found: (files) =>
      files.filter((f) =>
        t.includes("/")
          ? f === t || f.startsWith(`${t}/`)
          : [base(f), ...(t.includes(".") ? [] : [stem(f)]), ...f.split("/").slice(0, -1)].some(
              (p) => p.toLowerCase() === lower,
            ),
      ),
  };
}

const KINDS: readonly (Named & { readonly word: RegExp })[] = [
  {
    word: /\bglossary\b/i,
    name: "a glossary",
    found: (files) => files.filter((f) => /(^|\/)(CONTEXT|GLOSSARY)\.md$/i.test(f)),
  },
  {
    word: /\b(?:ADRs?|decision records?)\b/,
    name: "an ADR directory",
    found: (files) => files.filter((f) => /(^|\/)(adr|adrs|decisions)\//i.test(f)),
  },
];

// named : every file or folder a claim names that the file list can answer for, but the cited file itself
export function named(text: string, cited: string): readonly Named[] {
  const plain = text.replace(/[`*]/g, "");
  const paths = [
    ...(plain.match(/[A-Za-z0-9_.][A-Za-z0-9_./-]*\.[A-Za-z][A-Za-z0-9]+\b/g) ?? []),
    ...(plain.match(/\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]*/g) ?? []),
  ].filter((p) => !/^(?:e\.g|i\.e)$/i.test(p));
  const bare = BARE.filter((b) => new RegExp(`\\b${b}\\b(?!\\.)`).test(plain));
  const all = [...new Set([...paths, ...bare])].filter((p) => cited === "" || stem(p) !== stem(cited));
  return [...all.map(pathNamed), ...KINDS.filter((k) => k.word.test(plain))];
}

export type Absence =
  | { readonly kind: "not-absence" }
  | { readonly kind: "unchecked"; readonly why: string }
  | { readonly kind: "true"; readonly names: readonly string[] }
  | { readonly kind: "false"; readonly held: readonly string[] };

// absence : whether a line says a file is absent, and what the default branch's file list says to that
export function absence(text: string, cited: string, files: readonly string[]): Absence {
  if (!ABSENT.some((a) => a.test(text))) {
    return { kind: "not-absence" };
  }
  const names = named(text, cited);
  if (names.length === 0) {
    return /\b(?:file|folder|directory)\b/i.test(text)
      ? { kind: "unchecked", why: "it says a file is absent, and names none the file list can answer for" }
      : { kind: "not-absence" };
  }
  const held = names.flatMap((n) => n.found(files).slice(0, 1));
  return held.length > 0 ? { kind: "false", held } : { kind: "true", names: names.map((n) => n.name) };
}
