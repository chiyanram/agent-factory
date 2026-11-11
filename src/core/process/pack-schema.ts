// pack-schema — the rules pack's own format, read from the pack (#484; P18). The repos are one-way: the rules pack
// (chiyanram/skills, or a team's own) publishes the format of its cards, lanes and findings as JSON schemas, and the
// engine is one user of it. The engine reads the pack's schemas and checks the pack's files against them before it uses
// them, on top of its own checks (cards.ts, lane.ts):
//
//   <plugin>/skills/<skill>/process/schema/card-v<N>.schema.json      a role card's frontmatter
//   <plugin>/skills/<skill>/process/schema/lanes-v<N>.schema.json     the lanes file
//   <plugin>/skills/<skill>/process/schema/finding-v<N>.schema.json   one finding of a finder run's answer
//
// The pack's format version is the highest N it ships. The engine reads this version and the one before (PACK_SUPPORTED),
// as the plugin protocol does (plugin/contract.ts); a pack with no schema folder is version 0, from before the pack
// published its format, and is read by the engine's own checks alone. A newer version is refused, naming both, so an
// old engine never half-reads a new pack.
//
// The checker knows the keywords the pack's schemas use (draft 2020-12): type, enum, const, pattern, minLength,
// minItems, items (a schema or false), prefixItems, required, properties, additionalProperties (false), allOf and anyOf.
// A schema that uses any other keyword is refused, so it never asks for a check this file does not run. The finding
// schema is read and kept for the finder's run from its card (#438); today the finder runs from the built-in prompt.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../forge/api.js";

export const PACK_FORMAT = 1;
export const PACK_SUPPORTED: readonly number[] = [PACK_FORMAT, PACK_FORMAT - 1];

export type PackPart = "card" | "lanes" | "finding";
export type Schema = boolean | { readonly [key: string]: unknown };
export type PackSchemas = {
  readonly version: number;
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

// ---- the keywords a schema uses

// unknownKeywords : every keyword the checker does not run, anywhere in the schema. Pure.
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

// ---- checking a value

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

// only : the line when the problem holds, else none. Pure.
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

// validate : each way a value breaks a schema, as one line naming where. Pure.
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

// ---- a card's frontmatter as the pack's schema reads it

// frontValue : a frontmatter value: "[a, b]" is a list, anything else a string. Pure.
function frontValue(raw: string): string | readonly string[] {
  return raw.startsWith("[") && raw.endsWith("]")
    ? raw
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "")
    : raw;
}

// frontmatterOf : a card's frontmatter fields, each a string or a [list], as the pack's own check reads them. Pure.
export function frontmatterOf(text: string): Readonly<Record<string, string | readonly string[]>> {
  const head = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  return Object.fromEntries(
    head.split("\n").flatMap((line) => {
      const m = /^([a-z_]+):\s*(.*)$/.exec(line);
      return m === null ? [] : [[m[1] ?? "", frontValue((m[2] ?? "").trim())]];
    }),
  );
}

// ---- reading the pack's schemas

const PARTS: ReadonlySet<string> = new Set(["card", "lanes", "finding"]);

function isPart(name: string | undefined): name is PackPart {
  return name !== undefined && PARTS.has(name);
}

type SchemaFile = { readonly part: PackPart; readonly version: number; readonly file: string };

// schemaFileOf : a file of the schema folder, when it is a part's schema at a version. Pure.
function schemaFileOf(file: string): readonly SchemaFile[] {
  const m = FILE.exec(file);
  const part = m?.[1];
  return isPart(part) ? [{ part, version: Number(m?.[2]), file }] : [];
}

// versionsIn : each part's schema files in the pack's schema folder, by version. Pure.
function versionsIn(files: readonly string[]): ReadonlyMap<number, readonly SchemaFile[]> {
  const found = new Map<number, SchemaFile[]>();
  for (const entry of files.flatMap(schemaFileOf)) {
    found.set(entry.version, [...(found.get(entry.version) ?? []), entry]);
  }
  return found;
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

// readPackSchemas : the pack's format from its process folder: the highest version it ships, and each part's schema at
// that version; version 0, with none, when it has no schema folder. A version this engine does not read is refused.
export async function readPackSchemas(processDir: string): Promise<Result<PackSchemas>> {
  const dir = join(processDir, "schema");
  const versions = versionsIn(await readdir(dir).catch((): string[] => []));
  const version = Math.max(0, ...versions.keys());
  if (!PACK_SUPPORTED.includes(version)) {
    return failed(
      `${dir}: the rules pack's format is version ${version}; this engine reads versions ${PACK_SUPPORTED.join(" and ")}. Update agent-factory, or pin an older rules pack`,
    );
  }
  const parts: Partial<Record<PackPart, Schema>> = {};
  for (const { part, file } of versions.get(version) ?? []) {
    const schema = await schemaAt(join(dir, file));
    if (schema.kind === "failed") {
      return schema;
    }
    parts[part] = schema.value;
  }
  return { kind: "ok", value: { version, parts } };
}

// packProblem : why a pack's file breaks the pack's own schema for its part, or "" (none for that part, or it holds).
// Pure.
export function packProblem(schemas: PackSchemas, part: PackPart, value: unknown, from: string): string {
  const schema = schemas.parts[part];
  const found = schema === undefined ? [] : validate(value, schema);
  return found.length === 0
    ? ""
    : `${from}: does not follow the rules pack's ${part} format (version ${schemas.version}): ${found.join("; ")}`;
}
