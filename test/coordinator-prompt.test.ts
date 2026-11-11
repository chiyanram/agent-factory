// the coordinator's instructions (#486): no retro trigger of its own, one short session per topic, and the source of
// every stated fact named; and the four problems the split must avoid (the comments on #486)
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const prompt = readFileSync(join(ROOT, "prompts", "coordinator.md"), "utf8");
const reference = readFileSync(join(ROOT, "docs", "reference", "orchestrator.md"), "utf8");

describe("prompts/coordinator.md (#486)", () => {
  it("AC-4: holds no retro trigger of its own; a retro runs when a person starts it", () => {
    expect(prompt).not.toMatch(/one merge in ten|one in ten/i);
    expect(prompt).toContain("A retro runs only when a person starts it");
  });

  it("AC-6: one short session per topic, started from the factory's state, and every fact's source named", () => {
    expect(prompt).toContain("One short session per topic or ticket.");
    expect(prompt).toContain("Name the source of every fact.");
  });

  it("says a red check is never re-run by the factory, here and in the orchestrator reference", () => {
    for (const text of [prompt, reference]) {
      expect(text).not.toMatch(/flaky job gets a rerun|not rerun yet/);
    }
    expect(reference).toContain("A red check is a fail: the factory\nnever re-runs it");
  });

  it("keeps the by-hand duties the orchestrator does not do yet, each behind the person's yes, until #497", () => {
    expect(prompt.replace(/\s+/g, " ")).toContain(
      "**Today:** you still run `agent-factory block`, `reconcile`, `claim` and `release` by hand where the orchestrator does not yet, each only with the person's yes, until #497 removes them.",
    );
  });

  it("the reference says how many questions a round holds and that only the writer's round gives answers", () => {
    const flat = reference.replace(/\s+/g, " ");
    expect(flat).toContain("`asked` with one to twenty `questions` (`MOST_QUESTIONS`)");
    expect(flat).not.toContain("one to five");
    expect(flat).toContain("The answers come only from the newest `[writer] OPEN:` round");
  });

  it("marks the rewrite untested by an eval (P11)", () => {
    expect(prompt).toContain("**Untested by an eval** (P11)");
  });
});
