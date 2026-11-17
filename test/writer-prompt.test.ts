import { describe, expect, it } from "vitest";
import { readCard } from "../src/core/process/cards.js";
import { commandArgv } from "../src/core/ready/command.js";
import { REPORT_INSTRUCTIONS } from "../src/core/report.js";
import { evidenceRules, FLOOR, FOREGROUND, PROJECT_INSTRUCTIONS, runPrompt } from "../src/core/writer/prompt.js";

describe("the writer's words", () => {
  it("points the test-first and fix runs at the person's answers in .factory/task.md (#486)", async () => {
    const card = await readCard([], "implementer");
    if (card.kind !== "ok") throw new Error(card.reason);
    for (const mode of ["test-first", "fix"] as const) {
      const text = runPrompt({
        card: card.value,
        mode,
        names: { ticket: "PROJ-1", branch: "factory/PROJ-1", head: "abc", base: "main" },
        tools: [],
      });
      expect(text).toContain("When .factory/task.md is there, it holds the person's answers to your last questions.");
    }
  });

  it("builds the prompt from the role card: its body, the run's task, the floor, the project's instructions and tools, then the report's schema (#232)", async () => {
    const card = await readCard([], "implementer");
    if (card.kind !== "ok") throw new Error(card.reason);
    const text = runPrompt({
      card: card.value,
      mode: "fix",
      names: { ticket: "PROJ-1", branch: "factory/PROJ-1", head: "abc", base: "main" },
      tools: ["Each file you edit is linted at once with: make lint-file."],
    });
    expect(
      text.startsWith(
        `${card.value.body}\n\nThis run builds ticket PROJ-1, on branch factory/PROJ-1 at head abc. Your contract is the approved spec in .factory/spec.md: the intent, the acceptance criteria and the design. When .factory/task.md is there, it holds the person's answers to your last questions.\n\n${FLOOR}\n\n${FOREGROUND}\n\n${PROJECT_INSTRUCTIONS}\n\nEach file you edit is linted at once with: make lint-file.\n\n`,
      ),
    ).toBe(true);
    expect(text).toContain(REPORT_INSTRUCTIONS);
    expect(text).not.toContain('"deferred"');
  });

  it("names the exact programs an evidence row may start with, and that its result is the command's output, in every mode (#444)", async () => {
    const card = await readCard([], "implementer");
    if (card.kind !== "ok") throw new Error(card.reason);
    const names = { ticket: "PROJ-1", branch: "b", head: "h", base: "main" };
    for (const mode of ["fix", "test-first", "rework", "cleanup"] as const) {
      const text = runPrompt({ card: card.value, mode, names, tools: [], programs: ["./gradlew"] });
      expect(text).toContain(`${FLOOR}\n${evidenceRules(["./gradlew"])}\n\n`);
    }
    expect(evidenceRules(["./gradlew"])).toContain(
      "grep, test, wc, ls, cat, head, tail, git (only diff, log, show, status, ls-files, rev-parse), ./gradlew.",
    );
    expect(evidenceRules([])).toContain("never the evidence for what a file says");
  });

  // a row quoted its pattern in double quotes with a backtick inside, which a shell runs as a command,
  // so the ready check refused it three times; the rule tells the writer to use single quotes, and its own example runs
  it("tells the writer to quote patterns with single quotes, and its example is a row the ready check runs (#62)", () => {
    const rules = evidenceRules(["./gradlew"]);
    expect(rules).toContain("Quote patterns with single quotes");
    const example = /\((grep -n -E '[^']*' README\.md)\)/.exec(rules)?.[1] ?? "";
    expect(commandArgv(example, ["./gradlew"])).toEqual({
      kind: "ok",
      value: ["grep", "-n", "-E", "^## Commands|^- `./gradlew", "README.md"],
    });
    expect(commandArgv('grep -n -E "^## Commands|^- `./gradlew" README.md', ["./gradlew"])).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("needs a shell"),
    });
  });

  it("tells the writer of every mode the floor and to keep its subagents and commands in the foreground (#192, #232)", async () => {
    const card = await readCard([], "implementer");
    if (card.kind !== "ok") throw new Error(card.reason);
    const modes = ["fix", "test-first", "rework", "ci", "merge", "cleanup"] as const;
    const names = { ticket: "PROJ-1", branch: "b", head: "h", base: "main" };
    const texts = modes.map((mode) => runPrompt({ card: card.value, mode, names, tools: [] }));
    expect(texts.filter((t) => !t.includes(FOREGROUND) || !t.includes(FLOOR))).toEqual([]);
  });

  // a done report has no free-text field, so a CI run that finds no cause in the code stops as blocked, where its
  // reason reaches the person, and never re-runs, waits out or drops a red check
  it("tells the CI run to find the root cause first, and to stop as blocked when it finds none in the code", async () => {
    const card = await readCard([], "implementer");
    if (card.kind !== "ok") throw new Error(card.reason);
    const text = runPrompt({
      card: card.value,
      mode: "ci",
      names: { ticket: "PROJ-1", branch: "b", head: "h", base: "main" },
      tools: [],
    });
    expect(text).toContain("First find the root cause in the failed job's log");
    expect(text).toContain("when it is in the code or a test, fix it");
    expect(text).toContain('change nothing and stop with "blocked"');
    expect(text).toContain("name the job, quote the log line and say what you checked");
    expect(text).toContain("Never re-run a job, add a sleep or a retry, or skip or delete a test");
    expect(text).not.toContain("change nothing and say so in the report");
  });
});
