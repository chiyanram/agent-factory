// brief — brief.md and glossary.md, written from the onboarder's answer and what the engine read itself (#235;
// docs/explanation/architecture.md section 5 "Project knowledge"). Every line is marked verified or inferred:
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
// A brief is refused only when the model gave lines and none is left, because the engine's lines alone would hide an
// unusable answer. Otherwise the brief with what is left is staged.
//
// A term the project's own glossary (CONTEXT.md or GLOSSARY.md) defines is linked there, never given a meaning of ours.
// No count goes in. Each kept cite is returned with its line's text, so every later run can check it again (cites.ts).
// Pure.

import type { Answer, Cite, Item, Module, Term } from "./answer.js";
import type { Result } from "../forge/api.js";
import { type Absence, absence } from "./cites.js";
import type { Commands } from "./listing.js";
import { projectMusts, RULE_FILES } from "./musts.js";

export type KeptCite = Cite & { readonly text: string };

export type BriefInput = {
  readonly project: string;
  readonly base: string;
  readonly sha: string;
  readonly commands: Commands;
  readonly files: readonly string[];
  readonly lines: (path: string) => readonly string[] | undefined;
  readonly answer: Answer;
};

export type Written = {
  readonly brief: string;
  readonly glossary: string;
  readonly cites: readonly KeptCite[];
  readonly dropped: readonly string[];
};

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

function checked(input: BriefInput, cite: Cite): KeptCite | "none" {
  const lines = cite.file === "" ? undefined : input.lines(cite.file);
  return lines === undefined || cite.line > lines.length ? "none" : { ...cite, text: lineText(lines, cite.line) };
}

function lineText(lines: readonly string[], line: number): string {
  return line === 0 ? "" : (lines[line - 1] ?? "");
}

type Mark = { readonly mark: string; readonly cite: KeptCite | "none" } | { readonly dropped: string };

const RULES_TALK = [
  /^\s*project rules\b/i,
  /\b(?:AGENTS|CLAUDE)\.md\b/i,
  /\b(?:AGENTS|CLAUDE)\b/,
  /(?:^|[\s(`'"])\.(?:claude|agents)\b/i,
  /\b(?:agent|AI)\s+instructions?\b/i,
  /\binstruction files?\b/i,
] as const;

export function rulesTalk(text: string): boolean {
  const plain = text.replace(/[`*]/g, "");
  return RULES_TALK.some((r) => r.test(plain));
}

const ENGINE_RULES = "the engine writes Project rules itself, from the root AGENTS.md and CLAUDE.md";

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

function droppedWhy(absent: Extract<Absence, { readonly held: readonly string[] }>): string {
  const held = absent.held.join(", ");
  return absent.kind === "false"
    ? `it says ${absent.names.join(", ")} absent, but the default branch holds ${held}`
    : `it says a file is absent, and the default branch holds ${held}, which it names`;
}

function markOf(input: BriefInput, item: Cite & { readonly verified: boolean }, text: string, model: boolean): Mark {
  return (model ? modelMark(input, item, text) : undefined) ?? citedMark(input, item);
}

function modelMark(input: BriefInput, item: Cite, text: string): Mark | undefined {
  return rulesTalk(text) ? { dropped: `"${text}": ${ENGINE_RULES}` } : absentMark(input, item, text);
}

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

function defined(lines: readonly string[]): ReadonlySet<string> {
  return new Set(lines.flatMap((l) => /^\*\*([^*]+)\*\*\s*:/.exec(l)?.[1]?.trim().toLowerCase() ?? []));
}

const termLine = (t: Term): string =>
  `**${t.term}**: ${t.meaning}${t.avoid.length === 0 ? "" : ` _Avoid_: ${t.avoid.join(", ")}.`}`;

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
