// cards — one role card per role, read from the project's process plugin, or the engine's built-in card when no
// plugin holds one (#236, #235; docs/DESIGN.md section 5 "The process plugin"):
//
//   <plugin>/skills/<skill>/process/roles/<role>.md     the process plugin's card (read.ts finds the process folder)
//   prompts/roles/<role>.md                             the engine's built-in card
//
// A card is frontmatter, then the body the model reads. The engine checks the frontmatter before a run: the card must
// name its own role, and its tools must be ones the engine gives that role, so a card can never ask for a tool the role
// does not get. Every run record carries the card's hash, so a person can tell which card a run used.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "../forge/api.js";
import { processDir, type PluginDir } from "./read.js";

const BUILT_IN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "prompts", "roles");

// the roles whose runs the engine starts from a card, and the tools it gives each one
export const ROLE_TOOLS = {
  "design-reviewer": ["Read", "Grep", "Glob"],
  "verify-pass": ["Read", "Grep", "Glob"],
  cleanup: ["Read", "Grep", "Glob", "Edit", "Bash"],
  // its Bash is the build tool's help and task list only: the engine lists the commands itself and hands the run the
  // list, so the run gets the read-only tools alone (#235; onboard/run.ts)
  onboarder: ["Read", "Grep", "Glob", "Bash"],
} as const;

export type Role = keyof typeof ROLE_TOOLS;

export type Card = {
  readonly role: Role;
  // what the model reads: the card without its frontmatter
  readonly body: string;
  // the sha256 of the whole card file, for the run record
  readonly sha256: string;
  // where it came from, as a person reads it
  readonly from: string;
};

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

const FRONT = /^---\n([\s\S]*?)\n---\n/;

// field : one "name: value" line of the frontmatter, or "" when it has none. Pure.
function field(front: string, name: string): string {
  const line = front.split("\n").find((l) => l.startsWith(`${name}:`));
  return line === undefined ? "" : line.slice(name.length + 1).trim();
}

// toolsOf : the frontmatter's tools list, each tool by its name alone ("Bash (on the runner)" is Bash). Pure.
function toolsOf(front: string): readonly string[] {
  const list = field(front, "tools").replace(/^\[/, "").replace(/\]$/, "");
  return list
    .split(",")
    .map((t) => t.trim().split(/\s/)[0] ?? "")
    .filter((t) => t !== "");
}

// cardOf : a card's text, checked against the role it is read for. Pure.
// frontProblem : why a card's frontmatter does not fit the role it is read for, or "". Pure.
function frontProblem(role: Role, front: string): string {
  const named = field(front, "role");
  if (named !== role) {
    return `the card names the role ${JSON.stringify(named)}, not ${role}`;
  }
  const allowed: readonly string[] = ROLE_TOOLS[role];
  const extra = toolsOf(front).filter((t) => !allowed.includes(t));
  return extra.length === 0 ? "" : `the ${role} gets only ${allowed.join(", ")}; the card asks for ${extra.join(", ")}`;
}

export function cardOf(role: Role, text: string, from: string): Result<Card> {
  const front = FRONT.exec(text);
  if (front === null) {
    return failed(`${from}: a role card starts with its frontmatter between two --- lines`);
  }
  const problem = frontProblem(role, front[1] ?? "");
  if (problem !== "") {
    return failed(`${from}: ${problem}`);
  }
  const sha256 = createHash("sha256").update(text, "utf8").digest("hex");
  return { kind: "ok", value: { role, body: text.slice(front[0].length).trim(), sha256, from } };
}

async function textAt(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch(() => undefined);
}

// pluginCard : the first plugin's card for the role, in the project's order, among the plugins that hold a process;
// "none" when none holds that card
async function pluginCard(plugins: readonly PluginDir[], role: Role): Promise<Result<Card> | "none"> {
  for (const plugin of plugins) {
    const dir = await processDir(plugin.dir);
    const path = join(dir, "roles", `${role}.md`);
    const text = dir === "" ? undefined : await textAt(path);
    if (text !== undefined) {
      return cardOf(role, text, `${plugin.label} (${path})`);
    }
  }
  return "none";
}

// readCard : the role's card from the project's process plugins, or the built-in card when none holds one. A card that
// is there but does not pass its check is refused, never skipped for the built-in one.
export async function readCard(plugins: readonly PluginDir[], role: Role, builtIn = BUILT_IN): Promise<Result<Card>> {
  const found = await pluginCard(plugins, role);
  if (found !== "none") {
    return found;
  }
  const path = join(builtIn, `${role}.md`);
  const text = await textAt(path);
  return text === undefined ? failed(`cannot read the built-in ${role} card at ${path}`) : cardOf(role, text, path);
}
