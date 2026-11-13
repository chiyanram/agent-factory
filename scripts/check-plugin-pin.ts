// check-plugin-pin — fails when the sessions in this repo would load a different rules pack from the one the engine
// pins (#580). `.claude/settings.json` declares the chiyanram marketplace at a release tag (`ref`), and
// `.github/rules-pack.json` pins that tag's commit and names the tag. The two must name the same repo and tag; CI also
// checks that the tag still points at the pinned commit (`git ls-remote`, in ci.yml), since this check reads no network.
//
//   node scripts/check-plugin-pin.ts [ROOT]      (make lint)
//
// Runs on Node's type stripping (Node 22.18+), so it uses only erasable TypeScript.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MARKETPLACE = "chiyanram";
const PLUGINS = ["rulebook@chiyanram", "toolbox@chiyanram"];

// at : the value at a path of object keys, or undefined
function at(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((v, k) => (typeof v === "object" && v !== null ? Reflect.get(v, k) : undefined), value);
}

// read : a file's JSON, or undefined when it is missing or not JSON
function read(file: string): unknown {
  if (!existsSync(file)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

// Pins : what the two files say: the marketplace source the sessions load, and the engine's pin
type Pins = { readonly settings: unknown; readonly source: unknown; readonly pin: unknown };

// a rule over the two files: why they fail it, or "" when they pass. Pure.
type Rule = (p: Pins) => string;

const RULES: readonly Rule[] = [
  (p) =>
    at(p.source, ["source"]) === "github" && typeof at(p.source, ["repo"]) === "string"
      ? ""
      : `.claude/settings.json: extraKnownMarketplaces.${MARKETPLACE}.source must be a github repo`,
  (p) =>
    at(p.pin, ["repo"]) === `https://github.com/${String(at(p.source, ["repo"]))}`
      ? ""
      : `.claude/settings.json names ${String(at(p.source, ["repo"]))}; .github/rules-pack.json names ${String(at(p.pin, ["repo"]))}`,
  (p) =>
    typeof at(p.pin, ["tag"]) === "string" && at(p.pin, ["tag"]) !== ""
      ? ""
      : ".github/rules-pack.json: tag must name the release tag its commit is",
  (p) =>
    at(p.source, ["ref"]) === at(p.pin, ["tag"])
      ? ""
      : `.claude/settings.json pins ${String(at(p.source, ["ref"]))}; .github/rules-pack.json pins ${String(at(p.pin, ["tag"]))}`,
  ...PLUGINS.map(
    (plugin): Rule =>
      (p) =>
        at(p.settings, ["enabledPlugins", plugin]) === true
          ? ""
          : `.claude/settings.json: enabledPlugins.${plugin} must be true`,
  ),
];

// pinProblems : why the settings and the rules-pack pin disagree; none when they agree. Pure.
export function pinProblems(settings: unknown, pin: unknown): readonly string[] {
  const pins = { settings, source: at(settings, ["extraKnownMarketplaces", MARKETPLACE, "source"]), pin };
  return RULES.map((rule) => rule(pins)).filter((why) => why !== "");
}

if (process.argv[1] === import.meta.filename) {
  const root = process.argv[2] ?? ".";
  const problems = pinProblems(
    read(join(root, ".claude", "settings.json")),
    read(join(root, ".github", "rules-pack.json")),
  );
  for (const p of problems) {
    console.log(p);
  }
  if (problems.length > 0) {
    process.exit(1);
  }
}
