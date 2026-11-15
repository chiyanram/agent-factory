// check-pr-body — the description of a pull request that is ready for review holds the template's lines, filled in.
// The squash merge makes the description the commit body on main, where it cannot be edited, so CI checks it before
// the merge. A problem is:
//
//   why          the first line is not "Why: " and a reason
//   line         a "Breaking change:", "Rollback:" or "Where to look:" line is missing or has no answer
//   placeholder  a <placeholder> of .github/pull_request_template.md is still in the description
//   unticked     a checklist item is not ticked: answer its line, then tick it
//
//   gh pr view <N> --json body -q .body | node scripts/check-pr-body.ts [ROOT]     (the pr-body workflow)
//
// The same rule as chiyanram/skills' scripts/pr_body.py. Runs on Node's type stripping (Node 22.18+), so it uses only
// erasable TypeScript.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const TEMPLATE = ".github/pull_request_template.md";

const LABELS: readonly string[] = ["Breaking change:", "Rollback:", "Where to look:"];
const PLACEHOLDER = /<[^<>\n]+>/g;
const UNTICKED = /^\s*[-*] \[ \]/;

// placeholders : each <placeholder> the template holds, once
export function placeholders(template: string): readonly string[] {
  return [...new Set(template.match(PLACEHOLDER) ?? [])];
}

export function problems(body: string, template: string): readonly string[] {
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  return [...why(lines), ...answered(lines), ...left(body, template), ...unticked(lines)];
}

function why(lines: readonly string[]): readonly string[] {
  const first = (lines.find((l) => l.trim() !== "") ?? "").trim();
  return /^Why: \S/.test(first)
    ? []
    : ['the first line must be "Why: " and the reason for the change, in one sentence'];
}

function answered(lines: readonly string[]): readonly string[] {
  return LABELS.filter((label) => !lines.some((l) => l.startsWith(label) && l.slice(label.length).trim() !== "")).map(
    (label) => `the "${label}" line is missing or has no answer`,
  );
}

function left(body: string, template: string): readonly string[] {
  return placeholders(template)
    .filter((p) => body.includes(p))
    .map((p) => `the placeholder ${p} is still there: replace it`);
}

function unticked(lines: readonly string[]): readonly string[] {
  return [...lines.entries()]
    .filter(([, l]) => UNTICKED.test(l))
    .map(([i, l]) => `line ${i + 1} is not ticked: answer it, then tick it: ${l.trim()}`);
}

if (process.argv[1] === import.meta.filename) {
  const root = process.argv[2] ?? ".";
  const found = problems(readFileSync(0, "utf8"), readFileSync(join(root, TEMPLATE), "utf8"));
  for (const p of found) {
    console.error(`::error::${p}`);
  }
  if (found.length > 0) {
    console.error(
      `check-pr-body: ${found.length} problem(s); the description becomes the commit body on main, so fill in ${TEMPLATE}`,
    );
    process.exit(1);
  }
}
