// json-schema — a small JSON-schema checker for the schemas the engine writes itself (agent/copilot.ts checks a model's
// answer against the run's schema with it, since that CLI has no --json-schema).
//
// The checker knows these keywords (draft 2020-12): type, enum, const, pattern, minLength, minItems, items (a schema or
// false), prefixItems, required, properties, additionalProperties (false), allOf and anyOf. A schema that uses any other
// keyword is refused (unknownKeywords), so it never asks for a check this file does not run.

export type Schema = boolean | { readonly [key: string]: unknown };
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
