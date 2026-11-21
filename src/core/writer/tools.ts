// tools — the project's quick tools for the writer (ADR-0011 D17; #171 Q3): docs/agents/commands.md on the default
// branch holds "lint-file: <command>", run on each file the writer edits, and "test-touched: <command>", its quick
// command for the tests it touched. The file is read from the default branch, never from the change's branch, because
// the lint runs as a hook with no permission prompt (ADR-0004). The agent CLI's adapter puts the hook into the
// writer's settings file (agent/claude-writer.ts); the vm box has this package (box build), and the srt runner has
// the host's own.

import { hostGit } from "../git.js";

export const COMMANDS_FILE = "docs/agents/commands.md";

export type Tools = { readonly lint: string; readonly quick: string };
export const NO_TOOLS: Tools = { lint: "", quick: "" };

export function toolOf(text: string, name: string): string {
  const line = text
    .replace(/\r/g, "")
    .split("\n")
    .find((l) => l.startsWith(`${name}:`));
  const command = (line ?? "").slice(name.length + 1).trim();
  return /^`[^`]*`$/.test(command) ? command.slice(1, -1).trim() : command;
}

export function toolsOf(text: string): Tools {
  return { lint: toolOf(text, "lint-file"), quick: toolOf(text, "test-touched") };
}

export function toolLines(tools: Tools): readonly string[] {
  return [
    ...(tools.lint === "" ? [] : [`Each file you edit is linted at once with: ${tools.lint}. Fix what it reports.`]),
    ...(tools.quick === ""
      ? []
      : [`Run the tests you touched with: ${tools.quick}. Run the full check before you stop.`]),
  ];
}

export const TARGET_REF = "refs/factory/writer-target";

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
      stdin: { kind: "none" },
    });
  const fetched = await git(["fetch", "-q", "origin", `+refs/heads/${input.base}:${ref}`]);
  const shown = fetched.kind === "ok" ? await git(["show", `${ref}:${COMMANDS_FILE}`]) : fetched;
  return shown.kind === "ok" ? toolsOf(shown.stdout) : NO_TOOLS;
}
