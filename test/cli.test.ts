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

describe("agent-factory approve and approval", () => {
  it("approve records, approval says approved (0), an edit makes it stale (3)", async () => {
    writeSpec(SPEC);
    const hash = specHash(SPEC);
    expect((await cli(["approval", "ledger", "PROJ-1"])).code).toBe(4);
    const approved = await cli(["approve", "ledger", "PROJ-1", hash]);
    expect(approved.code).toBe(0);
    expect(approved.out).toMatch(new RegExp(`^approved ledger/PROJ-1 spec ${hash} by `));
    expect((await cli(["approval", "ledger", "PROJ-1"])).code).toBe(0);
    writeSpec(SPEC.replace("It works.", "It works, fast."));
    const stale = await cli(["approval", "ledger", "PROJ-1"]);
    expect(stale.code).toBe(3);
    expect(stale.out).toContain("approve again");
  });

  it("approve refuses a short hash or a changed spec (1), and prints its usage when arguments are missing (64)", async () => {
    writeSpec(SPEC);
    expect((await cli(["approve", "ledger", "PROJ-1", specHash(SPEC).slice(0, 12)])).code).toBe(1);
    expect((await cli(["approve", "ledger", "PROJ-1", specHash("other")])).code).toBe(1);
    expect((await cli(["approve", "ledger", "PROJ-1"])).code).toBe(64);
    expect((await cli(["approval", "ledger"])).code).toBe(64);
  });

  it("approval refuses a broken record (1), and both refuse a relative FACTORY_HOME", async () => {
    writeSpec(SPEC);
    mkdirSync(join(home, "approvals", "ledger"), { recursive: true });
    writeFileSync(join(home, "approvals", "ledger", "PROJ-1.json"), "{not json");
    expect((await cli(["approval", "ledger", "PROJ-1"])).code).toBe(1);
    for (const argv of [["approve", "ledger", "PROJ-1", specHash(SPEC)], ["approval", "ledger", "PROJ-1"]]) {
      const run = await cli(argv, { FACTORY_HOME: "" });
      expect(run.code).toBe(1);
      expect(run.err).toContain("FACTORY_HOME must be an absolute path");
    }
  });
});
