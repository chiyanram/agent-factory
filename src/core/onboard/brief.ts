// brief — brief.md and glossary.md, written from the onboarder's answer and what the engine read itself (#235;
// docs/DESIGN.md section 5 "Project knowledge"). Every line is marked verified or inferred:
//
//   project rules        the engine's alone: each MUST of the root AGENTS.md and CLAUDE.md, read by the engine itself
//                        (musts.ts), one line each, verified at its file:line
//   commands             the engine's listing (listing.ts), each verified at the file:line it was read from
//   where rules live     the project's own instruction files, glossary and decision records, linked, never copied
//   stack, modules,      the model's answer; an item is verified only when its cite names a file and line the default
//   gotchas, terms       branch holds, else it is inferred and loses the cite
//
// The model's copy of the code holds no rule file (review/code.ts prunes them), so whatever it says of them is wrong
// by construction. Two kinds of model line are dropped, never sent to a run, each with a note for the human who reads
// the staged brief (#383):
//   - a line that speaks of the project's rules: one titled "Project rules", or one that names AGENTS.md, CLAUDE.md,
//     .claude/, .agents/ or an agent instruction file
//   - a line that says a file is absent which the default branch holds (cites.ts "absence"), or one the engine cannot
//     tell apart from such a claim
// A brief is refused only when the model gave lines and none is left; the brief with what is left is staged otherwise.
//
// A term the project's own glossary (CONTEXT.md or GLOSSARY.md) defines is linked there, never given a meaning of ours.
// No count goes in. Each kept cite is returned with its line's text, so every later run can check it again (cites.ts).
// Pure.

import type { Answer, Cite, Item, Module, Term } from "./answer.js";
import type { Result } from "../forge/api.js";
import { type Absence, absence } from "./cites.js";
import type { Commands } from "./listing.js";
import { projectMusts, RULE_FILES } from "./musts.js";

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

// dropped: one note per model line the engine left out of the brief, for the human, never for a run
export type Written = {
  readonly brief: string;
  readonly glossary: string;
  readonly cites: readonly KeptCite[];
  readonly dropped: readonly string[];
};

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

type Mark = { readonly mark: string; readonly cite: KeptCite | "none" } | { readonly dropped: string };

// a line that speaks of the project's rules, which only the engine writes (musts.ts)
const RULES_TALK = [
  /^\s*project rules\b/i,
  /\b(?:AGENTS|CLAUDE)\.md\b/i,
  /\b(?:AGENTS|CLAUDE)\b/,
  /(?:^|[\s(`'"])\.(?:claude|agents)\b/i,
  /\b(?:agent|AI)\s+instructions?\b/i,
  /\binstruction files?\b/i,
] as const;

// rulesTalk : whether a model line speaks of the project's rules
export function rulesTalk(text: string): boolean {
  const plain = text.replace(/[`*]/g, "");
  return RULES_TALK.some((r) => r.test(plain));
}

const ENGINE_RULES = "the engine writes Project rules itself, from the root AGENTS.md and CLAUDE.md";

// absentMark : the mark of a line that says a file is absent, checked against the file list (cites.ts "absence"); a
// line the file list contradicts, or may, is dropped; undefined when the line is no such claim
function absentMark(input: BriefInput, item: Cite, text: string): Mark | undefined {
  const absent = absence(text, item.file, input.files);
  if (absent.kind === "not-absence") {
    return undefined;
  }
  if ("held" in absent) {
    return { dropped: `"${text}": ${droppedWhy(absent)}` };
  }
  return {
    mark: absent.kind === "true" ? "(verified against the file list)" : `(inferred: ${absent.why})`,
    cite: "none",
  };
}

// droppedWhy : why an absence claim is dropped: the repo holds a file it claims absent, or one it may mean
function droppedWhy(absent: Extract<Absence, { readonly held: readonly string[] }>): string {
  const held = absent.held.join(", ");
  return absent.kind === "false"
    ? `it says ${absent.names.join(", ")} absent, but the default branch holds ${held}`
    : `it says a file is absent, and the default branch holds ${held}, which it names`;
}

// markOf : how a line is marked: verified with its cite, verified against the file list, or inferred; or, for a model
// line, dropped with the reason
function markOf(input: BriefInput, item: Cite & { readonly verified: boolean }, text: string, model: boolean): Mark {
  return (model ? modelMark(input, item, text) : undefined) ?? citedMark(input, item);
}

// modelMark : a model line dropped, or marked against the file list; undefined when its cite decides
function modelMark(input: BriefInput, item: Cite, text: string): Mark | undefined {
  return rulesTalk(text) ? { dropped: `"${text}": ${ENGINE_RULES}` } : absentMark(input, item, text);
}

// citedMark : a line marked by its cite: verified or inferred at its file:line, or inferred without one
function citedMark(input: BriefInput, item: Cite & { readonly verified: boolean }): Mark {
  const cite = checked(input, item);
  if (cite === "none") {
    return { mark: "(inferred)", cite };
  }
  const at = cite.line === 0 ? cite.file : `${cite.file}:${cite.line}`;
  return { mark: `(\`${at}\`, ${item.verified ? "verified" : "inferred"})`, cite };
}

type Lines = {
  readonly lines: readonly string[];
  readonly cites: readonly KeptCite[];
  readonly dropped: readonly string[];
  // how many lines the model gave, kept or dropped
  readonly given: number;
};

const NONE: Pick<Lines, "dropped" | "given"> = { dropped: [], given: 0 };

function rendered<T extends Cite & { readonly verified: boolean }>(
  input: BriefInput,
  items: readonly T[],
  body: (item: T) => string,
  model = true,
): Lines {
  const marks = items.map((item) => ({ text: body(item), ...markOf(input, item, body(item), model) }));
  return {
    lines: marks.flatMap((m) => ("mark" in m ? [`- ${m.text} ${m.mark}`] : [])),
    cites: marks.flatMap((m) => ("cite" in m && m.cite !== "none" ? [m.cite] : [])),
    dropped: marks.flatMap((m) => ("dropped" in m ? [m.dropped] : [])),
    given: model ? items.length : 0,
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
      ...NONE,
    };
  }
  const items = c.commands.map((l) => Object.assign({ verified: true }, l));
  const body = (l: (typeof items)[number]): string =>
    l.help === "" ? `\`${l.command}\`` : `\`${l.command}\`: ${l.help}`;
  return rendered(input, items, body, false);
}

function ruleLines(input: BriefInput): readonly string[] {
  const own = RULE_PLACES.filter((p) => present(input.files, p)).map((p) => `- [${p}](${p}) (verified)`);
  const nested = input.files.some((f) => /.\/(AGENTS|CLAUDE)\.md$/.test(f));
  return nested ? [...own, "- the AGENTS.md or CLAUDE.md of a folder, for that folder (verified)"] : own;
}

// ruleMustLines : each MUST the root AGENTS.md and CLAUDE.md state, one line each, cited at its line (musts.ts); the
// engine reads them itself, since the model's copy of the code holds no rule file
function ruleMustLines(input: BriefInput): Lines {
  const musts = projectMusts(input.lines);
  if (musts.length > 0) {
    return {
      lines: musts.map((m) => `- ${m.text} (\`${m.file}:${m.line}\`, verified)`),
      cites: musts.map((m) => ({ file: m.file, line: m.line, text: lineText(input.lines(m.file) ?? [], m.line) })),
      ...NONE,
    };
  }
  const held = RULE_FILES.filter((f) => input.lines(f) !== undefined);
  const line =
    held.length === 0
      ? `- no ${RULE_FILES.join(" or ")} at the root (verified against the file list)`
      : `- no MUST in ${held.map((f) => `[${f}](${f})`).join(" or ")}: read ${held.length === 1 ? "it" : "them"} whole (verified)`;
  return { lines: [line], cites: [], ...NONE };
}

const stackLine = (i: Item): string => i.text;
const moduleLine = (m: Module): string => `**${m.name}**: ${m.job}`;

// briefOf : brief.md, and the cites it keeps
function briefOf(input: BriefInput): Lines {
  const rules = ruleMustLines(input);
  const commands = commandLines(input);
  const stack = rendered(input, input.answer.stack, stackLine);
  const modules = rendered(input, input.answer.modules, moduleLine);
  const gotchas = rendered(input, input.answer.gotchas, stackLine);
  const lines = [
    `# ${input.project}: brief`,
    "",
    `Written by the onboarder from ${input.base} at ${input.sha.slice(0, 12)}; a human accepts it before any run reads it.`,
    "Each line is verified (its cite was read) or inferred. Every run checks each cite again.",
    ...section("Project rules", rules.lines, "- none found (inferred)"),
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
  const parts = [rules, stack, commands, modules, gotchas];
  return {
    lines,
    cites: parts.flatMap((p) => p.cites),
    dropped: parts.flatMap((p) => p.dropped),
    given: parts.reduce((n, p) => n + p.given, 0),
  };
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
    dropped: ours.dropped,
    given: input.answer.terms.length,
  };
}

// written : brief.md, glossary.md, every cite they keep, and a note for each model line the engine dropped; refused
// only when the model gave lines and the engine dropped every one, since a brief of the engine's lines alone would hide
// that the model's answer was unusable
export function written(input: BriefInput): Result<Written> {
  const brief = briefOf(input);
  const glossary = glossaryOf(input);
  const dropped = [...brief.dropped, ...glossary.dropped];
  const given = brief.given + glossary.given;
  if (given > 0 && dropped.length === given) {
    return {
      kind: "failed",
      reason: `the brief is refused: the engine dropped every line the onboarder gave: ${dropped.join("; ")}`,
    };
  }
  return {
    kind: "ok",
    value: {
      brief: brief.lines.join("\n"),
      glossary: glossary.lines.join("\n"),
      cites: [...brief.cites, ...glossary.cites],
      dropped,
    },
  };
}
