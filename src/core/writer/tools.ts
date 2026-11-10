// tools — the writer's settings file: its allow and deny lists (#114), and the project's quick tools for the writer (ADR-0011 D17; #171 Q3), ported from start-writer.sh:
// docs/agents/commands.md on the default branch holds "lint-file: <command>", run on each file the writer edits, and
// "test-touched: <command>", its quick command for the tests it touched. The file is read from the default branch,
// never from the change's branch, because the lint runs as a hook with no permission prompt (ADR-0004). The hook goes
// into .factory/settings.json, read-only, which claude loads with --settings; the vm box has this package (box build),
// and the srt runner has the host's own.

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

// The writer's allow and deny lists (#111, absorbed by #114; ADR-0012 S11). The writer runs only inside a runner (vm or
// srt), with skip-all permissions: there Claude Code reads no allow rule, but every deny rule still holds ("Deny rules
// block in every mode, including bypassPermissions", Claude Code's permission modes). The runner is the wall; these
// lists are the second line, and say what the writer is for:
//   allow  Bash, inside the runner's sandbox; edits in the clone (the folder it starts in)
//   deny   git push, WebFetch, curl, and reads of the credential paths under the person's home
export const WRITER_ALLOW: readonly string[] = ["Bash", "Edit(./**)"];

// the credential paths of review issue 6 on #30 a writer never reads, under the person's home
const CREDENTIALS: readonly string[] = [
  ".ssh/**",
  ".gnupg/**",
  ".config/gh/**",
  ".config/glab-cli/**",
  ".git-credentials",
  ".config/git/credentials",
  ".netrc",
  ".aws/**",
  ".config/gcloud/**",
  ".azure/**",
  ".kube/**",
  ".docker/**",
  ".claude/**",
  ".claude.json",
  ".copilot/**",
];

// both spellings of one command: alone, and with arguments
function bashRule(name: string): readonly string[] {
  return [`Bash(${name})`, `Bash(${name} *)`];
}

// writerDenies : the deny list, with the credential paths under `home`, the person's real home ("" when unknown, and
// then only the runner hides them). A rule with // is absolute: inside the srt runner ~ is the run's private HOME, not
// the person's. Pure.
export function writerDenies(home: string): readonly string[] {
  const root = home.replace(/^\/+/, "").replace(/\/+$/, "");
  return [
    "WebFetch",
    ...bashRule("git push"),
    ...bashRule("curl"),
    ...(root === "" ? [] : CREDENTIALS.map((p) => `Read(//${root}/${p})`)),
  ];
}

// settingsOf : the writer's settings: its allow and deny lists, and the lint hook on each edit when the project names a
// lint. `home` is the person's real home. Pure.
export function settingsOf(tools: Tools, home: string): FileText {
  const permissions = { allow: WRITER_ALLOW, deny: writerDenies(home) };
  const hook = { type: "command", command: `agent-factory lint-edit ${quoted(tools.lint)}` };
  const hooks =
    tools.lint === "" ? {} : { hooks: { PostToolUse: [{ matcher: "Edit|MultiEdit|Write", hooks: [hook] }] } };
  return { kind: "text", text: `${JSON.stringify({ permissions, ...hooks }, null, 2)}\n` };
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
      stdin: { kind: "none" },
    });
  const fetched = await git(["fetch", "-q", "origin", `+refs/heads/${input.base}:${ref}`]);
  const shown = fetched.kind === "ok" ? await git(["show", `${ref}:${COMMANDS_FILE}`]) : fetched;
  return shown.kind === "ok" ? toolsOf(shown.stdout) : NO_TOOLS;
}
