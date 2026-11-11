import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cardOf, ROLE_TOOLS, type Role } from "../src/core/process/cards.js";
import {
  CARD_FIELDS,
  CONTRACT_ROLES,
  CONTRACT_SUPPORTED,
  CONTRACT_VERSION,
  contractSchemas,
  ENGINE_ROLES,
  schemaText,
  type ContractPart,
} from "../src/core/process/contract.js";
import { prop } from "../src/core/dispatch/records.js";
import { GUARDRAILS } from "../src/core/process/guardrails.js";
import { findProcess, readProcess, type PluginDir } from "../src/core/process/read.js";
import { LANES } from "../src/core/spec.js";

const ROOT = join(import.meta.dirname, "..");
const PARTS: readonly ContractPart[] = ["card", "lanes", "finding"];
const PIN: unknown = JSON.parse(readFileSync(join(ROOT, "contract", "rules-pack.json"), "utf8"));

function isRole(name: string): name is Role {
  return Object.hasOwn(ROLE_TOOLS, name);
}

// frontOf : a card's frontmatter fields, as a rules pack's check reads them
function frontOf(text: string): Readonly<Record<string, string>> {
  const head = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  return Object.fromEntries(
    head.split("\n").flatMap((l) => {
      const m = /^([a-z_]+):\s*(.*)$/.exec(l);
      return m === null ? [] : [[m[1] ?? "", (m[2] ?? "").trim()]];
    }),
  );
}

// loads : what a card file gives: "ok" when it loads through the engine (or is a role the engine never loads), else
// why not; and the frontmatter fields that are not the contract's
function loads(
  file: string,
  text: string,
): { readonly role: string; readonly result: string; readonly extra: string[] } {
  const role = file.replace(/\.md$/, "");
  const card = isRole(role) ? cardOf(role, text, file) : ({ kind: "ok" } as const);
  const extra = Object.keys(frontOf(text)).filter((f) => !(CARD_FIELDS as readonly string[]).includes(f));
  return { role, result: card.kind === "ok" ? "ok" : card.reason, extra };
}

describe("the versioned contract (#484)", () => {
  it("publishes one JSON schema per part, each file as the engine builds it", () => {
    // when this fails after an engine change: write each file from schemaText(part), and bump CONTRACT_VERSION when a
    // rules pack's files must change to follow it
    const files = PARTS.map((part) =>
      readFileSync(join(ROOT, "contract", `v${CONTRACT_VERSION}`, `${part}.schema.json`), "utf8"),
    );
    expect(files).toEqual(PARTS.map(schemaText));
    expect(PARTS.map((part) => prop(contractSchemas()[part], "x-contract-version"))).toEqual([2, 2, 2]);
  });

  it("builds the schemas from the engine's own lists, so the two repos keep one list", () => {
    const { card, lanes } = contractSchemas();
    expect(CONTRACT_SUPPORTED).toEqual([CONTRACT_VERSION, CONTRACT_VERSION - 1]);
    expect(card).toMatchObject({ required: [...CARD_FIELDS], properties: { role: { enum: CONTRACT_ROLES } } });
    expect(ENGINE_ROLES.every((r) => CONTRACT_ROLES.includes(r))).toBe(true);
    expect(JSON.stringify(card)).toContain(Object.keys(GUARDRAILS).join("|"));
    expect(JSON.stringify(lanes)).toContain(JSON.stringify([...LANES]));
  });

  it("the lanes schema holds the approval floor: a lane is tiny, or needs approval: true", () => {
    const item = prop(prop(prop(contractSchemas().lanes, "properties"), "lanes"), "items");
    expect(prop(item, "anyOf")).toEqual([
      { properties: { lane: { const: "tiny" } } },
      { properties: { approval: { const: true } } },
    ]);
  });

  it("still loads a card in the previous version: plain-text guardrails and next: are read and ignored", () => {
    const dir = join(ROOT, "tests", "fixtures", "contract", `v${CONTRACT_VERSION - 1}`);
    const read = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => loads(f, readFileSync(join(dir, f), "utf8")));
    expect(read.map((r) => [r.role, r.result, r.extra])).toEqual([
      ["design-reviewer", "ok", ["next"]],
      ["implementer", "ok", ["next"]],
    ]);
  });

  it("pins the rules pack by a full commit", () => {
    expect(prop(PIN, "repo")).toBe("https://github.com/chiyanram/skills");
    expect(prop(PIN, "commit")).toMatch(/^[0-9a-f]{40}$/);
  });
});

// The pinned rules pack's checkout: CI fetches contract/rules-pack.json's commit and names it in FACTORY_RULES_PACK.
// Without it the check is skipped on a laptop and fails in CI, so CI can never pass without loading the cards.
const PACK = process.env.FACTORY_RULES_PACK ?? "";
const IN_CI = (process.env.CI ?? "") !== "";

// cardsOf : every role card of one plugin's process, with what each gives; none when the plugin holds no process
async function cardsOf(plugin: PluginDir): Promise<{ readonly at: string; readonly card: ReturnType<typeof loads> }[]> {
  const found = await findProcess([plugin]);
  const roles = found.kind === "ok" ? join(found.value.dir, "roles") : "";
  const files = roles !== "" && existsSync(roles) ? readdirSync(roles).filter((f) => f.endsWith(".md")) : [];
  return files.map((f) => ({ at: `${plugin.label}/${f}`, card: loads(f, readFileSync(join(roles, f), "utf8")) }));
}

describe("the pinned rules pack loads through the engine (#484)", () => {
  it.runIf(IN_CI && PACK === "")("CI names the pinned rules pack's checkout in FACTORY_RULES_PACK", () => {
    expect(PACK).not.toBe("");
  });

  it.runIf(PACK !== "")("every role card of every plugin loads, and each plugin's process reads", async () => {
    const plugins = readdirSync(join(PACK, "plugins")).map((name) => ({
      label: name,
      dir: join(PACK, "plugins", name),
    }));
    const cards = (await Promise.all(plugins.map(cardsOf))).flat();
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.filter((c) => c.card.result !== "ok" || c.card.extra.length > 0)).toEqual([]);
    const roles = cards.map((c) => c.card.role);
    expect(roles.filter((r) => !CONTRACT_ROLES.includes(r))).toEqual([]);
    const processes = await Promise.all(plugins.map((p) => readProcess([p])));
    expect(processes.filter((p) => p.kind !== "ok")).toEqual([]);
  });
});
