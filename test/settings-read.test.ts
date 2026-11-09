import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { machineKeys } from "../src/core/settings/keys.js";

// No module reads a settings key's FACTORY_* variable itself: it reads the resolved value through
// src/core/settings/machine.ts settingOf, so a team or user file value reaches it too (#254).

const ROOT = join(import.meta.dirname, "..");

// the modules not yet moved to settingOf, and the variables each still reads. It only shrinks: an entry that is no
// longer read fails this test, so it is taken off when the module moves (#254 follow-up).
const NOT_YET: Readonly<Record<string, readonly string[]>> = {
  "src/loop-cli.ts": ["FACTORY_CLAIM_LABEL", "FACTORY_DRY_RUN"],
  "src/eval-cli.ts": ["FACTORY_DRY_RUN", "FACTORY_MAX_USD", "FACTORY_RULEBOOK"],
  "src/core/forge/index.ts": ["FACTORY_DRY_RUN", "FACTORY_FORGE", "FACTORY_FORGE_HOST", "FACTORY_MAX_TRIES"],
  "src/core/forge/target.ts": ["FACTORY_FORGE"],
  "src/core/ready/plan.ts": ["FACTORY_EGRESS_IMAGE"],
  "src/core/eval/harness.ts": ["FACTORY_MAX_USD"],
  "src/core/egress/upstream.ts": ["FACTORY_UPSTREAM_PROXY"],
  "src/core/identity.ts": ["FACTORY_IDENTITY"],
  "src/core/box/choose.ts": ["FACTORY_BOX"],
};

function sources(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      return sources(path);
    }
    return e.name.endsWith(".ts") ? [path] : [];
  });
}

const NAMES = machineKeys().map((k) => k.env);
// env.FACTORY_X, or the name as a string, as in env["FACTORY_X"] or a reader handed "FACTORY_X"
const READ = new RegExp(`(?:\\.|["'\`])(${NAMES.join("|")})\\b(?!\\s*=[^=])`, "g");

// reads : the settings variables one source reads, by name; comments and the adapter itself do not count
export function reads(text: string): readonly string[] {
  const code = text
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, "").replace(/\s\/\/ .*$/, ""))
    .join("\n");
  return [...new Set([...code.matchAll(READ)].map((m) => m[1] ?? ""))];
}

function found(): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, readonly string[]> = {};
  for (const path of sources(join(ROOT, "src"))) {
    const name = relative(ROOT, path);
    const got = name.startsWith("src/core/settings/") ? [] : reads(readFileSync(path, "utf8"));
    if (got.length > 0) {
      out[name] = got.toSorted();
    }
  }
  return out;
}

describe("settings are read through the one adapter (#254)", () => {
  it("no module reads a settings key's FACTORY_* variable but the ones not yet moved, and those only shrink", () => {
    const sorted = Object.fromEntries(Object.entries(NOT_YET).map(([k, v]) => [k, v.toSorted()]));
    expect(found()).toEqual(sorted);
  });

  it("catches a direct read in every form, and leaves comments, other variables, a test's own env and the adapter's calls alone", () => {
    expect(reads('const a = env.FACTORY_MAX_USD ?? "";')).toEqual(["FACTORY_MAX_USD"]);
    expect(reads('const a = process.env["FACTORY_BOX"];')).toEqual(["FACTORY_BOX"]);
    expect(reads('absolute(env, "FACTORY_RULEBOOK")')).toEqual(["FACTORY_RULEBOOK"]);
    expect(reads('const n = name("FACTORY_WRITER_MODEL");')).toEqual(["FACTORY_WRITER_MODEL"]);
    expect(reads("// env.FACTORY_MAX_USD is the cap")).toEqual([]);
    expect(reads("const a = env.FACTORY_REPO;")).toEqual([]);
    expect(reads('env.FACTORY_MAX_USD = "2";')).toEqual([]);
    expect(reads('const a = settingOf(env, "caps.usdPerRun");')).toEqual([]);
  });
});
