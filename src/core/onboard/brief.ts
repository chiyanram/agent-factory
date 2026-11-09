// brief — brief.md and glossary.md, written from the onboarder's answer and what the engine read itself (#235;
// docs/DESIGN.md section 5 "Project knowledge"). Every line is marked verified or inferred:
//
//   commands             the engine's listing (listing.ts), each verified at the file:line it was read from
//   where rules live     the project's own instruction files, glossary and decision records, linked, never copied
//   stack, modules,      the model's answer; an item is verified only when its cite names a file and line the default
//   gotchas, terms       branch holds, else it is inferred and loses the cite
//
// A term the project's own glossary (CONTEXT.md or GLOSSARY.md) defines is linked there, never given a meaning of ours.
// No count goes in. Each kept cite is returned with its line's text, so every later run can check it again (cites.ts).
// Pure.

import type { Answer, Cite, Item, Module, Term } from "./answer.js";
import type { Commands } from "./listing.js";

// a cite the brief keeps, with the text of its line when it was written (line 0: the file as a whole, text "")
export type KeptCite = Cite & { readonly text: string };

export type BriefInput = {
  readonly project: string;
  readonly base: string;
  readonly sha: string;
  readonly commands: Commands;
  // every path at the default branch
  readonly files: readonly string[];
  // a file's lines at the default branch, or undefined when it is not there
  readonly lines: (path: string) => readonly string[] | undefined;
  readonly answer: Answer;
};

export type Written = { readonly brief: string; readonly glossary: string; readonly cites: readonly KeptCite[] };

// where a project keeps its rules, in the order the brief lists them
const RULE_PLACES = [
  "AGENTS.md",
  "CLAUDE.md",
  "CONTEXT.md",
  "GLOSSARY.md",
  "docs/adr",
  ".claude/rules",
  ".claude/skills",
  ".agents/skills",
] as const;

const GLOSSARIES = ["CONTEXT.md", "GLOSSARY.md"] as const;

function present(files: readonly string[], place: string): boolean {
  return files.some((f) => f === place || f.startsWith(`${place}/`));
}

// checked : the cite as the brief keeps it, or "none" when the default branch does not hold that file and line
function checked(input: BriefInput, cite: Cite): KeptCite | "none" {
  const lines = cite.file === "" ? undefined : input.lines(cite.file);
  return lines === undefined || cite.line > lines.length ? "none" : { ...cite, text: lineText(lines, cite.line) };
}

// lineText : a cite's line, or "" for the file as a whole
function lineText(lines: readonly string[], line: number): string {
  return line === 0 ? "" : (lines[line - 1] ?? "");
}

type Mark = { readonly mark: string; readonly cite: KeptCite | "none" };

// markOf : how a line is marked: verified with its cite, or inferred
function markOf(input: BriefInput, item: Cite & { readonly verified: boolean }): Mark {
  const cite = checked(input, item);
  if (cite === "none") {
    return { mark: "(inferred)", cite };
  }
  const at = cite.line === 0 ? cite.file : `${cite.file}:${cite.line}`;
  return { mark: `(\`${at}\`, ${item.verified ? "verified" : "inferred"})`, cite };
}

type Lines = { readonly lines: readonly string[]; readonly cites: readonly KeptCite[] };

function rendered<T extends Cite & { readonly verified: boolean }>(
  input: BriefInput,
  items: readonly T[],
  body: (item: T) => string,
): Lines {
  const marks = items.map((item) => ({ item, ...markOf(input, item) }));
  return {
    lines: marks.map((m) => `- ${body(m.item)} ${m.mark}`),
    cites: marks.flatMap((m) => (m.cite === "none" ? [] : [m.cite])),
  };
}

function section(title: string, lines: readonly string[], empty: string): readonly string[] {
  return ["", `## ${title}`, "", ...(lines.length === 0 ? [empty] : lines)];
}

// commandLines : the engine's listing, every command verified where it was read
function commandLines(input: BriefInput): Lines {
  const c = input.commands;
  if (c.kind !== "listed") {
    return {
      lines: [c.kind === "inferred" ? `- ${c.why} (inferred)` : "- none listed in the repo's root files (inferred)"],
      cites: [],
    };
  }
  const items = c.commands.map((l) => Object.assign({ verified: true }, l));
  return rendered(input, items, (l) => (l.help === "" ? `\`${l.command}\`` : `\`${l.command}\`: ${l.help}`));
}

function ruleLines(input: BriefInput): readonly string[] {
  const own = RULE_PLACES.filter((p) => present(input.files, p)).map((p) => `- [${p}](${p}) (verified)`);
  const nested = input.files.some((f) => /.\/(AGENTS|CLAUDE)\.md$/.test(f));
  return nested ? [...own, "- the AGENTS.md or CLAUDE.md of a folder, for that folder (verified)"] : own;
}

const stackLine = (i: Item): string => i.text;
const moduleLine = (m: Module): string => `**${m.name}**: ${m.job}`;

// briefOf : brief.md, and the cites it keeps
function briefOf(input: BriefInput): Lines {
  const commands = commandLines(input);
  const stack = rendered(input, input.answer.stack, stackLine);
  const modules = rendered(input, input.answer.modules, moduleLine);
  const gotchas = rendered(input, input.answer.gotchas, stackLine);
  const lines = [
    `# ${input.project}: brief`,
    "",
    `Written by the onboarder from ${input.base} at ${input.sha.slice(0, 12)}; a human accepts it before any run reads it.`,
    "Each line is verified (its cite was read) or inferred. Every run checks each cite again.",
    ...section("Stack", stack.lines, "- none found (inferred)"),
    ...section("Build, test and run", commands.lines, "- none listed (inferred)"),
    ...section("Modules", modules.lines, "- none found (inferred)"),
    ...section(
      "Where the rules live",
      ruleLines(input),
      "- no instruction file, glossary or decision record (verified)",
    ),
    ...section("Gotchas", gotchas.lines, "- none found (inferred)"),
    "",
  ];
  return { lines, cites: [...stack.cites, ...commands.cites, ...modules.cites, ...gotchas.cites] };
}

// defined : the terms a glossary defines, as "**Term**:" at a line's start, in lower case
function defined(lines: readonly string[]): ReadonlySet<string> {
  return new Set(lines.flatMap((l) => /^\*\*([^*]+)\*\*\s*:/.exec(l)?.[1]?.trim().toLowerCase() ?? []));
}

const termLine = (t: Term): string =>
  `**${t.term}**: ${t.meaning}${t.avoid.length === 0 ? "" : ` _Avoid_: ${t.avoid.join(", ")}.`}`;

// glossaryOf : glossary.md: the project's own glossary linked, then the terms it does not define
function glossaryOf(input: BriefInput): Lines {
  const own = GLOSSARIES.find((g) => input.lines(g) !== undefined);
  const theirs = own === undefined ? new Set<string>() : defined(input.lines(own) ?? []);
  const linked = input.answer.terms.filter((t) => theirs.has(t.term.toLowerCase()));
  const ours = rendered(
    input,
    input.answer.terms.filter((t) => !theirs.has(t.term.toLowerCase())),
    termLine,
  );
  const link =
    own === undefined
      ? []
      : [
          `The project's own glossary is [${own}](${own}): a term it defines means what it says there, and is not repeated here. (verified)`,
          ...linked.map((t) => `- **${t.term}**: see [${own}](${own}) (verified)`),
          "",
        ];
  return {
    lines: [
      `# ${input.project}: glossary`,
      "",
      ...link,
      ...(ours.lines.length === 0 ? ["- no other term (inferred)"] : ours.lines),
      "",
    ],
    cites: ours.cites,
  };
}

// written : brief.md, glossary.md, and every cite they keep
export function written(input: BriefInput): Written {
  const brief = briefOf(input);
  const glossary = glossaryOf(input);
  return {
    brief: brief.lines.join("\n"),
    glossary: glossary.lines.join("\n"),
    cites: [...brief.cites, ...glossary.cites],
  };
}
