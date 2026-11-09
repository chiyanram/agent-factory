// check-evals (#214; ADR-0015 E5): the golden set's shape, each pure check on its own, then the script on a fresh git
// repository with one good case and a bad one of each kind.
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileProblems, kindProblem, placeProblems, shaProblem, tableProblems } from "../scripts/check-evals.js";
import { findingProblems, readGolden, tableRows } from "../src/core/eval/golden.js";
import { tempDir } from "./temp.js";

const ROOT = join(import.meta.dirname, "..");
const good = { file: "a.ts", line: 2, issue: "off by one", severity: "blocker", category: "bug" } as const;

describe("readGolden", () => {
  it("reads [] and a list of findings", () => {
    expect(readGolden("[]\n")).toEqual({ kind: "ok", value: [] });
    expect(readGolden(JSON.stringify([good]))).toEqual({ kind: "ok", value: [good] });
  });

  it("refuses text that is not JSON, or not an array", () => {
    expect(readGolden("{")).toMatchObject({ kind: "failed", reason: expect.stringContaining("is not JSON") });
    expect(readGolden("{}")).toEqual({
      kind: "failed",
      reason: "golden.json must be an array of findings ([] for a clean case)",
    });
  });

  it("names every bad value, missing key and unknown key, by finding", () => {
    const bad = { file: "", line: 0, issue: " ", severity: "major", category: "logic", extra: 1 };
    expect(findingProblems(bad, 1)).toEqual([
      "finding 2: an unknown key extra",
      "finding 2: file is not a path",
      "finding 2: line is not a whole number from 1",
      "finding 2: issue is empty",
      "finding 2: severity is not one of blocker, warning, nit",
      "finding 2: category is not one of bug, security, concurrency, data, api, perf, test_gap, doc_defect, style, speculative",
    ]);
    expect(findingProblems({ file: "a.ts", line: 1.5 }, 0)).toEqual([
      "finding 1: no issue",
      "finding 1: no severity",
      "finding 1: no category",
      "finding 1: line is not a whole number from 1",
      "finding 1: issue is empty",
      "finding 1: severity is not one of blocker, warning, nit",
      "finding 1: category is not one of bug, security, concurrency, data, api, perf, test_gap, doc_defect, style, speculative",
    ]);
    expect(findingProblems("a.ts:3", 0)).toEqual(["finding 1: is not an object"]);
    expect(readGolden(JSON.stringify([good, { ...good, severity: "high" }]))).toEqual({
      kind: "failed",
      reason: "finding 2: severity is not one of blocker, warning, nit",
    });
  });
});

describe("the small checks", () => {
  it("shaProblem takes one 40-hex hash, with or without a newline", () => {
    expect(shaProblem(`${"a".repeat(40)}\n`)).toBe("");
    expect(shaProblem("a".repeat(39))).toBe("base.sha must hold one 40-hex commit hash");
    expect(shaProblem("A".repeat(40))).toBe("base.sha must hold one 40-hex commit hash");
    expect(shaProblem("main")).toBe("base.sha must hold one 40-hex commit hash");
  });

  it("fileProblems wants the three files, allows pr.md, and names anything else", () => {
    expect(fileProblems(["base.sha", "change.patch", "golden.json", "pr.md"])).toEqual([]);
    expect(fileProblems(["base.sha", "notes.txt"])).toEqual([
      "no change.patch",
      "no golden.json",
      "an unknown file notes.txt",
    ]);
  });

  it("kindProblem: a clean case has no finding and a seeded one has one; a rulebook copy may be either", () => {
    expect(kindProblem("clean", [good])).toBe("a clean case's golden.json must be []");
    expect(kindProblem("seeded", [])).toBe("a seeded case's golden.json must name its seed");
    expect([kindProblem("clean", []), kindProblem("seeded", [good]), kindProblem("rulebook-copy", [])]).toEqual([
      "",
      "",
      "",
    ]);
  });

  it("placeProblems: a finding must be in a file the patch changes, on a line it has", () => {
    const files = new Map([["a.ts", 3]]);
    expect(placeProblems([good, { ...good, line: 3 }], files)).toEqual([]);
    expect(
      placeProblems(
        [
          { ...good, line: 4 },
          { ...good, file: "b.ts" },
        ],
        files,
      ),
    ).toEqual(["finding 1: a.ts has 3 lines, not 4", "finding 2: b.ts is not a file the patch changes"]);
  });

  it("tableRows reads the case rows; tableProblems matches them with the folders", () => {
    const md = [
      "| case | kind | what | source | status |",
      "|---|---|---|---|---|",
      "| `one` | seeded | a slip | abc123 | draft |",
      "| `two` | clean | a PR | def456 | approved |",
      "| `two` | odd | again | x | done |",
      "| `ghost` | clean | no folder | x | draft |",
    ].join("\n");
    const rows = tableRows(md);
    expect(rows[0]).toEqual({ name: "one", kind: "seeded", status: "draft" });
    expect(tableProblems(["one", "two", "three"], rows)).toEqual([
      "three: no row in cases.md",
      "ghost: a row in cases.md but no folder",
      "two: two rows in cases.md",
      "two: cases.md: kind odd is not one of seeded, clean, rulebook-copy",
      "two: cases.md: status done is not draft or approved",
    ]);
  });
});

describe("check-evals on a repository", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: "/nonexistent" };
  const git = (dir: string, ...args: string[]) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      encoding: "utf8",
      env,
    }).trim();

  const PATCH = ["--- a/a.ts", "+++ b/a.ts", "@@ -1,2 +1,2 @@", " const a = 1;", "-const b = 2;", "+const b = 3;", ""];

  // a repository with one commit of a.ts (2 lines) and the given cases; every case is listed in cases.md as seeded
  function repo(cases: Readonly<Record<string, Readonly<Record<string, string>>>>, rows?: string): string {
    const dir = tempDir("factory-evals-test-");
    made.push(dir);
    git(dir, "init", "-q");
    writeFileSync(join(dir, "a.ts"), "const a = 1;\nconst b = 2;\n");
    git(dir, "add", "a.ts");
    git(dir, "commit", "-qm", "base");
    const sha = git(dir, "rev-parse", "HEAD");
    for (const [name, files] of Object.entries(cases)) {
      mkdirSync(join(dir, "evals", "reviewer", name), { recursive: true });
      for (const [file, text] of Object.entries(files)) {
        writeFileSync(join(dir, "evals", "reviewer", name, file), text.replace("{sha}", sha));
      }
    }
    const table = Object.keys(cases)
      .map((n) => `| \`${n}\` | seeded | x | y | draft |`)
      .join("\n");
    writeFileSync(join(dir, "evals", "reviewer", "cases.md"), rows ?? `| case |\n${table}\n`);
    return dir;
  }

  const golden = (line: number) => JSON.stringify([{ ...good, line }]);
  const ok = { "base.sha": "{sha}\n", "change.patch": PATCH.join("\n"), "golden.json": golden(2) };

  function run(root: string): { readonly code: number; readonly out: string } {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts", "check-evals.ts"), root], { encoding: "utf8" });
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
  }

  it("passes a well-formed case, a repository with no golden set, and leaves the index untouched", () => {
    const dir = repo({ good: { ...ok, "pr.md": "# fix: b\n" } });
    expect(run(dir)).toEqual({ code: 0, out: "" });
    expect(git(dir, "diff", "--cached", "--name-only")).toBe("");
    const none = tempDir("factory-evals-none-");
    made.push(none);
    expect(run(none)).toEqual({ code: 0, out: "" });
  });

  it("fails a commit not in the history, a patch that does not apply, and a finding past the file's end", () => {
    const dir = repo({
      gone: { ...ok, "base.sha": `${"0".repeat(40)}\n` },
      stale: { ...ok, "change.patch": PATCH.join("\n").replace("const b = 2;", "const b = 9;") },
      past: { ...ok, "golden.json": golden(3) },
    });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      `evals/reviewer/gone: base.sha ${"0".repeat(40)} is not a commit in this history (a shallow clone?)`,
    );
    expect(r.out).toContain(
      "evals/reviewer/stale: change.patch does not apply to base.sha: error: patch failed: a.ts:1",
    );
    expect(r.out).toContain("evals/reviewer/past: finding 1: a.ts has 2 lines, not 3");
    expect(r.out).toContain("check-evals: 3 problem(s) in the golden set");
  });

  it("fails a missing file, a bad hash, a bad golden.json, a seeded case with no finding, and a case with no row", () => {
    const dir = repo(
      {
        bare: { "base.sha": "{sha}\n" },
        short: { ...ok, "base.sha": "abc\n" },
        shape: { ...ok, "golden.json": '[{"file": "a.ts"}]' },
        empty: { ...ok, "golden.json": "[]" },
        lost: ok,
      },
      [
        "| `bare` | seeded | x | y | draft |",
        "| `short` | seeded | x | y | draft |",
        "| `shape` | seeded | x | y | draft |",
        "| `empty` | seeded | x | y | draft |",
        "",
      ].join("\n"),
    );
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("evals/reviewer/lost: no row in cases.md");
    expect(r.out).toContain("evals/reviewer/bare: no change.patch");
    expect(r.out).toContain("evals/reviewer/short: base.sha must hold one 40-hex commit hash");
    expect(r.out).toContain("evals/reviewer/shape: finding 1: no line");
    expect(r.out).toContain("evals/reviewer/empty: a seeded case's golden.json must name its seed");
  });

  // it applies every case's patch to its base commit, so it grows with the golden set: a cold macOS runner took 6 s
  it("passes this repository's own golden set", { timeout: 60_000 }, () => {
    expect(run(ROOT)).toEqual({ code: 0, out: "" });
  });
});
