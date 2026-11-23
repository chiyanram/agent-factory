import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../src/app.js";
import type { EvalInput } from "../src/core/eval/harness.js";
import { proofPath } from "../src/core/eval/pin-proof.js";
import { evalPinCommand, type PassRunner } from "../src/eval-pin-cli.js";
import { commitMarket, GIT_ENV, LANES, setUpMarket } from "./market.js";
import { tempDir } from "./temp.js";

const REF = { name: "rulebook", marketplace: "chiyanram" };
const LANES_PATH = "plugins/rulebook/skills/crq/process/lanes.json";
const REVIEW_PATH = "plugins/rulebook/skills/crq/references/code-review.md";
const WHY = ["--reason", "the manifest and lanes: no eval tests them"];

let home = "";
let repo = "";
let env: NodeJS.ProcessEnv = {};
beforeEach(() => {
  home = tempDir("factory-evalpin-");
  repo = tempDir("factory-evalpin-repo-");
  cpSync(join(import.meta.dirname, "..", "evals", "reviewer"), join(repo, "evals", "reviewer"), { recursive: true });
  env = { ...GIT_ENV, CI: "", FACTORY_HOME: home };
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

type Ran = { readonly code: number; readonly out: string; readonly err: string; readonly passes: EvalInput[] };

function pass(found: number, hits = 0): { readonly runner: PassRunner; readonly passes: EvalInput[] } {
  const passes: EvalInput[] = [];
  const runner: PassRunner = async (input) => {
    passes.push(input);
    const path = join(input.resultsDir ?? "", "pass.json");
    const doc = {
      partial: false,
      partial_why: [],
      proof: true,
      cost_usd: 7.5,
      recall_at_act_on: { overall: { found, of: 20 } },
      clean_floor: { hits },
      inputs: { rulebook: input.rulebookCommit },
      per_case: [],
    };
    writeFileSync(path, JSON.stringify(doc));
    return { kind: "ok", value: { path, partial: false, proof: true } };
  };
  return { runner, passes };
}

async function evalPin(args: readonly string[], answer = "y", runner = pass(20)): Promise<Ran> {
  let out = "";
  let err = "";
  const code = await evalPinCommand(
    ["ledger", "rulebook@chiyanram", ...args, "--repo", repo],
    { env, out: (t) => (out += t), err: (t) => (err += t), readLine: async () => answer },
    runner.runner,
  );
  return { code, out, err, passes: runner.passes };
}

async function pinFirst(): Promise<void> {
  setUpMarket(home);
  const code = await runCli(["plugin", "update", "ledger", "rulebook@chiyanram", ...WHY], {
    env,
    out: () => undefined,
    err: () => undefined,
    readSecret: async () => "",
    readStdin: async () => "",
    system: {
      platform: "linux",
      uid: -1,
      gid: -1,
      run: async () => ({ code: 1, stdout: "", stderr: "" }),
      interactive: async () => 0,
      background: async () => ({ kind: "failed", reason: "" }),
      agent: async () => ({ code: 127, stdout: "", stderr: "" }),
    },
  });
  expect(code).toBe(0);
}

function storeDirs(): readonly string[] {
  return readdirSync(join(home, "plugins", "chiyanram", "rulebook")).filter((d) => !d.startsWith("."));
}

describe("agent-factory eval pin", () => {
  it("refuses bad usage, and refuses in CI before it reads anything", async () => {
    const usage = await evalPinCommand(["ledger"], { env, out: () => undefined, err: () => undefined });
    expect(usage).toBe(64);
    env = { ...env, CI: "true" };
    const ci = await evalPin([]);
    expect(ci.code).toBe(1);
    expect(ci.err).toContain("never in CI");
  });

  it("a file no eval tests needs a reason and spends nothing; the engine's pin gets a proof that keeps it", async () => {
    setUpMarket(home);
    const bare = await evalPin([]);
    expect(bare.code).toBe(1);
    expect(bare.out).toContain("no base (every file counts)");
    expect(bare.err).toContain('move it with --reason "<why>"');
    const why = await evalPin(WHY);
    expect(why).toMatchObject({ code: 0, passes: [] });
    expect(why.out).toContain("eval size: none\n");
    expect(why.out).toContain("no eval can prove this move yet");
    expect(existsSync(join(repo, "evals", "pins"))).toBe(false);
    const committed = await evalPin([...WHY, "--commit-proof"]);
    expect(committed).toMatchObject({ code: 0, passes: [] });
    const [file = ""] = readdirSync(join(repo, "evals", "pins", "rulebook@chiyanram"));
    const proof = JSON.parse(readFileSync(join(repo, "evals", "pins", "rulebook@chiyanram", file), "utf8"));
    expect(proof).toMatchObject({ size: "none", review: null, base: null, reason: WHY[1] });
    expect(proof.uncovered).toEqual([".claude-plugin/plugin.json", "skills/crq/process/lanes.json"]);
  });

  it("spends nothing on the writer's size: it needs a reason, and no eval can prove it yet", async () => {
    await pinFirst();
    commitMarket(home, { [LANES_PATH]: LANES, "plugins/rulebook/skills/crq/process/roles/implementer.md": "x" });
    const r = await evalPin([]);
    expect(r).toMatchObject({ code: 1, passes: [] });
    expect(r.err).toContain("there is no implementer eval yet (#824)");
    const typed = await evalPin(["--reason", "by hand"]);
    expect(typed).toMatchObject({ code: 0, passes: [] });
    expect(typed.out).toContain("no eval can prove this move yet");
  });

  it("shows the cases and the cost and spends nothing on a no", async () => {
    await pinFirst();
    commitMarket(home, { [LANES_PATH]: LANES, [REVIEW_PATH]: "a sharper rubric" });
    const r = await evalPin([], "");
    expect(r).toMatchObject({ code: 1, passes: [] });
    expect(r.out).toContain("eval size: review\n  review: skills/crq/references/code-review.md\n");
    expect(r.out).toMatch(/targeted review pass: \d+ case\(s\), 1 run each: clean-/);
    expect(r.out).toMatch(/cost: about \$\d+\.\d\d .*; at most \$\d+\.\d\d/);
    expect(r.out).toContain("not run; no proof written");
  });

  it("on a yes runs the slice on the store copy and writes the proof, after which there is nothing to run", async () => {
    await pinFirst();
    const second = commitMarket(home, { [LANES_PATH]: LANES, [REVIEW_PATH]: "a sharper rubric" });
    const r = await evalPin([]);
    expect(r.code).toBe(0);
    const input = r.passes[0];
    const sha256 = storeDirs().find((d) => input?.rulebook.endsWith(d)) ?? "";
    expect(input).toMatchObject({ root: repo, runs: 1, rulebookCommit: second });
    expect(input?.only?.length).toBeGreaterThan(0);
    const path = proofPath(home, REF, sha256);
    expect(r.out).toContain(path);
    expect(r.out).toContain(`next: agent-factory plugin update ledger rulebook@chiyanram ${second}`);
    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written).toMatchObject({
      ref: "rulebook@chiyanram",
      commit: second,
      sha256,
      size: "review",
      changed: ["+ skills/crq/references/code-review.md"],
      review: { runs: 1, cost_usd: 7.5, found: 20, clean_hits: 0 },
    });
    expect(written.base).toMatchObject({ sha256: expect.stringMatching(/^\w{64}$/) });
    const again = await evalPin([]);
    expect(again).toMatchObject({ code: 0, passes: [] });
    expect(again.out).toContain("an eval proof already covers");
  });

  it("writes no proof for a pass that does not hold, and the engine's proof into the checkout when asked", async () => {
    await pinFirst();
    commitMarket(home, { [LANES_PATH]: LANES, [REVIEW_PATH]: "a sharper rubric" });
    const low = await evalPin([], "y", pass(0));
    expect(low.code).toBe(1);
    expect(low.err).toContain("below the baseline's lowest single run");
    expect(existsSync(join(home, "evals", "pins"))).toBe(false);
    const hit = await evalPin([], "y", pass(20, 2));
    expect(hit.err).toContain("2 clean-floor hit(s)");
    const committed = await evalPin(["--commit-proof"]);
    expect(committed.code).toBe(0);
    expect(readdirSync(join(repo, "evals", "pins", "rulebook@chiyanram"))).toHaveLength(1);
    expect(existsSync(join(home, "evals", "pins"))).toBe(false);
  });
});
