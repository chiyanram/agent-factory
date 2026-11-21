// check-pr-body — the description of a pull request that is ready for review holds the template's lines, filled in.
// The squash merge makes the description the commit body on main, where it cannot be edited, so CI checks it before
// the merge. A problem is:
//
//   why          the first line is not "Why: " and a reason
//   line         a "Breaking change:", "Rollback:" or "Where to look:" line is missing or has no answer
//   placeholder  a <placeholder> of .github/pull_request_template.md is still in the description
//   unticked     a checklist item is not ticked: answer its line, then tick it
//   breaking     "Breaking change: yes", a "BREAKING CHANGE:" footer and a "!" after the title's scope disagree:
//                semantic-release reads only the footer and the "!", so a yes without them ships as a minor release
//
//   gh pr view <N> --json body -q .body | PR_TITLE="<title>" node scripts/check-pr-body.ts [ROOT]     (pr-body)
//
// Without PR_TITLE the title's "!" is not checked.
//
// The same rule as chiyanram/skills' scripts/pr_body.py. Runs on Node's type stripping (Node 22.18+), so it uses only
// erasable TypeScript.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const TEMPLATE = ".github/pull_request_template.md";

const LABELS: readonly string[] = ["Breaking change:", "Rollback:", "Where to look:"];
const PLACEHOLDER = /<[^<>\n]+>/g;
const UNTICKED = /^\s*[-*] \[ \]/;
const SAYS_YES = /^Breaking change:\s*yes\b/i;
const FOOTER = /^BREAKING CHANGE: \S/;
const BANG = /^[a-z]+\([^)]*\)!: /;

export function placeholders(template: string): readonly string[] {
  return [...new Set(template.match(PLACEHOLDER) ?? [])];
}

export function problems(body: string, template: string, title = ""): readonly string[] {
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  return [...why(lines), ...answered(lines), ...left(body, template), ...unticked(lines), ...breaking(lines, title)];
}

function breaking(lines: readonly string[], title: string): readonly string[] {
  const yes = lines.some((l) => SAYS_YES.test(l));
  return [
    ...footerAgrees(
      yes,
      lines.some((l) => FOOTER.test(l)),
    ),
    ...(title === "" ? [] : titleAgrees(yes, title)),
  ];
}

function footerAgrees(yes: boolean, footer: boolean): readonly string[] {
  if (yes === footer) {
    return [];
  }
  return yes
    ? ['the "Breaking change:" line says yes: add a "BREAKING CHANGE: " footer, what breaks and what to do']
    : ['there is a "BREAKING CHANGE:" footer: the "Breaking change:" line must say yes'];
}

function titleAgrees(yes: boolean, title: string): readonly string[] {
  if (yes === BANG.test(title)) {
    return [];
  }
  return yes
    ? ['the "Breaking change:" line says yes: add "!" after the title\'s scope']
    : ['the title has "!" after its scope: the "Breaking change:" line must say yes'];
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
  const title = process.env.PR_TITLE ?? "";
  const found = problems(readFileSync(0, "utf8"), readFileSync(join(root, TEMPLATE), "utf8"), title);
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
