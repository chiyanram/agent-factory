// retro/draft (#488 AC-2 drafts, AC-3; design Q9 A, Q11 A): `retro --draft` stages the failures' records, traces and
// the rules pack, runs the retro card once with a stubbed model, and the engine writes the drafts. The run gets the
// card's read-only tools, the stage as its folder, a $10 cap, no git host token and no skip-permissions flag; no code
// path in the pass or the loop reaches the retro.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { draftRetro, RETRO_USD, type DraftSetup } from "../src/core/retro/draft.js";
import { LESSON_SCHEMA } from "../src/core/retro/lesson.js";
import type { Failure } from "../src/core/retro/repeated.js";
import { claudeArgs, type Model, type ModelRun } from "../src/core/review/model.js";
import { claudeEnv } from "../src/core/review/settings.js";
import { tempDir } from "./temp.js";

const ROOT = join(import.meta.dirname, "..");
const LANES = readFileSync(join(ROOT, "tests", "fixtures", "process", "rulebook-lanes.json"), "utf8");
const CARD = [
  "---",
  "role: retro",
  "steps: [retro]",
  "input: the timeline record; the run records and transcripts",
  "must_not_see: none",
  "hand_off: .factory/retro.md {actions: one JSON list [{type: rule | script | check | playbook, owner, due: YYYY-MM-DD, ticket}]}",
  "tools: [Read, Grep, Glob]",
  "enforced_guardrails: read-only tools; runs only when a human starts it",
  "rules: [RT1, RT6]",
  "---",
  "",
  "# Retro",
  "",
  "Turn the failures into lessons.",
].join("\n");

const FAILURE: Failure = {
  kind: "rule",
  key: "MUST-forge-seam",
  tickets: ["12", "15"],
  cites: ["12 timeline 2026-11-01T12:00:00Z: MUST-forge-seam acted on 1"],
};

const LESSON = {
  failures: ["rule MUST-forge-seam"],
  cause: "the forge seam rule is prose; nothing fails when gh is called directly",
  level: "lint",
  actions: [{ type: "check", owner: "operator", due: "2026-12-01", ticket: "#700" }],
  rules_patch: "--- a/rules.md\n+++ b/rules.md\n@@ -1 +1 @@\n-old\n+new\n",
  case: { name: "must-forge-seam-again", files: [{ path: "case.md", text: "# a seeded case\n" }] },
  review_by: "2027-02-01",
};

let home = "";
let plugin = "";
beforeEach(() => {
  home = tempDir("factory-retro-draft-");
  plugin = join(home, "plugins", "rulebook");
  const process = join(plugin, "skills", "crq", "process");
  mkdirSync(join(process, "roles"), { recursive: true });
  writeFileSync(join(process, "lanes.json"), LANES);
  writeFileSync(join(process, "roles", "retro.md"), CARD);
  writeFileSync(join(plugin, "skills", "crq", "rules.md"), "old\n");
  symlinkSync("/etc/passwd", join(plugin, "skills", "crq", "outside"));
  const runs = join(home, "runs", "loans");
  mkdirSync(join(runs, "12"), { recursive: true });
  writeFileSync(join(runs, "12.jsonl"), '{"kind":"merged"}\n');
  writeFileSync(join(runs, "12", "writer-1.jsonl"), "{}\n");
  writeFileSync(join(runs, "15.jsonl"), '{"kind":"merged"}\n');
  writeFileSync(join(runs, "99.jsonl"), '{"kind":"merged"}\n');
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

// stub : a model that answers these lessons and keeps each run and what its folder held
function stub(lessons: readonly unknown[]): { model: Model; runs: ModelRun[]; seen: string[][] } {
  const runs: ModelRun[] = [];
  const seen: string[][] = [];
  const model: Model = (run) => {
    runs.push(run);
    seen.push(readdirSync(run.folder, { recursive: true }).map(String).toSorted());
    return Promise.resolve({ kind: "ok", value: { output: { lessons }, answer: {}, costUsd: 1.25, tokens: 10 } });
  };
  return { model, runs, seen };
}

const setup = (model: Model): DraftSetup => ({
  home,
  project: "loans",
  plugins: [{ label: "rulebook", dir: plugin }],
  model,
  modelName: "the-logic-model",
  now: () => Date.parse("2026-11-14T10:00:00Z"),
});

// onlyRun : the one model run there was
function onlyRun(runs: readonly ModelRun[]): ModelRun {
  expect(runs).toHaveLength(1);
  const [run] = runs;
  if (run === undefined) {
    throw new Error("no run");
  }
  return run;
}

describe("retro --draft", () => {
  it("runs the retro card once over a stage of the failures' records, traces and the pack, and writes the drafts", async () => {
    const s = stub([LESSON]);
    const made = await draftRetro(setup(s.model), [FAILURE]);
    expect(made).toEqual({
      kind: "ok",
      value: { dirs: [join(home, "retro", "loans", "2026-11-14", "1")], usd: 1.25 },
    });
    const run = onlyRun(s.runs);
    expect(run.folder.startsWith(join(home, "retro-runs", "loans-"))).toBe(true);
    expect(run.tools).toEqual(["Read", "Grep", "Glob"]);
    expect(run).toMatchObject({ maxUsd: RETRO_USD, schema: LESSON_SCHEMA, model: "the-logic-model" });
    expect(RETRO_USD).toBe("10");
    expect(run.prompt.startsWith("# Retro")).toBe(true);
    // only the failures' tickets, their traces, and the pack with no symlink out of it
    const staged = s.seen.flat();
    expect(staged).toEqual(
      expect.arrayContaining(["failures.json", "records/12.jsonl", "records/15.jsonl", "traces/12/writer-1.jsonl"]),
    );
    expect(staged).toContain("pack/rules.md");
    expect(staged.filter((f) => f.includes("99") || f.includes("outside"))).toEqual([]);
    // the stage is gone; the drafts are written by the engine
    expect(existsSync(run.folder)).toBe(false);
    const dir = join(home, "retro", "loans", "2026-11-14", "1");
    const lesson = readFileSync(join(dir, "lesson.md"), "utf8");
    expect(lesson).toContain("Review by: 2027-02-01");
    expect(lesson).toContain("- rule MUST-forge-seam: 12, 15");
    expect(lesson).toContain('"ticket": "#700"');
    expect(readFileSync(join(dir, "rules.patch"), "utf8")).toBe(LESSON.rules_patch);
    expect(readFileSync(join(dir, "case", "case.md"), "utf8")).toBe("# a seeded case\n");
  });

  it("gives the run no git host token and no skip-permissions flag, and only the three read tools", async () => {
    const s = stub([LESSON]);
    await draftRetro(setup(s.model), [FAILURE]);
    const args = claudeArgs(onlyRun(s.runs));
    expect(args.join(" ")).not.toMatch(/skip-permissions|bypass/i);
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
    expect(args[args.indexOf("--max-budget-usd") + 1]).toBe("10");
    const env = claudeEnv({ PATH: "/bin", GH_TOKEN: "t", GITLAB_TOKEN: "t", FACTORY_HOME: home, HOME: "/h" });
    expect(Object.keys(env).toSorted()).toEqual(["HOME", "PATH"]);
  });

  it("numbers the drafts after the ones already there that day", async () => {
    await draftRetro(setup(stub([LESSON]).model), [FAILURE]);
    const made = await draftRetro(setup(stub([LESSON, LESSON]).model), [FAILURE]);
    expect(made.kind === "ok" ? made.value.dirs.map((d) => d.slice(-1)) : []).toEqual(["2", "3"]);
  });

  it("writes nothing for a case path that climbs out, and runs no model when there is no failure", async () => {
    const bad = { ...LESSON, case: { name: "x", files: [{ path: "../../escape.md", text: "x" }] } };
    expect(await draftRetro(setup(stub([bad]).model), [FAILURE])).toMatchObject({ kind: "failed" });
    expect(existsSync(join(home, "retro"))).toBe(false);
    const none = stub([LESSON]);
    expect(await draftRetro(setup(none.model), [])).toEqual({ kind: "ok", value: { dirs: [], usd: 0 } });
    expect(none.runs).toHaveLength(0);
  });

  it("refuses with no rules pack, since there is no retro card to run", async () => {
    const s = stub([LESSON]);
    const made = await draftRetro({ ...setup(s.model), plugins: [] }, [FAILURE]);
    expect(made).toMatchObject({ kind: "failed", reason: expect.stringContaining("no retro card") });
    expect(s.runs).toHaveLength(0);
  });
});

// importsOf : the src modules a module imports, by path. Pure but for the read.
function importsOf(file: string): readonly string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/from "(\.[^"]+)\.js"/g)].map((m) => resolve(dirname(file), `${m[1] ?? ""}.ts`));
}

describe("nothing but a person's command starts a retro (#488 AC-3)", () => {
  it("no module the pass or the loop imports reaches the retro", () => {
    const starts = ["src/core/dispatch/tick.ts", "src/core/dispatch/orchestrator-loop.ts", "src/core/loop.ts"];
    const seen = new Set<string>();
    const todo = starts.map((f) => join(ROOT, f));
    while (todo.length > 0) {
      const file = todo.pop() ?? "";
      if (!seen.has(file) && existsSync(file)) {
        seen.add(file);
        todo.push(...importsOf(file));
      }
    }
    expect(seen.size).toBeGreaterThan(10);
    // the role card check reads the lesson schema (retro/lesson.ts), which runs nothing
    const runs = new Set(["src/core/retro/draft.ts", "src/core/retro/repeated.ts", "src/retro-cli.ts"]);
    expect([...seen].filter((f) => runs.has(relative(ROOT, f)))).toEqual([]);
  });
});
