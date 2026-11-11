// the cite check (#485; P15): a finding's file:line must exist at the reviewed commit, else it is noted as "cite not
// found" and never posted as a finding. Planted findings cite a missing file and a line past the end.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkCites, citeChecked, citeProblem, citesNotFound, lineCount } from "../src/core/cite-check.js";
import { coreOf } from "../src/core/finding.js";
import { tempDir } from "./temp.js";

type F = {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly bucket: "act_on" | "consider" | "noted" | "dismissed";
  readonly why: string;
};

const f = (over: Partial<F>): F => ({
  id: "F1",
  file: "src/a.ts",
  line: 2,
  bucket: "act_on",
  why: "it holds",
  ...over,
});

describe("citeProblem and citeChecked: pure", () => {
  it("passes a cite within the file, a whole-file cite and a finding that names no file", () => {
    expect(citeProblem({ file: "src/a.ts", line: 3 }, 3)).toBe("");
    expect(citeProblem({ file: "src/a.ts", line: 0 }, 3)).toBe("");
    expect(citeProblem({ file: "", line: 9 }, undefined)).toBe("");
  });

  it("names a missing file and a line past the end", () => {
    expect(citeProblem({ file: "src/gone.ts", line: 1 }, undefined)).toBe("src/gone.ts is not in the reviewed commit");
    expect(citeProblem({ file: "src/a.ts", line: 4 }, 3)).toBe("src/a.ts:4 is past the end of the file (3 lines)");
  });

  it("moves an Act on or Consider finding with a bad cite to noted, and leaves a good one alone", () => {
    expect(citeChecked(f({}), undefined)).toEqual(
      f({ bucket: "noted", why: "cite not found: src/a.ts is not in the reviewed commit" }),
    );
    expect(citeChecked(f({ bucket: "consider", line: 9 }), 3).bucket).toBe("noted");
    expect(citeChecked(f({}), 3)).toEqual(f({}));
    expect(citeChecked(f({ bucket: "dismissed" }), undefined)).toEqual(f({ bucket: "dismissed" }));
  });

  it('checks a range by its end line, read from the finding\'s "N-M"', () => {
    expect(citeProblem({ file: "a.ts", line: 2, lineEnd: 3 }, 3)).toBe("");
    expect(citeProblem({ file: "a.ts", line: 2, lineEnd: 5 }, 3)).toBe(
      "a.ts:2-5 is past the end of the file (3 lines)",
    );
    const raw = { file: "a.ts", rule: null, severity: "warning", grade: "walked", finding: "f", fix: "x" };
    expect(coreOf({ ...raw, line: "2-5" }, "F1", (t) => t)).toMatchObject({ line: 2, lineEnd: 5 });
    expect(coreOf({ ...raw, line: "2" }, "F1", (t) => t)).not.toHaveProperty("lineEnd");
  });

  it("counts the findings noted as cite not found, for the run record", () => {
    expect(citesNotFound([f({}), f({ why: "cite not found: x" }), f({ why: "cite not found: y" })])).toBe(2);
  });

  it("counts a file's lines, with or without a last newline", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("a\nb\n")).toBe(2);
    expect(lineCount("a\nb")).toBe(2);
  });
});

describe("checkCites: at the reviewed commit, through git", () => {
  let repo = "";
  let sha = "";
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", repo, ...args], { encoding: "utf8" });

  beforeAll(() => {
    repo = tempDir("factory-cites-");
    git("init", "-q");
    writeFileSync(join(repo, "a.ts"), "one\ntwo\nthree\n");
    git("add", "a.ts");
    git("commit", "-q", "-m", "one");
    sha = git("rev-parse", "HEAD").trim();
    // a later commit grows the file: the check reads the reviewed commit, not the working tree
    writeFileSync(join(repo, "a.ts"), "one\ntwo\nthree\nfour\nfive\n");
    git("commit", "-q", "-am", "two");
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("keeps a valid cite, and notes a missing file, a line past the end and a path that is not a plain path", async () => {
    const at = { repo, env: process.env, sha };
    const checked = await checkCites(at, [
      f({ id: "ok", file: "a.ts", line: 3 }),
      f({ id: "gone", file: "b.ts", line: 1 }),
      f({ id: "past", file: "a.ts", line: 5 }),
      f({ id: "odd", file: "--output=x", line: 1 }),
    ]);
    expect(checked.map((c) => [c.id, c.bucket])).toEqual([
      ["ok", "act_on"],
      ["gone", "noted"],
      ["past", "noted"],
      ["odd", "noted"],
    ]);
    expect(checked[2]?.why).toBe("cite not found: a.ts:5 is past the end of the file (3 lines)");
  });

  it("checks a file the caller holds the text of against that text, not the commit", async () => {
    const own = { "spec.md": "# spec\n\n1. one\n" };
    const checked = await checkCites(
      { repo, env: process.env, sha },
      [f({ id: "in", file: "spec.md", line: 3 }), f({ id: "past", file: "spec.md", line: 4 })],
      own,
    );
    expect(checked.map((c) => [c.id, c.bucket])).toEqual([
      ["in", "act_on"],
      ["past", "noted"],
    ]);
  });
});
