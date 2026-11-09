// tools — the project's quick tools for the writer (ADR-0011 D17; #171 Q3), ported from start-writer.sh:
// docs/agents/commands.md on the default branch holds "lint-file: <command>", run on each file the writer edits, and
// "test-touched: <command>", its quick command for the tests it touched. The file is read from the default branch,
// never from the change's branch, because the lint runs as a hook with no permission prompt (ADR-0004). The hook goes
// into .factory/settings.json, read-only, which claude loads with --settings; the box has this package (box build).

import { hostGit } from "../git.js";
import type { FileText } from "./clone.js";

export const COMMANDS_FILE = "docs/agents/commands.md";

export type Tools = { readonly lint: string; readonly quick: string };
export const NO_TOOLS: Tools = { lint: "", quick: "" };

// toolOf : the first "<name>: <command>" line's command, a code span unwrapped; "" when there is none. Pure.
export function toolOf(text: string, name: string): string {
  const line = text
    .replace(/\r/g, "")
    .split("\n")
    .find((l) => l.startsWith(`${name}:`));
  const command = (line ?? "").slice(name.length + 1).trim();
  return /^`[^`]*`$/.test(command) ? command.slice(1, -1).trim() : command;
}

// toolsOf : both tools from the file's text. Pure.
export function toolsOf(text: string): Tools {
  return { lint: toolOf(text, "lint-file"), quick: toolOf(text, "test-touched") };
}

// quoted : one shell word, as the hook's command line needs. Pure.
export function quoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

// settingsOf : the writer's settings: the lint hook on each edit, or none when the project names no lint. Pure.
export function settingsOf(tools: Tools): FileText {
  if (tools.lint === "") {
    return { kind: "none" };
  }
  const hook = { type: "command", command: `agent-factory lint-edit ${quoted(tools.lint)}` };
  const settings = { hooks: { PostToolUse: [{ matcher: "Edit|MultiEdit|Write", hooks: [hook] }] } };
  return { kind: "text", text: `${JSON.stringify(settings, null, 2)}\n` };
}

// toolLines : what the prompt says of the tools; none when the project names none. Pure.
export function toolLines(tools: Tools): readonly string[] {
  return [
    ...(tools.lint === "" ? [] : [`Each file you edit is linted at once with: ${tools.lint}. Fix what it reports.`]),
    ...(tools.quick === ""
      ? []
      : [`Run the tests you touched with: ${tools.quick}. Run the full check before you stop.`]),
  ];
}

// the default branch, as readTools fetches it into the project's clone before each run
export const TARGET_REF = "refs/factory/writer-target";

// readTools : the tools on the default branch of the project's clone; none when the file is not there
export async function readTools(input: {
  readonly repo: string;
  readonly env: NodeJS.ProcessEnv;
  readonly base: string;
}): Promise<Tools> {
  const ref = TARGET_REF;
  const git = (args: readonly string[]) =>
    hostGit({
      args,
      repo: { kind: "repo", path: input.repo },
      env: input.env,
      ownHelper: { kind: "none" },
      stdin: { kind: "none" },
    });
  const fetched = await git(["fetch", "-q", "origin", `+refs/heads/${input.base}:${ref}`]);
  const shown = fetched.kind === "ok" ? await git(["show", `${ref}:${COMMANDS_FILE}`]) : fetched;
  return shown.kind === "ok" ? toolsOf(shown.stdout) : NO_TOOLS;
}
