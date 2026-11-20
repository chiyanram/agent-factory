// write — one settings key changed in a project file's text, every other byte kept, for config set (#814). It is pure:
// the command reads the file, checks the new text and saves it. A key the file holds gets its value replaced in place;
// an absent key goes in at the end of the nearest object the file holds, with its missing parents, at the file's indent.

import { prop } from "../dispatch/records.js";
import type { Result } from "../forge/api.js";
import { KEYS, type Key } from "./keys.js";
import { keyPlaces, pathKey, type Place } from "./lines.js";

export type Change = { readonly path: readonly string[]; readonly value: unknown };

const BLANK = " \t\r\n";

// the file's indent unit: the indent of its first member, else two spaces
function unitOf(text: string): string {
  return /\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
}

// the indent of the line that holds text[at]
function lineIndent(text: string, at: number): string {
  const from = text.lastIndexOf("\n", at - 1) + 1;
  return /^[ \t]*/.exec(text.slice(from, at))?.[0] ?? "";
}

function rendered(value: unknown, indent: string, unit: string): string {
  return JSON.stringify(value, null, unit).replaceAll("\n", `\n${indent}`);
}

// inserted : the member name: value added at the end of the object at `parent`
function inserted(text: string, parent: Place, name: string, value: unknown, unit: string): string {
  const close = parent.end - 1;
  let last = close - 1;
  while (last > parent.start && BLANK.includes(text.charAt(last))) {
    last -= 1;
  }
  const outer = lineIndent(text, parent.start);
  const inner = `${outer}${unit}`;
  const member = `${JSON.stringify(name)}: ${rendered(value, inner, unit)}`;
  return last === parent.start
    ? `${text.slice(0, parent.start)}{\n${inner}${member}\n${outer}}${text.slice(parent.end)}`
    : `${text.slice(0, last + 1)},\n${inner}${member}${text.slice(last + 1)}`;
}

// nearestParent : how many leading parts of the path the text holds, the longest first; the root always counts
function nearestParent(places: ReadonlyMap<string, Place>, path: readonly string[]): number {
  let k = path.length - 1;
  while (k > 0 && !places.has(pathKey(path.slice(0, k)))) {
    k -= 1;
  }
  return k;
}

// added : the text with an absent key put in its nearest object the text holds, with its missing parents
function added(text: string, places: ReadonlyMap<string, Place>, change: Change): Result<string> {
  const { path, value } = change;
  const k = nearestParent(places, path);
  const parent = places.get(pathKey(path.slice(0, k)));
  if (parent === undefined || text.charAt(parent.start) !== "{") {
    return { kind: "failed", reason: `${k === 0 ? "the file" : path.slice(0, k).join(".")} is not an object` };
  }
  const nested = path.slice(k + 1).reduceRight<unknown>((v, part) => ({ [part]: v }), value);
  return { kind: "ok", value: inserted(text, parent, path[k] ?? "", nested, unitOf(text)) };
}

// withValue : the text with one key set; a parent that is not an object is refused
export function withValue(text: string, change: Change): Result<string> {
  const places = keyPlaces(text);
  const at = places.get(pathKey(change.path));
  if (at === undefined) {
    return added(text, places, change);
  }
  const value = rendered(change.value, lineIndent(text, at.start), unitOf(text));
  return { kind: "ok", value: `${text.slice(0, at.start)}${value}${text.slice(at.end)}` };
}

// withValues : the text with each change made in turn
export function withValues(text: string, changes: readonly Change[]): Result<string> {
  return changes.reduce<Result<string>>((r, change) => (r.kind === "ok" ? withValue(r.value, change) : r), {
    kind: "ok",
    value: text,
  });
}

// valueAt : the value at a path of a parsed JSON value, or undefined when it holds none
export function valueAt(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((at, part) => prop(at, part), value);
}

// isPolicyHalf : policy.<point>.mode or policy.<point>.cap
function isPolicyHalf(path: readonly string[]): boolean {
  const [top, , half] = path;
  return path.length === 3 && top === "policy" && (half === "mode" || half === "cap");
}

// partnerOf : the other half of a policy point, when the project file lacks it, at its resolved value; the project
// file's reader takes a policy point only with both its mode and its cap (plugin/config.ts)
export function partnerOf(key: Key, project: object, resolvedOf: (id: string) => unknown): Change | undefined {
  const [, point, half] = key.path;
  const other = KEYS.find((k) => isPolicyHalf(k.path) && k.path[1] === point && k.path[2] !== half);
  return !isPolicyHalf(key.path) || other === undefined || valueAt(project, other.path) !== undefined
    ? undefined
    : { path: other.path, value: resolvedOf(other.id) };
}
