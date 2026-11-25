// write — one settings key changed in a project file's text, every other byte kept, for config set. It is pure:
// the command reads the file, checks the new text and saves it. A key the file holds gets its value replaced in place;
// an absent key goes in at the end of the nearest object the file holds, with its missing parents, at the file's indent.
// Half a policy point brings its other half at the resolved value, because the project file's reader takes a point
// only with both its mode and its cap (plugin/config.ts).

import { prop } from "../field.js";
import type { Result } from "../forge/api.js";
import { KEYS, type Key } from "./keys.js";
import { keyPlaces, pathKey, type Place } from "./lines.js";

export type Change = { readonly path: readonly string[]; readonly value: unknown };

const BLANK = " \t\r\n";

function unitOf(text: string): string {
  return /\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
}

function lineIndent(text: string, at: number): string {
  const from = text.lastIndexOf("\n", at - 1) + 1;
  return /^[ \t]*/.exec(text.slice(from, at))?.[0] ?? "";
}

function rendered(value: unknown, indent: string, unit: string): string {
  return JSON.stringify(value, null, unit).replaceAll("\n", `\n${indent}`);
}

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

function nearestParent(places: ReadonlyMap<string, Place>, path: readonly string[]): number {
  let k = path.length - 1;
  while (k > 0 && !places.has(pathKey(path.slice(0, k)))) {
    k -= 1;
  }
  return k;
}

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

export function withValue(text: string, change: Change): Result<string> {
  const places = keyPlaces(text);
  const at = places.get(pathKey(change.path));
  if (at === undefined) {
    return added(text, places, change);
  }
  const value = rendered(change.value, lineIndent(text, at.start), unitOf(text));
  return { kind: "ok", value: `${text.slice(0, at.start)}${value}${text.slice(at.end)}` };
}

export function withValues(text: string, changes: readonly Change[]): Result<string> {
  return changes.reduce<Result<string>>((r, change) => (r.kind === "ok" ? withValue(r.value, change) : r), {
    kind: "ok",
    value: text,
  });
}

export function valueAt(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((at, part) => prop(at, part), value);
}

function isPolicyHalf(path: readonly string[]): boolean {
  const [top, , half] = path;
  return path.length === 3 && top === "policy" && (half === "mode" || half === "cap");
}

export function partnerOf(key: Key, project: object, resolvedOf: (id: string) => unknown): Change | undefined {
  const [, point, half] = key.path;
  const other = KEYS.find((k) => isPolicyHalf(k.path) && k.path[1] === point && k.path[2] !== half);
  return !isPolicyHalf(key.path) || other === undefined || valueAt(project, other.path) !== undefined
    ? undefined
    : { path: other.path, value: resolvedOf(other.id) };
}
