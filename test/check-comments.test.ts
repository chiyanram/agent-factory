import { describe, expect, it } from "vitest";
import { banned, comments, judged, shrunk, verdict } from "../scripts/check-comments.js";

const src = (...lines: readonly string[]): string => lines.join("\n");

describe("check-comments", () => {
  it("finds line, block and trailing comments, and not a // inside a string, a template or a regex", () => {
    const text = src(
      'const url = "https://x.test/a"; // trailing',
      "const t = `a // b ${'//'} c`;",
      "const r = /\\/\\//g;",
      "/* block",
      "   two */",
      "const d = 4 / 2; const e = 1 / 2;",
    );
    expect(comments(text).map((c) => [c.first, c.last, c.own])).toEqual([
      [1, 1, false],
      [4, 5, true],
    ]);
  });

  it("steps over a template literal that nests a template and braces", () => {
    const text = src("const a = `x${`y${{ k: 1 }.k}`}z`; // after", "// own");
    expect(comments(text).map((c) => c.first)).toEqual([1, 2]);
  });

  it("keeps the header block, a Today: paragraph, a linked paragraph and directives; bans the rest", () => {
    const text = src(
      "#!/usr/bin/env node",
      "// mod — what it is.",
      "//",
      "// why it is.",
      "",
      "import x from 'x';",
      "// a narration",
      "// on two lines",
      "const a = 1; // trailing narration",
      "// Today: the gap still open",
      "// and its second line",
      "// the vendor's rule:",
      "// https://vendor.test/docs",
      '/// <reference types="node" />',
      "const b = 2;",
    );
    expect(banned(text)).toEqual([7, 8, 9]);
  });

  it("splits a run at a blank comment line, so a link keeps only its own paragraph", () => {
    const text = src("const a = 1;", "// narration", "//", "// https://vendor.test/docs");
    expect(banned(text)).toEqual([2, 3]);
  });

  it("judges code files and skips the fixtures and the built output", () => {
    expect(
      ["src/a.ts", "scripts/b.mjs", "tests/fixtures/c.ts", "dist/d.js", "plugins/p/lib/e.js", "f.md"].filter(judged),
    ).toEqual(["src/a.ts", "scripts/b.mjs"]);
  });

  it("fails a count above its baseline, and asks for --shrink below it", () => {
    expect(verdict({ "a.ts": 2 }, { "a.ts": 2 })).toEqual({ kind: "clean" });
    expect(verdict({ "a.ts": 3, "n.ts": 1 }, { "a.ts": 2 })).toEqual({ kind: "over", files: ["a.ts", "n.ts"] });
    expect(verdict({ "a.ts": 1 }, { "a.ts": 2 })).toEqual({ kind: "shrinkable", files: ["a.ts"] });
  });

  it("shrinks a count, never raises one, and drops a file at 0", () => {
    expect(shrunk({ "a.ts": 1, "b.ts": 9, "n.ts": 4 }, { "a.ts": 2, "b.ts": 3, "c.ts": 5 })).toEqual({
      "a.ts": 1,
      "b.ts": 3,
    });
  });
});
