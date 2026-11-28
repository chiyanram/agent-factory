import { describe, expect, it } from "vitest";
import { readRules } from "../src/core/review/rules.js";

function pointers(text: string): unknown {
  const read = readRules({ path: "AGENTS.md", text });
  return read.kind === "ok" ? read.rules.pointers : read;
}

describe("readRules: a rulebook pointer names a skill (#936)", () => {
  it("AC-1 reads the one-line form as a pointer to the skill", () => {
    expect(pointers("- Java: use the `code` skill (rulebook plugin).\n")).toEqual([{ skill: "code", dropped: [] }]);
  });

  it("AC-2 reads a list under a rulebook line that names no skill, one pointer per skill", () => {
    const ledger = [
      "## Read when relevant",
      "",
      "Use the named skill (rulebook plugin) before you act.",
      "",
      "- Java code, Spring beans and configuration, errors and failure paths: the `code` skill.",
      "- A test, its tier, Spock specs and integration tests: the `testing` skill.",
      "- A Flyway migration: the `migrations` skill.",
      "- Log calls: the `obs` skill.",
      "",
    ].join("\n");
    expect(pointers(ledger)).toEqual([
      { skill: "code", dropped: [] },
      { skill: "testing", dropped: [] },
      { skill: "migrations", dropped: [] },
      { skill: "obs", dropped: [] },
    ]);
  });

  it("AC-2 reads no list without a rulebook line, so a plain mention of a skill is not a rule", () => {
    expect(pointers("- Tests: see the `testing` skill.\n")).toEqual([]);
  });

  it("AC-3 stops on a rulebook line that names no skill, with the form to write", () => {
    expect(readRules({ path: "svc/AGENTS.md", text: "The rest is in the rulebook (rulebook plugin).\n" })).toEqual({
      kind: "failed",
      reason:
        'svc/AGENTS.md: a "(rulebook plugin)" line names no skill; write each as: use the `<skill>` skill (rulebook plugin)',
    });
  });

  it("AC-4 keeps the skill of an old pointer that names a reference, wrapped or plural, and drops each reference", () => {
    const text =
      "- Tests: use the `testing` skill (rulebook plugin) and read\n  its `llm-tests` reference.\n" +
      "- Both: use the `code` skill (rulebook plugin) and read its `errors` and `smells` references.\n" +
      "- Again: use the `code` skill (rulebook plugin).\n";
    expect(pointers(text)).toEqual([
      { skill: "testing", dropped: ["llm-tests"] },
      { skill: "code", dropped: ["errors", "smells"] },
    ]);
  });

  it("AC-4 reads no reference past the end of the pointer's sentence", () => {
    expect(pointers("Use the `code` skill (rulebook plugin). The `x` reference is a word here.\n")).toEqual([
      { skill: "code", dropped: [] },
    ]);
  });
});
