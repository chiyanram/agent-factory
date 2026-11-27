import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  baseOf,
  findProof,
  gateMove,
  pinProof,
  proofOf,
  proofPath,
  writeProof,
  type Base,
  type Proof,
} from "../src/core/eval/pin-proof.js";
import type { Fetched } from "../src/core/process/fetch.js";
import { tempDir } from "./temp.js";

let home = "";
let repo = "";
beforeEach(() => {
  home = tempDir("factory-proof-");
  repo = tempDir("factory-proof-repo-");
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

const REF = { name: "rulebook", marketplace: "chiyanram" };
const SHA = "a".repeat(64);
const OTHER = "b".repeat(64);
const COMMIT = "c".repeat(40);

function proof(over: Partial<Proof> = {}): Proof {
  return {
    version: 1,
    ref: "rulebook@chiyanram",
    commit: COMMIT,
    sha256: SHA,
    base: null,
    changed: ["~ skills/crq/references/code-review.md"],
    baseline: ["crq", "code"],
    size: "review",
    uncovered: [],
    reason: "",
    review: null,
    ...over,
  };
}

function fetched(sha256: string, files: readonly string[]): Fetched {
  return { commit: COMMIT, version: "1", sha256, dir: join(home, "none"), files };
}

const line = (path: string, sum = "0") => `- ${sum.repeat(64)} ${path}`;
const base = (files: readonly string[], proven = ""): Base => ({
  commit: "d".repeat(40),
  sha256: OTHER,
  dir: join(home, "none"),
  files,
  proven,
});

describe("the proof file", () => {
  it("reads a proof, and refuses one with no size, a short sha256 or a list that is not strings", () => {
    expect(proofOf(proof())).toMatchObject({ size: "review", sha256: SHA });
    expect(proofOf({ ...proof(), size: "big" })).toBeUndefined();
    expect(proofOf({ ...proof(), sha256: "abc" })).toBeUndefined();
    expect(proofOf({ ...proof(), changed: [1] })).toBeUndefined();
    expect(proofOf({ ...proof(), baseline: [{ domain: "crq" }] })).toBeUndefined();
    expect(proofOf({ ...proof(), baseline: ["crq", 1] })).toBeUndefined();
    expect(proofOf("x")).toBeUndefined();
  });

  it("is found in the factory home or the engine's checkout, only for its own plugin and sha256", async () => {
    expect(await findProof([home, repo], REF, SHA)).toBeUndefined();
    const wrote = await writeProof(repo, REF, proof());
    expect(wrote).toEqual({ kind: "ok", value: proofPath(repo, REF, SHA) });
    expect(proofPath(repo, REF, SHA)).toBe(join(repo, "evals", "pins", "rulebook@chiyanram", `${SHA}.json`));
    expect(await findProof([home, repo], REF, SHA)).toMatchObject({ path: proofPath(repo, REF, SHA) });
    expect(await findProof([home, repo], { name: "toolbox", marketplace: "chiyanram" }, SHA)).toBeUndefined();
    mkdirSync(join(home, "evals", "pins", "rulebook@chiyanram"), { recursive: true });
    writeFileSync(proofPath(home, REF, OTHER), JSON.stringify(proof()));
    expect(await findProof([home], REF, OTHER)).toBeUndefined();
    writeFileSync(proofPath(home, REF, SHA), "{not json");
    expect(await findProof([home, repo], REF, SHA)).toMatchObject({ path: proofPath(repo, REF, SHA) });
  });
});

describe("pinProof: the check config check shows, and doctor will", () => {
  const pin = { commit: COMMIT, version: "1", sha256: SHA };

  it("says a pin with no record and no proof has none", async () => {
    expect(await pinProof([home, repo], REF, pin)).toContain("has no eval proof (ADR-0020)");
  });

  it("finds a proof for the pin's own sha256 with no record, as for a pin set before the gate", async () => {
    await writeProof(home, REF, proof());
    expect(await pinProof([home, repo], REF, pin)).toBe("");
  });

  it("shows a pin moved on a reason as unproven, until a proof for its sha256 covers its size", async () => {
    const typed = { ...pin, proof: { size: "both" as const, proven: "", reason: "by hand" } };
    expect(await pinProof([home, repo], REF, typed)).toContain('it moved on the reason "by hand"');
    await writeProof(home, REF, proof({ uncovered: ["x.md"], size: "both" }));
    expect(await pinProof([home, repo], REF, typed)).toContain("has no eval proof");
    await writeProof(home, REF, proof());
    expect(await pinProof([home, repo], REF, typed)).toContain("has no eval proof");
    await writeProof(home, REF, proof({ size: "both" }));
    expect(await pinProof([home, repo], REF, typed)).toBe("");
  });

  it("follows the record to the proof it names, and says when that proof is gone", async () => {
    const proven = { ...pin, proof: { size: "none" as const, proven: OTHER, reason: "" } };
    expect(await pinProof([home, repo], REF, proven)).toContain("is gone from");
    await writeProof(repo, REF, proof({ sha256: OTHER }));
    expect(await pinProof([home, repo], REF, proven)).toBe("");
  });
});

describe("gateMove", () => {
  const review = line("skills/crq/references/code-review.md", "1");

  it("needs no proof for a size of none, and keeps the proof its base had", async () => {
    const g = await gateMove({
      places: [home],
      ref: REF,
      base: base([], OTHER),
      after: fetched(SHA, [line("README.md")]),
      reason: "",
    });
    expect(g).toMatchObject({ problems: [], needsProof: false, record: { size: "none", proven: OTHER } });
  });

  it("refuses a review size with no proof, and takes one that covers it", async () => {
    const after = fetched(SHA, [review]);
    const missing = await gateMove({ places: [home], ref: REF, base: base([]), after, reason: "" });
    expect(missing).toMatchObject({ needsProof: true, record: undefined });
    expect(missing.problems[0]).toContain("no eval proof for sha256:aaaaaaaaaaaa covers the review size");
    await writeProof(home, REF, proof({ size: "writer" }));
    expect((await gateMove({ places: [home], ref: REF, base: base([]), after, reason: "" })).record).toBeUndefined();
    await writeProof(home, REF, proof({ size: "both" }));
    const held = await gateMove({ places: [home], ref: REF, base: base([]), after, reason: "" });
    expect(held).toMatchObject({ problems: [], record: { size: "review", proven: SHA, reason: "" } });
  });

  it("diffs against its base: a file the base already has is no change", async () => {
    const g = await gateMove({
      places: [home],
      ref: REF,
      base: base([review]),
      after: fetched(SHA, [review]),
      reason: "",
    });
    expect(g).toMatchObject({ changed: [], record: { size: "none" } });
  });

  it("takes the writer's size and a file no eval tests only with a reason, and records them unproven", async () => {
    const card = fetched(SHA, [line("skills/team/process/roles/implementer.md", "2")]);
    const writer = await gateMove({ places: [home], ref: REF, base: base([], OTHER), after: card, reason: "" });
    expect(writer.problems.join("\n")).toContain("there is no implementer eval yet (#824)");
    expect(writer.problems.join("\n")).toContain('move it with --reason "<why>"');
    const typed = await gateMove({ places: [home], ref: REF, base: base([], OTHER), after: card, reason: "by hand" });
    expect(typed).toMatchObject({
      problems: [],
      needsProof: false,
      record: { size: "writer", proven: "", reason: "by hand" },
    });
    const retro = fetched(SHA, [line("skills/team/process/roles/retro.md", "3")]);
    const bare = await gateMove({ places: [home], ref: REF, base: base([], OTHER), after: retro, reason: " " });
    expect(bare.problems.join("\n")).toContain('move it with --reason "<why>"');
    expect(bare.problems.join("\n")).not.toContain("#824");
    const why = await gateMove({ places: [home], ref: REF, base: base([], OTHER), after: retro, reason: "wording" });
    expect(why.record).toEqual({ size: "none", proven: "", reason: "wording" });
  });

  it("D5 needs a review proof for a card inside a baseline skill, since the review reads its copy", async () => {
    const inCrq = fetched(SHA, [line("skills/crq/process/roles/implementer.md", "2")]);
    const g = await gateMove({ places: [home], ref: REF, base: base([], OTHER), after: inCrq, reason: "by hand" });
    expect(g).toMatchObject({ needsProof: true, record: undefined, sized: { size: "both" } });
  });

  it("a move of both needs the review's proof and a reason, and stays unproven until a proof covers both", async () => {
    const both = fetched(SHA, [review, line("skills/crq/process/roles/implementer.md", "2")]);
    const bare = await gateMove({ places: [home], ref: REF, base: base([]), after: both, reason: "by hand" });
    expect(bare).toMatchObject({ needsProof: true, record: undefined });
    await writeProof(home, REF, proof({ uncovered: ["skills/crq/process/roles/implementer.md"], reason: "by hand" }));
    const held = await gateMove({ places: [home], ref: REF, base: base([]), after: both, reason: "by hand" });
    expect(held).toMatchObject({ problems: [], record: { size: "both", proven: "" } });
    await writeProof(home, REF, proof({ size: "both" }));
    const whole = await gateMove({ places: [home], ref: REF, base: base([]), after: both, reason: "" });
    expect(whole).toMatchObject({ problems: [], record: { size: "both", proven: SHA } });
  });
});

describe("baseOf", () => {
  const after = fetched(SHA, [line("README.md")]);

  it("has no base for a first pin of a plugin that is not the engine's rulebook", async () => {
    const engine = { kind: "ok" as const, value: { repo: "r", commit: COMMIT, tag: "rulebook--v1.0.0" } };
    const team = { name: "teamrules", marketplace: "team" };
    const got = await baseOf({ home, env: {}, places: [home], ref: team, before: undefined, after, engine });
    expect(got).toMatchObject({ commit: "", files: [], proven: "" });
  });

  it("takes the engine's pinned commit as a first pin's base, with that commit's proof", async () => {
    const engine = { kind: "ok" as const, value: { repo: "r", commit: COMMIT, tag: "rulebook--v1.0.0" } };
    const bare = await baseOf({ home, env: {}, places: [home, repo], ref: REF, before: undefined, after, engine });
    expect(bare).toMatchObject({ commit: COMMIT, sha256: SHA, files: after.files, proven: "" });
    await writeProof(repo, REF, proof({ size: "none" }));
    const proven = await baseOf({ home, env: {}, places: [home, repo], ref: REF, before: undefined, after, engine });
    expect(proven.proven).toBe(SHA);
  });

  it("takes the old pin as the base, with the proof its record names", async () => {
    const before = {
      commit: COMMIT,
      version: "1",
      sha256: OTHER,
      proof: { size: "none" as const, proven: "e".repeat(64), reason: "" },
    };
    const engine = { kind: "failed" as const, reason: "x" };
    const got = await baseOf({ home, env: {}, places: [home], ref: REF, before, after, engine });
    expect(got).toMatchObject({ commit: COMMIT, sha256: OTHER, files: [], proven: "e".repeat(64) });
  });
});
