// pack-schema — the rules pack's own format, read from the pack (#484; P18). The repos are one-way: the rules pack
// (chiyanram/skills, or a team's own) publishes the format of its cards, lanes and findings as JSON schemas, and the
// engine is one user of it. The engine reads the pack's schemas and checks the pack's files against them before it uses
// them, on top of its own checks (cards.ts, lane.ts):
//
//   <plugin>/skills/<skill>/process/schema/card-v<N>.schema.json      a role card's frontmatter
//   <plugin>/skills/<skill>/process/schema/lanes-v<N>.schema.json     the lanes file
//   <plugin>/skills/<skill>/process/schema/finding-v<N>.schema.json   one finding of a finder run's answer
//
// Each part has its own format version: the N in its file name. The engine reads each part at its own version and the
// one before (PACK_FORMAT, PACK_SUPPORTED; as the plugin protocol does, plugin/contract.ts): card 2 and 1, lanes and
// finding 1 and 0, and uses the highest of them the pack ships. Card v2 adds edit-scope to enforced_guardrails, which
// the engine already enforces (guardrails.ts), so it changes the format and not what a run gets. When a part
// is at no version the engine reads, the whole pack is refused, naming that part and both versions. A newer version beside a readable one is
// left for the engine that reads it, as the pack's contract says: a new version is a new file beside the old one
// (skills docs/DESIGN.md). A pack with no schema folder, from before the pack published its format, has no parts and is
// read by the engine's own checks alone. Lanes v1 checks lanes.json; a later version's data file is named by the
// ticket that reads it.
//
// The checker knows the keywords the pack's schemas use (draft 2020-12): type, enum, const, pattern, minLength,
// minItems, items (a schema or false), prefixItems, required, properties, additionalProperties (false), allOf and anyOf.
// A schema that uses any other keyword is refused, so it never asks for a check this file does not run. The finding
// schema is read and kept for the finder's run from its card (#438); today the finder runs from the built-in prompt.
// A pack's card schema may allow no role or guardrail ID the engine does not know, so a pack never names a guardrail the
// engine would skip.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../forge/api.js";

export type PackPart = "card" | "lanes" | "finding";

export const PACK_FORMAT: Readonly<Record<PackPart, number>> = { card: 2, lanes: 1, finding: 1 };

function andBefore(version: number): readonly number[] {
  return [version, version - 1];
}

export const PACK_SUPPORTED: Readonly<Record<PackPart, readonly number[]>> = {
  card: andBefore(PACK_FORMAT.card),
  lanes: andBefore(PACK_FORMAT.lanes),
  finding: andBefore(PACK_FORMAT.finding),
};
export type Schema = boolean | { readonly [key: string]: unknown };
export type PackSchemas = {
  readonly versions: Readonly<Partial<Record<PackPart, number>>>;
  readonly parts: Readonly<Partial<Record<PackPart, Schema>>>;
};

const FILE = /^(card|lanes|finding)-v(\d+)\.schema\.json$/;
const ANNOTATIONS = new Set(["$schema", "$id", "title", "description", "deprecated", "$comment"]);
const KEYWORDS = new Set([
  "type",
  "enum",
  "const",
  "pattern",
  "minLength",
  "minItems",
  "items",
  "prefixItems",
  "required",
  "properties",
  "additionalProperties",
  "allOf",
  "anyOf",
]);

function failed(reason: string): { readonly kind: "failed"; readonly reason: string } {
  return { kind: "failed", reason };
}

function isObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asSchema(value: unknown): Schema {
  return typeof value === "boolean" || isObject(value) ? value : {};
}

function listAt(schema: Schema, key: string): readonly unknown[] {
  const value = typeof schema === "boolean" ? undefined : schema[key];
  return Array.isArray(value) ? value : [];
}

function objectAt(schema: Schema, key: string): { readonly [key: string]: unknown } {
  const value = typeof schema === "boolean" ? undefined : schema[key];
  return isObject(value) ? value : {};
}

export function unknownKeywords(schema: Schema, where = "#"): readonly string[] {
  if (typeof schema === "boolean") {
    return [];
  }
  const own = Object.keys(schema)
    .filter((k) => !KEYWORDS.has(k) && !ANNOTATIONS.has(k))
    .map((k) => `${where}: unsupported keyword "${k}"`);
  return [...own, ...nestedUnknown(schema, where)];
}

function nestedUnknown(schema: { readonly [key: string]: unknown }, where: string): readonly string[] {
  const single = ["items", "additionalProperties"].flatMap((k) =>
    isObject(schema[k]) ? unknownKeywords(asSchema(schema[k]), `${where}/${k}`) : [],
  );
  const named = Object.entries(objectAt(schema, "properties")).flatMap(([name, sub]) =>
    unknownKeywords(asSchema(sub), `${where}/properties/${name}`),
  );
  const lists = ["prefixItems", "allOf", "anyOf"].flatMap((k) =>
    listAt(schema, k).flatMap((sub, n) => unknownKeywords(asSchema(sub), `${where}/${k}/${n}`)),
  );
  return [...single, ...named, ...lists];
}

type Obj = { readonly [key: string]: unknown };

const TYPE_TESTS: Readonly<Record<string, (value: unknown) => boolean>> = {
  integer: (v) => Number.isSafeInteger(v),
  number: (v) => typeof v === "number",
  string: (v) => typeof v === "string",
  boolean: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  object: (v) => isObject(v),
  null: (v) => v === null,
};

function isType(value: unknown, name: unknown): boolean {
  const test = typeof name === "string" ? TYPE_TESTS[name] : undefined;
  return test?.(value) ?? false;
}

function shown(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

function only(holds: boolean, line: string): readonly string[] {
  return holds ? [line] : [];
}

function placeOf(where: string): string {
  return where === "" ? "the top level" : where;
}

function numberAt(schema: Obj, key: string): number {
  const value = schema[key];
  return typeof value === "number" ? value : 0;
}

function typeProblems(value: unknown, schema: Obj, at: string): readonly string[] {
  const types = schema.type;
  if (types === undefined) {
    return [];
  }
  const names = Array.isArray(types) ? types : [types];
  return only(!names.some((n) => isType(value, n)), `${at}: ${shown(value)} is not ${names.join(" or ")}`);
}

function enumProblems(value: unknown, schema: Obj, at: string): readonly string[] {
  const listed = schema.enum;
  if (!Array.isArray(listed)) {
    return [];
  }
  const known = listed.some((e) => shown(e) === shown(value));
  return only(!known, `${at}: ${shown(value)} is not one of ${listed.map(String).join(", ")}`);
}

function constProblems(value: unknown, schema: Obj, at: string): readonly string[] {
  return only(
    "const" in schema && shown(schema.const) !== shown(value),
    `${at}: ${shown(value)} is not ${shown(schema.const)}`,
  );
}

function patternProblems(value: string, schema: Obj, at: string): readonly string[] {
  const pattern = schema.pattern;
  return typeof pattern === "string"
    ? only(!new RegExp(pattern, "u").test(value), `${at}: ${shown(value)} does not match ${pattern}`)
    : [];
}

function stringProblems(value: unknown, schema: Obj, at: string): readonly string[] {
  if (typeof value !== "string") {
    return [];
  }
  return [
    ...only(value.length < numberAt(schema, "minLength"), `${at}: is empty`),
    ...patternProblems(value, schema, at),
  ];
}

function itemProblems(value: readonly unknown[], schema: Obj, where: string): readonly string[] {
  const prefix = listAt(schema, "prefixItems");
  const rest = "items" in schema ? asSchema(schema.items) : true;
  return value.flatMap((item, n) => validate(item, n < prefix.length ? asSchema(prefix[n]) : rest, `${where}[${n}]`));
}

function arrayProblems(value: unknown, schema: Obj, where: string): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const least = numberAt(schema, "minItems");
  const few = only(value.length < least, `${placeOf(where)}: has ${value.length} items, needs at least ${least}`);
  return [...few, ...itemProblems(value, schema, where)];
}

function fieldProblems(key: string, item: unknown, schema: Obj, where: string): readonly string[] {
  const properties = objectAt(schema, "properties");
  if (key in properties) {
    return validate(item, asSchema(properties[key]), where === "" ? key : `${where}.${key}`);
  }
  return only(schema.additionalProperties === false, `${placeOf(where)}: "${key}" is not a known field`);
}

function objectProblems(value: unknown, schema: Obj, where: string): readonly string[] {
  if (!isObject(value)) {
    return [];
  }
  const missing = listAt(schema, "required")
    .filter((k) => typeof k === "string" && !(k in value))
    .map((k) => `${placeOf(where)}: "${String(k)}" is missing`);
  const fields = Object.entries(value).flatMap(([key, item]) => fieldProblems(key, item, schema, where));
  return [...missing, ...fields];
}

function combinedProblems(value: unknown, schema: Obj, where: string): readonly string[] {
  const all = listAt(schema, "allOf").flatMap((sub) => validate(value, asSchema(sub), where));
  const options = listAt(schema, "anyOf");
  const tries = options.map((sub) => validate(value, asSchema(sub), where));
  const none = options.length > 0 && tries.every((t) => t.length > 0);
  const firsts = tries.map((t) => t[0] ?? "").join("; ");
  return [...all, ...only(none, `${placeOf(where)}: matches no allowed form (${firsts})`)];
}

export function validate(value: unknown, schema: Schema, where = ""): readonly string[] {
  if (typeof schema === "boolean") {
    return only(!schema, `${placeOf(where)}: not allowed`);
  }
  const at = placeOf(where);
  const typed = typeProblems(value, schema, at);
  if (typed.length > 0) {
    return typed;
  }
  return [
    ...enumProblems(value, schema, at),
    ...constProblems(value, schema, at),
    ...stringProblems(value, schema, at),
    ...arrayProblems(value, schema, where),
    ...objectProblems(value, schema, where),
    ...combinedProblems(value, schema, where),
  ];
}

function frontValue(raw: string): string | readonly string[] {
  return raw.startsWith("[") && raw.endsWith("]")
    ? raw
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "")
    : raw;
}

export function frontmatterOf(text: string): Readonly<Record<string, string | readonly string[]>> {
  const head = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  return Object.fromEntries(
    head.split("\n").flatMap((line) => {
      const m = /^([a-z_]+):\s*(.*)$/.exec(line);
      return m === null ? [] : [[m[1] ?? "", frontValue((m[2] ?? "").trim())]];
    }),
  );
}

const PARTS: ReadonlySet<string> = new Set(["card", "lanes", "finding"]);

function isPart(name: string | undefined): name is PackPart {
  return name !== undefined && PARTS.has(name);
}

type SchemaFile = { readonly part: PackPart; readonly version: number; readonly file: string };

function schemaFileOf(file: string): readonly SchemaFile[] {
  const m = FILE.exec(file);
  const part = m?.[1];
  return isPart(part) ? [{ part, version: Number(m?.[2]), file }] : [];
}

function versionsIn(files: readonly string[]): ReadonlyMap<PackPart, readonly SchemaFile[]> {
  const found = new Map<PackPart, SchemaFile[]>();
  for (const entry of files.flatMap(schemaFileOf)) {
    found.set(entry.part, [...(found.get(entry.part) ?? []), entry]);
  }
  return found;
}

function inUse(dir: string, part: PackPart, shipped: readonly SchemaFile[]): Result<SchemaFile> {
  const newestFirst = shipped.toSorted((a, b) => b.version - a.version);
  const supported = PACK_SUPPORTED[part];
  const use = newestFirst.find((f) => supported.includes(f.version));
  if (use !== undefined) {
    return { kind: "ok", value: use };
  }
  const newest = newestFirst[0]?.version;
  return failed(
    `${dir}: the rules pack's ${part} format is version ${newest}; this engine reads versions ${supported.join(" and ")}. Update agent-factory, or pin an older rules pack`,
  );
}

const NOT_JSON = Symbol("not JSON");

function parsedJson(text: string | undefined): unknown {
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return NOT_JSON;
  }
}

async function schemaAt(path: string): Promise<Result<Schema>> {
  const parsed = parsedJson(await readFile(path, "utf8").catch(() => undefined));
  if (parsed === NOT_JSON) {
    return failed(`${path}: is not JSON`);
  }
  if (typeof parsed !== "boolean" && !isObject(parsed)) {
    return failed(`${path}: cannot be read as a JSON schema`);
  }
  const unknown = unknownKeywords(parsed);
  return unknown.length === 0 ? { kind: "ok", value: parsed } : failed(`${path}: ${unknown.join("; ")}`);
}

export async function readPackSchemas(processDir: string): Promise<Result<PackSchemas>> {
  const dir = join(processDir, "schema");
  const versions: Partial<Record<PackPart, number>> = {};
  const parts: Partial<Record<PackPart, Schema>> = {};
  const files = (await readdir(dir).catch((): string[] => [])).toSorted();
  for (const [part, shipped] of versionsIn(files)) {
    const use = inUse(dir, part, shipped);
    if (use.kind === "failed") {
      return use;
    }
    const schema = await schemaAt(join(dir, use.value.file));
    if (schema.kind === "failed") {
      return schema;
    }
    versions[part] = use.value.version;
    parts[part] = schema.value;
  }
  return { kind: "ok", value: { versions, parts } };
}

function enumsUnder(schema: unknown): readonly unknown[] {
  if (Array.isArray(schema)) {
    return schema.flatMap(enumsUnder);
  }
  if (!isObject(schema)) {
    return [];
  }
  const own = Array.isArray(schema.enum) ? schema.enum : [];
  return [...own, ...Object.entries(schema).flatMap(([k, v]) => (k === "enum" ? [] : enumsUnder(v)))];
}

export function unknownToEngine(
  schemas: PackSchemas,
  known: { readonly roles: readonly string[]; readonly guardrails: readonly string[] },
): readonly string[] {
  const card = schemas.parts.card;
  const properties = card === undefined ? {} : objectAt(card, "properties");
  const roles = enumsUnder(properties.role).filter((r) => !known.roles.includes(String(r)));
  const guardrails = enumsUnder(properties.enforced_guardrails).filter((g) => !known.guardrails.includes(String(g)));
  return [
    ...roles.map(
      (r) => `the rules pack's card format allows the role ${JSON.stringify(r)}, which this engine does not know`,
    ),
    ...guardrails.map(
      (g) =>
        `the rules pack's card format allows the guardrail ${JSON.stringify(g)}, which this engine does not enforce`,
    ),
  ];
}

export function packProblem(schemas: PackSchemas, part: PackPart, value: unknown, from: string): string {
  const schema = schemas.parts[part];
  const found = schema === undefined ? [] : validate(value, schema);
  return found.length === 0
    ? ""
    : `${from}: does not follow the rules pack's ${part} format (version ${schemas.versions[part]}): ${found.join("; ")}`;
}
