import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readCard, ROLE_TOOLS, type Role } from "../src/core/process/cards.js";
import {
  frontmatterOf,
  PACK_FORMAT,
  PACK_SUPPORTED,
  readPackSchemas,
  unknownKeywords,
  validate,
} from "../src/core/process/pack-schema.js";
import { prop } from "../src/core/dispatch/records.js";
import { findProcess, readProcess, type PluginDir } from "../src/core/process/read.js";
import { tempDir } from "./temp.js";

const ROOT = join(import.meta.dirname, "..");
const FIXTURES = join(ROOT, "tests", "fixtures");
// the rules pack's own schemas, version 1, as chiyanram/skills#316 ships them
const V1 = join(FIXTURES, "pack-schema", "v1");
// cards from before the pack published its format: a next: field, plain-text guardrails
const V0_CARDS = join(FIXTURES, "pack-schema", "v0-cards");
const LANES = readFileSync(join(FIXTURES, "process", "rulebook-lanes.json"), "utf8");

let root = "";
beforeEach(() => {
  root = tempDir("factory-pack-schema-");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function isRole(name: string): name is Role {
  return Object.hasOwn(ROLE_TOOLS, name);
}

// pack : a rules pack plugin with these schema files, lanes and cards; its process folder
function pack(input: {
  readonly schemas?: Readonly<Record<string, string>>;
  readonly lanes?: string;
  readonly cards?: Readonly<Record<string, string>>;
}): { readonly plugin: PluginDir; readonly process: string } {
  const dir = join(root, "rulebook", "skills", "crq", "process");
  mkdirSync(join(dir, "roles"), { recursive: true });
  mkdirSync(join(dir, "schema"), { recursive: true });
  writeFileSync(join(dir, "lanes.json"), input.lanes ?? LANES);
  writeAll(join(dir, "schema"), input.schemas ?? {}, "");
  writeAll(join(dir, "roles"), input.cards ?? {}, ".md");
  return { plugin: { label: "rulebook", dir: join(root, "rulebook") }, process: dir };
}

function writeAll(dir: string, files: Readonly<Record<string, string>>, suffix: string): void {
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, `${name}${suffix}`), text);
  }
}

function v1Schemas(): Readonly<Record<string, string>> {
  return Object.fromEntries(readdirSync(V1).map((f) => [f, readFileSync(join(V1, f), "utf8")]));
}

// a card as the pack ships it today: a [list] of guardrail IDs, no next:
const CARD = [
  "---",
  "role: verify-pass",
  "steps: [verify]",
  "input: the findings; the code at the head",
  "must_not_see: the implementer's report",
  "hand_off: the JSON the run returns {verdicts}",
  "tools: [Read, Grep, Glob]",
  "enforced_guardrails: [read-only]",
  "rules: [RV1, RV7]",
  "---",
  "",
  "# Verify pass",
  "",
].join("\n");

describe("the checker for the pack's schemas (#484)", () => {
  it("runs the keywords the pack's schemas use", () => {
    const schema = {
      type: "object",
      required: ["a"],
      additionalProperties: false,
      properties: {
        a: { type: "array", minItems: 1, items: { enum: ["x", "y"] } },
        b: { type: "string", minLength: 1, pattern: "^[A-Z]+[0-9]+$" },
        c: { anyOf: [{ type: "boolean" }, { const: "yes" }] },
        d: { type: "array", prefixItems: [{ const: 1 }], items: false },
      },
    };
    expect(validate({ a: ["x"], b: "RV1", c: true, d: [1] }, schema)).toEqual([]);
    expect(validate({ a: [], b: "", c: "no", d: [1, 2], e: 0 }, schema)).toEqual([
      "a: has 0 items, needs at least 1",
      "b: is empty",
      'b: "" does not match ^[A-Z]+[0-9]+$',
      'c: matches no allowed form (c: "no" is not boolean; c: "no" is not "yes")',
      "d[1]: not allowed",
      'the top level: "e" is not a known field',
    ]);
    expect(validate({}, schema)).toEqual(['the top level: "a" is missing']);
  });

  it("refuses a schema that asks for a check it does not run", () => {
    expect(unknownKeywords({ properties: { a: { maximum: 3 } }, if: {} })).toEqual([
      '#: unsupported keyword "if"',
      '#/properties/a: unsupported keyword "maximum"',
    ]);
    for (const file of readdirSync(V1)) {
      const schema: unknown = JSON.parse(readFileSync(join(V1, file), "utf8"));
      expect(typeof schema === "object" && schema !== null ? unknownKeywords({ ...schema }) : ["not a schema"]).toEqual(
        [],
      );
    }
  });

  it("reads a card's frontmatter as the pack's own check does: [a, b] is a list", () => {
    expect(frontmatterOf(CARD)).toMatchObject({
      role: "verify-pass",
      steps: ["verify"],
      tools: ["Read", "Grep", "Glob"],
    });
  });
});

describe("the rules pack's format version (#484)", () => {
  it("reads this version and the one before", () => {
    expect(PACK_SUPPORTED).toEqual([PACK_FORMAT, PACK_FORMAT - 1]);
  });

  it("a pack with no schema folder is version 0, read by the engine's own checks alone", async () => {
    const { process } = pack({});
    expect(await readPackSchemas(process)).toEqual({ kind: "ok", value: { version: 0, parts: {} } });
  });

  it("a pack's version is the highest it ships", async () => {
    const { process } = pack({ schemas: v1Schemas() });
    const read = await readPackSchemas(process);
    expect(read).toMatchObject({ kind: "ok", value: { version: 1 } });
    expect(Object.keys(read.kind === "ok" ? read.value.parts : {}).toSorted()).toEqual(["card", "finding", "lanes"]);
  });

  it("refuses a newer version than it reads, naming both, so an old engine never half-reads a new pack", async () => {
    const { process } = pack({ schemas: { "card-v2.schema.json": "{}" } });
    expect(await readPackSchemas(process)).toEqual({
      kind: "failed",
      reason: `${join(process, "schema")}: the rules pack's format is version 2; this engine reads versions 1 and 0. Update agent-factory, or pin an older rules pack`,
    });
  });

  it("refuses a schema file that is not JSON, or asks for a check it does not run", async () => {
    expect(await readPackSchemas(pack({ schemas: { "card-v1.schema.json": "{" } }).process)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("is not JSON"),
    });
    rmSync(join(root, "rulebook"), { recursive: true });
    const odd = pack({ schemas: { "lanes-v1.schema.json": '{"maximum": 1}' } });
    expect(await readPackSchemas(odd.process)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining('unsupported keyword "maximum"'),
    });
  });
});

describe("the engine reads a pack's files through the pack's own format (#484)", () => {
  it("a card that follows the pack's card schema loads", async () => {
    const { plugin } = pack({ schemas: v1Schemas(), cards: { "verify-pass": CARD } });
    expect(await readCard([plugin], "verify-pass")).toMatchObject({ kind: "ok", value: { role: "verify-pass" } });
  });

  it("a card that breaks the pack's card schema is refused, never skipped for the built-in one", async () => {
    const bad = CARD.replace("rules: [RV1, RV7]\n", "rules: [RV1, RV7]\nowner: me\n");
    const { plugin } = pack({ schemas: v1Schemas(), cards: { "verify-pass": bad } });
    expect(await readCard([plugin], "verify-pass")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining(
        `does not follow the rules pack's card format (version 1): the top level: "owner"`,
      ),
    });
  });

  it("a card from before the pack published its format (version 0) still loads", async () => {
    const files = readdirSync(V0_CARDS).filter((f) => f.endsWith(".md"));
    const cards = Object.fromEntries(
      files.map((f) => [f.replace(/\.md$/, ""), readFileSync(join(V0_CARDS, f), "utf8")]),
    );
    expect(Object.values(cards).every((t) => "next" in frontmatterOf(t))).toBe(true);
    const { plugin } = pack({ cards });
    const read = await Promise.all(
      Object.keys(cards)
        .filter(isRole)
        .map((role) => readCard([plugin], role)),
    );
    expect(read.map((r) => r.kind)).toEqual(files.map(() => "ok"));
  });

  it("a lanes file that breaks the pack's lanes schema stops the process from reading", async () => {
    // the bug lane, second in the file, without its approval
    const loose = LANES.replace(/("lane": "bug",\s*"approval": )true/, "$1false");
    expect(loose).not.toBe(LANES);
    const { plugin } = pack({ schemas: v1Schemas(), lanes: loose });
    expect(await readProcess([plugin])).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("does not follow the rules pack's lanes format (version 1): lanes[1].approval"),
    });
  });
});

// The pinned rules pack's checkout: CI fetches .github/rules-pack.json's commit and names it in FACTORY_RULES_PACK.
// Without it the check is skipped on a laptop and fails in CI, so CI can never pass without reading the pack.
const PACK = process.env.FACTORY_RULES_PACK ?? "";
const IN_CI = (process.env.CI ?? "") !== "";
const PIN: unknown = JSON.parse(readFileSync(join(ROOT, ".github", "rules-pack.json"), "utf8"));

// packCards : every role card of one plugin's process, each with how it read
async function packCards(plugin: PluginDir): Promise<readonly { readonly at: string; readonly result: string }[]> {
  const found = await findProcess([plugin]);
  if (found.kind !== "ok") {
    return [];
  }
  const roles = join(found.value.dir, "roles");
  const files = readdirSync(roles).filter((f) => f.endsWith(".md"));
  return Promise.all(
    files.map(async (f) => {
      const role = f.replace(/\.md$/, "");
      // a card the engine never runs (coordinator, finder, retro) is the pack's own business
      const read = isRole(role) ? await readCard([plugin], role) : ({ kind: "ok" } as const);
      return { at: `${plugin.label}/${f}`, result: read.kind === "ok" ? "ok" : read.reason };
    }),
  );
}

describe("the pinned rules pack reads through the engine (#484)", () => {
  it("pins the rules pack by a full commit", () => {
    expect(prop(PIN, "repo")).toBe("https://github.com/chiyanram/skills");
    expect(prop(PIN, "commit")).toMatch(/^[0-9a-f]{40}$/);
  });

  it.runIf(IN_CI && PACK === "")("CI names the pinned rules pack's checkout in FACTORY_RULES_PACK", () => {
    expect(PACK).not.toBe("");
  });

  it.runIf(PACK !== "")("every plugin's process and every role card the engine runs reads", async () => {
    const plugins = readdirSync(join(PACK, "plugins")).map((name) => ({
      label: name,
      dir: join(PACK, "plugins", name),
    }));
    const cards = (await Promise.all(plugins.map(packCards))).flat();
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.filter((c) => c.result !== "ok")).toEqual([]);
    const processes = await Promise.all(plugins.map((p) => readProcess([p])));
    expect(processes.filter((p) => p.kind !== "ok")).toEqual([]);
  });
});
