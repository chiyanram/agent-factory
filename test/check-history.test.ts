// check-history: a history note on an added comment or doc line fails; the same line without the note, a Today: note,
// a header's one pointer, an ADR's status and "from" column, code that is not a comment and lines already on the
// default branch pass. Then the script on this repository and on a planted change in a fresh git repository.
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { addedLines, applies, baseRef, commentOf, scan } from "../scripts/check-history.js";
import { claudeEnv } from "../src/core/review/settings.js";
import { tempDir } from "./temp.js";

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "check-history.ts");
const FIXTURES = join(ROOT, "tests", "fixtures", "history");

// every line of a text, as added
const all = (text: string): ReadonlySet<number> => new Set(text.split("\n").map((_, i) => i + 1));
// file:line: rule for each finding on a text whose every line is added
const notes = (file: string, lines: readonly string[]): readonly string[] =>
  scan(file, lines.join("\n"), all(lines.join("\n"))).map((f) => f.split(": ").slice(0, 3).join(": "));

const BODY = ["export const CAP = 3;", ""];

describe("scan", () => {
  it("fails a ticket, a person with a date, or an approval on an added comment, and passes the line without it", () => {
    expect(notes("src/a.ts", [...BODY, "// keep the cap low (#488, operator 2026-11-14)", "function f() {}"])).toEqual([
      "src/a.ts:3: history-note: ticket",
      "src/a.ts:3: history-note: person-date",
    ]);
    expect(notes("src/a.ts", [...BODY, "// keep the cap low", "function f() {}"])).toEqual([]);
    expect(notes("src/a.ts", [...BODY, "function f() {", "  return 1; // see #12", "}"])).toEqual([
      "src/a.ts:4: history-note: ticket",
    ]);
    expect(notes("src/a.ts", [...BODY, "// Decided by the maintainers"])).toEqual([
      "src/a.ts:3: history-note: decided-by",
    ]);
    expect(notes("docs/a.md", ["# A", "", "Approved by the operator on 2026-11-13."])).toEqual([
      "docs/a.md:3: history-note: decided-by",
      "docs/a.md:3: history-note: person-date",
    ]);
  });

  it("passes a date with no person or decision on the line", () => {
    expect(notes("src/a.ts", [...BODY, "// the results file is named 2026-11-13-abc.json"])).toEqual([]);
  });

  it("passes a ticket in a Today: note, to the end of its paragraph or table cell", () => {
    const code = [...BODY, "// Today: not read from settings yet (#21); a setting", "// replaces it later (#22)"];
    expect(notes("src/a.ts", code)).toEqual([]);
    expect(notes("src/a.ts", [...code, "//", "// a new paragraph (#23)"])).toEqual([
      "src/a.ts:6: history-note: ticket",
    ]);
    expect(
      notes("docs/a.md", ["# A", "", "## B", "", "| a | b |", "|---|---|", "| x | **Today:** not yet (#42) |"]),
    ).toEqual([]);
    expect(notes("docs/a.md", ["## B", "", "| x | **Today:** not yet (#42) | see #43 and #44 |"])).toEqual([
      "docs/a.md:3: history-note: ticket",
    ]);
    expect(notes("docs/a.md", ["## B", "", "- **Today:** not yet (#42)", "- another item (#43, #44)"])).toEqual([
      "docs/a.md:4: history-note: ticket",
    ]);
  });

  it("passes one pointer in a module header or a doc section, and fails a second", () => {
    expect(notes("src/a.ts", ["// a — what it does; see #12", "", ...BODY])).toEqual([]);
    expect(notes("src/a.ts", ["// a — what it does; see ADR-0021", "", ...BODY])).toEqual([]);
    expect(notes("src/a.ts", ["// a — see #12", "// and #13", "", ...BODY])).toEqual([
      "src/a.ts:1: history-note: ticket",
      "src/a.ts:2: history-note: ticket",
    ]);
    expect(notes("docs/a.md", ["# A", "", "## B", "", "The cap is low; see #40.", "", "## C", "", "See #41."])).toEqual(
      [],
    );
    expect(notes("docs/a.md", ["## B", "", "The cap moved to owner/repo#5 and #41."])).toEqual([
      "docs/a.md:3: history-note: ticket",
    ]);
  });

  it("passes an ADR's status line and its from column", () => {
    const adr = "docs/adr/0099-x.md";
    expect(notes(adr, ["# 0099 · X", "", "Status: accepted 2026-11-13 (operator, #488 Q1, #489)."])).toEqual([]);
    expect(notes(adr, ["## Decision", "", "| # | decision | from |", "|---|---|---|", "| E1 | one | #180 |"])).toEqual(
      [],
    );
    expect(notes(adr, ["## Decision", "", "| E1 | one, see #181 and #182 | #180 |"])).toEqual([
      `${adr}:3: history-note: ticket`,
    ]);
    expect(notes("docs/a.md", ["## B", "", "Status: accepted 2026-11-13 (operator)."])).toEqual([
      "docs/a.md:3: history-note: person-date",
    ]);
  });

  it("does not judge code that is not a comment, headings, inline code, fences or URLs", () => {
    const code = ["class A {", "  #count = 1;", '  label = "#12 // not a comment";', "}"];
    expect(notes("src/a.ts", [...BODY, ...code])).toEqual([]);
    const doc = [
      "## 12. Steps",
      "",
      "Run `gh issue view #43`; see [it](https://x.test/o/r/issues/12#issuecomment-3).",
      "```",
      "#44",
      "```",
    ];
    expect(notes("docs/a.md", doc)).toEqual([]);
  });

  it("does not judge the pages that record or list history, nor planted input", () => {
    const row = "| 9 | the next step | #640, #641 |";
    expect(scan("docs/explanation/roadmap.md", `# Roadmap\n\n${row}\n`, all(`# Roadmap\n\n${row}\n`))).toEqual([]);
    for (const file of [
      "CHANGELOG.md",
      ".github/ISSUE_TEMPLATE/task.md",
      "docs/agents/issue-tracker.md",
      "tests/fixtures/x/a.ts",
      "evals/reviewer/cases/a.md",
      "plugins/p/lib/a.js",
      "src/a.json",
    ]) {
      expect(applies(file)).toBe(false);
    }
  });

  it("reports only added lines; an old note in a touched file passes", () => {
    const text = ["// keep it (#488)", "export const A = 1;", "// keep it too (#489)", "export const B = 2;"].join(
      "\n",
    );
    expect(scan("src/a.ts", text, new Set([2, 3, 4]))).toEqual([
      "src/a.ts:3: history-note: ticket: say what and why; history goes in the commit, the PR or an ADR",
    ]);
  });
});

describe("commentOf", () => {
  it("reads a comment line, a trailing comment, and nothing from strings", () => {
    expect(commentOf("  // a")).toBe("  // a");
    expect(commentOf(" * a")).toBe(" * a");
    expect(commentOf("f(); // a")).toBe(" // a");
    expect(commentOf('f("x // y");')).toBeUndefined();
    expect(commentOf("const re = /https?:\\/\\//;")).toBeUndefined();
  });
});

describe("addedLines", () => {
  it("reads the added line numbers of each file from a -U0 diff", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -2,0 +3,2 @@",
      "+x",
      "+y",
      "@@ -9 +11 @@",
      "-old",
      "+new",
      "@@ -20,3 +22,0 @@",
      "diff --git a/docs/b.md b/docs/b.md",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/docs/b.md",
      "@@ -0,0 +1,3 @@",
    ].join("\n");
    expect(addedLines(diff)).toEqual(
      new Map([
        ["src/a.ts", new Set([3, 4, 11])],
        ["docs/b.md", new Set([1, 2, 3])],
      ]),
    );
  });
});

describe("baseRef", () => {
  it("reads FACTORY_BASE_REF, else the pull request's base, else origin/main", () => {
    expect(baseRef({ FACTORY_BASE_REF: "main", GITHUB_BASE_REF: "dev" })).toBe("main");
    expect(baseRef({ GITHUB_BASE_REF: "dev" })).toBe("origin/dev");
    expect(baseRef({})).toBe("origin/main");
  });
});

describe("the script", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const run = (root: string, env: NodeJS.ProcessEnv = claudeEnv(process.env)) => {
    const r = spawnSync("node", [SCRIPT, root], { encoding: "utf8", env });
    return { code: r.status, out: r.stdout };
  };

  it("passes this repository", () => {
    expect(run(ROOT)).toEqual({ code: 0, out: "" });
  });

  it("fails the history notes a planted change adds, and only those", () => {
    const dir = tempDir("factory-history-");
    made.push(dir);
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    git("init", "-q", "-b", "main");
    cpSync(join(FIXTURES, "before"), dir, { recursive: true });
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
    cpSync(join(FIXTURES, "after"), dir, { recursive: true });
    const out = run(dir, { ...process.env, FACTORY_BASE_REF: "main" });
    expect(out.code).toBe(1);
    expect(out.out.split("\n").map((l) => l.split(": ").slice(0, 3).join(": "))).toEqual([
      "docs/page.md:5: history-note: ticket",
      "docs/page.md:6: history-note: decided-by",
      "docs/page.md:6: history-note: person-date",
      "docs/page.md:7: history-note: ticket",
      "src/a.ts:2: history-note: ticket",
      "src/a.ts:7: history-note: ticket",
      "src/a.ts:7: history-note: person-date",
      "check-history: 7 history note(s) on added lines; say what and why; history goes in the commit, the PR or an ADR",
      "",
    ]);
  });

  it("fails when it cannot find the default branch", () => {
    const dir = tempDir("factory-history-");
    made.push(dir);
    execFileSync("git", ["-C", dir, "init", "-q"]);
    expect(run(dir, { ...process.env, FACTORY_BASE_REF: "origin/nowhere" })).toMatchObject({
      code: 1,
      out: expect.stringContaining("cannot find the default branch origin/nowhere; fetch it or set FACTORY_BASE_REF"),
    });
  });
});
