// eval reviewer (#215; ADR-0015 E4, E7, E11): the harness on a small repository with an approved seeded case, an
// approved clean case and a draft, run with a fake model (and once with a fake agent CLI), so no model runs and nothing
// is spent. Covers the location gate and the judge's threshold, the results file, the drafts rule, the $100 cap before
// and during a pass, and the refusal in CI.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runCli } from "../src/app.js";
import { capped, costOf, dollars, purse, worstCase } from "../src/core/eval/budget.js";
import { choose, prText, specOf, type Case } from "../src/core/eval/cases.js";
import { evalReviewer, evalSettings, RUNS, type EvalSettings } from "../src/core/eval/harness.js";
import { isMatch, matchRun, nearby, readJudgment, type Judge } from "../src/core/eval/judge.js";
import { blobSha } from "../src/core/eval/results.js";
import type { ActOn } from "../src/core/review/act-on.js";
import type { Model, ModelResult, ModelRun } from "../src/core/review/model.js";
import { checkSpec } from "../src/core/spec.js";
import { tempDir } from "./temp.js";

const RULEBOOK = join(import.meta.dirname, "..", "tests", "fixtures", "pack", "rulebook");

let root = "";
let base = "";
let env: NodeJS.ProcessEnv = {};

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
}

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const LINES = Array.from({ length: 20 }, (_, i) => `export const v${i + 1} = ${i + 1};`).join("\n");

// a case: the change made on base and saved as change.patch, then undone
function addCase(name: string, edit: () => void, golden: readonly unknown[], pr: string): void {
  edit();
  const patch = git("diff");
  git("checkout", "-q", "--", ".");
  write(`evals/reviewer/${name}/base.sha`, `${base}\n`);
  write(`evals/reviewer/${name}/change.patch`, `${patch}\n`);
  write(`evals/reviewer/${name}/golden.json`, JSON.stringify(golden));
  write(`evals/reviewer/${name}/pr.md`, pr);
}

const SEED = { file: "src/a.ts", line: 10, issue: "v10 is off by one", severity: "blocker", category: "bug" };

function cases(status: { seeded: string; clean: string; draft: string }): void {
  write(
    "evals/reviewer/cases.md",
    [
      "| case | kind | what | source | status |",
      "|---|---|---|---|---|",
      `| \`seeded-one\` | seeded | v10 off by one | test | ${status.seeded} |`,
      `| \`clean-one\` | clean | a new constant | test | ${status.clean} |`,
      `| \`draft-one\` | seeded | a draft | test | ${status.draft} |`,
      "",
    ].join("\n"),
  );
}

beforeEach(() => {
  root = tempDir("factory-eval-");
  const home = join(root, "..", `${root.split("/").pop() ?? ""}-home`);
  mkdirSync(home);
  env = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: "1", FACTORY_HOME: join(home, ".factory") };
  git("init", "-q", "-b", "main");
  git("config", "user.name", "t");
  git("config", "user.email", "t@t");
  write("AGENTS.md", "# Root\n\nROOT-RULES\n");
  write("src/a.ts", `${LINES}\n`);
  write("src/b.ts", "export const b = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  base = git("rev-parse", "HEAD");
  addCase(
    "seeded-one",
    () => write("src/a.ts", `${LINES.replace("v10 = 10", "v10 = 11 /* SEEDED */")}\n`),
    [SEED],
    "# fix(a): v10 (#1)\n\nv10 is now right.\n\n## Acceptance criteria\n\n1. v10 is 10.\n",
  );
  addCase(
    "clean-one",
    () => write("src/b.ts", "export const b = 1;\nexport const c = 2; // CLEAN\n"),
    [],
    "# feat(b): c (#2)\n",
  );
  addCase(
    "draft-one",
    () => write("src/b.ts", "export const b = 2; // DRAFT\n"),
    [{ ...SEED, file: "src/b.ts", line: 1 }],
    "# x\n",
  );
  cases({ seeded: "approved", clean: "approved", draft: "draft" });
  git("add", "-A");
  git("commit", "-q", "-m", "golden set");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(env.HOME ?? "", { recursive: true, force: true });
});

type Fake = {
  // the line the finder reports on each case's file, by the marker in the diff; none for a marker not listed
  readonly lines: Readonly<Record<string, number>>;
  readonly confidence: number;
  readonly cost: number;
};

const finding = (file: string, line: number) => ({
  id: "F1",
  axis: "standards",
  kind: "rule",
  file,
  line,
  rule: "correctness",
  category: "bug",
  severity: "blocker",
  grade: "walked",
  evidence: "v10 = 11 at the line",
  finding: "v10 is 11, not 10",
  fix: "set it to 10",
});

// A fake model: the find pass reports one finding per marker in the pack's diff, the verify pass puts every finding in
// Act on, and the judge says same with the fake's confidence. Every run is recorded.
function fakeModel(f: Fake, seen: ModelRun[]): Model {
  return async (run): Promise<ModelResult> => {
    seen.push(run);
    const pack = existsSync(join(run.folder, "pack.md")) ? readFileSync(join(run.folder, "pack.md"), "utf8") : "";
    const output = run.schema.includes("confidence")
      ? { same: true, confidence: f.confidence, why: "same" }
      : run.schema.includes("verdicts")
        ? {
            verdicts: ids(readFileSync(join(run.folder, "findings.json"), "utf8")).map((id) => ({
              id,
              bucket: "act_on",
              why: "real",
            })),
          }
        : {
            findings: Object.entries(f.lines)
              .filter(([marker]) => pack.includes(marker))
              .map(([marker, line]) => finding(marker === "CLEAN" ? "src/b.ts" : "src/a.ts", line)),
          };
    return { kind: "ok", value: { output, answer: { usage: {} }, costUsd: f.cost, tokens: 1 } };
  };
}

// the ids in a findings.json the review wrote
function ids(text: string): readonly string[] {
  const list: unknown = JSON.parse(text);
  return Array.isArray(list) ? list.map((f: unknown) => String(Reflect.get(Object(f), "id"))) : [];
}

// one recorded argv of the fake agent CLI
function words(line: string): readonly string[] {
  const list: unknown = JSON.parse(line);
  return Array.isArray(list) ? list.map(String) : [];
}

function settings(over: Partial<EvalSettings> = {}): EvalSettings {
  return { ...evalSettings({}, { drafts: false }), ...over };
}

async function pass(model: Model, s: EvalSettings = settings()) {
  const log: string[] = [];
  const out = await evalReviewer({
    root,
    env,
    work: join(env.HOME ?? "", ".factory", "eval-x"),
    rulebook: RULEBOOK,
    model,
    settings: s,
    now: new Date("2026-11-09T10:00:00Z"),
    log: (l) => log.push(l),
  });
  return { out, log };
}

function results(path: string): Record<string, unknown> & {
  recall_at_act_on: { overall: { found: number; of: number; recall: number | null }; by_category: object };
  clean_floor: { hits: number };
  partial: boolean;
  partial_why: string[];
  proof: boolean;
  cost_usd: number;
  per_case: { case: string; runs: unknown[] }[];
  inputs: { head: string; prompts: Record<string, string>; models: Record<string, string>; rulebook: string };
  cases: { ran: string[]; skipped: { case: string; status: string }[] };
} {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("eval reviewer", { timeout: 60_000 }, () => {
  it("runs each approved case 3 times through the real review round and writes recall and the clean floor", async () => {
    const seen: ModelRun[] = [];
    const { out, log } = await pass(fakeModel({ lines: { SEEDED: 11, CLEAN: 2 }, confidence: 0.9, cost: 0.1 }, seen));
    expect(out.kind).toBe("ok");
    const path = out.kind === "ok" ? out.value.path : "";
    const head = git("rev-parse", "HEAD");
    expect(path).toBe(join(root, "evals", "reviewer", "results", `2026-11-09-${head.slice(0, 12)}.json`));
    const r = results(path);
    expect(r.recall_at_act_on.overall).toEqual({ found: RUNS, of: RUNS, recall: 1 });
    expect(r.recall_at_act_on.by_category).toEqual({ bug: { found: 3, of: 3, recall: 1 } });
    expect(r.clean_floor.hits).toBe(RUNS);
    expect(r.cases.ran).toEqual(["seeded-one", "clean-one"]);
    expect(r.cases.skipped).toEqual([{ case: "draft-one", status: "draft" }]);
    expect(r.partial).toBe(false);
    expect(r.proof).toBe(true);
    expect(r.inputs.head).toBe(head);
    expect(r.inputs.prompts.find).toBe(
      blobSha(readFileSync(join(import.meta.dirname, "..", "prompts", "review-find.md"))),
    );
    expect(r.inputs.prompts.judge).toMatch(/^[0-9a-f]{40}$/);
    expect(r.inputs.rulebook).toMatch(/^[0-9a-f]{40}$/);
    expect(r.inputs.models).toEqual({
      find: "claude-sonnet-5-5",
      rule: "claude-sonnet-5-5",
      logic: "claude-opus-5-5",
      judge: "claude-sonnet-5-5",
    });
    // per run: find, verify (rule); the seeded case's run also judges once
    expect(seen.filter((s) => s.schema.includes("confidence"))).toHaveLength(RUNS);
    expect(seen).toHaveLength(RUNS * 2 * 2 + RUNS);
    expect(seen.every((s) => s.maxUsd !== "")).toBe(true);
    expect(r.cost_usd).toBeCloseTo(seen.length * 0.1);
    expect(log.join("\n")).toContain("1 draft");
    // the pass's clones and run folders are gone
    expect(existsSync(join(env.HOME ?? "", ".factory", "eval-x"))).toBe(false);
  });

  it("matches only within 5 lines, and only when the judge is at least 0.7 sure", async () => {
    const far = await pass(fakeModel({ lines: { SEEDED: 16 }, confidence: 0.95, cost: 0 }, []));
    const unsure = await pass(fakeModel({ lines: { SEEDED: 15 }, confidence: 0.69, cost: 0 }, []));
    const sure = await pass(fakeModel({ lines: { SEEDED: 15 }, confidence: 0.7, cost: 0 }, []));
    const recallOf = (o: typeof far) =>
      results(o.out.kind === "ok" ? o.out.value.path : "").recall_at_act_on.overall.found;
    expect([recallOf(far), recallOf(unsure), recallOf(sure)]).toEqual([0, 0, RUNS]);
  });

  it("skips draft cases, refuses a pass with none approved, and runs drafts only when asked, never as proof", async () => {
    cases({ seeded: "draft", clean: "draft", draft: "draft" });
    const seen: ModelRun[] = [];
    const none = await pass(fakeModel({ lines: {}, confidence: 1, cost: 0 }, seen));
    expect(none.out).toMatchObject({ kind: "failed", reason: expect.stringContaining("approves a case") });
    expect(seen).toHaveLength(0);
    const drafts = await pass(fakeModel({ lines: {}, confidence: 1, cost: 0 }, seen), settings({ drafts: true }));
    const r = results(drafts.out.kind === "ok" ? drafts.out.value.path : "");
    expect(r.cases.ran).toEqual(["seeded-one", "clean-one", "draft-one"]);
    expect(r.drafts_included).toBe(true);
    expect(r.proof).toBe(false);
  });

  it("starts a pass whose worst case is over $100, and one that spends under the cap is not partial (#483)", async () => {
    const seen: ModelRun[] = [];
    const { out } = await pass(fakeModel({ lines: {}, confidence: 1, cost: 0 }, seen), settings({ runUsd: "20" }));
    expect(out).toMatchObject({ kind: "ok", value: { partial: false } });
    expect(seen.length).toBeGreaterThan(0);
  });

  it("stops before a round that might not fit under $100, never spends over it, and marks the result partial (#483)", async () => {
    const seen: ModelRun[] = [];
    const { out } = await pass(
      fakeModel({ lines: { SEEDED: 10 }, confidence: 1, cost: 15 }, seen),
      settings({ runUsd: "20" }),
    );
    const r = results(out.kind === "ok" ? out.value.path : "");
    expect(out).toMatchObject({ kind: "ok", value: { partial: true, proof: false } });
    // run 1 spent $45 (find, verify, judge at $15 each); run 2 might spend $60 more, so it never starts
    expect(r.cost_usd).toBe(45);
    expect(r.per_case.map((c) => [c.case, c.runs.length])).toEqual([["seeded-one", 1]]);
    expect(r.partial_why[0]).toContain("stopped at the $100 cap");
    expect(r.cases.skipped).toContainEqual({ case: "clean-one", status: "not run: the cap" });
  });

  it("refuses in CI, in a dry run, without a rulebook and with a model alias, and never starts the agent CLI", async () => {
    const io = (e: NodeJS.ProcessEnv, argv: readonly string[] = ["eval", "reviewer", root]) => {
      let err = "";
      return {
        run: () =>
          runCli(argv, {
            env: e,
            out: () => undefined,
            err: (t) => (err += t),
            readSecret: async () => "",
            readStdin: async () => "",
            system: {
              platform: "linux",
              uid: 1,
              gid: 1,
              run: async () => ({ code: 1, stdout: "", stderr: "" }),
              interactive: async () => 0,
              background: async () => ({ kind: "failed", reason: "no background in this test" }),
            },
          }),
        err: () => err,
      };
    };
    const full = { ...env, FACTORY_RULEBOOK: RULEBOOK, FACTORY_CLAUDE: "/nonexistent/claude" };
    for (const [e, why] of [
      [{ ...full, CI: "true" }, "never in CI"],
      [{ ...full, FACTORY_DRY_RUN: "1" }, "dry run"],
      [{ ...env }, "FACTORY_RULEBOOK"],
      [{ ...full, FACTORY_MAX_USD: "lots" }, "FACTORY_MAX_USD"],
      [
        { ...full, FACTORY_LOGIC_MODEL: "opus" },
        'FACTORY_LOGIC_MODEL must be a full model id, such as "claude-sonnet-5-5"',
      ],
      [{ ...full, FACTORY_JUDGE_MODEL: "sonnet" }, "FACTORY_JUDGE_MODEL must be a full model id"],
    ] as const) {
      const c = io(e);
      expect(await c.run()).toBe(1);
      expect(c.err()).toContain(why);
    }
    const usage = io(full, ["eval", "writer"]);
    expect(await usage.run()).toBe(64);
    expect(usage.err()).toContain("usage: agent-factory eval reviewer");
  });

  it("runs end to end through a fake agent CLI, which is called with a budget per run", async () => {
    const bin = join(env.HOME ?? "", "fake-claude.mjs");
    const calls = join(env.HOME ?? "", "calls.jsonl");
    writeFileSync(
      bin,
      `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
const schema = args[args.indexOf("--json-schema") + 1] ?? "";
const pack = existsSync("pack.md") ? readFileSync("pack.md", "utf8") : "";
let out;
if (schema.includes("confidence")) out = { same: true, confidence: 0.9, why: "same" };
else if (schema.includes("verdicts")) out = { verdicts: JSON.parse(readFileSync("findings.json", "utf8")).map((f) => ({ id: f.id, bucket: "act_on", why: "real" })) };
else out = { findings: pack.includes("SEEDED") ? [${JSON.stringify(finding("src/a.ts", 10))}] : [] };
// stream-json, as the real CLI prints it (#487): an event, the result, then a summary after it
process.stdout.write(JSON.stringify({ type: "system", subtype: "init" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", is_error: false, structured_output: out, total_cost_usd: 0.01, usage: { input_tokens: 1 } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "system", subtype: "task_summary" }) + "\\n");
`,
    );
    chmodSync(bin, 0o755);
    let out = "";
    let err = "";
    const code = await runCli(["eval", "reviewer", root], {
      env: { ...env, FACTORY_RULEBOOK: RULEBOOK, FACTORY_CLAUDE: bin },
      out: (t) => (out += t),
      err: (t) => (err += t),
      readSecret: async () => "",
      readStdin: async () => "",
      system: {
        platform: "linux",
        uid: 1,
        gid: 1,
        run: async () => ({ code: 1, stdout: "", stderr: "" }),
        interactive: async () => 0,
        background: async () => ({ kind: "failed", reason: "no background in this test" }),
      },
    });
    expect({ code, err: err.includes("agent-factory eval:") ? err : "" }).toEqual({ code: 0, err: "" });
    const r = results(out.trim());
    expect(r.recall_at_act_on.overall.recall).toBe(1);
    expect(r.clean_floor.hits).toBe(0);
    const argv = readFileSync(calls, "utf8").trim().split("\n").map(words);
    expect(argv.every((a) => a.includes("--max-budget-usd") && a.includes("--restricted"))).toBe(true);
    expect(argv.some((a) => a[a.indexOf("--max-budget-usd") + 1] === "0.50")).toBe(true);
    expect(readdirSync(join(env.HOME ?? "", ".factory")).filter((n) => n.startsWith("eval-"))).toEqual([]);
  });
});

describe("eval reviewer, the parts", () => {
  const act = (id: string, line: number, file = "src/a.ts"): ActOn => ({
    id,
    file,
    line,
    rule: "r",
    severity: "blocker",
    finding: "x",
    fix: "y",
  });
  const seed = { file: "src/a.ts", line: 10, issue: "i", severity: "blocker", category: "bug" } as const;

  it("gates by file and ±5 lines, nearest first, at most 3, and lets one finding match one seed", async () => {
    const list = [act("F1", 15), act("F2", 4), act("F3", 9), act("F4", 10, "src/b.ts"), act("F5", 11), act("F6", 12)];
    expect(nearby(seed, list, new Set()).map((f) => f.id)).toEqual(["F3", "F5", "F6"]);
    const judge: Judge = async () => ({ kind: "ok", value: { same: true, confidence: 1, why: "" } });
    const two = await matchRun([seed, seed], [act("F1", 10)], judge);
    expect(two.map((s) => s.matched)).toEqual([true, false]);
  });

  it("reads the judge's answer and holds the threshold at 0.7", () => {
    expect(readJudgment({ same: true, confidence: 2, why: "" }).kind).toBe("failed");
    expect(isMatch({ same: true, confidence: 0.7, why: "" })).toBe(true);
    expect(isMatch({ same: false, confidence: 0.99, why: "" })).toBe(false);
  });

  it("stops a judge that fails and records the seeds left", async () => {
    const judge: Judge = async () => ({ kind: "failed", reason: "cap" });
    const out = await matchRun([seed, seed], [act("F1", 10)], judge);
    expect(out.map((s) => s.error)).toEqual(["cap", "cap"]);
  });

  it("refuses a model run with no cap of its own, and one that would pass the cap", async () => {
    const p = purse(1);
    const ran: string[] = [];
    const model = capped(
      async (run) => (ran.push(run.maxUsd), { kind: "ok", value: { output: {}, answer: {}, costUsd: 0.4, tokens: 0 } }),
      p,
    );
    const run = (maxUsd: string) => model({ folder: "/", model: "m", schema: "{}", prompt: "", name: "n", maxUsd });
    expect((await run("0.5")).kind).toBe("ok");
    expect((await run("0.5")).kind).toBe("ok");
    expect(await run("0.5")).toMatchObject({ kind: "failed", reason: expect.stringContaining("$1 cap") });
    expect(ran).toEqual(["0.5", "0.5"]);
    expect(
      (await capped(model, purse(100))({ folder: "/", model: "m", schema: "{}", prompt: "", name: "n", maxUsd: "" }))
        .kind,
    ).toBe("failed");
    expect(dollars("")).toBe(Number.POSITIVE_INFINITY);
    expect(costOf({ kind: "failed", reason: "budget", answer: { total_cost_usd: 0.3 } })).toBe(0.3);
  });

  it("puts every model run at its cap in the worst case", () => {
    expect(worstCase({ seeds: [1, 0], runs: 3, runUsd: 2, judgeUsd: 0.5 })).toBe(3 * (6 + 1.5) + 3 * 6);
  });

  it("chooses approved cases, and drafts only when asked", () => {
    const rows = [
      { name: "a", kind: "seeded", status: "approved" },
      { name: "b", kind: "clean", status: "draft" },
    ];
    expect(choose(rows, false).run.map((r) => r.name)).toEqual(["a"]);
    expect(choose(rows, true).run.map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("makes a valid spec from pr.md, with its criteria or one plain one", () => {
    const c: Case = { name: "x", kind: "clean", status: "approved", base: "", patch: "", golden: [], pr: "" };
    expect(prText("# t (#1)\n\nbody\n")).toEqual({ title: "t (#1)", body: "body" });
    const plain = checkSpec(specOf(c));
    const withCriteria = checkSpec(specOf({ ...c, pr: "# t\n\nwhy\n\n## Acceptance criteria\n\n1. one\n2. two\n" }));
    expect(plain.kind === "ok" ? plain.spec.criteria.length : 0).toBe(1);
    expect(withCriteria.kind === "ok" ? [withCriteria.spec.intent, withCriteria.spec.criteria] : []).toEqual([
      "why",
      ["one", "two"],
    ]);
  });
});
