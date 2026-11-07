import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// a fresh git repository holding tests/fixtures/<name>, as make lint sees a checkout
function fixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "factory-lint-"));
  made.push(dir);
  cpSync(join(ROOT, "tests", "fixtures", name), dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

function run(script: string, root: string): { readonly code: number; readonly out: string } {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", script), root], { encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe("check-links (#138)", () => {
  it("fails on a broken relative, root-absolute and reference-style link, naming file:line", () => {
    const r = run("check-links.ts", fixture("links-broken"));
    expect(r.code).toBe(1);
    expect(r.out).toContain("broken link: README.md:3: docs/missing.md");
    expect(r.out).toContain("abs-missing.md");
    expect(r.out).toContain("ref-missing.md");
    expect(r.out).toContain("check-links: 3 broken relative link(s)");
  });

  it("fails on a broken link in a file with a non-ASCII name; passes good links, anchors, web links and code", () => {
    const bad = run("check-links.ts", fixture("links-nonascii"));
    expect(bad).toMatchObject({ code: 1, out: expect.stringContaining("café.md:3: nope.md") });
    expect(run("check-links.ts", fixture("links-ok"))).toEqual({ code: 0, out: "" });
  });
});

describe("check-size (#138; ADR-0003)", () => {
  it("fails on a root AGENTS.md of 200 lines, and passes one of 199", () => {
    expect(run("check-size.ts", fixture("size-over"))).toEqual({
      code: 1,
      out: "too long: AGENTS.md: 200 lines; ADR-0003 allows fewer than 200\n",
    });
    expect(run("check-size.ts", fixture("size-ok"))).toEqual({ code: 0, out: "" });
  });
});
