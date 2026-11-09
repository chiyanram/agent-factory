import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardOf, readCard, type Role } from "../src/core/process/cards.js";
import { tempDir } from "./temp.js";

// the rulebook's own role cards, as chiyanram/skills ships them (crq/process/roles/)
const RULEBOOK_ROLES = join(import.meta.dirname, "..", "tests", "fixtures", "process", "rulebook-roles");
const ROLES: readonly Role[] = ["design-reviewer", "verify-pass", "cleanup"];

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
