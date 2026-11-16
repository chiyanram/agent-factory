// scope — where a writer run may edit (process/guardrails.ts edit-scope), checked twice:
//   in the run   a PreToolUse hook (agent-factory writer-scope) refuses an Edit, MultiEdit, Write or NotebookEdit
//                outside the scopes before it happens. Under skip-all Claude Code reads no allow rule, so
//                Edit(src/test/**) cannot work as a permission, and a deny rule cannot carve out the test files. Every refusal
//                exits 2, but a hook that cannot start at all lets the edit through, so the host check below is the wall
//   on the host  after the box stops, every path the run's commits touch must match each scope, because Bash can
//                still write any file. An edit outside one blocks the run, and the reason names the paths
// The scopes: the card's Edit(…) globs, and for test-first the project's test files (ready.testFiles), so a card's
// globs only narrow them.

import { relative, sep } from "node:path";
import { deny, fileOf, real, type Scoped } from "../edit-scope.js";
import { PR_BODY_PATH } from "../pr-body.js";
import { matches } from "../lane.js";
import type { Role } from "../process/cards.js";
import { testFilesOnly } from "../process/guardrails.js";
import { REPORT_PATH, type Outcome } from "../report.js";

// one list of globs an edit must match: the card's Edit(…) globs, or the project's test files
export type EditScope = { readonly what: "card" | "tests"; readonly globs: readonly string[] };

// the most paths a reason names
const MOST_NAMED = 3;

// scopesOf : the scopes of a run from its card: the card's Edit(…) globs when it has some, and the project's test
// files for test-first; none is anywhere in the clone. Pure.
export function scopesOf(
  card: { readonly role: Role; readonly editScope: readonly string[] },
  testFiles: readonly string[],
): readonly EditScope[] {
  return [
    ...(card.editScope.length === 0 ? [] : [{ what: "card" as const, globs: card.editScope }]),
    ...(testFilesOnly(card.role) ? [{ what: "tests" as const, globs: testFiles }] : []),
  ];
}

// outsideScope : each path the run changed that misses a scope; none when there is no scope. Pure.
export function outsideScope(paths: readonly string[], scopes: readonly EditScope[]): readonly string[] {
  return paths.filter((p) => scopes.some((s) => !matches(p, s.globs)));
}

// named : a scope as a person reads it. Pure.
function named(scope: EditScope): string {
  return scope.what === "tests"
    ? "the project's test files (ready.testFiles)"
    : `its card's edit scope (${scope.globs.join(", ")})`;
}

// scoped : the run's outcome, or blocked by the host when it edited outside a scope. Pure.
export function scoped(outcome: Outcome, outside: readonly string[], scopes: readonly EditScope[]): Outcome {
  if (outside.length === 0) {
    return outcome;
  }
  const paths = outside.slice(0, MOST_NAMED).join(", ");
  const more = outside.length > MOST_NAMED ? ` and ${outside.length - MOST_NAMED} more` : "";
  const missed = scopes.filter((s) => outside.some((p) => !matches(p, s.globs))).map(named);
  return {
    kind: "blocked",
    reason: `the run edited ${paths}${more}, outside ${missed.join(" and ")}`,
    by: "host",
  };
}

// the files the floor tells every run to write, wherever its scope lies (step.ts FLOOR)
const OWN_FILES: ReadonlySet<string> = new Set([REPORT_PATH, PR_BODY_PATH]);

// clonePath : the edited file's path in the clone at `root`, followed through its links, or the refusal of a call
// that names no absolute file, or one outside the clone
async function clonePath(file: string, root: string): Promise<string | Scoped> {
  if (file === "") {
    return deny("this run edits only inside its scope; this call names no absolute file without a ..");
  }
  const [inside, top] = await Promise.all([real(file), real(root)]);
  return top !== "" && inside.startsWith(`${top}${sep}`)
    ? relative(top, inside).split(sep).join("/")
    : deny(`this run edits only inside its clone; ${file} is outside it`);
}

// writerScope : the hook's check: pass (exit 0) an edit inside the clone at `root` whose path, followed through its
// links, matches every scope's globs, or is the run's own report or PR body; deny (exit 2) any other, naming the path
// and the globs it missed
export async function writerScope(
  stdin: string,
  root: string,
  scopes: readonly (readonly string[])[],
): Promise<Scoped> {
  const path = await clonePath(fileOf(stdin), root);
  if (typeof path !== "string") {
    return path;
  }
  const missed = OWN_FILES.has(path) ? undefined : scopes.find((globs) => !matches(path, globs));
  return missed === undefined
    ? { code: 0, out: "", err: "" }
    : deny(`this run edits only files that match ${missed.join(", ")}; ${path} does not`);
}

// globList : one non-empty list of non-empty globs, or "bad". Pure.
function globList(value: unknown): readonly string[] | "bad" {
  const items: readonly unknown[] = Array.isArray(value) ? value : [];
  const globs = items.filter((g): g is string => typeof g === "string" && g !== "");
  return globs.length > 0 && globs.length === items.length ? globs : "bad";
}

// scopesArg : the hook's argument: a JSON list of non-empty glob lists, as writerSettings writes it; "bad" for any
// other. Pure.
export function scopesArg(text: string): readonly (readonly string[])[] | "bad" {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return "bad";
  }
  const lists = (Array.isArray(parsed) ? parsed : []).map(globList);
  const good = lists.filter((l): l is readonly string[] => l !== "bad");
  return good.length > 0 && good.length === lists.length ? good : "bad";
}
