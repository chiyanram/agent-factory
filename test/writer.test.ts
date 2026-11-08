import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { approve } from "../src/core/approval.js";
import type { Box, BoxSpec, Command, Ran } from "../src/core/box/types.js";
import type { RunInput } from "../src/core/dispatch/tick.js";
import type { WriterMode } from "../src/core/dispatch/records.js";
import type { Started as EgressStarted } from "../src/core/egress/start.js";
import type { Pusher } from "../src/core/finish.js";
import type { Done, Result } from "../src/core/forge/api.js";
import type { ChangeRequest, Forge, OpenChange } from "../src/core/forge/types.js";
import { renderPost, type Post } from "../src/core/post.js";
import { REPORT_INSTRUCTIONS } from "../src/core/report.js";
import { specHash } from "../src/core/spec.js";
import { claudeArgv } from "../src/core/writer/run.js";
import { minutesOf } from "../src/core/writer/settings.js";
import { promptFor, writerStep, type WriterSetup } from "../src/core/writer/step.js";
import { fakeBox, type FakeBox } from "./fake-box.js";
import { project, type Project } from "./review-repo.js";

const SPEC = [
  "# PROJ-1: renewals refuse a reserved loan",
  "",
  "## Intent",
  "",
  "A member cannot renew a reserved loan.",
  "",
  "## Acceptance criteria",
  "",
  "1. It answers 409.",
  "",
  "## Design",
  "",
  "none",
  "",
  "## Lane",
  "",
  "feature",
  "",
].join("\n");

const EGRESS: EgressStarted = {
  kind: "started",
  proxy: { host: "factory-egress-ledger", port: 3128 },
  network: "factory-int-ledger",
};
const DONE = { status: "done", evidence: [{ criterion: "AC1", command: "make test", result: "1 passed" }] };

let p: Project;
let home = "";
let rulebook = "";
beforeEach(async () => {
  p = project();
  home = join(p.root, "home-w");
  rulebook = join(p.root, "rulebook");
  mkdirSync(join(rulebook, ".claude-plugin"), { recursive: true });
  writeFileSync(join(rulebook, ".claude-plugin", "plugin.json"), '{"name":"rulebook"}\n');
  mkdirSync(join(home, "specs", "ledger", "PROJ-1"), { recursive: true });
  writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), SPEC);
  const done = await approve({
    where: { home, project: "ledger", ticket: "PROJ-1" },
    seenHash: specHash(SPEC),
    by: "ram",
    at: "2026-11-08T08:00:00Z",
  });
  expect(done.kind).toBe("approved");
});
afterEach(() => rmSync(p.root, { recursive: true, force: true }));

// what a writer does in its box: what it saw, then a commit and a report
type Seen = { readonly spec: string; readonly files: readonly string[] };
type Act = { readonly commit: boolean; readonly report: unknown; readonly exit: number };

// git as the writer runs it in the box: no author in the environment, so the clone's own author name applies
function boxGit(dir: string, ...args: string[]): string {
  const env = { PATH: process.env.PATH, HOME: p.env.HOME, GIT_CONFIG_NOSYSTEM: "1" };
  return execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
}

function writer(fake: FakeBox, act: Act, seen: Seen[]): Box {
  return {
    ...fake.box,
    run: async (call) => {
      const start = fake.calls.findLast((c) => c.op === "start");
      const dir = start?.op === "start" ? start.spec.worktree : "";
      seen.push({ spec: readFileSync(join(dir, ".factory", "spec.md"), "utf8"), files: readdirSync(dir).toSorted() });
      if (act.commit) {
        writeFileSync(join(dir, "Renewal.java"), "class Renewal {}\n");
        boxGit(dir, "add", "-A");
        boxGit(dir, "commit", "-q", "-m", "feat: refuse a reserved loan");
      }
      writeFileSync(join(dir, ".factory", "report.json"), JSON.stringify(act.report));
      await fake.box.run(call);
      const ran: Ran = { kind: "exited", code: act.exit, stdout: "{}", stderr: "" };
      return ran;
    },
  };
}

type Told = { readonly log: string[]; readonly opened: ChangeRequest[]; readonly forge: Forge };

// a forge that records what the host told it, in order
function forge(): Told {
  const log: string[] = [];
  const opened: ChangeRequest[] = [];
  const text = (post: Post) => {
    const r = renderPost(post);
    return r.kind === "ok" ? r.text.split("\n")[0] : `refused: ${r.reason}`;
  };
  const f = {
    name: "github",
    defaultBranch: async () => ({ kind: "ok", value: "main" }),
    ciConfig: async () => ({ kind: "ok", value: { kind: "file", path: ".gitlab-ci.yml" } }),
    openChange: async (request: ChangeRequest): Promise<Result<number>> => {
      opened.push(request);
      log.push(`open ${request.branch}`);
      return { kind: "ok", value: 41 };
    },
    addLabel: async ({ number, label }: { number: number; label: string }): Promise<Done> => {
      log.push(`label ${number} ${label}`);
      return { kind: "ok" };
    },
    note: async ({ number, post }: { number: number; post: Post }): Promise<Done> => {
      log.push(`note ${number} ${text(post)}`);
      return { kind: "ok" };
    },
  } as unknown as Forge;
  return { log, opened, forge: f };
}

// the host push, run for real against the local origin, after every guard the host passes
function pusher(pushes: { lease: string; branch: string }[]): Pusher {
  return async (request) => {
    for (const guard of request.guards) {
      const done = await guard({ repo: request.repo, commit: request.commit, lease: request.lease });
      if (done.kind === "failed") {
        return done;
      }
    }
    pushes.push({ lease: request.lease.kind === "sha" ? request.lease.sha : "absent", branch: request.branch });
    execFileSync("git", ["push", "-q", "origin", `${request.commit}:refs/heads/${request.branch}`], {
      cwd: request.repo,
      env: p.env,
    });
    return { kind: "ok" };
  };
}

function setup(box: Box, told: Told, pushes: { lease: string; branch: string }[]): WriterSetup {
  return {
    box: {
      box,
      image: { kind: "pinned", ref: `sha256:${"0".repeat(64)}` },
      egress: async () => EGRESS,
      repo: p.clone,
      env: { ...p.env, GITHUB_TOKEN: "host-only" },
      runsDir: join(p.root, "box-runs"),
    },
    settings: { rulebook, timeoutSeconds: 3600, claude: { maxUsd: "2", model: "" } },
    prompts: { fix: "fix {{ticket}} on {{branch}} at {{head}}", testFirst: "test {{ticket}}" },
    forge: told.forge,
    push: { forge: "github", host: "github.com", project: "o/r", identity: { kind: "own" }, env: p.env },
    home,
    project: "ledger",
    label: "agent::claimed",
    login: async () => ({
      kind: "ready",
      env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-test", CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" },
      notice: { kind: "none" },
    }),
    pusher: pusher(pushes),
  };
}

const openLine = (over: Partial<OpenChange> = {}): RunInput["change"] => ({
  kind: "open",
  line: {
    kind: "open",
    number: 12,
    branch: "feat/x",
    fork: false,
    lastNoteAt: "",
    head: p.head2,
    draft: true,
    claimed: true,
    pipeline: { kind: "none" },
    needsHuman: false,
    stop: { kind: "none" },
    asks: 0,
    ...over,
  },
});

async function run(s: WriterSetup, mode: WriterMode, change: RunInput["change"] = { kind: "none" }) {
  const step = writerStep({ kind: "ok", value: s });
  if (step.kind !== "available") throw new Error("unavailable");
  return step.run({ ticket: "PROJ-1", change, head: change.kind === "open" ? change.line.head : "", mode });
}

const origin = (ref: string): string =>
  execFileSync("git", ["rev-parse", ref], { cwd: join(p.root, "origin.git"), encoding: "utf8" }).trim();

// what the host gave the box, and the command it ran there; a missing call fails the test
function started(fake: FakeBox): BoxSpec {
  const call = fake.calls.find((c) => c.op === "start");
  if (call?.op !== "start") throw new Error("no box was started");
  return call.spec;
}

function command(fake: FakeBox): Command {
  const call = fake.calls.find((c) => c.op === "run");
  if (call?.op !== "run") throw new Error("nothing ran in the box");
  return call.command;
}

function valueOf<T>(out: Result<T>): T {
  if (out.kind !== "ok") throw new Error(out.reason);
  return out.value;
}

describe("the writer step: a ticket's first run (#113)", () => {
  it("runs the writer in a box on a clone of main, then pushes factory/PROJ-1, opens the draft change and claims it", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const told = forge();
    const pushes: { lease: string; branch: string }[] = [];
    const seen: Seen[] = [];
    const out = await run(setup(writer(fake, { commit: true, report: DONE, exit: 0 }, seen), told, pushes), "fix");

    expect(out).toMatchObject({ kind: "ok", value: { outcome: "done", evidence: DONE.evidence } });
    const { head, patch } = valueOf(out);
    // the writer saw the approved spec and the tree of main, and its commit is on the new branch on the forge
    expect(seen).toEqual([{ spec: SPEC, files: expect.arrayContaining(["AGENTS.md", ".factory"]) }]);
    expect(origin("refs/heads/factory/PROJ-1")).toBe(head);
    expect(origin(`${head}^`)).toBe(origin("refs/heads/main"));
    expect(patch).toMatch(/^[0-9a-f]{40}$/);
    const author = execFileSync("git", ["log", "-1", "--format=%an", head], {
      cwd: join(p.root, "origin.git"),
      encoding: "utf8",
    }).trim();
    expect(author).toBe("agent-factory writer");
    expect(pushes).toEqual([{ lease: "absent", branch: "factory/PROJ-1" }]);
    // pushed first, then opened, claimed, and the evidence posted on the new change
    expect(told.log).toEqual([
      "open factory/PROJ-1",
      "label 41 agent::claimed",
      expect.stringMatching(/^note 41 .*done at/),
    ]);
    expect(told.opened[0]).toMatchObject({
      branch: "factory/PROJ-1",
      base: "main",
      title: "PROJ-1: renewals refuse a reserved loan",
    });
    const body = JSON.stringify(told.opened.map((o) => o.body));
    expect(body).toContain(specHash(SPEC));
    expect(body).not.toContain("A member cannot renew");
  });

  it("gives the box only the model login, holds the settings and git config read-only, and leaves no run folder", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    await run(setup(writer(fake, { commit: true, report: DONE, exit: 0 }, []), forge(), []), "fix");
    const spec = started(fake);
    expect(spec.readOnly).toEqual(["AGENTS.md", ".git/config", ".git/hooks", ".factory/spec.md", ".factory/rulebook"]);
    expect(spec.network).toBe("factory-int-ledger");
    expect(spec.env).toMatchObject({
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-test",
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      HTTPS_PROXY: "http://factory-egress-ledger:3128",
    });
    expect(Object.keys(spec.env)).not.toContain("GITHUB_TOKEN");
    expect(Object.keys(spec.env)).not.toContain("PATH");
    const ran = command(fake);
    expect(ran.argv).toEqual(claudeArgv({ maxUsd: "2", model: "" }));
    expect(ran.stdin).toMatchObject({
      kind: "text",
      text: expect.stringContaining("fix PROJ-1 on factory/PROJ-1 at"),
    });
    expect(readdirSync(join(p.root, "box-runs"))).toEqual([]);
  });

  it("opens no change when the run committed nothing, so a person looks", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const told = forge();
    const out = await run(setup(writer(fake, { commit: false, report: DONE, exit: 0 }, []), told, []), "fix");
    expect(out).toMatchObject({ kind: "ok", value: { patch: "", outcome: "done" } });
    expect(told.log).toEqual([]);
  });

  it("reads a run that did not exit 0 as blocked, whatever its report says, and pushes the work in progress", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const told = forge();
    const out = await run(setup(writer(fake, { commit: true, report: DONE, exit: 1 }, []), told, []), "fix");
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked" } });
    expect(told.log).toContain("label 41 needs-human");
    expect(told.log.at(-1)).toMatch(/note 41 .*blocked: the run exited 1/);
  });
  it("reads a box that did not stop as blocked and never reads its report, which it may still be writing", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const box: Box = {
      ...writer(fake, { commit: true, report: DONE, exit: 0 }, []),
      stop: async () => ({ kind: "failed", reason: "docker rm timed out" }),
    };
    const told = forge();
    const out = await run(setup(box, told, []), "fix");
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked", evidence: [] } });
    expect(told.log.at(-1)).toMatch(/note 41 .*the box did not stop: docker rm timed out/);
  });
});

describe("the writer step: a later run on the change", () => {
  it("starts at the change's head and pushes with a lease on that head, opening nothing", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const told = forge();
    const pushes: { lease: string; branch: string }[] = [];
    const out = await run(
      setup(writer(fake, { commit: true, report: DONE, exit: 0 }, []), told, pushes),
      "fix",
      openLine(),
    );
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "done" } });
    expect(pushes).toEqual([{ lease: p.head2, branch: "feat/x" }]);
    expect(told.opened).toEqual([]);
    expect(told.log).toEqual([expect.stringMatching(/^note 12 .*done at/)]);
  });

  it("refuses to run when the head moved, and starts no box", async () => {
    const fake = fakeBox({});
    const out = await run(setup(fake.box, forge(), []), "fix", openLine({ head: p.head1 }));
    expect(out).toMatchObject({ kind: "failed", reason: expect.stringContaining("the head moved") });
    expect(fake.calls).toEqual([]);
  });

  it("refuses a branch that holds .factory or a symlink at AGENTS.md, and removes the run folder", async () => {
    for (const plant of [
      () => p.write(".factory/report.json", '{"status":"done"}'),
      () => {
        rmSync(join(p.clone, "AGENTS.md"));
        symlinkSync("/etc/hosts", join(p.clone, "AGENTS.md"));
      },
    ]) {
      p.git("checkout", "-q", "feat/x");
      plant();
      const head = p.commitAll("planted");
      p.git("push", "-q", "-f", "origin", "feat/x");
      p.git("reset", "-q", "--hard", "HEAD^");
      p.git("checkout", "-q", "main");
      const fake = fakeBox({});
      const out = await run(setup(fake.box, forge(), []), "fix", openLine({ head }));
      expect(out).toMatchObject({ kind: "failed", reason: expect.stringMatching(/\.factory|symlink at AGENTS\.md/) });
      expect(fake.calls).toEqual([]);
      expect(readdirSync(join(p.root, "box-runs"))).toEqual([]);
    }
  });

  it("does not run rework yet: says it needs agent-factory issue 171 on the change, labelled needs-human, and starts no box", async () => {
    const fake = fakeBox({});
    const told = forge();
    const out = await run(setup(fake.box, told, []), "rework", openLine());
    expect(out).toEqual({ kind: "ok", value: { head: p.head2, outcome: "blocked", patch: "", evidence: [] } });
    expect(told.log).toEqual([
      "label 12 needs-human",
      expect.stringMatching(/note 12 .*rework run is not built yet \(agent-factory issue 171\)/),
    ]);
    expect(fake.calls).toEqual([]);
  });

  it("refuses a ticket whose spec is no longer approved", async () => {
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), SPEC.replace("409", "423"));
    const fake = fakeBox({});
    const out = await run(setup(fake.box, forge(), []), "fix");
    expect(out).toMatchObject({ kind: "failed", reason: expect.stringContaining("not approved (stale)") });
    expect(existsSync(join(p.root, "box-runs"))).toBe(false);
  });
});

describe("the writer's words and settings", () => {
  it("fills the prompt with the run's names, then the report's schema", () => {
    const text = promptFor({
      prompts: { fix: "fix {{ticket}} on {{branch}} at {{head}} ({{ticket}})", testFirst: "test" },
      mode: "fix",
      ticket: "PROJ-1",
      branch: "factory/PROJ-1",
      head: "abc",
    });
    expect(text.startsWith("fix PROJ-1 on factory/PROJ-1 at abc (PROJ-1)\n\n")).toBe(true);
    expect(text).toContain(REPORT_INSTRUCTIONS);
  });

  it("runs claude with skip-all, the rulebook as a plugin, and the cap and model only when set", () => {
    expect(claudeArgv({ maxUsd: "", model: "" })).toEqual([
      "claude",
      "-p",
      "--dangerously-skip-permissions",
      "--plugin-dir",
      ".factory/rulebook",
      "--output-format",
      "json",
    ]);
    expect(claudeArgv({ maxUsd: "2", model: "opus" }).slice(-4)).toEqual(["--max-budget-usd", "2", "--model", "opus"]);
  });

  it("gives a run 60 minutes unless FACTORY_WRITER_MINUTES says otherwise, from 1 to 240", () => {
    expect(minutesOf({})).toEqual({ kind: "ok", value: 3600 });
    expect(minutesOf({ FACTORY_WRITER_MINUTES: "90" })).toEqual({ kind: "ok", value: 5400 });
    for (const bad of ["0", "241", "1.5", "x"]) {
      expect(minutesOf({ FACTORY_WRITER_MINUTES: bad }).kind).toBe("failed");
    }
  });

  it("is unavailable with the reason when its setup is not there", () => {
    expect(writerStep({ kind: "failed", reason: "no box" })).toEqual({ kind: "unavailable", reason: "no box" });
  });
});
