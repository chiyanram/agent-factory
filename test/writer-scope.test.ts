import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "./temp.js";
import { outsideScope, scoped, scopesArg, scopesOf, writerScope, type EditScope } from "../src/core/writer/scope.js";
import { writerScopeCommand } from "../src/loop-cli.js";

const DONE = { kind: "done", evidence: [] } as const;
const CARD: EditScope = { what: "card", globs: ["src/test/**"] };
const TESTS: EditScope = { what: "tests", globs: ["src/test/**", "**/*.test.ts"] };

describe("the card's edit scope, checked on the run's commits (#424)", () => {
  it("finds each changed path no glob of the scope names; none for a scope of anywhere", () => {
    const paths = ["src/test/a.test.ts", "src/main/a.ts", "README.md"];
    expect(outsideScope(paths, [CARD])).toEqual(["src/main/a.ts", "README.md"]);
    expect(outsideScope(paths, [])).toEqual([]);
  });

  it("blocks the run by the host, naming the paths, when it edited outside its scope", () => {
    expect(scoped(DONE, [], [CARD])).toBe(DONE);
    expect(scoped(DONE, ["a", "b", "c", "d", "e"], [CARD])).toEqual({
      kind: "blocked",
      reason: "the run edited a, b, c and 2 more, outside its card's edit scope (src/test/**)",
      by: "host",
    });
  });
});

describe("test-first edits only the project's test files (#688)", () => {
  it("gives test-first the project's test files, and the card's Edit(…) globs as a second scope that only narrows", () => {
    expect(scopesOf({ role: "test-first", editScope: [] }, ["spec/**"])).toEqual([
      { what: "tests", globs: ["spec/**"] },
    ]);
    expect(scopesOf({ role: "test-first", editScope: ["src/test/unit/**"] }, ["src/test/**"])).toEqual([
      { what: "card", globs: ["src/test/unit/**"] },
      { what: "tests", globs: ["src/test/**"] },
    ]);
    expect(scopesOf({ role: "implementer", editScope: [] }, ["spec/**"])).toEqual([]);
  });

  it("puts a path outside when it misses any scope, so a card's globs never widen the test files", () => {
    const scopes = scopesOf({ role: "test-first", editScope: ["**"] }, ["src/test/**"]);
    expect(outsideScope(["src/test/A.java", "src/main/A.java"], scopes)).toEqual(["src/main/A.java"]);
    const narrow = scopesOf({ role: "test-first", editScope: ["src/test/unit/**"] }, ["src/test/**"]);
    expect(outsideScope(["src/test/unit/A.java", "src/test/it/B.java"], narrow)).toEqual(["src/test/it/B.java"]);
  });

  it("names the project's test files when the host blocks a test-first run", () => {
    expect(scoped(DONE, ["src/main/A.java"], [TESTS])).toEqual({
      kind: "blocked",
      reason: "the run edited src/main/A.java, outside the project's test files (ready.testFiles)",
      by: "host",
    });
  });
});

describe("the writer's scope hook, before each edit in the run (#688)", () => {
  let root = "";
  let clone = "";
  beforeEach(() => {
    root = tempDir("writer-scope-");
    clone = join(root, "clone");
    mkdirSync(join(clone, "src", "test"), { recursive: true });
    mkdirSync(join(clone, "src", "main"), { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const call = (input: Record<string, string>) => JSON.stringify({ tool_name: "Edit", tool_input: input });
  const scopes = [["src/test/**"]];

  it("passes an edit of a test file", async () => {
    expect(await writerScope(call({ file_path: join(clone, "src", "test", "FooTest.java") }), clone, scopes)).toEqual({
      code: 0,
      out: "",
      err: "",
    });
  });

  it("refuses an edit of a production file, and names it", async () => {
    const hooked = await writerScope(call({ file_path: join(clone, "src", "main", "Foo.java") }), clone, scopes);
    expect(hooked).toMatchObject({ code: 2, err: expect.stringContaining("src/main/Foo.java") });
    expect(hooked.err).toContain("src/test/**");
  });

  it("passes the run's own report and PR body, which the floor tells it to write, whatever its scope", async () => {
    for (const file of [".factory/report.json", ".factory/pr.md"]) {
      expect(await writerScope(call({ file_path: join(clone, file) }), clone, scopes)).toMatchObject({ code: 0 });
    }
    expect(
      await writerScope(call({ file_path: join(clone, ".factory", "settings.json") }), clone, scopes),
    ).toMatchObject({
      code: 2,
    });
  });

  it("refuses a path outside the clone, a .., a symlink that leads out, and a call with no absolute path", async () => {
    symlinkSync(join(clone, "src", "main"), join(clone, "src", "test", "out"));
    for (const file of [
      join(root, "elsewhere", "src", "test", "A.java"),
      `${clone}/src/test/../main/Foo.java`,
      join(clone, "src", "test", "out", "Foo.java"),
      "src/test/FooTest.java",
    ]) {
      expect(await writerScope(call({ file_path: file }), clone, scopes)).toMatchObject({ code: 2 });
    }
    expect(await writerScope("{not json", clone, scopes)).toMatchObject({ code: 2 });
  });
});

describe("agent-factory writer-scope, the hook's command line (#688)", () => {
  it("reads its scopes as one JSON list of glob lists, and nothing else", () => {
    expect(scopesArg('[["src/test/**"],["**/*.test.ts"]]')).toEqual([["src/test/**"], ["**/*.test.ts"]]);
    for (const bad of ["", "x", "[]", '["src/test/**"]', "[[1]]", "[[]]", '{"a":1}']) {
      expect(scopesArg(bad)).toBe("bad");
    }
  });

  it("refuses the edit (exit 2) on a bad argument, because any other exit lets the edit through", async () => {
    const err: string[] = [];
    const io = { readStdin: async () => "{}", out: () => undefined, err: (t: string) => err.push(t), env: {} };
    expect(await writerScopeCommand(["[]"], io)).toBe(2);
    expect(await writerScopeCommand([], io)).toBe(2);
    expect(err.join("")).toContain("usage: agent-factory writer-scope");
    const broken = { ...io, readStdin: () => Promise.reject(new Error("closed")) };
    expect(await writerScopeCommand(['[["src/test/**"]]'], broken)).toBe(2);
  });
});
