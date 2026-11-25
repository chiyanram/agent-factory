import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { designSetup } from "../src/core/design/settings.js";
import { AGAIN, designSteps, FLOOR, VERIFY_AGAIN, type DesignSetup } from "../src/core/design/step.js";
import type { EarlierRound } from "../src/core/dispatch/design.js";
import type { DesignFinding } from "../src/core/design/findings.js";
import type { Forge } from "../src/core/forge/types.js";
import type { Result } from "../src/core/forge/api.js";
import type { DesignRan } from "../src/core/dispatch/steps.js";
import type { Model, ModelRun } from "../src/core/review/model.js";
import { specHash } from "../src/core/spec.js";
import { project, specText, writeSpec, type Project } from "./review-repo.js";

let p: Project;
let home = "";
beforeEach(() => {
  p = project("feat/x");
  home = join(p.root, "home-d");
  writeSpec(home, specText("One table per ticket."));
});
afterEach(() => rmSync(p.root, { recursive: true, force: true }));

const forge: Pick<Forge, "defaultBranch" | "issueBody"> = {
  defaultBranch: async () => ({ kind: "ok", value: "main" }),
  issueBody: async () => ({ kind: "failed", reason: "a local-store project reads no issue" }),
};

function done<T>(out: Result<DesignRan<T>>): T {
  if (out.kind !== "ok" || out.value.kind !== "done") throw new Error(JSON.stringify(out));
  return out.value;
}

const FINDING = {
  id: "x",
  source: "design",
  decision: "one table per ticket",
  verdict: "conflict",
  file: "svc/Main.java",
  line: 1,
  rule: "SR9",
  severity: "warning",
  grade: "walked",
  finding: "Main already totals",
  fix: "reuse Main",
} as const;

type Seen = {
  readonly run: ModelRun;
  readonly files: readonly string[];
  readonly findings: string;
  readonly earlier: string;
};

function model(seen: Seen[], outputs: readonly unknown[]): Model {
  return async (run) => {
    const findings = join(run.folder, "findings.json");
    const earlier = join(run.folder, "earlier.json");
    seen.push({
      run,
      files: readdirSync(run.folder).toSorted(),
      findings: existsSync(findings) ? readFileSync(findings, "utf8") : "",
      earlier: existsSync(earlier) ? readFileSync(earlier, "utf8") : "",
    });
    const output = outputs[seen.length - 1];
    return { kind: "ok", value: { output, answer: {}, costUsd: 0.25, tokens: 400 } };
  };
}

const LIMITS = {
  review: { minutes: 13, setting: "FACTORY_DESIGN_MINUTES" },
  verify: { minutes: 14, setting: "FACTORY_VERIFY_MINUTES" },
};

function setup(m: Model): DesignSetup {
  return {
    home,
    project: "ledger",
    repo: p.clone,
    env: p.env,
    forge,
    model: m,
    modelName: "opus",
    maxUsd: "2",
    limits: LIMITS,
    runsDir: join(p.root, "design-runs"),
  };
}

const SPEC = () => specText("One table per ticket.");
const input = () => ({ ticket: "PROJ-1", spec: specHash(SPEC()) });

function bothRuns(steps: ReturnType<typeof designSteps>) {
  const [review, verify] = [steps.designReview, steps.designVerify];
  if (review.kind !== "available") throw new Error("unavailable");
  if (verify.kind !== "available") throw new Error("unavailable");
  return { review: review.run, verify: verify.run };
}

function earlierSeen(
  seen: readonly Seen[],
  i: number,
): { rounds: unknown; previous: { spec: string; design?: string } | null } {
  return JSON.parse(seen[i]?.earlier ?? "{}");
}

function promptSeen(seen: readonly Seen[], i: number): string {
  return String(seen[i]?.run.prompt);
}

describe("designSetup's time limits (P7)", () => {
  it("gives the design-reviewer design.minutes and its verify pass review.verifyMinutes, and refuses one not valid", () => {
    const given = { forge, home: "/h", project: "ledger" };
    const env = { FACTORY_REPO: "/r", FACTORY_HOME: "/h", FACTORY_DESIGN_MINUTES: "30" };
    expect(designSetup({ ...given, env })).toMatchObject({
      kind: "ok",
      value: {
        limits: {
          review: { minutes: 30, setting: "FACTORY_DESIGN_MINUTES" },
          verify: { minutes: 20, setting: "FACTORY_VERIFY_MINUTES" },
        },
      },
    });
    expect(designSetup({ ...given, env: { ...env, FACTORY_DESIGN_MINUTES: "0" } })).toEqual({
      kind: "failed",
      reason: "the design review is not set up: FACTORY_DESIGN_MINUTES must be a whole number from 1 to 60",
    });
  });
});

describe("the design review's runs (#236)", () => {
  it("the design-reviewer reads the spec, its ## Design included, and the code at the default branch, read-only, from its card", async () => {
    const seen: Seen[] = [];
    const steps = designSteps({
      kind: "ok",
      value: setup(model(seen, [{ findings: [FINDING, { ...FINDING, verdict: "aligned" }] }])),
    });
    if (steps.designReview.kind !== "available") throw new Error("unavailable");
    const out = await steps.designReview.run(input());
    expect(out).toMatchObject({
      kind: "ok",
      value: { kind: "done", card: expect.stringMatching(/^[0-9a-f]{64}$/), spend: { usd: 0.25, tokens: 400 } },
    });
    expect(done(out).findings.map((f) => f.id)).toEqual(["D1", "D2"]);
    expect(seen[0]?.files).toEqual(["code", "spec.md"]);
    const prompt = String(seen[0]?.run.prompt);
    expect(prompt).toMatch(/^# Design-reviewer/);
    expect(prompt).toContain(FLOOR);
    expect(seen[0]?.run.schema).toContain('"verdict"');
    expect(seen.map((s) => s.run.limit)).toEqual([LIMITS.review]);
    expect(readdirSync(join(p.root, "design-runs"))).toEqual([]);
  });

  it("each run keeps its stream as its trace in the ticket's folder, named on its result, a failed run's too (#487)", async () => {
    const stream = '{"type":"assistant"}\n{"type":"result"}\n';
    const streaming: Model = async (run) => {
      const ran = await model([], [{ findings: [FINDING] }])(run);
      return ran.kind === "ok" ? { kind: "ok", value: { ...ran.value, stream } } : ran;
    };
    const steps = designSteps({ kind: "ok", value: setup(streaming) });
    if (steps.designReview.kind !== "available") throw new Error("unavailable");
    const out = await steps.designReview.run(input());
    const trace = out.kind === "ok" ? out.value.trace : undefined;
    expect(trace).toMatch(/^design-review-.*\.jsonl$/);
    expect(readFileSync(join(home, "runs", "ledger", "PROJ-1", trace ?? ""), "utf8")).toBe(stream);
    const failing: Model = async () => ({ kind: "failed", reason: "error_max_budget_usd", answer: {}, stream });
    const failed = designSteps({ kind: "ok", value: setup(failing) });
    if (failed.designReview.kind !== "available") throw new Error("unavailable");
    expect(await failed.designReview.run(input())).toMatchObject({
      kind: "ok",
      value: { kind: "failed", trace: expect.stringMatching(/^design-review-/) },
    });
  });

  it("names each run's CLI, the model it asked for, and what its init event reported, a failed run's too", async () => {
    const init = { type: "system", subtype: "init", model: "opus-ran", claude_code_version: "9.9.9" };
    const stream = `${JSON.stringify(init)}\n{"type":"result"}\n`;
    const streaming: Model = async (run) => {
      const ran = await model([], [{ findings: [FINDING] }])(run);
      return ran.kind === "ok" ? { kind: "ok", value: { ...ran.value, stream } } : ran;
    };
    const steps = designSteps({ kind: "ok", value: setup(streaming) });
    expect(steps.designReview).toMatchObject({ named: { cli: "claude", asks: { design: "opus" } } });
    expect(steps.designVerify).toMatchObject({ named: { cli: "claude", asks: { design: "opus" } } });
    if (steps.designReview.kind !== "available") throw new Error("unavailable");
    expect(await steps.designReview.run(input())).toMatchObject({
      kind: "ok",
      value: { runs: [{ cli: "claude", asked: "opus", version: "9.9.9", model: "opus-ran" }] },
    });
    const failing: Model = async () => ({ kind: "failed", reason: "error_max_budget_usd", answer: {} });
    const failed = designSteps({ kind: "ok", value: setup(failing) });
    if (failed.designReview.kind !== "available") throw new Error("unavailable");
    expect(await failed.designReview.run(input())).toMatchObject({
      kind: "ok",
      value: { kind: "failed", runs: [{ cli: "claude", asked: "opus" }] },
    });
  });

  it("a model that streams nothing keeps no trace", async () => {
    const steps = designSteps({ kind: "ok", value: setup(model([], [{ findings: [] }])) });
    if (steps.designReview.kind !== "available") throw new Error("unavailable");
    const out = await steps.designReview.run(input());
    expect(out.kind === "ok" ? out.value : out).not.toHaveProperty("trace");
  });

  it("a first round gets no earlier.json and is not told it is a re-review", async () => {
    const seen: Seen[] = [];
    const steps = designSteps({ kind: "ok", value: setup(model(seen, [{ findings: [] }])) });
    if (steps.designReview.kind !== "available") throw new Error("unavailable");
    done(await steps.designReview.run(input()));
    expect(seen[0]?.files).not.toContain("earlier.json");
    expect(String(seen[0]?.run.prompt)).not.toContain(AGAIN);
  });

  it("a re-review and its verify pass get earlier.json: every round, and the spec text the last one read", async () => {
    const seen: Seen[] = [];
    const conflict = { ...FINDING, id: "D1" };
    const steps = designSteps({
      kind: "ok",
      value: setup(
        model(seen, [{ findings: [] }, { findings: [] }, { verdicts: [{ id: "D1", bucket: "act_on", why: "x" }] }]),
      ),
    });
    const { review, verify } = bothRuns(steps);
    done(await review(input()));
    const first = input();
    writeSpec(home, SPEC().replace("SPEC-INTENT: an order's total", "SPEC-INTENT: an order's net total"));
    const earlier: readonly EarlierRound[] = [
      {
        round: 1,
        spec: first.spec,
        lane: "feature",
        planned: [],
        findings: [conflict],
        kept: [{ ...conflict, bucket: "act_on", why: "it holds" }],
        dismissed: [],
      },
    ];
    const second = {
      ...input(),
      spec: specHash(SPEC().replace("an order's total", "an order's net total")),
      earlier,
    };
    done(await review(second));
    done(await verify({ ...second, findings: [conflict] }));
    for (const [i, told] of [
      [1, AGAIN],
      [2, VERIFY_AGAIN],
    ] as const) {
      const read = earlierSeen(seen, i);
      expect(read.rounds).toEqual(earlier);
      expect(read.previous).toEqual({ spec: expect.stringContaining("SPEC-INTENT: an order's total is the sum") });
      expect(promptSeen(seen, i)).toContain(told);
    }
  });

  it("a re-review whose last round left no text snapshot gets earlier.json with no previous", async () => {
    const seen: Seen[] = [];
    const steps = designSteps({ kind: "ok", value: setup(model(seen, [{ findings: [] }])) });
    const { review } = bothRuns(steps);
    const round = { round: 1, spec: "c".repeat(64), design: "d".repeat(64), findings: [], kept: [], dismissed: [] };
    done(await review({ ...input(), earlier: [round] }));
    expect(earlierSeen(seen, 0)).toEqual({ rounds: [round], previous: null });
  });

  it("a cite in the ## Design that does not hold stops the design-reviewer before any model runs (#489)", async () => {
    const cited = specText("A check in svc/Main.java:9@0000000.");
    writeSpec(home, cited);
    const seen: Seen[] = [];
    const steps = designSteps({ kind: "ok", value: setup(model(seen, [{ findings: [] }])) });
    if (steps.designReview.kind !== "available") throw new Error("unavailable");
    expect(await steps.designReview.run({ ...input(), spec: specHash(cited) })).toMatchObject({
      kind: "ok",
      value: {
        kind: "failed",
        final: true,
        why: expect.stringContaining("svc/Main.java:9@0000000: 0000000 is not a commit"),
      },
    });
    expect(seen).toEqual([]);
  });

  it("the verify pass gets findings.json and keeps what it does not dismiss; none to verify runs no model", async () => {
    const seen: Seen[] = [];
    const verdicts = {
      verdicts: [
        { id: "D1", bucket: "act_on", why: "it holds" },
        { id: "D2", bucket: "dismissed", why: "no" },
      ],
    };
    const steps = designSteps({ kind: "ok", value: setup(model(seen, [verdicts])) });
    if (steps.designVerify.kind !== "available") throw new Error("unavailable");
    const findings: readonly DesignFinding[] = [
      { ...FINDING, id: "D1", verdict: "conflict" },
      { ...FINDING, id: "D2", verdict: "open" },
    ];
    const out = await steps.designVerify.run({ ...input(), findings });
    expect(done(out).kept.map((k) => [k.id, k.bucket])).toEqual([["D1", "act_on"]]);
    expect(seen[0]?.files).toEqual(["code", "findings.json", "spec.md"]);
    expect(seen.map((s) => s.run.limit)).toEqual([LIMITS.verify]);
    expect(JSON.parse(String(seen[0]?.findings))).toHaveLength(2);
    expect(seen[0]?.run.prompt).toMatch(/^# Verify pass/);
    const none = await steps.designVerify.run({ ...input(), findings: [] });
    expect(none).toMatchObject({ kind: "ok", value: { kind: "done", kept: [] } });
    expect(seen).toHaveLength(1);
  });

  it("notes a kept finding whose cite is not on the default branch as cite not found (#485)", async () => {
    const verdicts = {
      verdicts: [
        { id: "D1", bucket: "act_on", why: "it holds" },
        { id: "D2", bucket: "act_on", why: "it holds" },
        { id: "D3", bucket: "consider", why: "maybe" },
      ],
    };
    const steps = designSteps({ kind: "ok", value: setup(model([], [verdicts])) });
    if (steps.designVerify.kind !== "available") throw new Error("unavailable");
    const findings: readonly DesignFinding[] = [
      { ...FINDING, id: "D1" },
      { ...FINDING, id: "D2", file: "sp ace/a.txt" },
      { ...FINDING, id: "D3", line: 2 },
    ];
    const kept = done(await steps.designVerify.run({ ...input(), findings })).kept;
    expect(kept.map((k) => [k.id, k.bucket, k.why])).toEqual([
      ["D1", "act_on", "it holds"],
      ["D2", "noted", "cite not found: sp ace/a.txt is not in the reviewed commit"],
      ["D3", "noted", "cite not found: svc/Main.java:2 is past the end of the file (1 line)"],
    ]);
  });

  it("checks a cite of the spec against its own text, not the repo; a design.md the run never read is no cite (#485)", async () => {
    const verdicts = {
      verdicts: ["D1", "D2", "D3"].map((id) => ({ id, bucket: "act_on", why: "it holds" })),
    };
    const steps = designSteps({ kind: "ok", value: setup(model([], [verdicts])) });
    if (steps.designVerify.kind !== "available") throw new Error("unavailable");
    const findings: readonly DesignFinding[] = [
      { ...FINDING, id: "D1", file: "spec.md", line: 3 },
      { ...FINDING, id: "D2", file: "spec.md", line: 400 },
      { ...FINDING, id: "D3", file: "design.md", line: 3 },
    ];
    const kept = done(await steps.designVerify.run({ ...input(), findings })).kept;
    expect(kept.map((k) => [k.id, k.bucket])).toEqual([
      ["D1", "act_on"],
      ["D2", "noted"],
      ["D3", "noted"],
    ]);
  });

  it("checks the cites against what the run read, even when the spec is edited while the verify pass runs", async () => {
    const verdicts = { verdicts: [{ id: "D1", bucket: "act_on", why: "it holds" }] };
    const editing: Model = async (run) => {
      writeSpec(home, `${SPEC()}\nedited while the run ran\n`);
      return model([], [verdicts])(run);
    };
    const steps = designSteps({ kind: "ok", value: setup(editing) });
    if (steps.designVerify.kind !== "available") throw new Error("unavailable");
    const findings: readonly DesignFinding[] = [{ ...FINDING, id: "D1", file: "spec.md", line: 99 }];
    const kept = done(await steps.designVerify.run({ ...input(), findings })).kept;
    expect(kept.map((k) => [k.id, k.bucket])).toEqual([["D1", "noted"]]);
  });

  it("a spec edited since the pass decided fails the run and runs no model; a bad answer fails it with its spend", async () => {
    const seen: Seen[] = [];
    const steps = designSteps({
      kind: "ok",
      value: setup(model(seen, [{ findings: [{ ...FINDING, verdict: "approve" }] }])),
    });
    if (steps.designReview.kind !== "available") throw new Error("unavailable");
    expect(await steps.designReview.run({ ...input(), spec: "f".repeat(64) })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("changed since"),
    });
    expect(seen).toEqual([]);
    expect(await steps.designReview.run(input())).toMatchObject({
      kind: "ok",
      value: { kind: "failed", spend: { usd: 0.25 }, why: expect.stringContaining("findings") },
    });
  });

  it("the card's tools are the run's only tools, and its must_not_see leaves the design and code out (#232)", async () => {
    const cards = join(p.root, "cards");
    mkdirSync(cards, { recursive: true });
    writeFileSync(
      join(cards, "design-reviewer.md"),
      "---\nrole: design-reviewer\ntools: [Read]\nmust_not_see: the design; the code\n---\n\nRead the spec only.\n",
    );
    const seen: Seen[] = [];
    const s = { ...setup(model(seen, [{ findings: [] }])), cards };
    const step = designSteps({ kind: "ok", value: s }).designReview;
    if (step.kind !== "available") throw new Error("unavailable");
    done(await step.run(input()));
    expect(seen[0]?.run.tools).toEqual(["Read"]);
    expect(seen[0]?.files).toEqual(["spec.md"]);
    expect(seen[0]?.run.prompt).toBe(`Read the spec only.\n\n${FLOOR}\n`);
  });

  it("is unavailable, with the reason, when the review is not set up", () => {
    const steps = designSteps({ kind: "failed", reason: "FACTORY_REPO must be an absolute path" });
    expect(steps.designReview).toEqual({ kind: "unavailable", reason: "FACTORY_REPO must be an absolute path" });
  });
});
