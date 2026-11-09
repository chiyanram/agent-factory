import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { machineKeys } from "../src/core/settings/keys.js";

// No module reads a settings key's FACTORY_* variable itself: it reads the resolved value through
// src/core/settings/machine.ts settingOf, so a team or user file value reaches it too (#254).

const ROOT = join(import.meta.dirname, "..");

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
// env.FACTORY_X, or the name as a whole string, as in env["FACTORY_X"] or a reader handed "FACTORY_X"; a message that
// names the variable is not a read
const READ = new RegExp(`(?:\\.(${NAMES.join("|")})\\b(?!\\s*=[^=])|["'\`](${NAMES.join("|")})["'\`])`, "g");

// reads : the settings variables one source reads, by name; comments and the adapter itself do not count
export function reads(text: string): readonly string[] {
  const code = text
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, "").replace(/\s\/\/ .*$/, ""))
    .join("\n");
  return [...new Set([...code.matchAll(READ)].map((m) => m[1] ?? m[2] ?? ""))];
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
  it("no module reads a settings key's FACTORY_* variable but through the adapter", () => {
    expect(found()).toEqual({});
  });

  it("catches a direct read in every form, and leaves comments, other variables, a test's own env and the adapter's calls alone", () => {
    expect(reads('const a = env.FACTORY_MAX_USD ?? "";')).toEqual(["FACTORY_MAX_USD"]);
    expect(reads('const a = process.env["FACTORY_BOX"];')).toEqual(["FACTORY_BOX"]);
    expect(reads('absolute(env, "FACTORY_RULEBOOK")')).toEqual(["FACTORY_RULEBOOK"]);
    expect(reads('const n = name("FACTORY_WRITER_MODEL");')).toEqual(["FACTORY_WRITER_MODEL"]);
    expect(reads("// env.FACTORY_MAX_USD is the cap")).toEqual([]);
    expect(reads("const a = env.FACTORY_REPO;")).toEqual([]);
    expect(reads('reason: "FACTORY_BOX is not set; set it to vm"')).toEqual([]);
    expect(reads('env.FACTORY_MAX_USD = "2";')).toEqual([]);
    expect(reads('const a = settingOf(env, "caps.usdPerRun");')).toEqual([]);
  });
});
