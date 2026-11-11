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
