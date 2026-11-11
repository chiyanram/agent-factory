import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../src/app.js";
import { specHash } from "../src/core/spec.js";
import { tempDir } from "./temp.js";

const SPEC =
  "# PROJ-1: a title\n\n## Intent\n\nDo the thing.\n\n## Acceptance criteria\n\n1. It works.\n\n## Design\n\nnone\n\n## Lane\n\ntiny\n";

let home = "";
const started: {
  readonly bin: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}[] = [];
// the background commands a test asked for: the fake starts none of them (#305)
const backgrounded: { readonly args: readonly string[]; readonly log: string }[] = [];
// this test's own ids: a test never runs as root, and the platform is linux so no Keychain is touched
const ME = { uid: process.getuid?.() ?? -1, gid: process.getgid?.() ?? -1 };
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
      ...ME,
      run: async () => ({ code: 1, stdout: "", stderr: "no CLI in this test" }),
      interactive: async (call) => (started.push(call), 0),
      background: async (call) => (backgrounded.push(call), { kind: "ok", value: 4242 }),
    },
  });
  return { code, out, err };
}
function writeSpec(text: string): void {
  mkdirSync(join(home, "specs", "ledger", "PROJ-1"), { recursive: true });
  writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), text);
}

beforeEach(() => {
  home = tempDir("factory-cli-");
  backgrounded.length = 0;
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("agent-factory spec", () => {
  it("prints the hash of a spec that follows the template, exit 0", async () => {
    writeSpec(SPEC);
    const run = await cli(["spec", "ledger", "PROJ-1"]);
    expect(run).toMatchObject({
      code: 0,
      out: `spec ledger/PROJ-1 ${specHash(SPEC)} ${join(home, "specs", "ledger", "PROJ-1", "spec.md")}\ndesign none\n`,
    });
  });

  it("lists what a spec is missing, exit 2", async () => {
    writeSpec(SPEC.replace("1. It works.", "TBD"));
    const run = await cli(["spec", "ledger", "PROJ-1"]);
    expect(run.code).toBe(2);
    expect(run.err).toContain("Acceptance criteria");
  });

  // #489: checked at spec, before any design review: the planned files' lane, and the spec's own cites
  it("stops a spec whose planned files need a heavier lane, and one with a cite that does not hold, exit 2", async () => {
    mkdirSync(join(home, "projects"), { recursive: true });
    writeFileSync(
      join(home, "projects", "ledger.json"),
      JSON.stringify({ lanes: { oneWayDoor: ["db/migration/**"] } }),
    );
    writeSpec(SPEC.replace("## Lane", "## Planned files\n\n- db/migration/V2__add.sql\n\n## Lane"));
    const raised = await cli(["spec", "ledger", "PROJ-1"]);
    expect(raised.code).toBe(2);
    expect(raised.err).toContain("the lane is raised from tiny to one-way door");
    const clone = join(home, "clone");
    mkdirSync(clone);
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init", "-q"], { cwd: clone });
    writeSpec(SPEC.replace("Do the thing.", "Do the thing; see src/a.ts:3@0000000."));
    const cited = await cli(["spec", "ledger", "PROJ-1"], {
      FACTORY_HOME: home,
      FACTORY_REPO: clone,
      PATH: process.env.PATH,
    });
    expect(cited.code).toBe(2);
    expect(cited.err).toContain("src/a.ts:3@0000000: 0000000 is not a commit in the project's clone");
  });

  it("says the cites were not checked when no clone is set, and stops nothing for them (#489)", async () => {
    writeSpec(SPEC.replace("Do the thing.", "Do the thing; see src/a.ts:3@0000000 and Makefile:1@0000000."));
    const run = await cli(["spec", "ledger", "PROJ-1"]);
    expect(run.code).toBe(0);
    expect(run.err).toBe(
      "agent-factory spec: 2 cite(s) not checked: no clone set (FACTORY_REPO); the design review checks them\n",
    );
    writeSpec(SPEC);
    expect((await cli(["spec", "ledger", "PROJ-1"])).err).toBe("");
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
    expect(approved.out).toMatch(new RegExp(`^approved ledger/PROJ-1 spec ${hash} design none by `));
    expect((await cli(["approval", "ledger", "PROJ-1"])).code).toBe(0);
    writeSpec(SPEC.replace("It works.", "It works, fast."));
    const stale = await cli(["approval", "ledger", "PROJ-1"]);
    expect(stale.code).toBe(3);
    expect(stale.out).toContain("approve again");
  });

  it("spec prints the design's hash, approve needs it, and an edit to the design makes the approval stale (#227)", async () => {
    writeSpec(SPEC);
    const design = "# Design\n\nOne table.\n";
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "design.md"), design);
    expect((await cli(["spec", "ledger", "PROJ-1"])).out).toContain(`\ndesign ${specHash(design)}\n`);
    expect((await cli(["approve", "ledger", "PROJ-1", specHash(SPEC)])).err).toContain("design's hash is now");
    expect((await cli(["approve", "ledger", "PROJ-1", specHash(SPEC), specHash(design)])).code).toBe(0);
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "design.md"), `${design}Two tables.\n`);
    const stale = await cli(["approval", "ledger", "PROJ-1"]);
    expect(stale).toMatchObject({ code: 3, out: expect.stringContaining("approved design") });
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
                conflicts: false,
                mergeStatusEnum: "CAN_BE_MERGED",
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
      out: "!9 merged claimed=yes\n!12 head=1a2b3c4d draft=no claimed=yes pipeline=success needs_human=no stop=no asks=1 conflict=no\n",
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

// writeProject : <home>/projects/<name>.json with the project's git host, its project there and its clone (#377)
function writeProject(name: string, gitHostProject: string, clone = home): void {
  mkdirSync(join(home, "projects"), { recursive: true });
  writeFileSync(join(home, "projects", `${name}.json`), JSON.stringify({ gitHost: "gitlab", gitHostProject, clone }));
}

describe("commands read the project's git host and clone from the project file (#382)", () => {
  const POLLED = "!9 merged claimed=yes\n";
  // no FACTORY_PROJECT, FACTORY_FORGE or FACTORY_REPO: only the factory home and the fake glab
  const bare = () => ({ FACTORY_HOME: home, FACTORY_GLAB: fakeGlab(), PATH: process.env.PATH });

  it("poll with no export reads the one project in the factory home, or the project it names", async () => {
    writeProject("ledger", "aruvii/agent-platform");
    const sole = await cli(["poll"], bare());
    expect(sole).toMatchObject({ code: 0, out: expect.stringContaining(POLLED) });
    const named = await cli(["poll", "ledger"], bare());
    expect(named).toMatchObject({ code: 0, out: expect.stringContaining(POLLED) });
  });

  it("refuses when the factory home holds no project or several and none is named, and names them", async () => {
    expect(await cli(["poll"], bare())).toMatchObject({
      code: 1,
      out: "",
      err: expect.stringContaining("no project in"),
    });
    writeProject("ledger", "aruvii/agent-platform");
    writeProject("shop", "aruvii/shop");
    const many = await cli(["claim", "12"], bare());
    expect(many).toMatchObject({ code: 1, out: "" });
    expect(many.err).toContain("holds 2 projects (ledger, shop); name one: agent-factory claim <project> <number>");
    const unknown = await cli(["poll", "nope"], bare());
    expect(unknown).toMatchObject({ code: 1 });
    expect(unknown.err).toContain("or name one of ledger, shop");
    expect((await cli(["poll", "shop"], bare())).code).toBe(0);
  });

  it("the coordinator's project is the default; an exported FACTORY_PROJECT keeps the old form", async () => {
    writeProject("ledger", "aruvii/agent-platform");
    writeProject("shop", "not a project");
    const coordinated = await cli(["poll"], { ...bare(), FACTORY_DEFAULT_PROJECT: "ledger" });
    expect(coordinated).toMatchObject({ code: 0, out: expect.stringContaining(POLLED) });
    const old = await cli(["poll"], { ...bare(), FACTORY_PROJECT: "aruvii/agent-platform" });
    expect(old).toMatchObject({ code: 0, out: expect.stringContaining(POLLED) });
  });

  it("reconcile reads the clone from the project file", async () => {
    writeProject("ledger", "aruvii/agent-platform", "clone");
    const run = await cli(["reconcile", "ledger"], bare());
    expect(run).toMatchObject({
      code: 1,
      err: expect.stringContaining(`clone in ${join(home, "projects", "ledger.json")}:1 must be an absolute file path`),
    });
  });

  it("coordinator <project> starts the session with that project as its default; the only one with none named", async () => {
    expect((await cli(["setup", "coordinator"])).code).toBe(0);
    writeProject("ledger", "aruvii/agent-platform");
    started.length = 0;
    expect(await cli(["coordinator"])).toMatchObject({ code: 0, err: expect.stringContaining("for ledger") });
    expect(await cli(["coordinator", "ledger", "copilot"])).toMatchObject({ code: 0 });
    expect(started.map((s) => [s.bin, s.env.FACTORY_DEFAULT_PROJECT])).toEqual([
      ["claude", "ledger"],
      ["copilot", "ledger"],
    ]);
    writeProject("shop", "aruvii/shop");
    started.length = 0;
    expect(await cli(["coordinator"])).toMatchObject({ code: 0 });
    expect(started.map((s) => s.env.FACTORY_DEFAULT_PROJECT)).toEqual([undefined]);
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

// a glab that answers the branch search: factory/PROJ-1 is there when `there`
function branchGlab(there: boolean): string {
  const body = JSON.stringify(there ? [{ name: "factory/PROJ-1" }] : []);
  const path = join(home, "glab");
  writeFileSync(
    path,
    `#!/bin/sh\ncase "$*" in\n  *repository/branches*) printf 'HTTP/2.0 200 OK\\r\\n\\r\\n%s' '${body}' ;;\n  *) exit 3 ;;\nesac\n`,
    { mode: 0o755 },
  );
  return path;
}

// issueGlab : a fake glab that answers issue 2's description from <home>/issue.json, and refuses anything else
function issueGlab(): string {
  const path = join(home, "glab");
  writeFileSync(
    path,
    `#!/bin/sh\ncase "$*" in\n  *issues/2*) printf 'HTTP/2.0 200 OK\\r\\n\\r\\n'; cat '${join(home, "issue.json")}' ;;\n  *) exit 3 ;;\nesac\n`,
    { mode: 0o755 },
  );
  return path;
}

describe("the issue spec store (#381)", () => {
  const ISSUE = SPEC.replace("# PROJ-1: a title", "# 2: a title");
  const issue = (description: string | null): void =>
    writeFileSync(join(home, "issue.json"), JSON.stringify({ iid: 2, description }));
  const project = (extra: object = {}): void => {
    mkdirSync(join(home, "projects"), { recursive: true });
    writeFileSync(
      join(home, "projects", "ledger.json"),
      JSON.stringify({ gitHost: "gitlab", gitHostProject: "a/ledger", clone: home, specStore: "issue", ...extra }),
    );
  };
  const env = () => ({ FACTORY_HOME: home, FACTORY_GLAB: issueGlab() });

  it("spec reads and hashes the issue's body; approve binds it; an edit to the issue makes the approval stale", async () => {
    project();
    issue(ISSUE.replaceAll("\n", "\r\n"));
    const hash = specHash(ISSUE);
    const read = await cli(["spec", "ledger", "2"], env());
    expect(read).toMatchObject({ code: 0, out: `spec ledger/2 ${hash} issue #2 of a/ledger\ndesign none\n` });
    expect((await cli(["approve", "ledger", "2", hash, "--no-loop"], env())).code).toBe(0);
    expect((await cli(["approval", "ledger", "2"], env())).code).toBe(0);
    issue(ISSUE.replace("It works.", "It works, fast."));
    const stale = await cli(["approval", "ledger", "2"], env());
    expect(stale).toMatchObject({ code: 3, out: expect.stringContaining("approve again") });
    expect((await cli(["approve", "ledger", "2", hash, "--no-loop"], env())).err).toContain("it changed");
  });

  it("checks the issue's body by the template; an empty body is no spec; a ticket must be the issue number", async () => {
    project();
    issue(ISSUE.replace("1. It works.", "TBD"));
    expect(await cli(["spec", "ledger", "2"], env())).toMatchObject({
      code: 2,
      err: expect.stringContaining("Acceptance criteria"),
    });
    issue(null);
    expect(await cli(["spec", "ledger", "2"], env())).toMatchObject({
      code: 1,
      err: expect.stringContaining("no spec at issue #2 of a/ledger; write the spec in the issue's body"),
    });
    expect(await cli(["spec", "ledger", "PROJ-1"], env())).toMatchObject({
      code: 1,
      err: expect.stringContaining("the ticket is the issue number"),
    });
  });

  it("a work project refuses the issue store; a local spec is never read from the issue", async () => {
    project({ work: true });
    issue(ISSUE);
    expect(await cli(["spec", "ledger", "2"], env())).toMatchObject({
      code: 1,
      err: expect.stringContaining("where the spec stays local"),
    });
    project({ specStore: "local" });
    expect((await cli(["spec", "ledger", "2"], env())).err).toContain(join(home, "specs", "ledger", "2", "spec.md"));
  });
});

describe("agent-factory start (#227)", () => {
  const env = (there: boolean) => ({
    FACTORY_HOME: home,
    FACTORY_PROJECT: "a/ledger",
    FACTORY_GLAB: branchGlab(there),
  });

  it("records a human's START; with factory/<ticket> on the git host it asks first (3) and --yes starts", async () => {
    const run = await cli(["start", "ledger", "PROJ-1"], env(false));
    expect(run).toMatchObject({ code: 0, out: expect.stringMatching(/^started ledger\/PROJ-1 by /) });
    expect(JSON.parse(readFileSync(join(home, "starts", "ledger", "PROJ-1.json"), "utf8"))).toMatchObject({
      kind: "start",
      ticket: "PROJ-1",
      via: "terminal",
    });
    rmSync(join(home, "starts"), { recursive: true });
    const asked = await cli(["start", "ledger", "PROJ-1"], env(true));
    expect(asked).toMatchObject({ code: 3, err: expect.stringContaining("already on the git host") });
    expect((await cli(["start", "ledger", "PROJ-1", "--yes"], env(true))).code).toBe(0);
  });

  it("prints its usage without exactly a project and a plain ticket (64); a git host it cannot read refuses (1)", async () => {
    expect((await cli(["start", "ledger"])).code).toBe(64);
    expect((await cli(["start", "ledger", "../x"])).code).toBe(64);
    const down = await cli(["start", "ledger", "PROJ-1"], {
      FACTORY_HOME: home,
      FACTORY_PROJECT: "a/b",
      FACTORY_GLAB: join(home, "none"),
    });
    expect(down.code).toBe(1);
  });
});

describe("start and approve start the orchestrator loop (#305)", () => {
  const env = () => ({ FACTORY_HOME: home, FACTORY_PROJECT: "a/ledger", FACTORY_GLAB: branchGlab(false) });
  const LOG = () => join(home, "runs", "ledger", "loop.log");

  it("start starts a loop in the background when none runs; approve too; never one that runs", async () => {
    const first = await cli(["start", "ledger", "PROJ-1"], env());
    expect(first.code).toBe(0);
    expect(first.out).toContain("started the orchestrator loop for ledger (pid 4242)");
    expect(backgrounded).toEqual([{ args: ["dispatch", "ledger"], log: LOG() }]);
    // a loop runs: its file names a live pid (this test's own)
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    writeFileSync(join(home, "runs", "ledger", "loop.pid"), `${process.pid}:x`);
    writeSpec(SPEC);
    const approved = await cli(["approve", "ledger", "PROJ-1", specHash(SPEC)]);
    expect(approved).toMatchObject({
      code: 0,
      out: expect.stringContaining(`the orchestrator loop for ledger is already running (pid ${process.pid})`),
    });
    expect(backgrounded.length).toBe(1);
    // the loop that wrote the file died: approve starts a new one
    writeFileSync(join(home, "runs", "ledger", "loop.pid"), "999999999:x");
    expect((await cli(["approve", "ledger", "PROJ-1", specHash(SPEC)])).out).toContain("started the orchestrator loop");
    expect(backgrounded.length).toBe(2);
  });

  it("--no-loop starts none, and a refused START or approval starts none", async () => {
    expect((await cli(["start", "ledger", "PROJ-1", "--no-loop"], env())).code).toBe(0);
    writeSpec(SPEC);
    expect((await cli(["approve", "ledger", "PROJ-1", specHash(SPEC), "--no-loop"])).code).toBe(0);
    expect((await cli(["approve", "ledger", "PROJ-1", specHash("other")])).code).toBe(1);
    expect(backgrounded).toEqual([]);
  });
});

describe("agent-factory waive (#231)", () => {
  it("records a human's waiver of the test checks at the full head; a short head or no project refuses", async () => {
    const head = "c".repeat(40);
    const run = await cli(["waive", "ledger", "PROJ-1", head], { FACTORY_HOME: home });
    expect(run).toMatchObject({
      code: 0,
      out: expect.stringContaining(`waived the test checks of ledger/PROJ-1 at ${head}`),
    });
    expect(JSON.parse(readFileSync(join(home, "waivers", "ledger", "PROJ-1.json"), "utf8"))).toMatchObject({
      kind: "test-change",
      ticket: "PROJ-1",
      head,
      via: "terminal",
    });
    expect(await cli(["waive", "ledger", "PROJ-1", "cccc"], { FACTORY_HOME: home })).toMatchObject({
      code: 1,
      err: expect.stringContaining("full commit id"),
    });
    expect((await cli(["waive", "ledger", "PROJ-1"])).code).toBe(64);
    expect((await cli(["waive", "../x", "PROJ-1", head])).code).toBe(64);
  });
});

describe("agent-factory dispatch", () => {
  it("refuses to start while the coordinator's settings are missing or looser than its wall (#105)", async () => {
    const run = await cli(["dispatch", "ledger", "--once"], { FACTORY_HOME: home, FACTORY_PROJECT: "a/b" });
    expect(run).toMatchObject({ code: 1, err: expect.stringContaining("no coordinator settings") });
  });

  it("takes exactly one project (64 otherwise); without --once it is the loop, refused like a pass (#305)", async () => {
    const loop = await cli(["dispatch", "ledger"], { FACTORY_HOME: home, FACTORY_PROJECT: "a/b" });
    expect(loop).toMatchObject({ code: 1, err: expect.stringContaining("no coordinator settings") });
    expect((await cli(["dispatch"])).code).toBe(64);
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

  it("stores the Discord webhook at a hidden prompt, 0600, never printed; refuses anything else (#119)", async () => {
    const hook = "https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz_-0123";
    const run = await cli(["setup", "discord"], { FACTORY_HOME: home }, `${hook}\n`);
    expect(run).toMatchObject({ code: 0, out: expect.stringContaining("stored the Discord webhook") });
    expect(run.out + run.err).not.toContain(hook);
    const file = join(home, "secrets", "discord-token");
    expect(readFileSync(file, "utf8").trim()).toBe(hook);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const bad = await cli(["setup", "discord"], { FACTORY_HOME: home }, "https://evil.example/hook");
    expect(bad).toMatchObject({ code: 1, err: expect.stringContaining("not a Discord webhook URL") });
    expect(bad.err).not.toContain("evil.example");
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

  it("status lists a refused srt.readOnly folder under the srt runner, and fails (#371)", async () => {
    await cli(["setup", "claude"], { FACTORY_HOME: home }, TOKEN);
    const run = await cli(["setup", "status"], {
      FACTORY_HOME: home,
      FACTORY_BOX: "srt",
      FACTORY_SRT_READ_ONLY: JSON.stringify(["/usr"]),
    });
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/^box: srt\n {2}risk: /);
    expect(run.out).toContain('  refused: srt.readOnly "/usr" is not under your home');
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

  it("prints its usage without exactly a project and one change number (64)", async () => {
    for (const argv of [
      ["review"],
      ["review", "12"],
      ["review", "ledger", "abc"],
      ["review", "ledger", "1", "2"],
      ["review", "ledger", "0"],
      ["review", "../x", "12"],
    ]) {
      expect(await cli(argv, set())).toMatchObject({
        code: 64,
        err: "usage: agent-factory review <project> <number>\n",
      });
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
      const run = await cli(["review", "ledger", "12"], env);
      expect(run).toMatchObject({ code: 1, out: "" });
      expect(run.err).toContain(reason);
    }
  });

  it("refuses the round when it cannot tell which login the factory posts as (1)", async () => {
    const glab = join(home, "glab");
    writeFileSync(glab, "#!/bin/sh\necho down >&2\nexit 3\n", { mode: 0o755 });
    const run = await cli(["review", "ledger", "12"], { ...set(), FACTORY_PROJECT: "a/b", FACTORY_GLAB: glab });
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
      ["reconcile", "a", "b"],
      ["claim", "ledger"],
      ["status", "ledger", "12", "aaaa1111"],
      ["block", "../x", "12", "why"],
      ["lint-edit"],
    ];
    for (const argv of cases) {
      const run = await cli(argv, {});
      expect(run.code).toBe(64);
      expect(run.err).toContain(`usage: agent-factory ${argv[0]}`);
    }
  });

  it("text after -- that starts with - is text, not an option", async () => {
    const run = await cli(["ask", "--", "12", "aaaa1111", "- is X ok?"], {
      FACTORY_FORGE: "github",
      FACTORY_PROJECT: "ledger",
    });
    expect(run.code).toBe(1);
    expect(run.err).toContain("FACTORY_PROJECT must be owner/name");
  });

  it("reconcile refuses a relative FACTORY_REPO before it reads the forge", async () => {
    const run = await cli(["reconcile"], { FACTORY_HOME: home, FACTORY_PROJECT: "a/b", FACTORY_REPO: "clone" });
    expect(run).toMatchObject({
      code: 1,
      err: expect.stringContaining("(clone in the project file, or FACTORY_REPO) must be an absolute path"),
    });
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

describe("agent-factory box (#113)", () => {
  it("prints its usage for anything but box build <project>", async () => {
    for (const argv of [["box"], ["box", "build"], ["box", "make", "ledger"], ["box", "build", "a", "b"]]) {
      expect(await cli(argv)).toMatchObject({ code: 64, err: "usage: agent-factory box build <project>\n" });
    }
  });

  it("fails with the tool's own words when the build fails, and writes no box file", async () => {
    const run = await cli(["box", "build", "ledger"]);
    expect(run.code).toBe(1);
    // the first step packs this package for the base image (#171)
    expect(run.err).toContain("agent-factory box: npm pack: no CLI in this test");
  });
});

describe("agent-factory setup coordinator and coordinator (#106)", () => {
  it("writes the wall into <home>/coordinator, then starts the session there with only its settings", async () => {
    expect(await cli(["coordinator", "a", "b"])).toMatchObject({ code: 64 });
    expect(await cli(["coordinator", "x"])).toMatchObject({
      code: 1,
      err: expect.stringContaining(`no project file ${join(home, "projects", "x.json")}`),
    });
    expect(await cli(["coordinator"])).toMatchObject({
      code: 1,
      err: expect.stringContaining("setup coordinator first"),
    });
    const setup = await cli(["setup", "coordinator"]);
    expect(setup).toMatchObject({ code: 0, out: expect.stringContaining(join(home, "coordinator")) });
    started.length = 0;
    expect(await cli(["coordinator"])).toMatchObject({ code: 0 });
    expect(started).toMatchObject([
      { bin: "claude", args: ["--setting-sources", "project"], cwd: join(home, "coordinator") },
    ]);
    expect(await cli(["setup", "coordinator"], { FACTORY_HOME: home, FACTORY_BOT_HOME: "factory" })).toMatchObject({
      code: 1,
      err: expect.stringContaining("FACTORY_BOT_HOME must be an absolute path"),
    });
  });
});

describe("agent-factory plugin (#134)", () => {
  it("adds and tests a bundled forge plugin by its name, with the kit's fake gh in place of the real one", async () => {
    // the plugin's #!/usr/bin/env node needs node in a PATH folder only its owner can write (pluginPath); a CI runner's
    // tool cache may not be one, so the test gives it a link to this node in such a folder
    const bin = join(home, "bin");
    mkdirSync(bin, { mode: 0o755 });
    symlinkSync(process.execPath, join(bin, "node"));
    const env = { FACTORY_HOME: home, PATH: `${bin}:/usr/bin:/bin`, HOME: home };
    expect(await cli(["plugin", "test", "github"], env)).toMatchObject({
      code: 0,
      out: expect.stringContaining("ok   write fidelity forge.write/note (tricky text)"),
    });
    expect(await cli(["plugin", "add", "gitlab"], env)).toMatchObject({
      code: 0,
      out: expect.stringContaining("added gitlab"),
    });
  });

  it("lists none, adds a plugin by path, tests it, and records an update only for the hash it showed", async () => {
    expect(await cli(["plugin"])).toMatchObject({ code: 64 });
    expect(await cli(["plugin", "list"])).toMatchObject({ code: 0, out: "no plugins\n" });
    expect(await cli(["plugin", "add", "nope"])).toMatchObject({
      code: 1,
      err: expect.stringContaining("neither an absolute path nor a bundled plugin"),
    });
    const path = join(home, "echo", "plugin");
    mkdirSync(join(home, "echo"));
    const described = {
      protocol: 1,
      name: "echo",
      version: "1.0.0",
      capabilities: [{ name: "notify" }],
      writes: [],
    };
    writeFileSync(
      path,
      `#!${process.execPath}\nif (process.argv[2] === "describe") { process.stdout.write(${JSON.stringify(JSON.stringify(described))}); } else { let t = ""; process.stdin.on("data", (d) => (t += d)); process.stdin.on("end", () => process.stdout.write(JSON.stringify({ kind: "unsupported" }))); }\n`,
      { mode: 0o755 },
    );
    const env = { FACTORY_HOME: home, PATH: process.env.PATH };
    expect(await cli(["plugin", "add", path], env)).toMatchObject({
      code: 0,
      out: expect.stringContaining("added echo 1.0.0"),
    });
    expect(await cli(["plugin", "list"], env)).toMatchObject({
      out: expect.stringContaining("echo 1.0.0 (protocol 1): notify"),
    });
    expect(await cli(["plugin", "test", path], env)).toMatchObject({
      code: 0,
      out: expect.stringContaining("ok   handshake"),
    });
    const shown = await cli(["plugin", "update", "echo"], env);
    expect(shown).toMatchObject({ code: 3, out: expect.stringContaining("agent-factory plugin update echo ") });
    const sha = /plugin update echo ([0-9a-f]{64})/.exec(shown.out)?.[1] ?? "";
    expect(await cli(["plugin", "update", "echo", "0".repeat(64)], env)).toMatchObject({
      code: 1,
      err: expect.stringContaining("you saw"),
    });
    expect(await cli(["plugin", "update", "echo", sha], env)).toMatchObject({
      code: 0,
      out: expect.stringContaining("updated echo"),
    });
    expect(await cli(["plugin", "add", "../../etc/x"], env)).toMatchObject({
      code: 1,
      err: expect.stringContaining("neither an absolute path nor a plugin name"),
    });
  });
});
