// check-eval-proof (#217; ADR-0015 E10): each pure check on a planted bad results file or baseline, then the script on
// a fresh git repository whose branch changes a reviewer input.
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  BASELINE,
  LABEL,
  approvalProblems,
  baseRef,
  baselineProblems,
  isReviewerInput,
  labelsOf,
  nameStatus,
  passProblems,
  proofProblems,
  packHashOf,
  rulesPackProblems,
  type Facts,
} from "../scripts/check-eval-proof.js";
import { treeHash } from "../src/core/process/pins.js";
import { tempDir } from "./temp.js";

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "check-eval-proof.ts");
const HEAD = "a".repeat(40);
const SHAS = { find: "1".repeat(40), verify: "2".repeat(40), judge: "3".repeat(40) };
const MODELS = {
  find: "claude-sonnet-5-5",
  rule: "claude-sonnet-5-5",
  logic: "claude-opus-5-5",
  judge: "claude-sonnet-5-5",
};

function pass(over: Record<string, unknown> = {}, found = 8, hits = 0): Record<string, unknown> {
  return {
    version: 1,
    head: HEAD,
    partial: false,
    proof: true,
    aim: "quality",
    cost_usd: 8,
    inputs: { head: HEAD, models: MODELS, prompts: SHAS, rulebook: "unknown" },
    recall_at_act_on: { overall: { found, of: 10, recall: found / 10 } },
    clean_floor: { hits, findings: [] },
    per_case: [],
    ...over,
  };
}

function baseline(over: Record<string, unknown> = {}): Record<string, unknown> {
  const run = (n: number, matched: number, usd: number) => ({
    run: n,
    error: "",
    cost_usd: usd,
    seeds: Array.from({ length: 5 }, (_, k) => ({ seed: k, matched: k < matched })),
  });
  const perCase = [{ case: "c", kind: "seeded", seeds: 5, error: "", runs: [run(1, 2, 4), run(2, 3, 5)] }];
  return pass({ aim: null, cost_usd: 9, per_case: perCase, ...over }, 5);
}

const RESULT = "evals/reviewer/results/2026-11-09-aaaaaaaaaaaa.json";
const OLD_PACK = "e".repeat(40);
const NEW_PACK = "f".repeat(40);
const packJson = (commit: string) => JSON.stringify({ repo: "r", commit, tag: "rulebook--v9.0.0" });
const PACK_PIN = packJson(OLD_PACK);

function facts(over: Partial<Facts> = {}): Facts {
  return {
    changed: ["prompts/review-find.md", RESULT],
    added: [RESULT],
    results: new Map([[RESULT, JSON.stringify(pass())]]),
    baseline: JSON.stringify(baseline()),
    prompts: SHAS,
    models: MODELS,
    onBranch: (sha) => sha === HEAD,
    labels: undefined,
    rulesPack: { before: PACK_PIN, after: PACK_PIN },
    pinProofs: new Map(),
    packHash: undefined,
    ...over,
  };
}

describe("isReviewerInput", () => {
  it("is the find and verify prompts and the judge, not the writer's prompts", () => {
    expect(
      ["prompts/review-find.md", "prompts/review-verify.md", "prompts/eval-judge.md"].map(isReviewerInput),
    ).toEqual([true, true, true]);
    expect(["prompts/writer.md", "src/core/review/round.ts", "evals/reviewer/cases.md"].map(isReviewerInput)).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("proofProblems", () => {
  it("passes a change that touches no reviewer input, and one proven by a results file", () => {
    expect(proofProblems(facts({ changed: ["src/a.ts"], added: [], results: new Map() }))).toEqual([]);
    expect(proofProblems(facts())).toEqual([]);
  });

  it("refuses a reviewer-input change while there is no baseline (#216)", () => {
    expect(proofProblems(facts({ baseline: undefined }))).toEqual([
      `a reviewer input changed (prompts/review-find.md), and there is no ${BASELINE} yet (#216): nothing to prove it against; wait for the first baseline`,
    ]);
  });

  it("refuses a reviewer-input change with no results file", () => {
    expect(proofProblems(facts({ added: [], results: new Map() }))).toEqual([
      "a reviewer input changed (prompts/review-find.md): add the results file of an eval pass run at this change (agent-factory eval reviewer)",
    ]);
  });

  it("names each way a results file fails: partial, drafts, clean floor, prompt SHAs, models, head, hold, aim", () => {
    const bad = pass(
      {
        partial: true,
        proof: false,
        head: "b".repeat(40),
        inputs: { prompts: { ...SHAS, judge: "9".repeat(40) }, models: { ...MODELS, logic: "opus" } },
      },
      2,
      2,
    );
    const why = proofProblems(facts({ results: new Map([[RESULT, JSON.stringify(bad)]]) })).map((w) =>
      w.replace(`a reviewer input changed (prompts/review-find.md): ${RESULT}: `, ""),
    );
    expect(why).toEqual([
      "it is partial",
      'it is not proof ("proof": true needs no draft case and not partial)',
      "it has 2 clean-floor hit(s); the floor is 0",
      `inputs.prompts.judge is ${"9".repeat(40)}, not prompts/eval-judge.md as changed (${"3".repeat(40)})`,
      "inputs.models.logic is opus, not the pin in src/core/review/pinned.ts (claude-opus-5-5)",
      `head ${"b".repeat(40)} is not a commit on this branch`,
      "recall@act_on 2/10 is below the baseline's 5/10 by more than the noise 1/5 (ADR-0021)",
      "it aims at quality, and recall@act_on 2/10 is not above the baseline's 5/10 plus the noise 1/5 (ADR-0021)",
    ]);
  });

  it("keeps a change only past the noise on what it aims at, and holding the rest (ADR-0021)", () => {
    const why = (doc: Record<string, unknown>) =>
      proofProblems(facts({ results: new Map([[RESULT, JSON.stringify(doc)]]) })).map((w) =>
        w.replace(`a reviewer input changed (prompts/review-find.md): ${RESULT}: `, ""),
      );
    expect(why(pass({}, 7))).toEqual([
      "it aims at quality, and recall@act_on 7/10 is not above the baseline's 5/10 plus the noise 1/5 (ADR-0021)",
    ]);
    expect(why(pass({ aim: "cost", cost_usd: 6.9 }, 3))).toEqual([]);
    expect(why(pass({ aim: "cost", cost_usd: 7 }, 3))).toEqual([
      "it aims at cost, and $7 is not below the baseline's $9 less the noise $2 (ADR-0021)",
    ]);
    expect(why(pass({ aim: undefined }))).toEqual([
      "it says no aim: run agent-factory eval reviewer with --aim quality or --aim cost (ADR-0021)",
    ]);
  });

  it("AC-19 should refuse an eval proof that holds an errored case or run when its partial field says false", () => {
    const errored = { case: "c", error: "", runs: [{ run: 1, error: "the review round failed" }] };
    expect(passProblems(pass({ partial: false, per_case: [errored] }))).toEqual([
      "c run 1: the review round failed; an errored run proves nothing (ADR-0021 N11)",
    ]);
    for (const perCase of [{ c: errored }, [{ case: "c", runs: {} }], [{ case: "c", error: "" }], undefined]) {
      expect(passProblems(pass({ per_case: perCase }))).toEqual([
        expect.stringContaining("its per_case is not a list of cases"),
      ]);
    }
  });

  it("refuses a results file in which a case or a run errored, naming each; the same file without it passes (N11)", () => {
    const runs = (error: string) => [
      { run: 1, outcome: "posted", error: "", act_on: [], seeds: [] },
      { run: 2, outcome: "failed", error, act_on: [], seeds: [] },
    ];
    const clean = (error: string) => ({ case: "clean-one", kind: "clean", seeds: 0, error: "", runs: runs(error) });
    const doc = (error: string, caseError = "") =>
      JSON.stringify(pass({ per_case: [{ ...clean(error), error: caseError }] }));
    const why = (text: string) => proofProblems(facts({ results: new Map([[RESULT, text]]) }));
    expect(why(doc("the review round failed"))).toEqual([
      `a reviewer input changed (prompts/review-find.md): ${RESULT}: clean-one run 2: the review round failed; an errored run proves nothing (ADR-0021 N11)`,
    ]);
    expect(why(doc("", "cannot set up the clone"))).toEqual([
      `a reviewer input changed (prompts/review-find.md): ${RESULT}: clean-one: cannot set up the clone; an errored run proves nothing (ADR-0021 N11)`,
    ]);
    expect(why(doc(""))).toEqual([]);
  });

  it("passes when one of several added results files proves the change", () => {
    const other = "evals/reviewer/results/2026-11-08-aaaaaaaaaaaa.json";
    const results = new Map([
      [other, "{"],
      [RESULT, JSON.stringify(pass())],
    ]);
    expect(proofProblems(facts({ added: [other, RESULT], results }))).toEqual([]);
  });

  it("refuses a baseline with no recall, or none of the repeat runs the noise is measured by", () => {
    expect(proofProblems(facts({ baseline: "{}" }))).toEqual([
      `a reviewer input changed (prompts/review-find.md), and ${BASELINE} has no recall_at_act_on.overall found and of`,
    ]);
    expect(proofProblems(facts({ baseline: JSON.stringify(pass({}, 5)) }))).toEqual([
      `a reviewer input changed (prompts/review-find.md), and ${BASELINE} has no per_case of two or more runs, each holding the same seeds, to measure the noise by (ADR-0021)`,
    ]);
  });
});

describe("rulesPackProblems: the engine's own pin moves only with a proof", () => {
  const SHA = "a".repeat(64);
  const PROOF = `evals/pins/rulebook@chiyanram/${SHA}.json`;
  const review = "+ skills/crq/references/code-review.md";
  const proof = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      ref: "rulebook@chiyanram",
      commit: NEW_PACK,
      sha256: SHA,
      base: { commit: OLD_PACK, sha256: "b".repeat(64) },
      changed: [review],
      baseline: [{ domain: "crq", reference: "code-review" }],
      size: "review",
      uncovered: [],
      reason: "",
      ...over,
    });
  const moved = (proofs: ReadonlyMap<string, string>, packHash?: string) =>
    facts({ changed: [], rulesPack: { before: PACK_PIN, after: packJson(NEW_PACK) }, pinProofs: proofs, packHash });

  it("leaves a change that does not move the pin alone", () => {
    expect(rulesPackProblems(facts({ changed: [] }))).toEqual([]);
  });

  it("refuses a move with no proof for the new commit", () => {
    const wrong = new Map([[PROOF, proof({ commit: OLD_PACK })]]);
    for (const proofs of [new Map<string, string>(), wrong]) {
      expect(rulesPackProblems(moved(proofs))[0]).toContain(
        `.github/rules-pack.json moved to ${NEW_PACK}, and no evals/pins/rulebook@chiyanram/<sha256>.json`,
      );
    }
  });

  it("passes a proof whose size covers its paths, from the old pin, with the pack's hash", () => {
    expect(rulesPackProblems(moved(new Map([[PROOF, proof()]])))).toEqual([]);
    expect(rulesPackProblems(moved(new Map([[PROOF, proof()]]), SHA))).toEqual([]);
  });

  it("names each way a proof fails: its size, its base, a missing reason, and the pack's hash", () => {
    const why = (over: Record<string, unknown>, hash?: string) =>
      rulesPackProblems(moved(new Map([[PROOF, proof(over)]]), hash)).join("\n");
    expect(why({ size: "none" })).toContain("its size none does not cover the review its changed paths need");
    const writer = { changed: ["~ skills/crq/process/roles/implementer.md"], size: "none" };
    expect(why(writer)).toContain(
      "no eval can prove yet (skills/crq/process/roles/implementer.md) and gives no reason",
    );
    expect(why({ ...writer, reason: "by hand" })).toBe("");
    expect(why({ base: { commit: "1".repeat(40) } })).toContain(`not the old pin ${OLD_PACK}`);
    expect(why({ changed: ["~ .claude-plugin/plugin.json"], size: "none" })).toContain("gives no reason");
    expect(why({ changed: ["~ .claude-plugin/plugin.json"], size: "none", reason: "a version bump" })).toBe("");
    expect(why({}, "c".repeat(64))).toContain("is not the tree hash of the pinned pack");
  });

  it("hashes the pack's plugin folder the way a pin does", async () => {
    const pack = tempDir("pack-hash-");
    try {
      mkdirSync(join(pack, ".claude-plugin"), { recursive: true });
      mkdirSync(join(pack, "plugins", "rulebook", "skills"), { recursive: true });
      writeFileSync(
        join(pack, ".claude-plugin", "marketplace.json"),
        JSON.stringify({ plugins: [{ name: "rulebook", source: "./plugins/rulebook" }] }),
      );
      writeFileSync(join(pack, "plugins", "rulebook", "skills", "a.md"), "a");
      const pinned = await treeHash(join(pack, "plugins", "rulebook"));
      expect(await packHashOf(pack, "rulebook@chiyanram")).toBe(pinned.kind === "ok" ? pinned.value.sha256 : "-");
      expect(await packHashOf(pack, "toolbox@chiyanram")).toBeUndefined();
    } finally {
      rmSync(pack, { recursive: true, force: true });
    }
  });

  it("refuses a pin that names no full commit", () => {
    const bad = facts({ rulesPack: { before: PACK_PIN, after: "{}" } });
    expect(rulesPackProblems(bad)).toEqual([".github/rules-pack.json changed and names no full commit and tag"]);
  });
});

describe("baselineProblems", () => {
  const changed = [BASELINE];

  it("leaves a change that does not touch the baseline alone", () => {
    expect(baselineProblems(facts())).toEqual([]);
  });

  it("does not read the label: the approval is its own check", () => {
    expect(baselineProblems(facts({ changed }))).toEqual([]);
  });

  it("needs the new baseline to be a proof pass with a clean floor, a noise to measure and no aim (ADR-0021)", () => {
    expect(passProblems(pass({ proof: false }, 9, 1))).toHaveLength(2);
    const approved = (doc: Record<string, unknown>) =>
      baselineProblems(facts({ changed, baseline: JSON.stringify(doc) }));
    expect(approved(baseline())).toEqual([]);
    expect(approved(baseline({ clean_floor: { hits: 1, findings: [] } }))).toEqual([
      `${BASELINE} changed: it has 1 clean-floor hit(s); the floor is 0`,
    ]);
    expect(approved(pass({ aim: null }, 9))).toEqual([
      `${BASELINE} changed: it has no per_case of two or more runs, each holding the same seeds, to measure the noise by (ADR-0021)`,
    ]);
    expect(approved(baseline({ aim: "quality" }))).toEqual([
      `${BASELINE} changed: it says an aim; a baseline proves no change, so run it with no --aim`,
    ]);
  });
});

describe("approvalProblems", () => {
  const changed = [BASELINE];

  it("leaves a change that does not touch the baseline alone, with or without a pull request event", () => {
    expect(approvalProblems(["prompts/review-find.md"], undefined)).toEqual([]);
    expect(approvalProblems([], [])).toEqual([]);
  });

  it("needs the operator's label, read from the pull request event, and fails closed without one", () => {
    expect(approvalProblems(changed, undefined)).toEqual([
      `${BASELINE} changed: only the operator may change it: the label ${LABEL} on the pull request, which CI's eval-approval job reads; this run has none`,
    ]);
    expect(approvalProblems(changed, ["bug"])).toEqual([
      `${BASELINE} changed: only the operator may change it: the pull request has no ${LABEL} label`,
    ]);
    expect(approvalProblems(changed, [LABEL])).toEqual([]);
  });
});

describe("reading", () => {
  it("reads the labels of a pull request event, and none from another event", () => {
    expect(labelsOf(JSON.stringify({ pull_request: { labels: [{ name: LABEL }, { name: "x" }] } }))).toEqual([
      LABEL,
      "x",
    ]);
    expect(labelsOf(JSON.stringify({ ref: "refs/heads/main" }))).toBeUndefined();
    expect(labelsOf("{")).toBeUndefined();
  });

  it("reads git diff --name-status -z, and the default branch", () => {
    expect(nameStatus("M\0a.md\0A\0b c.json\0")).toEqual([
      ["M", "a.md"],
      ["A", "b c.json"],
    ]);
    expect(baseRef({ GITHUB_BASE_REF: "main" })).toBe("origin/main");
    expect(baseRef({ FACTORY_BASE_REF: "dev" })).toBe("dev");
  });
});

describe("check-eval-proof, the script", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const run = (root: string, env: NodeJS.ProcessEnv, flags: readonly string[] = []) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...flags, root], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
  };

  it("passes this repository", () => {
    expect(run(ROOT, {})).toEqual({ code: 0, out: "" });
  });

  it("refuses a prompt change with no baseline, then passes it with a proving results file", () => {
    const dir = tempDir("factory-proof-");
    made.push(dir);
    const put = (file: string, text: string): void => {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text);
    };
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
    const commit = (m: string) => git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", m);
    git("init", "-q", "-b", "main");
    for (const p of ["prompts/review-find.md", "prompts/review-verify.md", "prompts/eval-judge.md"]) {
      put(p, `${p}\n`);
    }
    const { judge, ...review } = MODELS;
    put(
      "src/core/review/pinned.ts",
      `export const REVIEW_MODELS = ${JSON.stringify(review)};\nexport const JUDGE_MODEL = ${JSON.stringify(judge)};\n`,
    );
    git("add", "-A");
    commit("base");
    git("checkout", "-qb", "change");
    put("prompts/review-find.md", "find better\n");
    commit("change the find prompt");
    const env = { FACTORY_BASE_REF: "main", GITHUB_EVENT_PATH: "" };

    expect(run(dir, env)).toMatchObject({
      code: 1,
      out: expect.stringContaining(`there is no ${BASELINE} yet (#216)`),
    });

    put(BASELINE, `${JSON.stringify(baseline())}\n`);
    const blob = (p: string) => git("hash-object", p);
    const prompts = {
      find: blob("prompts/review-find.md"),
      verify: blob("prompts/review-verify.md"),
      judge: blob("prompts/eval-judge.md"),
    };
    const head = git("rev-parse", "HEAD");
    put(
      RESULT,
      `${JSON.stringify(pass({ head, inputs: { head, prompts, models: { ...MODELS, find: "sonnet" } } }))}\n`,
    );
    git("add", "-A");
    commit("an eval pass run with an alias");
    const event = join(dir, "..", `${dir.split("/").pop()}-event.json`);
    made.push(event);
    writeFileSync(event, JSON.stringify({ pull_request: { labels: [{ name: LABEL }] } }));
    expect(run(dir, { ...env, GITHUB_EVENT_PATH: event })).toMatchObject({
      code: 1,
      out: expect.stringContaining("inputs.models.find is sonnet, not the pin in src/core/review/pinned.ts"),
    });
    put(RESULT, `${JSON.stringify(pass({ head, inputs: { head, prompts, models: MODELS } }))}\n`);
    git("add", "-A");
    commit("the eval pass, and a baseline");
    expect(run(dir, env)).toEqual({ code: 0, out: "" });
    expect(run(dir, env, ["--approval"])).toMatchObject({
      code: 1,
      out: expect.stringContaining(`${BASELINE} changed: only the operator may change it`),
    });
    expect(run(dir, { ...env, GITHUB_EVENT_PATH: event }, ["--approval"])).toEqual({ code: 0, out: "" });
  });
});
