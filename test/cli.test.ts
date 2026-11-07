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

// A fake glab on disk: the poll command runs it as a real process, so this checks the whole path from argv to the line.
function fakeGlab(): string {
  const answers = {
    user: { username: "ram" },
    members: { data: { project: { projectMembers: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ user: { username: "ram" }, accessLevel: { integerValue: 50 } }] } } } },
    open: {
      data: {
        project: {
          mergeRequests: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ iid: "12", draft: false, diffHeadSha: "1a2b3c4d5e6f", sourceBranch: "factory/PROJ-12", sourceProjectId: 1, targetProjectId: 1, labels: { pageInfo: { hasNextPage: false }, nodes: [{ title: "agent::claimed" }] }, headPipeline: { status: "SUCCESS", sha: "1a2b3c4d5e6f" }, notes: { pageInfo: { hasPreviousPage: false, startCursor: null }, nodes: [{ body: "[writer] OPEN: which port?", createdAt: "2026-11-02T10:00:00Z", author: { username: "ram" } }] } }],
          },
        },
      },
    },
    merged: [{ iid: 9, source_branch: "factory/PROJ-9", source_project_id: 1, target_project_id: 1 }],
  };
  const reply = (body: unknown) => `printf 'HTTP/2.0 200 OK\\r\\n\\r\\n%s' '${JSON.stringify(body)}'`;
  const script = `#!/bin/sh
case "$*" in
  *projectMembers*) ${reply(answers.members)} ;;
  *mergeRequests*) ${reply(answers.open)} ;;
  *merge_requests\\?state=merged*) ${reply(answers.merged)} ;;
  *" user "*|*" user") ${reply(answers.user)} ;;
  *) echo "fake glab: unexpected $*" >&2; exit 3 ;;
esac
`;
  const path = join(home, "glab");
  writeFileSync(path, script, { mode: 0o755 });
  return path;
}

describe("agent-factory poll", () => {
  it("prints one line per change, read through the forge's CLI", async () => {
    const env = { FACTORY_PROJECT: "aruvii/agent-platform", FACTORY_GLAB: fakeGlab(), PATH: process.env.PATH };
    const run = await cli(["poll"], env);
    expect(run).toEqual({ code: 0, out: "!9 merged claimed=yes\n!12 head=1a2b3c4d draft=no claimed=yes pipeline=success needs_human=no stop=no asks=1\n", err: "" });
    const json = await cli(["poll", "--json"], env);
    expect(JSON.parse(json.out.split("\n")[1]!)).toMatchObject({ kind: "open", number: 12, asks: 1, pipeline: { kind: "success" } });
  });

  it("fails with the reason, and prints no line, when a setting or the forge fails", async () => {
    const bad = await cli(["poll"], { FACTORY_FORGE: "github", FACTORY_PROJECT: "ledger" });
    expect(bad).toMatchObject({ code: 1, out: "" });
    expect(bad.err).toContain("must be owner/name");
    const down = await cli(["poll"], { FACTORY_PROJECT: "a/b", FACTORY_GLAB: join(home, "missing-glab") });
    expect(down).toMatchObject({ code: 1, out: "" });
    expect(down.err).toContain("no HTTP status");
  });
});

describe("agent-factory app-token", () => {
  it("prints its usage without exactly one project (64), and fails when this user holds no App (1)", async () => {
    expect((await cli(["app-token"])).code).toBe(64);
    expect((await cli(["app-token", "a/b", "c/d"])).code).toBe(64);
    const run = await cli(["app-token", "chiyanram/ledger"]);
    expect(run.code).toBe(1);
    expect(run.out).toBe("");
    expect(run.err).toContain("github-app.json");
  });
});

describe("agent-factory dispatch", () => {
  it("runs only one pass, named with --once, for one plain project (64 otherwise)", async () => {
    expect((await cli(["dispatch", "ledger"])).code).toBe(64);
    expect((await cli(["dispatch", "--once"])).code).toBe(64);
    expect((await cli(["dispatch", "ledger", "extra", "--once"])).code).toBe(64);
  });

  it("refuses a bad quiet time, and a project that is not a plain name", async () => {
    const bad = await cli(["dispatch", "ledger", "--once"], { FACTORY_HOME: home, FACTORY_QUIET_MINUTES: "soon", FACTORY_PROJECT: "a/b" });
    expect(bad).toMatchObject({ code: 1 });
    expect(bad.err).toContain("FACTORY_QUIET_MINUTES");
  });
});
