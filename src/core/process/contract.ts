// contract — the one versioned contract between the engine and a rules pack such as chiyanram/skills (#484): the role
// card's frontmatter, the lanes file, and the finding a finder run returns. Each part is published as a JSON schema
// built here from the engine's own lists (the roles and their tools, the guardrail IDs, the lanes, the finding's
// fields), so the engine and a rules pack's check never keep two lists that drift:
//
//   contract/v<N>/card.schema.json      a role card's frontmatter, every value as the card writes it
//   contract/v<N>/lanes.schema.json     a process plugin's lanes.json, the approval floor included
//   contract/v<N>/finding.schema.json   one finding of a finder run's JSON answer
//
// The files are written from contractSchemas (test/contract.test.ts fails when one differs), shipped in the package,
// and read by the rules pack's CI at the engine version it pins. The engine reads this version and the one before, as
// the plugin protocol does (plugin/contract.ts): a card in the previous version still loads (cards.ts).
//
//   2   a card's enforced_guardrails is a [list] of guardrail IDs; it has no next: field (#424)
//   1   the card form before #424: plain-text enforced_guardrails (read and ignored) and a next: field (dropped)
//
// A change that a pack's files must follow is a new version; one that only adds an optional field is not.

import { LANES } from "../spec.js";
import { FINDING_SCHEMA } from "../review/verdicts.js";
import { ROLE_TOOLS } from "./cards.js";
import { GUARDRAILS } from "./guardrails.js";

export const CONTRACT_VERSION = 2;
export const CONTRACT_SUPPORTED: readonly number[] = [CONTRACT_VERSION, CONTRACT_VERSION - 1];

// every role a rules pack may hold a card for: the roles the engine starts a run from a card for (cards.ts
// ROLE_TOOLS), and the roles whose card a person or the coordinator reads, which the engine never loads
export const ENGINE_ROLES = Object.keys(ROLE_TOOLS);
export const READ_ONLY_ROLES = ["coordinator", "finder", "retro"] as const;
export const CONTRACT_ROLES: readonly string[] = [...ENGINE_ROLES, ...READ_ONLY_ROLES];

// the frontmatter fields of a card in this version; every other field is refused by a rules pack's check
export const CARD_FIELDS = [
  "role",
  "steps",
  "input",
  "must_not_see",
  "hand_off",
  "tools",
  "enforced_guardrails",
  "rules",
] as const;

const BASE = "https://github.com/chiyanram/agent-factory/blob/main/contract";

function header(part: string, title: string): Readonly<Record<string, unknown>> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${BASE}/v${CONTRACT_VERSION}/${part}.schema.json`,
    title,
    "x-contract-version": CONTRACT_VERSION,
  };
}

// alternation : a regex alternation of literal words; a hyphen is literal outside a [class]. Pure.
function alternation(words: readonly string[]): string {
  return words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

// cardSchema : a role card's frontmatter. Each value is the text after "name:"; a list is written in [brackets]. A
// role the engine runs names guardrail IDs from the engine's list; a card read only by a person may say them in words.
function cardSchema(): Readonly<Record<string, unknown>> {
  const text = { type: "string", minLength: 1 };
  const ids = alternation(Object.keys(GUARDRAILS));
  return {
    ...header("card", "agent-factory role card frontmatter"),
    type: "object",
    required: [...CARD_FIELDS],
    additionalProperties: false,
    properties: {
      role: { enum: [...CONTRACT_ROLES] },
      steps: text,
      input: text,
      must_not_see: { ...text, description: 'entries separated by ";", or "none"' },
      hand_off: { ...text, description: "every field named in {…} is a field of the engine's schema for the role" },
      tools: {
        type: "string",
        pattern: "^\\[.+\\]$",
        description: "a [list]; only Edit takes a path scope, Edit(glob)",
      },
      enforced_guardrails: { type: "string" },
      rules: text,
    },
    // a card read only by a person, or one whose enforced_guardrails is a [list] of the engine's IDs, possibly empty
    anyOf: [
      { properties: { role: { enum: [...READ_ONLY_ROLES] } } },
      { properties: { enforced_guardrails: { pattern: `^\\[\\s*((${ids})\\s*(,\\s*(${ids})\\s*)*)?\\]$` } } },
    ],
    "x-engine-tools": ROLE_TOOLS,
    "x-guardrails": GUARDRAILS,
  };
}

// lanesSchema : a process plugin's lanes.json. Every lane but tiny carries approval: true (the approval floor, #483).
function lanesSchema(): Readonly<Record<string, unknown>> {
  const flag = { type: "boolean" };
  return {
    ...header("lanes", "agent-factory lanes file"),
    type: "object",
    required: ["lanes"],
    properties: {
      rules: { type: "array", items: { type: "string" } },
      lanes: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["lane", "approval"],
          properties: {
            lane: { enum: [...LANES] },
            approval: flag,
            lenses: {
              oneOf: [
                { type: "integer", minimum: 1 },
                { type: "string", pattern: "^\\s*(all\\b|~?\\s*[1-9]\\d*\\b)" },
              ],
            },
            design_review: flag,
            test_first: flag,
            starts_on: { type: "string" },
            retro: { type: "string" },
          },
          // the approval floor: tiny, or a lane that needs a human's approval
          anyOf: [{ properties: { lane: { const: "tiny" } } }, { properties: { approval: { const: true } } }],
        },
      },
    },
  };
}

// findingSchema : one finding of a finder run's answer, {"findings": [ … ]}; the engine adds the lens itself
function findingSchema(): Readonly<Record<string, unknown>> {
  return {
    ...header("finding", "agent-factory finding (a finder run's answer holds a list of these)"),
    ...FINDING_SCHEMA,
  };
}

export type ContractPart = "card" | "lanes" | "finding";

// contractSchemas : each part's JSON schema, as the package publishes it. Pure.
export function contractSchemas(): Readonly<Record<ContractPart, Readonly<Record<string, unknown>>>> {
  return { card: cardSchema(), lanes: lanesSchema(), finding: findingSchema() };
}

// schemaText : a part's schema as its file holds it. Pure.
export function schemaText(part: ContractPart): string {
  return `${JSON.stringify(contractSchemas()[part], null, 2)}\n`;
}
