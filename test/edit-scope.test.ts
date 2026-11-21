import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { editScope } from "../src/core/edit-scope.js";
import { tempDir } from "./temp.js";

describe("edit-scope, the coordinator's PreToolUse hook (#676)", () => {
  let home = "";
  let specs = "";
  beforeEach(() => {
    home = tempDir("factory-edit-scope-");
    specs = join(home, "specs");
    mkdirSync(join(specs, "ledger"), { recursive: true });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const call = (input: Record<string, unknown>, cwd = home): string => JSON.stringify({ cwd, tool_input: input });

  it("passes an edit of a spec draft, new or existing, on to the rules", async () => {
    writeFileSync(join(specs, "ledger", "spec.md"), "x");
    for (const file of [join(specs, "ledger", "spec.md"), join(specs, "ledger", "PROJ-1", "design.md")]) {
      expect(await editScope(call({ file_path: file }), specs)).toEqual({ code: 0, out: "", err: "" });
    }
  });

  it("passes a spec draft before the specs folder exists, as the first draft needs", async () => {
    rmSync(specs, { recursive: true });
    expect(await editScope(call({ file_path: join(specs, "ledger", "spec.md") }), specs)).toMatchObject({ code: 0 });
  });

  it("denies every edit outside the spec drafts, with the reason Claude Code shows", async () => {
    const outside = join(home, "elsewhere");
    mkdirSync(outside);
    symlinkSync(outside, join(specs, "ledger", "out"));
    for (const input of [
      { file_path: join(home, "approvals", "ledger", "PROJ-1.json") },
      { file_path: "/work/project/src/app.ts" },
      { file_path: join(specs, "..", "starts", "x.json") },
      { file_path: join(specs, "ledger", "out", "x.md") },
      { file_path: specs },
      { file_path: `${specs}-other/x.md` },
      { notebook_path: "/work/project/n.ipynb" },
      { file_path: "relative.md" },
      { file_path: "" },
      {},
    ]) {
      const hooked = await editScope(call(input, "/work/project"), specs);
      expect({ input, code: hooked.code }).toEqual({ input, code: 2 });
      expect(JSON.parse(hooked.out)).toMatchObject({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
      });
      expect(hooked.err).toContain("only spec drafts");
    }
  });

  it("denies a dangling symlink in the drafts, which a Write would follow to create a file outside them", async () => {
    symlinkSync(join(home, "approvals", "PROJ-1.json"), join(specs, "ledger", "dangling.md"));
    expect(await editScope(call({ file_path: join(specs, "ledger", "dangling.md") }), specs)).toMatchObject({
      code: 2,
    });
    symlinkSync(join(home, "nowhere"), join(specs, "ledger", "gone"));
    expect(await editScope(call({ file_path: join(specs, "ledger", "gone", "x.md") }), specs)).toMatchObject({
      code: 2,
    });
  });

  it("checks a notebook by its notebook_path, and denies stdin that is not a tool call", async () => {
    expect(await editScope(call({ notebook_path: join(specs, "ledger", "n.ipynb") }), specs)).toMatchObject({
      code: 0,
    });
    expect(await editScope("{not json", specs)).toMatchObject({ code: 2 });
    expect(await editScope("", specs)).toMatchObject({ code: 2 });
  });
});
