import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/app.js";
import { specHash } from "../src/core/spec.js";

const SPEC =
  "# PROJ-1: a title\n\n## Intent\n\nDo the thing.\n\n## Acceptance criteria\n\n1. It works.\n\n## Design\n\nnone\n\n## Lane\n\ntiny\n";

let home = "";
type Run = { readonly code: number; readonly out: string; readonly err: string };
async function cli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = { FACTORY_HOME: home },
  pasted = "",
): Promise<Run> {
  let out = "";
  let err = "";
  const code = await runCli(argv, {
    env,
    out: (t) => (out += t),
    err: (t) => (err += t),
    readSecret: async () => pasted,
    readStdin: async () => pasted,
    system: {
      platform: "linux",
      uid: process.getuid?.() ?? -1,
      run: async () => ({ code: 1, stdout: "", stderr: "no CLI in this test" }),
    },
  });
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
    expect(run).toMatchObject({
      code: 0,
      out: `spec ledger/PROJ-1 ${specHash(SPEC)} ${join(home, "specs", "ledger", "PROJ-1", "spec.md")}\n`,
    });
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
    for (const argv of [
      ["approve", "ledger", "PROJ-1", specHash(SPEC)],
      ["approval", "ledger", "PROJ-1"],
    ]) {
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
    members: {
      data: {
        project: {
          projectMembers: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ user: { username: "ram" }, accessLevel: { integerValue: 50 } }],
          },
        },
      },
    },
    open: {
      data: {
        project: {
          mergeRequests: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                iid: "12",
                draft: false,
                diffHeadSha: "1a2b3c4d5e6f",
                sourceBranch: "factory/PROJ-12",
                sourceProjectId: 1,
                targetProjectId: 1,
                labels: { pageInfo: { hasNextPage: false }, nodes: [{ title: "agent::claimed" }] },
                headPipeline: { status: "SUCCESS", sha: "1a2b3c4d5e6f" },
                notes: {
                  pageInfo: { hasPreviousPage: false, startCursor: null },
                  nodes: [
                    {
                      body: "[writer] OPEN: which port?",
                      createdAt: "2026-11-02T10:00:00Z",
                      author: { username: "ram" },
                    },
                  ],
                },
              },
            ],
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
    expect(run).toEqual({
      code: 0,
      out: "!9 merged claimed=yes\n!12 head=1a2b3c4d draft=no claimed=yes pipeline=success needs_human=no stop=no asks=1\n",
      err: "",
    });
    const json = await cli(["poll", "--json"], env);
    expect(JSON.parse(json.out.split("\n")[1]!)).toMatchObject({
      kind: "open",
      number: 12,
      asks: 1,
      pipeline: { kind: "success" },
    });
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
    const bad = await cli(["dispatch", "ledger", "--once"], {
      FACTORY_HOME: home,
      FACTORY_QUIET_MINUTES: "soon",
      FACTORY_PROJECT: "a/b",
    });
    expect(bad).toMatchObject({ code: 1 });
    expect(bad.err).toContain("FACTORY_QUIET_MINUTES");
  });
});

describe("agent-factory setup", () => {
  const TOKEN = "sk-ant-oat01-AbCdEf0123456789_xyz-TOKEN";

  it("stores the pasted claude token and never prints it", async () => {
    const run = await cli(["setup", "claude"], { FACTORY_HOME: home }, `${TOKEN}\n`);
    expect(run.code).toBe(0);
    expect(run.out).toMatch(/^stored the claude token in .*secrets; made 20\d\d-.*, expires 20\d\d-/);
    expect(run.out + run.err).not.toContain(TOKEN);
  });

  it("refuses a GitHub login and stores nothing", async () => {
    const run = await cli(["setup", "claude"], { FACTORY_HOME: home }, "gho_16C7e42F292c6912E7710c838347Ae178B4a");
    expect(run.code).toBe(1);
    expect(run.err).toContain("GitHub login");
    expect(run.err).not.toContain("gho_16C7");
    expect((await cli(["setup", "status"], { FACTORY_HOME: home, FACTORY_BOX: "vm" })).out).toContain(
      "claude token: none",
    );
  });

  it("status names the box, its risks and a valid token, exit 0", async () => {
    await cli(["setup", "claude"], { FACTORY_HOME: home }, TOKEN);
    const run = await cli(["setup", "status"], { FACTORY_HOME: home, FACTORY_BOX: "vm" });
    expect(run.code).toBe(0);
    expect(run.out).toMatch(/^box: vm\n {2}risk: /);
    expect(run.out).toMatch(/claude token: valid, 36\d days left/);
    expect(run.out).not.toContain(TOKEN);
  });

  it("status fails when no box is chosen", async () => {
    await cli(["setup", "claude"], { FACTORY_HOME: home }, TOKEN);
    const run = await cli(["setup", "status"], { FACTORY_HOME: home });
    expect(run.code).toBe(1);
    expect(run.out).toContain("box: refused: FACTORY_BOX is not set");
  });

  it("names its steps when given none", async () => {
    expect((await cli(["setup"])).code).toBe(64);
  });
});

describe("agent-factory review", () => {
  const set = () => ({ FACTORY_REPO: home, FACTORY_RULEBOOK: home, FACTORY_HOME: home, PATH: process.env.PATH });

  it("prints its usage without exactly one change number (64)", async () => {
    for (const argv of [["review"], ["review", "abc"], ["review", "1", "2"], ["review", "0"]]) {
      expect(await cli(argv, set())).toMatchObject({ code: 64, err: "usage: agent-factory review <number>\n" });
    }
  });

  it("refuses a dry run, and a setting that is set but not valid, before it reads the forge (1)", async () => {
    const cases: readonly [NodeJS.ProcessEnv, string][] = [
      [{ ...set(), FACTORY_DRY_RUN: "1" }, "FACTORY_DRY_RUN is set"],
      [{ ...set(), FACTORY_MAX_USD: "two" }, "FACTORY_MAX_USD"],
      [{ ...set(), FACTORY_MAX_RUNS: "-1" }, "FACTORY_MAX_RUNS"],
      [{ ...set(), FACTORY_REPO: "clone" }, "FACTORY_REPO must be an absolute path"],
      [{ ...set(), FACTORY_HOME: "" }, "FACTORY_HOME must be an absolute path"],
    ];
    for (const [env, reason] of cases) {
      const run = await cli(["review", "12"], env);
      expect(run).toMatchObject({ code: 1, out: "" });
      expect(run.err).toContain(reason);
    }
  });

  it("refuses the round when it cannot tell which login the factory posts as (1)", async () => {
    const glab = join(home, "glab");
    writeFileSync(glab, "#!/bin/sh\necho down >&2\nexit 3\n", { mode: 0o755 });
    const run = await cli(["review", "12"], { ...set(), FACTORY_PROJECT: "a/b", FACTORY_GLAB: glab });
    expect(run).toMatchObject({ code: 1, out: "" });
    expect(run.err).toContain("cannot tell which login the factory posts as");
  });
});

describe("agent-factory loop commands (#138)", () => {
  it("print their usage on wrong arguments (64)", async () => {
    const cases: readonly (readonly string[])[] = [
      ["claim"],
      ["claim", "abc"],
      ["release", "1", "2"],
      ["status", "12", "aaaa1111"],
      ["ask", "x", "aaaa1111", "q"],
      ["block", "12"],
      ["reconcile", "now"],
      ["lint-edit"],
    ];
    for (const argv of cases) {
      const run = await cli(argv, {});
      expect(run.code).toBe(64);
      expect(run.err).toContain(`usage: agent-factory ${argv[0]}`);
    }
  });

  it("reconcile refuses a relative FACTORY_REPO before it reads the forge", async () => {
    const run = await cli(["reconcile"], { FACTORY_REPO: "clone" });
    expect(run).toMatchObject({ code: 1, err: expect.stringContaining("FACTORY_REPO must be an absolute path") });
  });

  it("lint-edit reads the tool call on stdin and skips a file outside the session's folder", async () => {
    const tool = JSON.stringify({ tool_input: { file_path: "/etc/hostname" } });
    expect(await cli(["lint-edit", "grep -n BAD"], { CLAUDE_PROJECT_DIR: home }, tool)).toEqual({
      code: 0,
      out: "",
      err: "",
    });
  });
});
