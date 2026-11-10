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
// file list instead. The engine finds what the line claims absent, the noun phrase after "no", "there is no",
// "without", "lacks" or "missing", or before "is absent", "is missing" or "does not exist", within its own clause and
// up to the next preposition, and reads only those names. Any other file the line names ("the only rules are comments
// in build.gradle.kts") is no part of the claim. Then
//   holds  a name it claims absent         the claim is false: the line is dropped, with a note
//   claims a file absent, names none, but
//     names elsewhere a file it holds      unsure: the line is dropped, with a note, never the brief refused
//   holds none of the names                verified against the file list, with no cite
//   names none it can check                inferred, with the reason
// A line about its own cited file ("LoanRepository.java has no index") is a claim about that file's text, not an
// absence claim.

// a word that opens the claimed-absent phrase after it
const BEFORE =
  /\b(?:no(?!\s+(?:longer|more|one|matter|doubt)\b)|without|lacks?|lacking|(?<!\b(?:is|are|be|been)\s)missing)\b/gi;
// a word that closes the claimed-absent phrase before it
const AFTER =
  /\b(?:(?:is|are) (?:absent|missing)|(?:is|are)(?: not|n't) present|(?:does|do)(?: not|n't) exist|not in the (?:repo|repository|tree))\b/gi;
// where a phrase before AFTER starts: after the last word that joins two statements
const JOIN = /.*(?:,\s+and|\s(?:but|while|so|because|since|whereas|although|though))\s/is;
// where a phrase after BEFORE stops: the place it is not in, what the sentence goes on to say, or a comma that does
// not go on with a list of names
const STOP =
  /\s(?:in|at|under|inside|beside|for|from|on|of|except|besides|other than|than|apart from|so|because|since|which|that|where|while|but)\s|,\s+(?![A-Z0-9.`]|(?:no|nor|or|and)\b)/;
// where a clause ends: a sentence's end, a semicolon, a colon or a dash between words
const CLAUSE = /[.;:!?](?:\s+|$)|\s[—–]\s|\s-\s/;

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

// tokens : "CLAUDE.md/AGENTS.md" is two files, "docs/adr" one path
function tokens(token: string): readonly string[] {
  const parts = token.split("/");
  return parts.length > 1 && parts.every((p) => /\.[A-Za-z][A-Za-z0-9]+$/.test(p)) ? parts : [token];
}

// named : every file or folder a text names that the file list can answer for, but the cited file itself
export function named(text: string, cited: string): readonly Named[] {
  const plain = text.replace(/[`*]/g, "");
  const paths = [
    ...(plain.match(/[A-Za-z0-9_.][A-Za-z0-9_./-]*\.[A-Za-z][A-Za-z0-9]+\b/g) ?? []),
    ...(plain.match(/\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]*/g) ?? []),
  ]
    .flatMap(tokens)
    .filter((p) => !/^(?:e\.g|i\.e)$/i.test(p));
  const bare = BARE.filter((b) => new RegExp(`\\b${b}\\b(?!\\.)`).test(plain));
  const all = [...new Set([...paths, ...bare])].filter((p) => cited === "" || stem(p) !== stem(cited));
  const byName = new Map(all.map((p) => [p, pathNamed(p)]));
  return [...byName.values(), ...KINDS.filter((k) => k.word.test(plain))];
}

// claimed : the phrases a text claims absent, each within its clause; none when it makes no absence claim
export function claimed(text: string): readonly string[] {
  return text.split(CLAUSE).flatMap((clause) => {
    const after = Array.from(clause.matchAll(BEFORE), (m) => clause.slice(m.index + m[0].length).split(STOP)[0] ?? "");
    const before = Array.from(clause.matchAll(AFTER), (m) => clause.slice(0, m.index).replace(JOIN, ""));
    return after.concat(before);
  });
}

export type Absence =
  | { readonly kind: "not-absence" }
  | { readonly kind: "unchecked"; readonly why: string }
  | { readonly kind: "true"; readonly names: readonly string[] }
  | { readonly kind: "false"; readonly names: readonly string[]; readonly held: readonly string[] }
  | { readonly kind: "unsure"; readonly held: readonly string[] };

const firstHeld = (names: readonly Named[], files: readonly string[]): readonly string[] => [
  ...new Set(names.flatMap((n) => n.found(files).slice(0, 1))),
];

// absence : whether a line says a file is absent, and what the default branch's file list says to the names it claims
// absent, never to any other file it names
export function absence(text: string, cited: string, files: readonly string[]): Absence {
  const phrases = claimed(text);
  const names = phrases.flatMap((p) => named(p, cited));
  if (names.length > 0) {
    return checkedNames(names, files);
  }
  if (!phrases.some((p) => /\b(?:files?|folders?|directory|directories)\b/i.test(p))) {
    return { kind: "not-absence" };
  }
  return unnamed(text, cited, files);
}

// checkedNames : the names a line claims absent, against the file list
function checkedNames(names: readonly Named[], files: readonly string[]): Absence {
  const unique = [...new Map(names.map((n) => [n.name, n])).values()];
  const held = firstHeld(unique, files);
  return held.length > 0
    ? { kind: "false", names: unique.map((n) => n.name), held }
    : { kind: "true", names: unique.map((n) => n.name) };
}

// unnamed : a line that says a file is absent and names none in its claim: unsure when it names, elsewhere, a file
// the list holds, since the engine cannot tell that file from the one claimed absent
function unnamed(text: string, cited: string, files: readonly string[]): Absence {
  const elsewhere = firstHeld(named(text, cited), files);
  return elsewhere.length > 0
    ? { kind: "unsure", held: elsewhere }
    : { kind: "unchecked", why: "it says a file is absent, and names none the file list can answer for" };
}
