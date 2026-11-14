import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PKG: unknown = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"));
const scripts = (): Readonly<Record<string, unknown>> => {
  const s = typeof PKG === "object" && PKG !== null ? Reflect.get(PKG, "scripts") : undefined;
  return typeof s === "object" && s !== null ? { ...s } : {};
};

describe("the packed package (#482, ledger pilot row 13)", () => {
  it("declares no script an install runs, so npm i -g <release .tgz> gives no allowScripts warning", () => {
    const install = ["preinstall", "install", "postinstall", "prepare"].filter((k) => k in scripts());
    expect(install).toEqual([]);
  });

  it("still builds dist/ when it is packed", () => {
    expect(scripts().prepack).toBe("npm run build");
  });
});

// gardener's numbers depend on its exact version: an upgrade is its own change, and it rechecks any deep import
describe("repo-gardener", () => {
  const read = (file: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "..", file), "utf8"));
  const at = (value: unknown, ...keys: readonly string[]): unknown =>
    keys.reduce<unknown>((v, k) => (typeof v === "object" && v !== null ? Reflect.get(v, k) : undefined), value);

  it("is pinned at exactly 0.1.2 in devDependencies, and the lockfile resolves that version", () => {
    expect(at(read("package.json"), "devDependencies", "repo-gardener")).toBe("0.1.2");
    expect(at(read("package-lock.json"), "packages", "node_modules/repo-gardener", "version")).toBe("0.1.2");
  });

  it("runs from make garden with no --transcripts and no --github", () => {
    const makefile = readFileSync(join(import.meta.dirname, "..", "Makefile"), "utf8");
    const lines = makefile.split("\n").filter((l) => l.includes("npx --no-install gardener "));
    expect(lines.length).toBe(3);
    expect(lines.filter((l) => /--transcripts|--github/.test(l))).toEqual([]);
  });
});
