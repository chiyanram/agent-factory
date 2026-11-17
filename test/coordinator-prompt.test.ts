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

  it("AC-6: started from the factory's state, and every fact's source named", () => {
    expect(prompt).toContain("Name the source of every fact.");
  });

  // one long coordinator per project, reset from a note built by code; ticket work in fresh ticket sessions
  it("is the project coordinator, which resets from the handoff note and never from a model's summary", () => {
    const flat = prompt.replace(/\s+/g, " ");
    expect(prompt).not.toContain("One short session per topic or ticket.");
    expect(flat).toContain("You are the **project coordinator**");
    expect(flat).toContain("each ticket's work runs in its own fresh **ticket session**");
    expect(flat).toContain("never from a model's summary of the chat");
    expect(flat).toContain("I stop coordinating now; start a fresh coordinator from `agent-factory handoff");
  });

  it("opens every reply with what waits on the person, then what is running, in short lines (the narration rule)", () => {
    expect(prompt.replace(/\s+/g, " ")).toContain(
      "Open every reply with what waits on the person, then what is running, one short line per ticket",
    );
  });

  it("relays the person's exact words, never a START or an approval, and falls back when a relay is refused", () => {
    const flat = prompt.replace(/\s+/g, " ");
    expect(flat).toContain("quote their exact words, with where and when they said them");
    expect(flat).toContain("A relay never writes a START or an approval");
    expect(flat).toContain("Never rephrase a relay or send it twice");
  });

  it("relays answers only; an approval, an acceptance, a waiver or a push yes is typed by the person (#749)", () => {
    const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8").replace(/\s+/g, " ");
    const flat = prompt.replace(/\s+/g, " ");
    expect(flat).toContain(
      "Never relay a spec or design approval, an ADR acceptance, a waiver, or a yes to a commit or push",
    );
    expect(flat).toContain("send them the ticket session's link and ask them to type it there");
    expect(flat).toContain('answers "type it here" in one line and keeps `waiting:operator`');
    expect(flat).toContain(
      "Never write one of them on the git host yourself, where your comment can carry the person's login",
    );
    expect(agents).toContain("never relayed and never posted by a model");
    expect(agents).toContain("Take a relayed answer only to a grill round or a run's question");
    expect(agents).toContain('answer "type it here" in one line and keep `waiting:operator`');
    for (const text of [flat, agents]) {
      expect(text).not.toMatch(
        /approve a spec in the ticket's comment|say yes to a commit and push|A relay can approve/,
      );
    }
  });

  it("starts every relay with its ticket number and keeps no ticket facts", () => {
    const flat = prompt.replace(/\s+/g, " ");
    expect(flat).toContain("start with the ticket number");
    expect(flat).toContain("`#<ticket>: Operator, <date>, in the coordinator");
    expect(flat).toContain("Keep no ticket's facts");
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
          agent: async () => ({ code: 127, stdout: "", stderr: "no agent CLI in this test" }),
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
    // the session starts with the reset note, which holds the board
    expect(named).toContain("handoff ledger");
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
