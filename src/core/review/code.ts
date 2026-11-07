// code — the change's files at its head, in a folder the reviewer reads, with every rule file and symlink removed
// (ADR-0004). Claude loads a CLAUDE.md from any folder it can read, and the change must not choose its own rules.
//
// The files are exactly as committed: read-tree into a private index, then checkout-index into the empty folder. Not
// git archive, whose .gitattributes could hide files (export-ignore) or rewrite them (export-subst); and no
// .gitattributes at all, from the change or this machine, so no encoding, eol, ident or filter rule changes what the
// reviewer reads. Then every symlink goes (a link to a rule file or out of the folder), then every rule file and folder.

import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Done } from "../forge/api.js";
import { hostGit } from "../git.js";

// matched without case: on macOS claude.md opens CLAUDE.md
const RULE_FILES = new Set(["claude.md", "claude.local.md", "agents.md"]);
const RULE_DIRS = new Set([".claude", ".agents"]);

type CopyInput = {
  readonly repo: string;
  readonly sha: string;
  readonly into: string;
  readonly env: NodeJS.ProcessEnv;
};

function git(input: CopyInput, args: readonly string[]): ReturnType<typeof hostGit> {
  return hostGit({
    args: [`--work-tree=${input.into}`, "-c", "core.attributesFile=/dev/null", "-c", "core.autocrlf=false", ...args],
    repo: { kind: "repo", path: input.repo },
    env: { ...input.env, GIT_INDEX_FILE: join(input.into, "..", "index") },
    ownHelper: { kind: "none" },
    stdin: { kind: "none" },
  });
}

async function step(input: CopyInput, args: readonly string[]): Promise<Done> {
  const ran = await git(input, args);
  return ran.kind === "ok"
    ? { kind: "ok" }
    : {
        kind: "failed",
        reason: `cannot copy the code at ${input.sha.slice(0, 8)}: ${ran.kind === "refused" ? ran.reason : ran.stderr.trim()}`,
      };
}

// the .gitattributes paths in the private index
async function attributes(input: CopyInput): Promise<readonly string[] | "failed"> {
  const listed = await git(input, ["ls-files", "-z"]);
  return listed.kind === "ok"
    ? listed.stdout.split("\u0000").filter((f) => /(^|\/)\.gitattributes$/.test(f))
    : "failed";
}

// a symlink, a rule file or a rule folder: never shown to the reviewer
function ruleOrLink(name: string, s: Awaited<ReturnType<typeof lstat>>): boolean {
  const lower = name.toLowerCase();
  return s.isSymbolicLink() || RULE_FILES.has(lower) || (s.isDirectory() && RULE_DIRS.has(lower));
}

// prune : removes every symlink, every rule file and every rule folder under dir
async function prune(dir: string): Promise<void> {
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    const s = await lstat(path);
    if (ruleOrLink(name, s)) {
      await rm(path, { recursive: true, force: true });
    } else if (s.isDirectory()) {
      await prune(path);
    }
  }
}

// dropAttributes : the .gitattributes files leave the private index before the checkout
async function dropAttributes(input: CopyInput): Promise<Done> {
  const attrs = await attributes(input);
  if (attrs === "failed") {
    return { kind: "failed", reason: "cannot list the files at the head" };
  }
  for (const path of attrs) {
    const removed = await step(input, ["update-index", "--force-remove", "--", path]);
    if (removed.kind === "failed") {
      return removed;
    }
  }
  return { kind: "ok" };
}

async function checkout(input: CopyInput): Promise<Done> {
  const read = await step(input, ["read-tree", input.sha]);
  const dropped = read.kind === "ok" ? await dropAttributes(input) : read;
  return dropped.kind === "ok" ? step(input, ["checkout-index", "-a"]) : dropped;
}

// copyCode : the files at sha in `into` (which must not exist yet; its parent holds the private index)
export async function copyCode(input: CopyInput): Promise<Done> {
  try {
    await mkdir(input.into, { recursive: true, mode: 0o700 });
    const out = await checkout(input);
    await rm(join(input.into, "..", "index"), { force: true });
    if (out.kind === "ok") {
      await prune(input.into);
    }
    return out;
  } catch {
    return { kind: "failed", reason: `cannot copy the code at ${input.sha.slice(0, 8)} into ${input.into}` };
  }
}
