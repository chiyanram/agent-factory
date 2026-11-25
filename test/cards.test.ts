import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardOf, handOffFields, inputsOf, readCard, withheld, type Role } from "../src/core/process/cards.js";
import { tempDir } from "./temp.js";

const ROLES: readonly Role[] = [
  "implementer",
  "test-first",
  "cleanup",
  "design-reviewer",
  "verify-pass",
  "retro",
  "onboarder",
];

let root = "";
beforeEach(() => {
  root = tempDir("factory-cards-");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function cardsDir(cards: Readonly<Record<string, string>>): string {
  const dir = join(root, "cards");
  mkdirSync(dir, { recursive: true });
  for (const [role, text] of Object.entries(cards)) {
    writeFileSync(join(dir, `${role}.md`), text);
  }
  return dir;
}

describe("role cards (#236)", () => {
  it("the engine runs alone: every role it starts has a built-in card that passes its check", async () => {
    for (const role of ROLES) {
      const card = await readCard(role);
      expect(card).toMatchObject({ kind: "ok", value: { role, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    }
  });

  it("the body the model reads holds none of the card's frontmatter", async () => {
    for (const role of ROLES) {
      const card = await readCard(role);
      expect(card.kind === "ok" ? card.value.body : "").not.toContain("enforced_guardrails");
    }
  });

  it("a card for the wrong role, with no frontmatter, or asking for a tool its role does not get is refused", async () => {
    expect(cardOf("design-reviewer", "---\nrole: cleanup\n---\nx", "p")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining('names the role "cleanup"'),
    });
    expect(cardOf("cleanup", "# Cleanup\n", "p")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("frontmatter"),
    });
    expect(
      cardOf("design-reviewer", "---\nrole: design-reviewer\ntools: [Read, Edit, Bash]\n---\nx", "p"),
    ).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("asks for Edit, Bash"),
    });
    const dir = cardsDir({ "verify-pass": "---\nrole: verify-pass\ntools: [Read, Write]\n---\nx" });
    expect(await readCard("verify-pass", dir)).toMatchObject({ kind: "failed" });
  });
});

describe("role card frontmatter, enforced (#232)", () => {
  const card = (front: string) => cardOf("implementer", `---\nrole: implementer\n${front}\n---\n\nBuild it.\n`, "team");

  it("a card must name its tools; the run gets the card's tools, by name alone", () => {
    expect(card("steps: [build]")).toMatchObject({ kind: "failed", reason: expect.stringContaining("names no tools") });
    expect(card("tools: [Read, Edit (src only), Read]")).toMatchObject({
      kind: "ok",
      value: { tools: ["Read", "Edit"] },
    });
  });

  it("reads each field a hand-off names in braces, at the brace's own level", () => {
    expect(
      handOffFields(
        "commits, and .factory/report.json {status: done, evidence: [rows, run again]} or {status: asked, questions}",
      ),
    ).toEqual(["status", "evidence", "status", "questions"]);
    expect(handOffFields("the spec, in the spec home")).toEqual([]);
  });

  it("takes the rulebook's hand-offs, a question's fields included", () => {
    const hands: ReadonlyArray<readonly [Role, string]> = [
      [
        "implementer",
        "commits, .factory/report.json {status: done, evidence: [evidence rows]} or {status: asked, questions: [{question, choices, recommended}]} or {status: blocked, blocker}, and .factory/pr.md",
      ],
      [
        "test-first",
        "one commit with the failing test, and .factory/report.json {status: done, evidence: [one evidence row]} or {status: asked, questions: [{question, choices, recommended}]}",
      ],
      [
        "cleanup",
        "commits, and .factory/report.json {status: done, evidence: [the evidence rows, run again], deferred: [each cleanup that would change behaviour]}",
      ],
    ];
    for (const [role, hand] of hands) {
      expect(cardOf(role, `---\nrole: ${role}\ntools: [Read]\nhand_off: ${hand}\n---\nx`, "rulebook")).toMatchObject({
        kind: "ok",
      });
    }
  });

  it("refuses a hand-off that names a field the engine's schema for the role does not have", () => {
    expect(card("tools: [Read]\nhand_off: .factory/report.json {status: done, evidence, pr_title}")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining('names "pr_title", which the engine\'s implementer schema does not have'),
    });
    expect(
      cardOf(
        "verify-pass",
        "---\nrole: verify-pass\ntools: [Read]\nhand_off: {id, bucket, why, confidence}\n---\nx",
        "t",
      ),
    ).toMatchObject({ kind: "failed", reason: expect.stringContaining('"confidence"') });
  });

  it("keeps the role's must_not_see floor, whatever the card says, and adds the card's own entries", () => {
    const none = card("tools: [Read]\nmust_not_see: none");
    const own = card("tools: [Read]\nmust_not_see: the failed CI jobs; the design");
    expect(none).toMatchObject({
      kind: "ok",
      value: { mustNotSee: ["review findings other than the act_on list", "earlier verdicts"] },
    });
    expect(own).toMatchObject({ kind: "ok", value: { mustNotSee: expect.arrayContaining(["the design"]) } });
  });

  it("leaves out what an entry names, unless its 'other than' names it too", () => {
    const actOn = { names: ["the act_on list", "review findings"], needed: true } as const;
    const report = { names: ["the implementer's report"], needed: false } as const;
    expect(withheld({ mustNotSee: ["review findings other than the act_on list"] }, actOn)).toBe(false);
    expect(withheld({ mustNotSee: ["review findings"] }, actOn)).toBe(true);
    expect(withheld({ mustNotSee: ["The implementer's report or account"] }, report)).toBe(true);
    expect(withheld({ mustNotSee: ["the implementer's work"] }, report)).toBe(false);
  });

  it("refuses a card that leaves out an input the run needs, and drops one it can do without", () => {
    const read = cardOf(
      "verify-pass",
      "---\nrole: verify-pass\ntools: [Read]\nmust_not_see: the code; the findings\n---\nx",
      "team",
    );
    if (read.kind !== "ok") throw new Error(read.reason);
    const code = { names: ["the code"], needed: false } as const;
    const findings = { names: ["the design-reviewer's findings", "the findings"], needed: true } as const;
    expect(inputsOf(read.value, [code])).toEqual({ kind: "ok", value: [] });
    expect(inputsOf(read.value, [code, findings])).toMatchObject({
      kind: "failed",
      reason: "team: its must_not_see leaves out the design-reviewer's findings, which the verify-pass run needs",
    });
  });
});

describe("role card guardrails and edit scope (#424)", () => {
  const card = (role: Role, front: string) => cardOf(role, `---\nrole: ${role}\n${front}\n---\n\nx\n`, "team");

  it("refuses a guardrail ID that is not on the engine's list", () => {
    expect(card("implementer", "tools: [Read]\nenforced_guardrails: [no-push, tests-green]")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining('"tests-green", which is not a guardrail ID'),
    });
  });

  it("refuses an ID the role cannot have, and edit-scope with no Edit(…) path", () => {
    expect(card("verify-pass", "tools: [Read]\nenforced_guardrails: [judge-files-locked]")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("the verify-pass cannot have the guardrail judge-files-locked"),
    });
    expect(card("implementer", "tools: [Read, Edit]\nenforced_guardrails: [edit-scope]")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("no Edit(…) path"),
    });
  });

  it("keeps the role's floor, whatever the card names, and adds edit-scope for an Edit(…) path", () => {
    const read = card("test-first", "tools: [Read, Edit(src/test/**), Edit(**/*.test.ts)]\nenforced_guardrails: []");
    expect(read).toMatchObject({
      kind: "ok",
      value: {
        tools: ["Read", "Edit"],
        editScope: ["src/test/**", "**/*.test.ts"],
        guardrails: ["no-push", "no-web", "no-credentials", "edit-scope"],
      },
    });
  });

  it("refuses a path scope on a tool other than Edit; a note with a space is text", () => {
    expect(card("implementer", "tools: [Read(src/**)]")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("only Edit takes a path scope; the card gives Read(src/**)"),
    });
    expect(card("implementer", "tools: [Edit (test files only)]")).toMatchObject({
      kind: "ok",
      value: { tools: ["Edit"], editScope: [] },
    });
  });

  it("reads the old plain-text guardrails and next for one release, and ignores them", () => {
    expect(
      card("cleanup", "tools: [Read]\nenforced_guardrails: the test checks; no push\nnext: the ready check"),
    ).toMatchObject({
      kind: "ok",
      value: { guardrails: ["no-push", "no-web", "no-credentials", "judge-files-locked"] },
    });
  });
});

describe("test-first's edit scope and the onboarder's tools (#688)", () => {
  const card = (role: Role, front: string) => cardOf(role, `---\nrole: ${role}\n${front}\n---\n\nx\n`, "team");

  it("gives the built-in test-first card edit-scope from the role's floor", async () => {
    const builtIn = await readCard("test-first");
    expect(builtIn).toMatchObject({ kind: "ok", value: { guardrails: expect.arrayContaining(["edit-scope"]) } });
  });

  it("lets test-first name edit-scope with no Edit(…) path: its scope is the project's test files", () => {
    expect(card("test-first", "tools: [Read, Edit]\nenforced_guardrails: [edit-scope]")).toMatchObject({
      kind: "ok",
      value: { editScope: [], guardrails: ["no-push", "no-web", "no-credentials", "edit-scope"] },
    });
  });

  it("refuses an onboarder card that asks for Bash, and keeps the onboarder read-only", () => {
    expect(card("onboarder", "tools: [Read, Grep, Glob, Bash]\nenforced_guardrails: []")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("the onboarder gets only Read, Grep, Glob; the card asks for Bash"),
    });
    expect(card("onboarder", "tools: [Read, Grep, Glob]\nenforced_guardrails: []")).toMatchObject({
      kind: "ok",
      value: { guardrails: ["read-only"] },
    });
  });
});
