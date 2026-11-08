import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { approve } from "../src/core/approval.js";
import type { Box, BoxSpec, Command, Ran } from "../src/core/box/types.js";
import type { RunInput } from "../src/core/dispatch/tick.js";
import type { Task } from "../src/core/dispatch/records.js";
import { keepText, recordsDirOf } from "../src/core/kept.js";
import { VERIFY_FILE } from "../src/core/ready/steps.js";
import { keepActOn } from "../src/core/review/act-on.js";
import type { Sorted } from "../src/core/review/verdicts.js";
import type { Started as EgressStarted } from "../src/core/egress/start.js";
import type { Pusher } from "../src/core/finish.js";
import type { Result } from "../src/core/forge/api.js";
import type { ChangeRequest, FailedJob, Forge, OpenChange } from "../src/core/forge/types.js";
import { renderPost, type Post } from "../src/core/post.js";
import { REPORT_INSTRUCTIONS } from "../src/core/report.js";
import { specHash } from "../src/core/spec.js";
import { claudeArgv } from "../src/core/writer/run.js";
import { minutesOf } from "../src/core/writer/settings.js";
import { FOREGROUND, PROJECT_INSTRUCTIONS, promptFor, writerStep, type WriterSetup } from "../src/core/writer/step.js";
import { quoted, settingsOf, toolsOf } from "../src/core/writer/tools.js";
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
  if (done.kind !== "approved") throw new Error(`the test spec was not approved: ${done.kind}`);
});
afterEach(() => rmSync(p.root, { recursive: true, force: true }));

// what a writer does in its box: what it saw, then a commit and a report
type Seen = { readonly spec: string; readonly task: string; readonly files: readonly string[] };
// skipHook: the writer commits past the trailer hook, as `git -c core.hooksPath=/dev/null commit` would
// plant: a file the writer also commits, as a run that writes the agent's settings would (#110)
type Act = {
  readonly commit: boolean;
  readonly report: unknown;
  readonly exit: number;
  readonly skipHook?: boolean;
  readonly plant?: string;
};

// git as the writer runs it in the box: no author in the environment, so the clone's own author name applies
function boxGit(dir: string, ...args: string[]): string {
  const env = { PATH: process.env.PATH, HOME: p.env.HOME, GIT_CONFIG_NOSYSTEM: "1" };
  return execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
}

// the writer's commit in the box: its code, and the planted file when there is one
function commitWork(dir: string, act: Act): void {
  writeFileSync(join(dir, "Renewal.java"), "class Renewal {}\n");
  if (act.plant !== undefined) {
    mkdirSync(join(dir, act.plant, ".."), { recursive: true });
    writeFileSync(join(dir, act.plant), '{ "hooks": {} }\n');
  }
  boxGit(dir, "add", "-A");
  const hooks = act.skipHook === true ? ["-c", "core.hooksPath=/dev/null"] : [];
  boxGit(dir, ...hooks, "commit", "-q", "-m", "feat: refuse a reserved loan");
}

function writer(fake: FakeBox, act: Act, seen: Seen[]): Box {
  return {
    ...fake.box,
    run: async (call) => {
      const start = fake.calls.findLast((c) => c.op === "start");
      const dir = start?.op === "start" ? start.spec.worktree : "";
      const read = (file: string) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : "none");
      seen.push({ spec: read(".factory/spec.md"), task: read(".factory/task.md"), files: readdirSync(dir).toSorted() });
      if (act.commit) {
        commitWork(dir, act);
      }
      writeFileSync(join(dir, ".factory", "report.json"), JSON.stringify(act.report));
      await fake.box.run(call);
      const ran: Ran = { kind: "exited", code: act.exit, stdout: "{}", stderr: "" };
      return ran;
    },
  };
}

// log: the first line of each post; bodies: each note in full
// a writer that never exits by itself (#182): the box's stop ends it, or the box's own timeout after `polls` waits
function stuck(fake: FakeBox, act: Act, polls: number | "never") {
  const waited: number[] = [];
  let end: (ran: Ran) => void = () => {};
  const running = new Promise<Ran>((resolve) => {
    end = resolve;
  });
  const wait = async (ms: number) => {
    waited.push(ms);
    if (waited.length === polls) end({ kind: "timedOut", seconds: 3600 });
    // a watch that polls this often has missed its window: it fails by name, not by running out of memory
    if (waited.length > 100) throw new Error("still watching after 100 polls");
  };
  const box: Box = {
    ...writer(fake, act, []),
    run: async (call) => {
      await writer(fake, act, []).run(call);
      return running;
    },
    stop: async (session) => (end({ kind: "exited", code: 137, stdout: "", stderr: "" }), fake.box.stop(session)),
  };
  return { box, wait, waited };
}

type Told = {
  readonly log: string[];
  readonly bodies: string[];
  readonly opened: ChangeRequest[];
  readonly forge: Forge;
};

// a forge that records what the host told it, in order
function forge(jobs: readonly FailedJob[] = []): Told {
  const log: string[] = [];
  const bodies: string[] = [];
  const opened: ChangeRequest[] = [];
  const text = (post: Post) => {
    const r = renderPost(post);
    return r.kind === "ok" ? r.text.split("\n")[0] : `refused: ${r.reason}`;
  };
  // a call the writer step must never make fails the test's run with its name
  const unused = async (what: string) => ({ kind: "failed" as const, reason: `the writer step called ${what}` });
  const f: Forge = {
    name: "github",
    mark: "#",
    me: async () => unused("me"),
    change: async () => unused("change"),
    defaultBranch: async () => ({ kind: "ok", value: "main" }),
    addLabel: async ({ number, label }) => {
      log.push(`label ${number} ${label}`);
      return { kind: "ok" };
    },
    removeLabel: async () => unused("removeLabel"),
    note: async ({ number, post }) => {
      log.push(`note ${number} ${text(post)}`);
      const r = renderPost(post);
      bodies.push(r.kind === "ok" ? r.text : "");
      return { kind: "ok" };
    },
    notes: async () => unused("notes"),
    lineFinding: async () => unused("lineFinding"),
    status: async () => unused("status"),
    ciConfig: async () => ({ kind: "ok", value: { kind: "file", path: ".gitlab-ci.yml" } }),
    claimed: async () => unused("claimed"),
    openChange: async (request) => {
      opened.push(request);
      log.push(`open ${request.branch}`);
      return { kind: "ok", value: 41 };
    },
    changes: async () => unused("changes"),
    failedJobs: async () => ({ kind: "ok", value: jobs }),
  };
  return { log, bodies, opened, forge: f };
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

function setup(
  box: Box,
  told: Told,
  pushes: { lease: string; branch: string }[],
  wait: (ms: number) => Promise<void> = async () => {},
): WriterSetup {
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
    prompts: {
      fix: "fix {{ticket}} on {{branch}} at {{head}}",
      testFirst: "test {{ticket}}",
      rework: "rework {{ticket}}",
      ci: "ci {{ticket}}",
    },
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
    wait,
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

async function run(s: WriterSetup, task: Task, change: RunInput["change"] = { kind: "none" }) {
  const step = writerStep({ kind: "ok", value: s });
  if (step.kind !== "available") throw new Error("unavailable");
  return step.run({ ticket: "PROJ-1", change, head: change.kind === "open" ? change.line.head : "", task });
}

const FIX: Task = { kind: "fix" };

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
    const out = await run(setup(writer(fake, { commit: true, report: DONE, exit: 0 }, seen), told, pushes), FIX);

    expect(out).toMatchObject({ kind: "ok", value: { outcome: "done", evidence: DONE.evidence } });
    const { head, patch } = valueOf(out);
    // the writer saw the approved spec and the tree of main, and its commit is on the new branch on the forge
    expect(seen).toEqual([{ spec: SPEC, task: "none", files: expect.arrayContaining(["AGENTS.md", ".factory"]) }]);
    expect(origin("refs/heads/factory/PROJ-1")).toBe(head);
    expect(origin(`${head}^`)).toBe(origin("refs/heads/main"));
    expect(patch).toMatch(/^[0-9a-f]{40}$/);
    const author = execFileSync("git", ["log", "-1", "--format=%an", head], {
      cwd: join(p.root, "origin.git"),
      encoding: "utf8",
    }).trim();
    expect(author).toBe("agent-factory writer");
    // the clone's hook gave the writer's commit its seat (#128)
    const message = execFileSync("git", ["log", "-1", "--format=%B", head], {
      cwd: join(p.root, "origin.git"),
      encoding: "utf8",
    });
    expect(message).toBe("feat: refuse a reserved loan\n\nAgent: writer\n\n");
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
    await run(setup(writer(fake, { commit: true, report: DONE, exit: 0 }, []), forge(), []), FIX);
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
    const out = await run(setup(writer(fake, { commit: false, report: DONE, exit: 0 }, []), told, []), FIX);
    expect(out).toMatchObject({ kind: "ok", value: { patch: "", outcome: "done" } });
    expect(told.log).toEqual([]);
  });

  it("reads a run that did not exit 0 as blocked, whatever its report says, and pushes the work in progress", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const told = forge();
    const out = await run(setup(writer(fake, { commit: true, report: DONE, exit: 1 }, []), told, []), FIX);
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked" } });
    expect(told.log).toContain("label 41 needs-human");
    expect(told.log.at(-1)).toMatch(/note 41 .*blocked: the run exited 1/);
  });
  it("decides a run that hung after a done report from that report, and says in the note that it hung (#182)", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const s = stuck(fake, { commit: true, report: DONE, exit: 0 }, "never");
    const told = forge();
    const out = await run(setup(s.box, told, [], s.wait), FIX);
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "done", stop: "hung" } });
    expect(s.waited.at(-1)).toBe(60_000);
    expect(fake.calls.filter((c) => c.op === "stop")).toHaveLength(1);
    expect(told.bodies.at(-1)).toContain("the writer hung after its report; the host stopped it after 60s");
  });

  it("waits out the full timeout for a run with no report the schema accepts, and reads it as blocked (#182)", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const s = stuck(fake, { commit: true, report: "none", exit: 0 }, 4);
    const told = forge();
    const out = await run(setup(s.box, told, [], s.wait), FIX);
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked", stop: "exited" } });
    expect(s.waited).not.toContain(60_000);
    expect(told.log.at(-1)).toMatch(/note 41 .*blocked: the run was stopped after 3600s/);
  });

  it("reads a box that did not stop as blocked and never reads its report, which it may still be writing", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const box: Box = {
      ...writer(fake, { commit: true, report: DONE, exit: 0 }, []),
      stop: async () => ({ kind: "failed", reason: "docker rm timed out" }),
    };
    const told = forge();
    const out = await run(setup(box, told, []), FIX);
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
      FIX,
      openLine(),
    );
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "done" } });
    expect(pushes).toEqual([{ lease: p.head2, branch: "feat/x" }]);
    expect(told.opened).toEqual([]);
    expect(told.log).toEqual([expect.stringMatching(/^note 12 .*done at/)]);
  });

  it("pushes nothing when a commit got past the trailer hook, and blocks the change for a person (#128)", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const told = forge();
    const pushes: { lease: string; branch: string }[] = [];
    const act = { commit: true, report: DONE, exit: 0, skipHook: true };
    const out = await run(setup(writer(fake, act, []), told, pushes), FIX, openLine());
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked" } });
    expect(pushes).toEqual([]);
    expect(origin("refs/heads/feat/x")).toBe(p.head2);
    expect(told.log).toEqual([
      "label 12 needs-human",
      expect.stringMatching(/^note 12 .*blocked: the push failed: commit [0-9a-f]{8} has no "Agent: writer" trailer/),
    ]);
  });

  it("pushes nothing when the writer commits the agent's settings, and blocks the change for a person (#110)", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const told = forge();
    const pushes: { lease: string; branch: string }[] = [];
    const act = { commit: true, report: DONE, exit: 0, plant: ".claude/settings.json" };
    const out = await run(setup(writer(fake, act, []), told, pushes), FIX, openLine());
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked" } });
    expect(pushes).toEqual([]);
    expect(origin("refs/heads/feat/x")).toBe(p.head2);
    expect(told.log).toEqual([
      "label 12 needs-human",
      expect.stringMatching(
        /^note 12 .*blocked: the push failed: touches the agent's settings \(\.claude\/settings\.json\)/,
      ),
    ]);
  });

  it("refuses to run when the head moved, and starts no box", async () => {
    const fake = fakeBox({});
    const out = await run(setup(fake.box, forge(), []), FIX, openLine({ head: p.head1 }));
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
      const out = await run(setup(fake.box, forge(), []), FIX, openLine({ head }));
      expect(out).toMatchObject({ kind: "failed", reason: expect.stringMatching(/\.factory|symlink at AGENTS\.md/) });
      expect(fake.calls).toEqual([]);
      expect(readdirSync(join(p.root, "box-runs"))).toEqual([]);
    }
  });

  it("hands a CI run the failed jobs and their logs' ends, and a person the change when the forge names none", async () => {
    const jobs: readonly FailedJob[] = [
      { name: "test", log: { kind: "tail", text: "FAIL RenewalTest > refuses a reserved loan" } },
      { name: "sonar", log: { kind: "none", why: "not a GitHub Actions job" } },
    ];
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const seen: Seen[] = [];
    const out = await run(
      setup(writer(fake, { commit: true, report: DONE, exit: 0 }, seen), forge(jobs), []),
      { kind: "ci-red", head: p.head2 },
      openLine(),
    );
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "done" } });
    expect(seen[0]?.task).toContain(
      "## test\n\nThe end of its log:\n\n```text\nFAIL RenewalTest > refuses a reserved loan\n```",
    );
    expect(seen[0]?.task).toContain("## sonar\n\nNo log: not a GitHub Actions job");
    expect(command(fake).stdin).toMatchObject({ kind: "text", text: expect.stringMatching(/^ci PROJ-1/) });

    const none = fakeBox({});
    const told = forge([]);
    const handed = await run(setup(none.box, told, []), { kind: "ci-red", head: p.head2 }, openLine());
    expect(handed).toEqual({
      kind: "ok",
      value: { head: p.head2, outcome: "blocked", stop: "exited", patch: "", evidence: [] },
    });
    expect(told.log).toEqual([
      "label 12 needs-human",
      expect.stringMatching(/note 12 .*the forge names no failed job at the head/),
    ]);
    expect(none.calls).toEqual([]);
  });

  it("refuses a ticket whose spec is no longer approved", async () => {
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), SPEC.replace("409", "423"));
    const fake = fakeBox({});
    const out = await run(setup(fake.box, forge(), []), FIX);
    expect(out).toMatchObject({ kind: "failed", reason: expect.stringContaining("not approved (stale)") });
    expect(existsSync(join(p.root, "box-runs"))).toBe(false);
  });
});

const FINDING: Sorted = {
  id: "F-1",
  axis: "standards",
  kind: "logic",
  file: "src/Renewal.java",
  line: 7,
  rule: "R-3",
  severity: "blocker",
  finding: "a reserved loan still renews",
  fix: "refuse it with 409",
  bucket: "act_on",
  why: "the code renews it",
};

describe("the writer step: a rework run (#171)", () => {
  it("hands the writer the factory's own Act on findings at the head, in .factory/task.md, read-only", async () => {
    const kept = await keepActOn({
      recordsDir: recordsDirOf(p.clone),
      change: 12,
      head: p.head2,
      sorted: [FINDING, { ...FINDING, id: "F-2", bucket: "consider", finding: "a name could be clearer" }],
    });
    expect(kept.kind).toBe("ok");
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const seen: Seen[] = [];
    const pushes: { lease: string; branch: string }[] = [];
    const out = await run(
      setup(writer(fake, { commit: true, report: DONE, exit: 0 }, seen), forge(), pushes),
      { kind: "act-on", head: p.head2 },
      openLine(),
    );
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "done" } });
    expect(seen[0]?.task).toContain("## F-1 · src/Renewal.java:7 · R-3 (blocker)");
    expect(seen[0]?.task).toContain("Fix: refuse it with 409");
    expect(seen[0]?.task).not.toContain("F-2");
    expect(started(fake).readOnly).toContain(".factory/task.md");
    expect(command(fake).stdin).toMatchObject({ kind: "text", text: expect.stringMatching(/^rework PROJ-1/) });
    expect(pushes).toEqual([{ lease: p.head2, branch: "feat/x" }]);
  });

  it("hands the writer the evidence row the ready check saw fail", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const seen: Seen[] = [];
    await run(
      setup(writer(fake, { commit: true, report: DONE, exit: 0 }, seen), forge(), []),
      { kind: "ready-failed", why: "AC1 `make test` exited 2" },
      openLine(),
    );
    expect(seen[0]?.task).toContain("This one failed:\n\nAC1 `make test` exited 2");
  });

  it("gives a person the change when no Act on findings are kept at the head, and starts no box", async () => {
    const fake = fakeBox({});
    const told = forge();
    const out = await run(setup(fake.box, told, []), { kind: "act-on", head: p.head2 }, openLine());
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked" } });
    expect(told.log).toEqual([
      "label 12 needs-human",
      expect.stringMatching(/note 12 .*the rework run has no task: no Act on findings kept at .*act-on\.json/),
    ]);
    expect(fake.calls).toEqual([]);
  });
});

describe("the writer step: a CI run on a local gate (#171)", () => {
  it("hands the writer the local verifier's kept output, and a person the change when none is kept", async () => {
    const at = { recordsDir: recordsDirOf(p.clone), change: 12, head: p.head2 };
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const seen: Seen[] = [];
    const none = fakeBox({});
    const told = forge();
    const missing = await run(setup(none.box, told, []), { kind: "verify-failed", head: p.head2 }, openLine());
    expect(missing).toMatchObject({ kind: "ok", value: { outcome: "blocked" } });
    expect(told.log.at(-1)).toMatch(/the CI run has no task: nothing kept at .*verify\.txt/);
    expect(none.calls).toEqual([]);

    expect((await keepText(at, VERIFY_FILE, "# The local verifier failed\n\nmake verify exited 2\n")).kind).toBe("ok");
    const out = await run(
      setup(writer(fake, { commit: true, report: DONE, exit: 0 }, seen), forge(), []),
      { kind: "verify-failed", head: p.head2 },
      openLine(),
    );
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "done" } });
    expect(seen[0]?.task).toBe("# The local verifier failed\n\nmake verify exited 2\n");
    expect(command(fake).stdin).toMatchObject({ kind: "text", text: expect.stringMatching(/^ci PROJ-1/) });
  });
});

describe("the writer's lint hook in the box (#171 Q3)", () => {
  // commands.md on a branch of the origin, as a person pushed it
  function commands(branch: string, text: string): void {
    p.git("checkout", "-q", branch);
    p.write("docs/agents/commands.md", text);
    p.commitAll(`commands on ${branch}`);
    p.git("push", "-q", "origin", branch);
    p.git("checkout", "-q", "main");
  }

  it("reads lint-file from the default branch, mounts the hook read-only, and runs claude with --settings", async () => {
    commands("main", "# Commands\n\nlint-file: `npx biome lint`\ntest-touched: npm test --\n");
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const seen: Seen[] = [];
    await run(setup(writer(fake, { commit: true, report: DONE, exit: 0 }, seen), forge(), []), FIX);
    expect(started(fake).readOnly).toContain(".factory/settings.json");
    expect(command(fake).argv.slice(-2)).toEqual(["--settings", ".factory/settings.json"]);
    expect(command(fake).stdin).toMatchObject({
      kind: "text",
      text: expect.stringContaining("Each file you edit is linted at once with: npx biome lint."),
    });
  });

  it("never takes the hook from the change's branch", async () => {
    commands("feat/x", "lint-file: touch /tmp/owned\n");
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    await run(
      setup(writer(fake, { commit: true, report: DONE, exit: 0 }, []), forge(), []),
      FIX,
      openLine({ head: p.git("rev-parse", "origin/feat/x") }),
    );
    expect(started(fake).readOnly).not.toContain(".factory/settings.json");
    expect(command(fake).argv).not.toContain("--settings");
  });

  it("reads each tool's first line, unwraps a code span, and quotes the lint for the hook's shell", () => {
    expect(toolsOf("lint-file: `make lint FILE=`\r\nlint-file: other\n")).toEqual({
      lint: "make lint FILE=",
      quick: "",
    });
    expect(toolsOf("no tools here\n")).toEqual({ lint: "", quick: "" });
    expect(quoted("it's")).toBe("'it'\\''s'");
    expect(settingsOf({ lint: "", quick: "npm test" })).toEqual({ kind: "none" });
    const hook = settingsOf({ lint: "eslint --fix", quick: "" });
    expect(hook.kind === "text" ? JSON.parse(hook.text) : {}).toEqual({
      hooks: {
        PostToolUse: [
          {
            matcher: "Edit|MultiEdit|Write",
            hooks: [{ type: "command", command: "agent-factory lint-edit 'eslint --fix'" }],
          },
        ],
      },
    });
  });
});

describe("the writer's words and settings", () => {
  it("fills the prompt with the run's names, then the project's instructions and tools, then the report's schema", () => {
    const text = promptFor({
      prompts: { fix: "fix {{ticket}} on {{branch}} at {{head}} ({{ticket}})", testFirst: "t", rework: "r", ci: "c" },
      mode: "fix",
      ticket: "PROJ-1",
      branch: "factory/PROJ-1",
      head: "abc",
      tools: ["Each file you edit is linted at once with: make lint-file."],
    });
    expect(
      text.startsWith(
        `fix PROJ-1 on factory/PROJ-1 at abc (PROJ-1)\n\n${FOREGROUND}\n\n${PROJECT_INSTRUCTIONS}\n\nEach file you edit is linted at once with: make lint-file.\n\n`,
      ),
    ).toBe(true);
    expect(text).toContain(REPORT_INSTRUCTIONS);
  });

  it("tells the writer of every mode to keep its subagents and commands in the foreground (#192)", () => {
    const prompts = { fix: "f", testFirst: "t", rework: "r", ci: "c" };
    const modes = ["fix", "test-first", "rework", "ci"] as const;
    const texts = modes.map((mode) =>
      promptFor({ prompts, mode, ticket: "PROJ-1", branch: "b", head: "h", tools: [] }),
    );
    expect(texts.filter((t) => !t.includes(FOREGROUND))).toEqual([]);
  });

  it("runs claude with no settings of the branch, skip-all, the rulebook as a plugin, the cap and model only when set", () => {
    // --setting-sources user: the branch's .claude/settings.json, hooks, env, .mcp.json, CLAUDE.md and skills are not
    // loaded (#110); a real run showed the rulebook plugin and the --settings hook still load (decision on #110)
    expect(claudeArgv({ maxUsd: "", model: "" })).toEqual([
      "claude",
      "-p",
      "--setting-sources",
      "user",
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
