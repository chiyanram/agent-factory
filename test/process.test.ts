import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LANES } from "../src/core/lane.js";
import { BUILT_IN, readProcess } from "../src/core/process/read.js";
import { BASELINE } from "../src/core/review/rules.js";
import { tempDir } from "./temp.js";

// the rulebook's own process files, as chiyanram/skills ships them (crq/process/lanes.json and review.json)
const FIXTURES = join(import.meta.dirname, "..", "tests", "fixtures", "process");
const RULEBOOK_LANES = join(FIXTURES, "rulebook-lanes.json");
const RULEBOOK_REVIEW = join(FIXTURES, "rulebook-review.json");

let root = "";
beforeEach(() => {
  root = tempDir("factory-process-");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

// plugin : a plugin folder with these files under it
function plugin(name: string, files: Readonly<Record<string, string>>): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function rulebook(): string {
  const dir = plugin("rulebook", {});
  mkdirSync(join(dir, "skills", "crq", "process"), { recursive: true });
  copyFileSync(RULEBOOK_LANES, join(dir, "skills", "crq", "process", "lanes.json"));
  copyFileSync(RULEBOOK_REVIEW, join(dir, "skills", "crq", "process", "review.json"));
  return dir;
}

// the rulebook's lanes with one lane's field changed
function lanesText(lane: string, field: string, value: unknown): string {
  const raw: unknown = JSON.parse(readFileSync(RULEBOOK_LANES, "utf8"));
  const lanes: unknown = Reflect.get(Object(raw), "lanes");
  const list: readonly unknown[] = Array.isArray(lanes) ? lanes : [];
  for (const l of list) {
    if (Reflect.get(Object(l), "lane") === lane) {
      Reflect.set(Object(l), field, value);
    }
  }
  return JSON.stringify({ lanes: list });
}

describe("readProcess: the lanes and the review baseline from the process plugin (#232)", () => {
  it("is the built-in process with no plugin, and with plugins that hold no process", async () => {
    expect(await readProcess([])).toEqual({ kind: "ok", value: BUILT_IN });
    const rules = plugin("rules", { "skills/java/references/x.md": "# x\n" });
    expect(await readProcess([{ label: "rules@acme", dir: rules }])).toEqual({ kind: "ok", value: BUILT_IN });
    expect(BUILT_IN.lanes.map((l) => l.name)).toEqual(["tiny", "bug", "feature", "one-way door"]);
    expect(BUILT_IN.baseline).toBe(BASELINE);
  });

  it("reads the rulebook's lanes, mapping its lane to the engine's name, and its baseline", async () => {
    const read = await readProcess([{ label: "rulebook@chiyanram", dir: rulebook() }]);
    expect(read).toMatchObject({ kind: "ok", value: { from: expect.stringContaining("rulebook@chiyanram") } });
    const value = read.kind === "ok" ? read.value : BUILT_IN;
    expect(value.lanes).toEqual(DEFAULT_LANES);
    expect(value.baseline).toEqual([
      { domain: "crq", reference: "review-process" },
      { domain: "crq", reference: "code-review" },
      { domain: "crq", reference: "verify-done" },
      { domain: "code", reference: "smells" },
    ]);
  });

  it("maps a lanes file's test_first to the lane's testFirst (#417)", async () => {
    const lanes = JSON.stringify({
      lanes: [
        { lane: "tiny", approval: false, lenses: "1" },
        { lane: "bug", approval: true, lenses: "~3", test_first: false },
        { lane: "feature", approval: true, lenses: "~3", test_first: true },
      ],
    });
    const team = plugin("team", { "skills/flow/process/lanes.json": lanes });
    const read = await readProcess([{ label: "team@local", dir: team }]);
    const value = read.kind === "ok" ? read.value : BUILT_IN;
    expect(value.lanes.map((l) => [l.name, l.testFirst])).toEqual([
      ["tiny", false],
      ["bug", false],
      ["feature", true],
    ]);
  });

  it("takes the first plugin in the list that holds a process, and keeps the built-in baseline without review.json", async () => {
    const rules = plugin("rules", { "skills/java/references/x.md": "# x\n" });
    const team = plugin("team", { "skills/flow/process/lanes.json": readFileSync(RULEBOOK_LANES, "utf8") });
    const read = await readProcess([
      { label: "rules@acme", dir: rules },
      { label: "team@acme", dir: team },
      { label: "rulebook@chiyanram", dir: rulebook() },
    ]);
    expect(read).toMatchObject({ kind: "ok", value: { from: expect.stringContaining("team@acme") } });
    expect(read.kind === "ok" ? read.value.baseline : []).toBe(BASELINE);
  });

  it("refuses a lanes file that drops the approval floor, or names a lane the engine has not, never skipping it", async () => {
    const open = lanesText("feature", "approval", false);
    const team = plugin("team", { "skills/flow/process/lanes.json": open });
    expect(
      await readProcess([
        { label: "team@acme", dir: team },
        { label: "rulebook@chiyanram", dir: rulebook() },
      ]),
    ).toMatchObject({ kind: "failed", reason: expect.stringContaining("approval floor); feature would run") });
    const renamed = lanesText("tiny", "lane", "small");
    const small = plugin("small", { "skills/flow/process/lanes.json": renamed });
    expect(await readProcess([{ label: "small@acme", dir: small }])).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("the lanes must be a list of"),
    });
    const broken = plugin("broken", { "skills/flow/process/lanes.json": "{" });
    expect(await readProcess([{ label: "broken@acme", dir: broken }])).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("is not JSON"),
    });
  });

  it("refuses a review file whose baseline is empty or names a path, not a plain name", async () => {
    const lanes = readFileSync(RULEBOOK_LANES, "utf8");
    const bad = [
      { baseline: [] },
      { baseline: [{ skill: "../crq", reference: "code-review" }] },
      { baseline: [{ skill: "crq" }] },
      [],
    ];
    for (const [i, review] of bad.entries()) {
      const dir = plugin(`p${i}`, {
        "skills/flow/process/lanes.json": lanes,
        "skills/flow/process/review.json": JSON.stringify(review),
      });
      expect(await readProcess([{ label: "p@acme", dir }])).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining('"baseline" must list {"skill", "reference"}'),
      });
    }
  });
});
