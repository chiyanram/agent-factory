import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { placeholders, problems, TEMPLATE } from "../scripts/check-pr-body.js";

const template = readFileSync(TEMPLATE, "utf8");

const FILLED = [
  "Why: a stale approval let a changed spec build; it now cannot. Spec: #56",
  "",
  "Breaking change: no",
  "Rollback: revert this PR; no data changes.",
  "Where to look: approvedAt in src/core/approve.ts.",
  "",
  "## Checklist",
  "",
  "- [x] Tests: test/approve.test.ts, failing without the change",
  "* [X] Docs: none, because no page describes the check",
  "",
  "Closes #56",
].join("\n");

describe("check-pr-body", () => {
  it("passes a description with every line filled in", () => {
    expect(problems(FILLED, template)).toEqual([]);
  });

  it("fails the template as it stands, on each placeholder and each checklist item", () => {
    const found = problems(template, template);
    expect(found.filter((p) => p.startsWith("the placeholder "))).toHaveLength(placeholders(template).length);
    expect(found.filter((p) => p.includes("is not ticked"))).toHaveLength(template.match(/^- \[ \]/gm)?.length ?? 0);
  });

  it("fails an empty description on the why line and each label line", () => {
    expect(problems("", template)).toEqual([
      'the first line must be "Why: " and the reason for the change, in one sentence',
      'the "Breaking change:" line is missing or has no answer',
      'the "Rollback:" line is missing or has no answer',
      'the "Where to look:" line is missing or has no answer',
    ]);
  });

  it("names a label line that is missing or has no answer", () => {
    const body = FILLED.replace("Rollback: revert this PR; no data changes.", "Rollback:").replace(
      "Where to look: approvedAt in src/core/approve.ts.\n",
      "",
    );
    expect(problems(body, template)).toEqual([
      'the "Rollback:" line is missing or has no answer',
      'the "Where to look:" line is missing or has no answer',
    ]);
  });

  it("names each placeholder left and each unticked box by its line", () => {
    const body = FILLED.replace("Spec: #56", "Spec: #<the approved spec; in the tiny lane, the ticket>").replace(
      "- [x] Tests",
      "- [ ] Tests",
    );
    expect(problems(body, template)).toEqual([
      "the placeholder <the approved spec; in the tiny lane, the ticket> is still there: replace it",
      "line 9 is not ticked: answer it, then tick it: - [ ] Tests: test/approve.test.ts, failing without the change",
    ]);
  });

  it("allows angle brackets the template does not hold, such as a type or an HTML tag", () => {
    expect(problems(`${FILLED}\n\n<details>Result<string></details>`, template)).toEqual([]);
  });
});
