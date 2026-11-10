import { describe, expect, it } from "vitest";
import { outsideScope, scoped } from "../src/core/writer/scope.js";

const DONE = { kind: "done", evidence: [] } as const;

describe("the card's edit scope, checked on the run's commits (#424)", () => {
  it("finds each changed path no glob of the scope names; none for a scope of anywhere", () => {
    const paths = ["src/test/a.test.ts", "src/main/a.ts", "README.md"];
    expect(outsideScope(paths, ["src/test/**"])).toEqual(["src/main/a.ts", "README.md"]);
    expect(outsideScope(paths, [])).toEqual([]);
  });

  it("blocks the run by the host, naming the paths, when it edited outside its scope", () => {
    expect(scoped(DONE, [], ["src/test/**"])).toBe(DONE);
    expect(scoped(DONE, ["a", "b", "c", "d", "e"], ["src/test/**"])).toEqual({
      kind: "blocked",
      reason: "the run edited a, b, c and 2 more, outside its card's edit scope (src/test/**)",
      by: "host",
    });
  });
});
