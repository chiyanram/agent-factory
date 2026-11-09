import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { designSteps, FLOOR, type DesignSetup } from "../src/core/design/step.js";
import type { DesignFinding } from "../src/core/design/findings.js";
import type { Forge } from "../src/core/forge/types.js";
import type { Result } from "../src/core/forge/api.js";
import type { DesignRan } from "../src/core/dispatch/tick.js";
import type { Model, ModelRun } from "../src/core/review/model.js";
import { specHash } from "../src/core/spec.js";
import { project, specText, writeSpec, type Project } from "./review-repo.js";

let p: Project;
let home = "";
beforeEach(() => {
  p = project("feat/x");
  home = join(p.root, "home-d");
  writeSpec(home, specText());
  writeFileSync(join(home, "specs", "ledger", "PROJ-1", "design.md"), "# Design\n\nOne table per ticket.\n");
});
afterEach(() => rmSync(p.root, { recursive: true, force: true }));

const forge: Pick<Forge, "defaultBranch"> = { defaultBranch: async () => ({ kind: "ok", value: "main" }) };

// done : a run's finished outcome, or a test failure
function done<T>(out: Result<DesignRan<T>>): T {
  if (out.kind !== "ok" || out.value.kind !== "done") throw new Error(JSON.stringify(out));
  return out.value;
}

const FINDING = {
  id: "x",
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

type Seen = { readonly run: ModelRun; readonly files: readonly string[]; readonly findings: string };

// a model that keeps what each run saw, and answers with `outputs` in turn
function model(seen: Seen[], outputs: readonly unknown[]): Model {
  return async (run) => {
    const findings = join(run.folder, "findings.json");
    seen.push({
      run,
      files: readdirSync(run.folder).toSorted(),
      findings: existsSync(findings) ? readFileSync(findings, "utf8") : "",
    });
    const output = outputs[seen.length - 1];
    return { kind: "ok", value: { output, answer: {}, costUsd: 0.25, tokens: 400 } };
  };
}

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
    plugins: [],
    runsDir: join(p.root, "design-runs"),
  };
}

const DESIGN = () => specHash("# Design\n\nOne table per ticket.\n");
const input = () => ({ ticket: "PROJ-1", spec: specHash(specText()), design: DESIGN() });

describe("the design review's runs (#236)", () => {
  it("the design-reviewer reads the spec, the design and the code at the default branch, read-only, from its card", async () => {
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
    expect(seen[0]?.files).toEqual(["code", "design.md", "spec.md"]);
    // the code at main, with every rule file removed: the branch's edits are not there
    const prompt = String(seen[0]?.run.prompt);
    expect(prompt).toMatch(/^# Design-reviewer/);
    expect(prompt).toContain(FLOOR);
    expect(seen[0]?.run.schema).toContain('"verdict"');
    // the folder is gone after the run
    expect(readdirSync(join(p.root, "design-runs"))).toEqual([]);
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
    expect(seen[0]?.files).toEqual(["code", "design.md", "findings.json", "spec.md"]);
    expect(JSON.parse(String(seen[0]?.findings))).toHaveLength(2);
    expect(seen[0]?.run.prompt).toMatch(/^# Verify pass/);
    const none = await steps.designVerify.run({ ...input(), findings: [] });
    expect(none).toMatchObject({ kind: "ok", value: { kind: "done", kept: [] } });
    expect(seen).toHaveLength(1);
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

  it("is unavailable, with the reason, when the review is not set up", () => {
    const steps = designSteps({ kind: "failed", reason: "FACTORY_REPO must be an absolute path" });
    expect(steps.designReview).toEqual({ kind: "unavailable", reason: "FACTORY_REPO must be an absolute path" });
  });
});
