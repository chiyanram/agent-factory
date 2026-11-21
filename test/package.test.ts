import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { prop } from "../src/core/field.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function shipped(): readonly string[] {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8" });
  const packed: unknown = JSON.parse(out);
  const files: unknown = Array.isArray(packed) ? prop(packed[0], "files") : [];
  return Array.isArray(files) ? files.map((f) => String(prop(f, "path"))) : [];
}

describe("the published package (#171)", () => {
  it("ships every prompt and the box image the code reads at run time", () => {
    const files = shipped();
    const prompts = readdirSync(join(ROOT, "prompts"), { recursive: true, withFileTypes: true })
      .filter((f) => f.isFile())
      .map((f) => relative(ROOT, join(f.parentPath, f.name)));
    expect(prompts).toEqual(
      expect.arrayContaining([
        "prompts/roles/cleanup.md",
        "prompts/roles/onboarder.md",
        "prompts/roles/implementer.md",
      ]),
    );
    expect(files).toEqual(expect.arrayContaining([...prompts, "images/factory-box/Dockerfile"]));
  });
});
