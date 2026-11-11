// the clean-machine install test's verdict (#485; scripts/install-test.ts): what it accepts and what fails it
import { describe, expect, it } from "vitest";
import { problems, type Seen } from "../scripts/install-test.js";

const OK = { code: 0, out: "", err: "" };
const seen = (over: Partial<Seen> = {}): Seen => ({
  version: { code: 0, out: "0.34.1\n", err: "" },
  init: { code: 1, out: "Checks:\n  ✗ gh auth login\n", err: "" },
  dispatch: { code: 1, out: "", err: "agent-factory dispatch: github: run gh auth login\n" },
  files: { "user.json": true, "projects/demo.json": true, "coordinator/.claude/settings.json": true },
  ...over,
});

describe("the install test's verdict", () => {
  it("passes a fresh install whose checks fail for want of a login, and whose dry run answers", () => {
    expect(problems(seen(), "0.34.1")).toEqual([]);
    expect(problems(seen({ init: OK, dispatch: OK }), "0.34.1")).toEqual([]);
  });

  it("fails another version, a refused init, a file init did not write, and any crash", () => {
    expect(problems(seen(), "0.35.0")).toEqual(['agent-factory --version printed "0.34.1", not 0.35.0']);
    expect(problems(seen({ init: { code: 1, out: "", err: "agent-factory init: no origin\n" } }), "0.34.1")).toEqual([
      "agent-factory init refused: agent-factory init: no origin",
    ]);
    expect(problems(seen({ files: { "user.json": false } }), "0.34.1")).toEqual(["init left no user.json"]);
    const crash = { code: 1, out: "", err: "TypeError: x is undefined\n    at main (/a/b.js:1:2)\n" };
    expect(problems(seen({ dispatch: crash }), "0.34.1")).toEqual([
      "a crash: TypeError: x is undefined\n    at main (/a/b.js:1:2)",
    ]);
    expect(problems(seen({ dispatch: { code: 134, out: "", err: "" } }), "0.34.1")).toEqual([
      "agent-factory dispatch --dry-run exited 134",
    ]);
  });
});
