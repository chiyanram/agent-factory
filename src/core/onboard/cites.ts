// cites — every file:line the brief and glossary keep, checked again on each run (#235; the onboarder card's step 8).
// A cite is stale when the default branch no longer holds its file, or its line no longer reads as it did when the
// brief was written; when that text is now at another line, the report says where. A stale cite is reported in the
// run record for the retro; the brief itself changes only when the onboarder runs again and a human accepts it. Pure.
//
// A cite cannot show that some other file is not there. So a line that says a file is absent is checked against
// the default branch's file list, and only for the names in the phrase it claims absent. A line about its own cited
// file is a claim about that file's text, not an absence claim.

import type { KeptCite } from "./brief.js";

export function staleCites(
  cites: readonly KeptCite[],
  lines: (path: string) => readonly string[] | undefined,
): readonly string[] {
  return cites.flatMap((c) => staleOne(c, lines(c.file)));
}

function staleOne(c: KeptCite, now: readonly string[] | undefined): readonly string[] {
  if (now === undefined) {
    return [`${c.line === 0 ? c.file : `${c.file}:${c.line}`} is stale: the file is gone`];
  }
  if (c.line === 0 || now[c.line - 1] === c.text) {
    return [];
  }
  return [`${c.file}:${c.line} is stale: ${movedTo(now, c.text)}`];
}

function movedTo(now: readonly string[], text: string): string {
  const moved = now.indexOf(text);
  return moved < 0 ? "its line changed" : `its line is now at ${moved + 1}`;
}

const BEFORE =
  /\b(?:no(?!\s+(?:longer|more|one|matter|doubt)\b)|without|lacks?|lacking|(?<!\b(?:is|are|be|been)\s)missing)\b/gi;
const AFTER =
  /\b(?:(?:is|are) (?:absent|missing)|(?:is|are)(?: not|n't) present|(?:does|do)(?: not|n't) exist|not in the (?:repo|repository|tree))\b/gi;
const JOIN = /.*(?:,\s+and|\s(?:but|while|so|because|since|whereas|although|though))\s/is;
const STOP =
  /\s(?:in|at|under|inside|beside|for|from|on|of|except|besides|other than|than|apart from|so|because|since|which|that|where|while|but)\s|,\s+(?![A-Z0-9.`]|(?:no|nor|or|and)\b)/;
const CLAUSE = /[.;:!?](?:\s+|$)|\s[—–]\s|\s-\s/;

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

function tokens(token: string): readonly string[] {
  const parts = token.split("/");
  return parts.length > 1 && parts.every((p) => /\.[A-Za-z][A-Za-z0-9]+$/.test(p)) ? parts : [token];
}

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

function checkedNames(names: readonly Named[], files: readonly string[]): Absence {
  const unique = [...new Map(names.map((n) => [n.name, n])).values()];
  const held = firstHeld(unique, files);
  return held.length > 0
    ? { kind: "false", names: unique.map((n) => n.name), held }
    : { kind: "true", names: unique.map((n) => n.name) };
}

function unnamed(text: string, cited: string, files: readonly string[]): Absence {
  const elsewhere = firstHeld(named(text, cited), files);
  return elsewhere.length > 0
    ? { kind: "unsure", held: elsewhere }
    : { kind: "unchecked", why: "it says a file is absent, and names none the file list can answer for" };
}
