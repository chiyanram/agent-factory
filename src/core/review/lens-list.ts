// lens-list — the project's lenses as the settings hold them, the key "review.lenses" (#237; docs/DESIGN.md section 5).
// A leaf the settings keys import: it reads and checks the value, and nothing else.
//
//   {"review": {"lenses": [
//     {"name": "security", "rubric": {"plugin": "rulebook", "skill": "crq", "reference": "security"}, "paths": ["src/auth/**"]},
//     {"name": "api", "rubric": {"file": "docs/review/api.md"}, "lanes": ["feature", "one-way door"]}
//   ]}}
//
// A rubric is a skill in an enabled plugin (its SKILL.md, or one of its references when "reference" is given), or a
// file in the repo on the default branch. "paths" and "lanes" are optional; empty or left out matches every file and
// every lane. A name is a plain word and given once.

import { prop } from "../dispatch/records.js";
import { LANES } from "../spec.js";
import type { Lens, Rubric } from "./lenses.js";

// a lens, skill, reference or plugin name the round can join into a path: no slash, no dot
const NAME = /^[A-Za-z0-9_-]+$/;
const PLUGIN = /^[A-Za-z0-9_.@-]+$/;

export const LENSES_HINT =
  'a list of lenses, each {"name", "rubric": {"plugin", "skill", "reference"?} or {"file"}, "paths"?, "lanes"?}, no name twice';

function plain(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

// repoFile : a relative path in the repo, with no way out of it
function repoFile(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    !value.startsWith("/") &&
    !value.split("/").some((part) => part === ".." || part === "") &&
    !/\p{Cc}/u.test(value)
  );
}

function skillRubric(raw: unknown): Rubric | "bad" {
  const [plugin, skill, reference] = [prop(raw, "plugin"), prop(raw, "skill"), prop(raw, "reference")];
  if (!plain(plugin, PLUGIN) || !plain(skill, NAME)) {
    return "bad";
  }
  if (reference === undefined) {
    return { kind: "skill", plugin, skill };
  }
  return plain(reference, NAME) ? { kind: "skill", plugin, skill, reference } : "bad";
}

function rubricOf(raw: unknown): Rubric | "bad" {
  const file = prop(raw, "file");
  if (file !== undefined) {
    return repoFile(file) && prop(raw, "skill") === undefined ? { kind: "file", path: file } : "bad";
  }
  return skillRubric(raw);
}

// words : an optional list of strings, each one `ok` accepts; none for left out
function words(value: unknown, ok: (w: string) => boolean): readonly string[] | "bad" {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) && value.every((w) => typeof w === "string" && ok(w))
    ? value.filter((w): w is string => typeof w === "string")
    : "bad";
}

function isLane(w: string): boolean {
  return LANES.some((l) => l === w);
}

function lensOf(raw: unknown): Lens | "bad" {
  const name = prop(raw, "name");
  const rubric = rubricOf(prop(raw, "rubric"));
  const paths = words(prop(raw, "paths"), (w) => w.trim() !== "");
  const lanes = words(prop(raw, "lanes"), isLane);
  if (!plain(name, NAME) || rubric === "bad") {
    return "bad";
  }
  return paths === "bad" || lanes === "bad" ? "bad" : { name, rubric, paths, lanes };
}

// lensListOf : the lenses a settings value names, in its order; "bad" when it is not a list of them. Pure.
export function lensListOf(value: unknown): readonly Lens[] | "bad" {
  if (!Array.isArray(value)) {
    return "bad";
  }
  const lenses = value.map(lensOf);
  const good = lenses.flatMap((l) => (l === "bad" ? [] : [l]));
  const names = new Set(good.map((l) => l.name));
  return good.length === lenses.length && names.size === good.length ? good : "bad";
}

// checkLenses : "" when a settings value is a good lens list, else what it must be. Pure.
export function checkLenses(value: unknown): string {
  return lensListOf(value) === "bad" ? LENSES_HINT : "";
}
