// edit-scope — the coordinator's PreToolUse hook (ADR-0012 S2, #676): Edit and Write work only in the spec drafts.
// A deny rule cannot do it, because Claude Code checks deny before allow and an allow cannot carve an exception out of
// a deny; so every edit outside `$FACTORY_HOME/specs/` is refused here, before the rules, and one inside passes on to
// them (its allow rule lets it run with no prompt).
//
// Claude Code passes the tool call as JSON on stdin: tool_input.file_path (Edit, Write, MultiEdit) or
// tool_input.notebook_path (NotebookEdit). The path is followed through symlinks as far as it exists, so a link inside
// the drafts that leads out, or one that leads nowhere, is refused; a ".." anywhere, a relative path, a missing path or stdin that is not a tool
// call is refused too. A deny exits 2, which blocks the call even where the JSON is not read; the reason goes on
// stderr, which Claude Code shows the coordinator.

import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, sep } from "node:path";
import { prop } from "./dispatch/records.js";

export type Scoped = { readonly code: 0 | 2; readonly out: string; readonly err: string };

const PASS: Scoped = { code: 0, out: "", err: "" };

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function deny(reason: string): Scoped {
  const decision = {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  };
  return { code: 2, out: `${JSON.stringify(decision)}\n`, err: `${reason}\n` };
}

export async function real(path: string): Promise<string> {
  const found = await realpath(path).catch(() => "");
  if (found !== "") {
    return found;
  }
  const there = await lstat(path).then(
    () => true,
    () => false,
  );
  const parent = dirname(path);
  if (there || parent === path) {
    return "";
  }
  const above = await real(parent);
  return above === "" ? "" : join(above, basename(path));
}

export function fileOf(stdin: string): string {
  const input = prop(parsed(stdin), "tool_input");
  const named = prop(input, "file_path") ?? prop(input, "notebook_path");
  const file = typeof named === "string" ? named : "";
  return isAbsolute(file) && !file.split(/[\\/]/).includes("..") ? file : "";
}

async function within(file: string, specs: string): Promise<boolean> {
  const [inside, root] = await Promise.all([real(file), real(specs)]);
  return root !== "" && inside.startsWith(`${root}${sep}`);
}

export async function editScope(stdin: string, specs: string): Promise<Scoped> {
  const file = fileOf(stdin);
  const named = file === "" ? "this call names no absolute file" : `${file} is outside them`;
  return file !== "" && (await within(file, specs))
    ? PASS
    : deny(`the coordinator edits only spec drafts under ${specs}/; ${named}`);
}
