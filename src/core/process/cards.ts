// cards — one role card per role, read from the project's process plugin, or the engine's built-in card when no
// plugin holds one (#236, #232, #235; docs/DESIGN.md section 5 "The process plugin"):
//
//   <plugin>/skills/<skill>/process/roles/<role>.md     the process plugin's card (read.ts finds the process folder)
//   prompts/roles/<role>.md                             the engine's built-in card
//
// A card is frontmatter, then the body the model reads. The engine enforces the frontmatter where it has the control:
//   role          the card names the role it is read for
//   tools         only tools the engine gives that role; the run then gets the card's tools and no others. An Edit may
//                 carry a path scope in Claude Code's permission syntax, Edit(src/test/**): an edit outside it blocks
//                 the run (writer/scope.ts, #424). Only Edit takes one. "Bash (on the runner)", with a space, is a note
//   enforced_guardrails  a [list] of IDs from the engine's closed list (guardrails.ts): an unknown ID, or one the role
//                 cannot have, refuses the card. The role's floor always applies. Plain text is the old form: read for
//                 one release and ignored, then refused (#424)
//   must_not_see  what the engine leaves out of the run's input, on top of the role's own floor (MUST_NOT_SEE), which no
//                 card can drop; a card that leaves out an input the run cannot do without is refused at the run
//   hand_off      every field it names in {…} is a field of the engine's schema for the role (HAND_OFF), and what the
//                 run returns is read with that schema (report.ts, design/findings.ts, review/verdicts.ts)
// Every other field (steps, input, rules) is the card's own text: the engine reads no meaning into it. next is dropped:
// the lanes hold the flow; a card that still has it is read for one release, then refused (#424). Every run record carries the card's hash, so a person can tell which card a run used.
// A plugin's card is also checked against the rules pack's own card schema, when the pack ships one (pack-schema.ts,
// #484): the pack owns its format, and the engine reads this version and the one before.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "../forge/api.js";
import { DESIGN_SCHEMA } from "../design/findings.js";
import { REPORT_FIELDS } from "../report.js";
import { VERIFY_SCHEMA } from "../review/verdicts.js";
import { ANSWER_SCHEMA } from "../onboard/answer.js";
import { allowedGuardrails, GUARDRAIL_FLOOR, isGuardrail, type GuardrailId } from "./guardrails.js";
import { frontmatterOf, packProblem, readPackSchemas } from "./pack-schema.js";
import { findProcess, type PluginDir } from "./read.js";

const BUILT_IN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "prompts", "roles");

const WRITES = ["Read", "Grep", "Glob", "Edit", "Bash"] as const;
const READS = ["Read", "Grep", "Glob"] as const;

// the roles whose runs the engine starts from a card, and the tools it gives each one
export const ROLE_TOOLS = {
  implementer: WRITES,
  "test-first": WRITES,
  cleanup: WRITES,
  "design-reviewer": READS,
  "verify-pass": READS,
  // its Bash is the build tool's help and task list only: the engine lists the commands itself and hands the run the
  // list, so the run gets the read-only tools alone (#235; onboard/run.ts)
  onboarder: [...READS, "Bash"],
} as const;

export type Role = keyof typeof ROLE_TOOLS;

// the role's floor: what the engine never hands its run, whatever the card says (docs/DESIGN.md section 5)
export const MUST_NOT_SEE: Readonly<Record<Role, readonly string[]>> = {
  implementer: ["review findings other than the act_on list", "earlier verdicts"],
  "test-first": ["any fix", "the implementer's work"],
  cleanup: ["review findings", "earlier verdicts"],
  "design-reviewer": ["the coordinator's conversation with the human"],
  "verify-pass": ["the implementer's report", "the coordinator's conversation with the human"],
  onboarder: [],
};

// fieldsOf : every property name a JSON schema names, at any depth. Pure.
function fieldsOf(schema: string): readonly string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) {
      return;
    }
    const properties: unknown = Reflect.get(node, "properties");
    if (typeof properties === "object" && properties !== null) {
      found.push(...Object.keys(properties));
    }
    Object.values(node).forEach(walk);
  };
  walk(JSON.parse(schema) as unknown);
  return found;
}

// the fields of the engine's schema for what each role's run returns
export const HAND_OFF: Readonly<Record<Role, readonly string[]>> = {
  implementer: REPORT_FIELDS,
  "test-first": REPORT_FIELDS,
  cleanup: REPORT_FIELDS,
  "design-reviewer": fieldsOf(DESIGN_SCHEMA),
  "verify-pass": fieldsOf(VERIFY_SCHEMA),
  onboarder: fieldsOf(ANSWER_SCHEMA),
};

export type Card = {
  readonly role: Role;
  // what the model reads: the card without its frontmatter
  readonly body: string;
  // the tools the run gets: the card's, each one the engine gives the role
  readonly tools: readonly string[];
  // what the run must not see: the role's floor, then the card's own entries
  readonly mustNotSee: readonly string[];
  // the guardrails that apply to the run: the role's floor, then the card's own IDs (guardrails.ts)
  readonly guardrails: readonly GuardrailId[];
  // where the run may edit, as globs from its Edit(…) scopes; none is anywhere in the clone
  readonly editScope: readonly string[];
  // the sha256 of the whole card file, for the run record
  readonly sha256: string;
  // where it came from, as a person reads it
  readonly from: string;
};

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

const FRONT = /^---\n([\s\S]*?)\n---\n/;

// field : one "name: value" line of the frontmatter, or undefined when it has none. Pure.
function field(front: string, name: string): string | undefined {
  const line = front.split("\n").find((l) => l.startsWith(`${name}:`));
  return line?.slice(name.length + 1).trim();
}

// a card's tool: its name, and its path scope in permission syntax; "" for none
type Tool = { readonly name: string; readonly scope: string };

const SCOPED = /^(\w+)\(([^()]*)\)$/;

// toolOf : one entry of the tools list: Edit(src/test/**) has a scope; "Bash (on the runner)" is Bash with a note. Pure.
function toolOf(entry: string): Tool {
  const scoped = SCOPED.exec(entry);
  return scoped === null
    ? { name: entry.split(/\s/)[0] ?? "", scope: "" }
    : { name: scoped[1] ?? "", scope: (scoped[2] ?? "").trim() };
}

// listOf : a frontmatter list's entries, with or without its [brackets]. Pure.
function listOf(list: string): readonly string[] {
  return list
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

function toolListOf(list: string): readonly Tool[] {
  return listOf(list)
    .map(toolOf)
    .filter((t) => t.name !== "");
}

// toolsOf : the frontmatter's tools list, each tool by its name alone. Pure.
function toolsOf(list: string): readonly string[] {
  return toolListOf(list).map((t) => t.name);
}

// scopeOf : the globs of the card's Edit(…) scopes; none is anywhere. Pure.
function scopeOf(list: string): readonly string[] {
  return toolListOf(list).flatMap((t) => (t.name === "Edit" && t.scope !== "" ? [t.scope] : []));
}

// entriesOf : the must_not_see list, one entry per ";"; "none" is none. Pure.
function entriesOf(list: string | undefined): readonly string[] {
  return (list ?? "")
    .split(";")
    .map((e) => e.trim())
    .filter((e) => e !== "" && e.toLowerCase() !== "none");
}

// handOffFields : each name the hand-off lists inside a {…}: the words before each top-level ":" or ",". A list in
// [brackets] is a value, never a name. Pure.
export function handOffFields(handOff: string): readonly string[] {
  const groups = [...handOff.matchAll(/\{([^{}]*)\}/g)].map((m) => (m[1] ?? "").replace(/\[[^\]]*\]/g, ""));
  return groups.flatMap((g) => g.split(",").map((f) => (f.split(":")[0] ?? "").trim()));
}

// toolsProblem : why the card's tools do not fit its role, or "". Pure.
function toolsProblem(role: Role, tools: string | undefined): string {
  const allowed: readonly string[] = ROLE_TOOLS[role];
  const asked = toolsOf(tools ?? "");
  if (asked.length === 0) {
    return `the card names no tools; the ${role} may have ${allowed.join(", ")}`;
  }
  const extra = asked.filter((t) => !allowed.includes(t));
  return extra.length === 0
    ? scopeProblem(tools ?? "")
    : `the ${role} gets only ${allowed.join(", ")}; the card asks for ${extra.join(", ")}`;
}

// scopeProblem : a path scope on a tool other than Edit, or "". Pure.
function scopeProblem(tools: string): string {
  const other = toolListOf(tools).find((t) => t.scope !== "" && t.name !== "Edit");
  return other === undefined ? "" : `only Edit takes a path scope; the card gives ${other.name}(${other.scope})`;
}

// namedGuardrails : the IDs a card's enforced_guardrails names; none for the old plain text, read for one release.
// Pure.
function namedGuardrails(value: string | undefined): readonly string[] {
  return value?.startsWith("[") === true ? listOf(value) : [];
}

// guardrailsProblem : an ID that is not on the list, one the role cannot have, or edit-scope with no Edit(…) scope;
// "". Pure.
function guardrailsProblem(role: Role, front: string): string {
  const named = namedGuardrails(field(front, "enforced_guardrails"));
  const unknown = named.find((id) => !isGuardrail(id));
  if (unknown !== undefined) {
    return `the card's enforced_guardrails names ${JSON.stringify(unknown)}, which is not a guardrail ID the engine enforces`;
  }
  return roleGuardrailProblem(role, named) || scopeGuardrailProblem(named, field(front, "tools") ?? "");
}

// roleGuardrailProblem : an ID the role cannot have, or "". Pure.
function roleGuardrailProblem(role: Role, named: readonly string[]): string {
  const allowed: readonly string[] = allowedGuardrails(role);
  const other = named.find((id) => !allowed.includes(id));
  return other === undefined
    ? ""
    : `the ${role} cannot have the guardrail ${other} (it may have ${allowed.join(", ")})`;
}

// scopeGuardrailProblem : edit-scope named with no Edit(…) path to hold it to, or "". Pure.
function scopeGuardrailProblem(named: readonly string[], tools: string): string {
  return named.includes("edit-scope") && scopeOf(tools).length === 0
    ? "the card names edit-scope, but its tools give no Edit(…) path"
    : "";
}

// guardrailsOf : the guardrails that apply to the run: the role's floor, the card's IDs, and edit-scope when an Edit
// has a scope. The card passed guardrailsProblem. Pure.
function guardrailsOf(role: Role, front: string): readonly GuardrailId[] {
  const named = namedGuardrails(field(front, "enforced_guardrails")).filter(isGuardrail);
  const scoped: readonly GuardrailId[] = scopeOf(field(front, "tools") ?? "").length > 0 ? ["edit-scope"] : [];
  return [...new Set([...GUARDRAIL_FLOOR[role], ...named, ...scoped])];
}

// handOffProblem : the hand-off's fields that the engine's schema for the role does not have, or "". Pure.
function handOffProblem(role: Role, handOff: string | undefined): string {
  const unknown = handOffFields(handOff ?? "").filter((f) => !HAND_OFF[role].includes(f));
  return unknown.length === 0
    ? ""
    : `the card's hand_off names ${unknown.map((f) => JSON.stringify(f)).join(", ")}, which the engine's ${role} schema does not have (it has ${HAND_OFF[role].join(", ")})`;
}

// frontProblem : why a card's frontmatter does not fit the role it is read for, or "". Pure.
function frontProblem(role: Role, front: string): string {
  const named = field(front, "role") ?? "";
  if (named !== role) {
    return `the card names the role ${JSON.stringify(named)}, not ${role}`;
  }
  return (
    toolsProblem(role, field(front, "tools")) ||
    handOffProblem(role, field(front, "hand_off")) ||
    guardrailsProblem(role, front)
  );
}

// cardOf : a card's text, checked against the role it is read for. Pure.
export function cardOf(role: Role, text: string, from: string): Result<Card> {
  const front = FRONT.exec(text);
  if (front === null) {
    return failed(`${from}: a role card starts with its frontmatter between two --- lines`);
  }
  const head = front[1] ?? "";
  const problem = frontProblem(role, head);
  if (problem !== "") {
    return failed(`${from}: ${problem}`);
  }
  return { kind: "ok", value: cardFrom(role, { text, head, body: text.slice(front[0].length), from }) };
}

// cardFrom : the card a checked text gives. Pure.
function cardFrom(
  role: Role,
  read: { readonly text: string; readonly head: string; readonly body: string; readonly from: string },
): Card {
  const tools = field(read.head, "tools") ?? "";
  return {
    role,
    body: read.body.trim(),
    tools: [...new Set(toolsOf(tools))],
    mustNotSee: [...MUST_NOT_SEE[role], ...entriesOf(field(read.head, "must_not_see"))],
    guardrails: guardrailsOf(role, read.head),
    editScope: scopeOf(tools),
    sha256: createHash("sha256").update(read.text, "utf8").digest("hex"),
    from: read.from,
  };
}

// ---- must_not_see

// one input the engine hands a run: the words a card may call it by, the first its name; needed when the run cannot do
// its job without it
export type Part = { readonly names: readonly [string, ...string[]]; readonly needed: boolean };

// plain : words as an entry and a name are compared: lower case, one space, no leading "the" or "any". Pure.
function plain(words: string): string {
  return words
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|any) /, "");
}

// names : an entry names a part when it is one of the part's names, or one of them and more words ("the implementer's
// report or account" names "the implementer's report"). Pure.
function names(entry: string, part: Part): boolean {
  const said = plain(entry);
  return part.names.map(plain).some((n) => said === n || said.startsWith(`${n} `) || said.startsWith(`${n},`));
}

// withheld : whether the card's must_not_see leaves the part out: an entry names it, and its "other than …" does not.
// Pure.
export function withheld(card: Pick<Card, "mustNotSee">, part: Part): boolean {
  return card.mustNotSee.some((entry) => {
    const [what = "", but] = entry.split(/ other than /i);
    return names(what, part) && (but === undefined || !names(but, part));
  });
}

// inputsOf : the parts the run gets, with what the card leaves out removed; a card that leaves out a part the run
// needs is refused, never run without it. Pure.
export function inputsOf<P extends Part>(card: Card, parts: readonly P[]): Result<readonly P[]> {
  const needed = parts.find((p) => p.needed && withheld(card, p));
  return needed === undefined
    ? { kind: "ok", value: parts.filter((p) => !withheld(card, p)) }
    : failed(`${card.from}: its must_not_see leaves out ${needed.names[0]}, which the ${card.role} run needs`);
}

// ---- reading

async function textAt(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch(() => undefined);
}

// pluginCard : the process plugin's card for the role; "none" when no plugin holds a process, or the process holds no
// card for the role. Two process plugins are refused (#426).
async function pluginCard(plugins: readonly PluginDir[], role: Role): Promise<Result<Card> | "none"> {
  const found = await findProcess(plugins);
  if (found.kind !== "ok") {
    return found.kind === "none" ? "none" : found;
  }
  const path = join(found.value.dir, "roles", `${role}.md`);
  const text = await textAt(path);
  return text === undefined ? "none" : packCard(found.value.dir, role, text, `${found.value.plugin.label} (${path})`);
}

// packCard : a plugin's card, checked against the rules pack's own card format, then by the engine (#484)
async function packCard(processDir: string, role: Role, text: string, from: string): Promise<Result<Card>> {
  const schemas = await readPackSchemas(processDir);
  if (schemas.kind === "failed") {
    return schemas;
  }
  const problem = packProblem(schemas.value, "card", frontmatterOf(text), from);
  return problem === "" ? cardOf(role, text, from) : failed(problem);
}

// readCard : the role's card from the project's process plugin, or the built-in card when none holds one. A card that
// is there but does not pass its check is refused, never skipped for the built-in one.
export async function readCard(plugins: readonly PluginDir[], role: Role, builtIn = BUILT_IN): Promise<Result<Card>> {
  const found = await pluginCard(plugins, role);
  if (found !== "none") {
    return found;
  }
  const path = join(builtIn, `${role}.md`);
  const text = await textAt(path);
  return text === undefined ? failed(`cannot read the built-in ${role} card at ${path}`) : cardOf(role, text, path);
}
