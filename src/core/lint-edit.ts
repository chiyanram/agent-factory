// lint-edit — the writer's PostToolUse hook, ported from lint-edit.sh (#138; ADR-0011 D17): lints the file an Edit or
// Write just changed, with the project's own lint command (docs/agents/commands.md, "lint-file: <command>").
//
// Claude Code passes the tool call as JSON on stdin; the file is tool_input.file_path. The command runs with no shell
// (the ready check's reader, ready/command.ts), with the file as its last word, in the session's folder. A file that
// is gone, or outside that folder once symlinks are followed, is skipped. On a lint failure the hook exits 2 with the
// lint's last 40 lines, which Claude Code shows the writer; on a command that needs a shell or a program that cannot
// start it exits 1, which Claude Code shows the person and does not hold the writer on; otherwise it exits 0 and prints
// nothing.

import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { prop } from "./dispatch/records.js";
import { CANNOT_START, type FolderRunner } from "./review/model.js";
import { commandWords } from "./ready/command.js";
import type { Result } from "./forge/api.js";
import type { Argv } from "./project.js";

export type Hooked = { readonly code: 0 | 1 | 2; readonly err: string };

const QUIET: Hooked = { code: 0, err: "" };
const TAIL = 40;

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

type Edited = { readonly kind: "file"; readonly path: string } | { readonly kind: "none" };

// pathOf : the tool call's file as an absolute path, or "" when it names none
function pathOf(stdin: string, root: string): string {
  const file = prop(prop(parsed(stdin), "tool_input"), "file_path");
  if (typeof file !== "string" || file === "") {
    return "";
  }
  return resolve(isAbsolute(file) ? file : join(root, file));
}

async function real(path: string): Promise<string> {
  return realpath(path).catch(() => "");
}

// edited : the file the tool call changed, when it is still there and inside root, symlinks followed first
async function edited(stdin: string, root: string): Promise<Edited> {
  const path = await real(pathOf(stdin, root));
  const top = await real(root);
  const inside = path !== "" && top !== "" && path.startsWith(`${top}${sep}`);
  const isFile = await stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
  return inside && isFile ? { kind: "file", path } : { kind: "none" };
}

// argvOf : the lint command as words, with a program first
function argvOf(command: string): Result<Argv> {
  const words = commandWords(command);
  if (words.kind === "failed") {
    return words;
  }
  const [bin, ...args] = words.value;
  if (bin === undefined) {
    return { kind: "failed", reason: "it is empty" };
  }
  // NAME=value before the program sets a variable only in a shell
  return bin.includes("=")
    ? { kind: "failed", reason: "it sets a variable, which needs a shell" }
    : { kind: "ok", value: [bin, ...args] };
}

function tail(text: string): string {
  return text.trimEnd().split("\n").slice(-TAIL).join("\n");
}

// lintEdit : what the hook prints and how it exits, for one tool call
export async function lintEdit(input: {
  readonly command: string;
  readonly stdin: string;
  // the session's folder (CLAUDE_PROJECT_DIR)
  readonly root: string;
  readonly env: NodeJS.ProcessEnv;
  readonly run: FolderRunner;
}): Promise<Hooked> {
  const argv = argvOf(input.command);
  if (argv.kind === "failed") {
    return {
      code: 1,
      err: `lint-edit: the lint command ${JSON.stringify(input.command)} cannot run: ${argv.reason}\n`,
    };
  }
  const file = await edited(input.stdin, input.root);
  if (file.kind === "none") {
    return QUIET;
  }
  const [bin, ...args] = argv.value;
  const ran = await input.run({ bin, args: [...args, file.path], env: input.env, cwd: input.root });
  if (ran.code === CANNOT_START) {
    return {
      code: 1,
      err: `lint-edit: the lint command ${JSON.stringify(input.command)} cannot run: ${ran.stderr.trim()}\n`,
    };
  }
  return ran.code === 0
    ? QUIET
    : { code: 2, err: `lint failed on ${file.path} (${input.command}):\n${tail(`${ran.stdout}${ran.stderr}`)}\n` };
}
