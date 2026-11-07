import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/app.js";
import { specHash } from "../src/core/spec.js";

const SPEC = "# PROJ-1: a title\n\n## Intent\n\nDo the thing.\n\n## Acceptance criteria\n\n1. It works.\n\n## Design\n\nnone\n\n## Lane\n\ntiny\n";

let home = "";
type Run = { readonly code: number; readonly out: string; readonly err: string };
async function cli(argv: readonly string[], env: NodeJS.ProcessEnv = { FACTORY_HOME: home }): Promise<Run> {
  let out = "";
  let err = "";
  const code = await runCli(argv, { env, out: (t) => (out += t), err: (t) => (err += t) });
  return { code, out, err };
}
function writeSpec(text: string): void {
  mkdirSync(join(home, "specs", "ledger", "PROJ-1"), { recursive: true });
  writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), text);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "factory-cli-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("agent-factory spec", () => {
  it("prints the hash of a spec that follows the template, exit 0", async () => {
    writeSpec(SPEC);
    const run = await cli(["spec", "ledger", "PROJ-1"]);
    expect(run).toMatchObject({ code: 0, out: `spec ledger/PROJ-1 ${specHash(SPEC)} ${join(home, "specs", "ledger", "PROJ-1", "spec.md")}\n` });
  });

  it("lists what a spec is missing, exit 2", async () => {
    writeSpec(SPEC.replace("1. It works.", "TBD"));
    const run = await cli(["spec", "ledger", "PROJ-1"]);
    expect(run.code).toBe(2);
    expect(run.err).toContain("Acceptance criteria");
  });

  it("says how to start when there is no spec, exit 1", async () => {
    const run = await cli(["spec", "ledger", "PROJ-1"]);
    expect(run.code).toBe(1);
    expect(run.err).toContain("agent-factory spec --template PROJ-1");
  });

  it("prints a template, and the usage line when arguments are missing (exit 64)", async () => {
    expect((await cli(["spec", "--template", "PROJ-9"])).out).toContain("# PROJ-9:");
    expect((await cli(["spec", "ledger"])).code).toBe(64);
  });

  it("refuses an empty or relative FACTORY_HOME, never reading the current folder", async () => {
    for (const value of ["", "relative/home"]) {
      const run = await cli(["spec", "ledger", "PROJ-1"], { FACTORY_HOME: value });
      expect(run.code).toBe(1);
      expect(run.err).toContain("FACTORY_HOME must be an absolute path");
    }
  });
});
