import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardOf, handOffFields, inputsOf, readCard, withheld, type Role } from "../src/core/process/cards.js";
import { tempDir } from "./temp.js";

// the rulebook's own role cards, as chiyanram/skills ships them (crq/process/roles/)
const RULEBOOK_ROLES = join(import.meta.dirname, "..", "tests", "fixtures", "process", "rulebook-roles");
const ROLES: readonly Role[] = ["implementer", "test-first", "cleanup", "design-reviewer", "verify-pass"];

let root = "";
beforeEach(() => {
  root = tempDir("factory-cards-");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

// a process plugin holding these role cards
function plugin(cards: Readonly<Record<string, string>>): string {
  const dir = join(root, "rulebook", "skills", "crq", "process");
  mkdirSync(join(dir, "roles"), { recursive: true });
  writeFileSync(join(dir, "lanes.json"), JSON.stringify({ lanes: [{ lane: "tiny", approval: false }] }));
  for (const [role, text] of Object.entries(cards)) {
    writeFileSync(join(dir, "roles", `${role}.md`), text);
  }
  return join(root, "rulebook");
}

describe("role cards (#236)", () => {
  it("the engine runs alone: every role it starts has a built-in card that passes its check", async () => {
    for (const role of ROLES) {
      const card = await readCard([], role);
      expect(card).toMatchObject({ kind: "ok", value: { role, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    }
  });

  it("the rulebook's cards pass the engine's check, and the body is what the model reads", () => {
    for (const role of ROLES) {
      const text = readFileSync(join(RULEBOOK_ROLES, `${role}.md`), "utf8");
      const card = cardOf(role, text, "rulebook");
      expect(card.kind).toBe("ok");
      expect(card.kind === "ok" ? card.value.body : "").not.toContain("enforced_guardrails");
    }
  });

  it("the process plugin's card wins over the built-in one; another plugin without a process is passed over", async () => {
    const dir = plugin({ cleanup: "---\nrole: cleanup\ntools: [Read, Edit]\n---\n\nTidy the team's way.\n" });
    const other = join(root, "other");
    mkdirSync(other);
    const card = await readCard(
      [
        { label: "other", dir: other },
        { label: "rulebook@chiyanram", dir },
      ],
      "cleanup",
    );
    expect(card).toMatchObject({
      kind: "ok",
      value: { body: "Tidy the team's way.", from: expect.stringContaining("rulebook@chiyanram") },
    });
    // a role the plugin holds no card for keeps the built-in one
    expect(await readCard([{ label: "rulebook@chiyanram", dir }], "verify-pass")).toMatchObject({
      kind: "ok",
      value: { from: expect.stringContaining(join("prompts", "roles")) },
    });
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
    const dir = plugin({ "verify-pass": "---\nrole: verify-pass\ntools: [Read, Write]\n---\nx" });
    expect(await readCard([{ label: "p", dir }], "verify-pass")).toMatchObject({ kind: "failed" });
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

  // The rulebook's cards (chiyanram/skills, rulebook 1.1.2) name a question's own fields since #320; the first ledger
  // pilot run (#62) was refused on them.
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
        "---\nrole: verify-pass\ntools: [Read]\nhand_off: {id, bucket, why, severity}\n---\nx",
        "t",
      ),
    ).toMatchObject({ kind: "failed", reason: expect.stringContaining('"severity"') });
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
