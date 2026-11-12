// the coordinator's instructions (#486): no retro trigger of its own, one short session per topic, and the source of
// every stated fact named; and the four problems the split must avoid (the comments on #486)
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { runCli } from "../src/app.js";
import { tempDir } from "./temp.js";

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

// #517 AC-4: every command the prompt tells the coordinator to run parses: none exits 64 (usage)
describe("the commands prompts/coordinator.md names (#517)", () => {
  // a sample value for each placeholder the prompt writes
  const SAMPLES: Readonly<Record<string, string>> = {
    "<project>": "ledger",
    "<ticket>": "PROJ-1",
    "<issue number>": "12",
    "<pr>": "12",
    "<sha>": "aaaa1111",
    "<file>": "/nonexistent/questions.json",
    "<spec hash>": "a".repeat(64),
  };

  // commands : each `agent-factory …` the prompt writes with its words, placeholders filled, an optional [<…>] left out;
  // a bare command name in prose ("`agent-factory status` to post one status line") names a command, not a form to run
  function commands(text: string): readonly (readonly string[])[] {
    return [...text.matchAll(/`agent-factory ([^`]+)`/g)]
      .map((m) =>
        (m[1] ?? "")
          .replace(/\s+/g, " ")
          .replace(/\s*\[<[^\]]*>\]/g, "")
          .trim(),
      )
      .map((c) =>
        Object.entries(SAMPLES)
          .reduce((t, [k, v]) => t.replaceAll(k, v), c)
          .split(" "),
      )
      .filter((words) => words.length >= 2);
  }

  async function exitOf(argv: readonly string[]): Promise<{ readonly code: number; readonly err: string }> {
    const home = tempDir("factory-prompt-commands-");
    let err = "";
    try {
      const code = await runCli(argv, {
        env: { FACTORY_HOME: home },
        out: () => undefined,
        err: (t) => (err += t),
        readSecret: async () => "",
        readStdin: async () => "",
        system: {
          platform: "linux",
          uid: process.getuid?.() ?? -1,
          gid: process.getgid?.() ?? -1,
          run: async () => ({ code: 1, stdout: "", stderr: "no CLI in this test" }),
          interactive: async () => 0,
          background: async () => ({ kind: "ok", value: 4242 }),
        },
      });
      return { code, err };
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  it("finds the forms the prompt names, grill and the session start among them", () => {
    const named = commands(prompt).map((w) => w.join(" "));
    expect(named).toContain("grill ledger 12 aaaa1111 /nonexistent/questions.json");
    expect(named).toContain("poll ledger");
    expect(named.length).toBeGreaterThanOrEqual(8);
  });

  it("AC-4: each parses: none exits 64 (usage); one may still fail for want of a project or a spec", async () => {
    const usage: string[] = [];
    for (const argv of commands(prompt)) {
      const ran = await exitOf(argv);
      if (ran.code === 64) {
        usage.push(`agent-factory ${argv.join(" ")}: ${ran.err.trim()}`);
      }
    }
    expect(usage).toEqual([]);
  });
});
