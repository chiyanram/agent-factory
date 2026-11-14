import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { approve } from "../src/core/approval.js";
import { start as startTicket } from "../src/core/start.js";
import type { Box, BoxSpec, Command, Ran } from "../src/core/box/types.js";
import type { RunInput } from "../src/core/dispatch/steps.js";
import type { Task } from "../src/core/dispatch/records.js";
import { keepText, recordsDirOf } from "../src/core/kept.js";
import { commandArgv } from "../src/core/ready/command.js";
import { READY_FILE, VERIFY_FILE } from "../src/core/ready/steps.js";
import { keepActOn } from "../src/core/review/act-on.js";
import type { Sorted } from "../src/core/review/verdicts.js";
import type { Started as EgressStarted } from "../src/core/egress/start.js";
import type { Pusher } from "../src/core/finish.js";
import type { Result } from "../src/core/forge/api.js";
import type { ChangeRequest, FailedJob, Forge, OpenChange } from "../src/core/forge/types.js";
import { renderBody, renderPost, type Post } from "../src/core/post.js";
import { REPORT_INSTRUCTIONS } from "../src/core/report.js";
import { specHash } from "../src/core/spec.js";
import { claudeArgv, lastLines, NO_TAIL, quietAfter, skipAll, tailOf } from "../src/core/writer/run.js";
import { minutesOf, questionsOf, stallOf } from "../src/core/writer/settings.js";
import {
  FLOOR,
  FOREGROUND,
  KNOWLEDGE,
  PROJECT_INSTRUCTIONS,
  runPrompt,
  evidenceRules,
  writerStep,
  type WriterSetup,
} from "../src/core/writer/step.js";
import { readCard, type Role } from "../src/core/process/cards.js";
import { readProcess, type PluginDir } from "../src/core/process/read.js";
import { designSteps, FLOOR as DESIGN_FLOOR } from "../src/core/design/step.js";
import type { ModelRun } from "../src/core/review/model.js";
import { NO_DESIGN } from "../src/core/spec.js";
import { createHash } from "node:crypto";
import { copyFileSync } from "node:fs";
import { MAX_TASK_CHARS } from "../src/core/writer/task.js";
import { outputName, scrubSecrets, WHY_CHARS, whyOf, whyText } from "../src/core/writer/why.js";
import { quoted, settingsOf, toolsOf, WRITER_ALLOW, writerDenies } from "../src/core/writer/tools.js";
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
  p = project("feat/x");
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
  // nothing runs without a START (#227)
  const startedTicket = await startTicket({
    where: { home, project: "ledger", ticket: "PROJ-1" },
    by: "ram",
    via: "terminal",
    at: "2026-11-08T07:00:00Z",
    branch: "absent",
    confirmed: false,
  });
  if (startedTicket.kind !== "started") throw new Error(`the test ticket was not started: ${startedTicket.kind}`);
});
afterEach(() => rmSync(p.root, { recursive: true, force: true }));

// what a writer does in its box: what it saw, then a commit and a report
type Seen = {
  readonly spec: string;
  readonly task: string;
  readonly files: readonly string[];
  readonly settings: string;
};
// skipHook: the writer commits past the trailer hook, as `git -c core.hooksPath=/dev/null commit` would
// plant: a file the writer also commits, as a run that writes the agent's settings would (#110)
type Act = {
  readonly commit: boolean;
  readonly report: unknown;
  readonly exit: number;
  readonly skipHook?: boolean;
  readonly plant?: string;
  // the PR body the writer writes in .factory/pr.md (#335)
  readonly pr?: string;
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
      seen.push({
        spec: read(".factory/spec.md"),
        task: read(".factory/task.md"),
        files: readdirSync(dir).toSorted(),
        settings: read(".factory/settings.json"),
      });
      if (act.commit) {
        commitWork(dir, act);
      }
      writeFileSync(join(dir, ".factory", "report.json"), JSON.stringify(act.report));
      if (act.pr !== undefined) {
        writeFileSync(join(dir, ".factory", "pr.md"), act.pr);
      }
      await fake.box.run(call);
      const ran: Ran = { kind: "exited", code: act.exit, stdout: "{}", stderr: "" };
      return ran;
    },
  };
}

// the completion window, shortened for the tests (#182)
const FAST = { pollMs: 20, windowMs: 150, graceMs: 200 };
// the stall time (#228), long enough that no other test's run stalls
const STALL_MS = 60_000;

// a writer that does its work and writes its report, then never exits on its own: a child keeps its stdout open. The
// host's stop ends it.
function hanging(fake: FakeBox, act: Act, seen: Seen[]): Box {
  const base = writer(fake, act, seen);
  let release: (ran: Ran) => void = () => undefined;
  return {
    ...base,
    run: async (call) => {
      await base.run(call);
      return new Promise<Ran>((resolve) => {
        release = resolve;
      });
    },
    stop: async (session) => {
      release({ kind: "failed", reason: "the box was stopped" });
      return base.stop(session);
    },
  };
}

type Told = { readonly log: string[]; readonly opened: ChangeRequest[]; readonly forge: Forge };

// a forge that records what the host told it, in order
function forge(jobs: readonly FailedJob[] = []): Told {
  const log: string[] = [];
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
    landed: async () => unused("landed"),
    defaultBranch: async () => ({ kind: "ok", value: "main" }),
    branchExists: async () => ({ kind: "ok", value: false }),
    branchState: async () => unused("branchState"),
    issueState: async () => unused("issueState"),
    issueBody: async () => unused("issueBody"),
    setIssueBody: async () => unused("setIssueBody"),
    addLabel: async ({ number, label }) => {
      log.push(`label ${number} ${label}`);
      return { kind: "ok" };
    },
    removeLabel: async () => unused("removeLabel"),
    note: async ({ number, post }) => {
      log.push(`note ${number} ${text(post)}`);
      return { kind: "ok" };
    },
    setBody: async ({ number, post }) => {
      const r = renderBody(post);
      log.push(`body ${number} ${r.kind === "ok" ? r.text.replaceAll("\n", " | ") : `refused: ${r.reason}`}`);
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
    settings: {
      plugins: [{ label: "rulebook@chiyanram", dir: rulebook }],
      timeoutSeconds: 3600,
      claude: { maxUsd: "2", model: "" },
      completion: FAST,
      stallMs: STALL_MS,
      questions: "round",
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
    mergeable: "clean",
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
    expect(seen).toEqual([
      {
        spec: SPEC,
        task: "none",
        files: expect.arrayContaining(["AGENTS.md", ".factory"]),
        settings: expect.stringContaining('"deny"'),
      },
    ]);
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
    expect(spec.readOnly).toEqual([
      "AGENTS.md",
      ".git/config",
      ".git/hooks",
      ".factory/spec.md",
      ".factory/plugins/1",
      ".factory/settings.json",
    ]);
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
    // the run gets the built-in implementer card's tools, and its prompt starts with the card's body
    expect(ran.argv).toEqual(
      claudeArgv(
        { maxUsd: "2", model: "" },
        { kind: "file", path: ".factory/settings.json" },
        1,
        ["Read", "Grep", "Glob", "Edit", "Bash"],
        "vm",
      ),
    );
    expect(ran.stdin).toMatchObject({ kind: "text", text: expect.stringMatching(/^# Implementer\n/) });
    expect(ran.stdin).toMatchObject({
      kind: "text",
      text: expect.stringContaining("This run builds ticket PROJ-1, on branch factory/PROJ-1 at head"),
    });
    expect(readdirSync(join(p.root, "box-runs"))).toEqual([]);
  });

  it("records the run's tokens and cost from the result event of its stream-json output (#131)", async () => {
    const result = {
      type: "result",
      subtype: "success",
      is_error: false,
      total_cost_usd: 0.42,
      usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 5, cache_read_input_tokens: 1000 },
    };
    const stdout = `${JSON.stringify({ type: "system", subtype: "init" })}\n${JSON.stringify(result)}\n`;
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout, stderr: "" }] });
    const out = await run(setup(writer(fake, { commit: true, report: DONE, exit: 0 }, []), forge(), []), FIX);
    expect(valueOf(out).spend).toEqual({ usd: 0.42, tokens: 1125 });
  });

  it("records no spend for a run that printed no result event, so usage counts it as unmeasured (#131)", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: '{"type":"system"}\n', stderr: "" }] });
    const out = await run(setup(writer(fake, { commit: true, report: DONE, exit: 0 }, []), forge(), []), FIX);
    expect(valueOf(out)).not.toHaveProperty("spend");
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

describe("the completion window (#182; ADR-0012 S13)", () => {
  it("ends a writer that hangs after a valid report at the window, not the timeout, and decides from the report", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const told = forge();
    const began = Date.now();
    const out = await run(setup(hanging(fake, { commit: true, report: DONE, exit: 0 }, []), told, []), FIX);
    // under the stall time, so it ended by the rule under test, not the stall; no fixed bound a slow runner overruns (#527)
    expect(Date.now() - began).toBeLessThan(STALL_MS);
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "done", evidence: DONE.evidence, hung: true } });
    expect(fake.calls.filter((c) => c.op === "stop")).toHaveLength(1);
    expect(told.log.at(-1)).toMatch(/note 41 \[writer\] done at/);
  });

  // a box whose run writes the work and the report, then does `then` with the report's folder after `ms`
  function after(fake: FakeBox, ms: number, then: (dir: string) => Ran | "never"): Box {
    const base = writer(fake, { commit: true, report: DONE, exit: 0 }, []);
    return {
      ...base,
      run: async (call) => {
        await base.run(call);
        const start = fake.calls.findLast((c) => c.op === "start");
        const dir = start?.op === "start" ? start.spec.worktree : "";
        await new Promise((resolve) => setTimeout(resolve, ms));
        const ran = then(dir);
        return ran === "never" ? new Promise<Ran>(() => undefined) : ran;
      },
    };
  }

  it("leaves a run that exits inside the window as it was: no hang", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const box = after(fake, 50, () => ({ kind: "exited", code: 0, stdout: "", stderr: "" }));
    const out = await run(setup(box, forge(), []), FIX);
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "done", hung: false } });
  });

  it("reads the box's own timeout inside the window as a hang after the report, decided from it", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const box = after(fake, 60, () => ({ kind: "timedOut", seconds: 3600 }));
    const out = await run(setup(box, forge(), []), FIX);
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "done", hung: true } });
  });

  it("decides from the report read after the stop: one the writer spoiled in the window is blocked", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const spoiled = after(fake, 60, (dir) => {
      writeFileSync(join(dir, ".factory", "report.json"), "not json");
      return "never";
    });
    const box: Box = { ...spoiled, stop: async (session) => fake.box.stop(session) };
    const out = await run(setup(box, forge(), []), FIX);
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked", hung: true } });
  });

  it("ends a run that never ends and wrote no valid report at the host's deadline: timed out, blocked", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const silent: Box = {
      ...writer(fake, { commit: true, report: {}, exit: 0 }, []),
      run: () => new Promise<Ran>(() => undefined),
    };
    const s = setup(silent, forge(), []);
    const began = Date.now();
    const out = await run({ ...s, settings: { ...s.settings, timeoutSeconds: 0 } }, FIX);
    // under the stall time, so it ended by the rule under test, not the stall; no fixed bound a slow runner overruns (#527)
    expect(Date.now() - began).toBeLessThan(STALL_MS);
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked", hung: false } });
    expect(fake.calls.filter((c) => c.op === "stop")).toHaveLength(1);
  });

  it("never reads the report of a hung run whose box does not stop, and does not wait for it", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const box: Box = {
      ...after(fake, 0, () => "never"),
      stop: async () => ({ kind: "failed", reason: "docker rm timed out" }),
    };
    const told = forge();
    const out = await run(setup(box, told, []), FIX);
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked", hung: false } });
    expect(told.log.at(-1)).toMatch(/the box did not stop: docker rm timed out/);
  });

  it("keeps a writer with no valid report to its own end: a timeout is blocked, as before", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const timedOut: Box = {
      ...writer(fake, { commit: true, report: { status: "done" }, exit: 0 }, []),
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return { kind: "timedOut", seconds: 3600 };
      },
    };
    const told = forge();
    const began = Date.now();
    const out = await run(setup(timedOut, told, []), FIX);
    // the window never opened: the run waited for its own end
    expect(Date.now() - began).toBeGreaterThanOrEqual(390);
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked", hung: false } });
  });

  it("never opens the window on a report the schema refuses", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const box = hanging(fake, { commit: true, report: { status: "done", evidence: [], extra: 1 }, exit: 0 }, []);
    const slow: Box = {
      ...box,
      run: (call) =>
        Promise.race([
          box.run(call),
          new Promise<Ran>((resolve) => setTimeout(() => resolve({ kind: "timedOut", seconds: 3600 }), 600)),
        ]),
    };
    const out = await run(setup(slow, forge(), []), FIX);
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked", hung: false } });
  });
});

describe("the stall stop (#228)", () => {
  const STALL = 200;
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // a forge that also keeps each post in full, to read its items
  function keeping(): Told & { readonly posts: string[] } {
    const told = forge();
    const posts: string[] = [];
    const note: Forge["note"] = async (input) => {
      const r = renderPost(input.post);
      posts.push(r.kind === "ok" ? r.text : r.reason);
      return told.forge.note(input);
    };
    return { ...told, posts, forge: { ...told.forge, note } };
  }

  it("stops a run that goes silent at the stall time: blocked, needs-human, with its last lines shown", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const base = hanging(fake, { commit: true, report: { status: "done" }, exit: 0 }, []);
    const silent: Box = {
      ...base,
      run: async (call) => {
        const ran = base.run(call);
        for (const line of ["line 1", "line 2", "line 3", "line 4", "line 5", "line 6"]) {
          call.command.watch?.(`{"type":"assistant","text":"${line}"}\n`);
        }
        // a last line with no line break is still shown; an @mention in it is made inert by post.ts
        call.command.watch?.("waiting on @someone");
        return ran;
      },
    };
    const told = keeping();
    const s = setup(silent, told, []);
    const began = Date.now();
    const out = await run({ ...s, settings: { ...s.settings, stallMs: STALL } }, FIX);
    expect(Date.now() - began).toBeGreaterThanOrEqual(STALL);
    // under the stall time, so it ended by the rule under test, not the stall; no fixed bound a slow runner overruns (#527)
    expect(Date.now() - began).toBeLessThan(STALL_MS);
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked", hung: false } });
    expect(fake.calls.filter((c) => c.op === "stop")).toHaveLength(1);
    expect(told.log).toContain("label 41 needs-human");
    const post = told.posts.at(-1) ?? "";
    expect(post).toMatch(/^\[coordinator\] blocked: the run printed nothing for 0 s; the host stopped it/);
    // the last five lines, oldest first, each cleaned for the forge
    const items = post.split("\n").filter((l) => l.startsWith("- "));
    expect(items).toHaveLength(5);
    expect(items[0]).toContain("line 3");
    expect(items.at(-1)).toBe("- waiting on @\u2060someone");
    expect(post).not.toContain("line 2");
  });

  it("never stops a run that streams steadily for longer than the stall time", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const base = writer(fake, { commit: true, report: { status: "done" }, exit: 0 }, []);
    const streaming: Box = {
      ...base,
      run: async (call) => {
        await base.run(call);
        const start = fake.calls.findLast((c) => c.op === "start");
        const dir = start?.op === "start" ? start.spec.worktree : "";
        // nothing reads the writer's output after the run: it keeps only the tail, so no cap stops a long run
        expect(call.command.keep).toBe("tail");
        for (let i = 0; i < 12; i += 1) {
          await pause(STALL / 4);
          call.command.watch?.(`{"type":"assistant","n":${i}}\n`);
        }
        writeFileSync(join(dir, ".factory", "report.json"), JSON.stringify(DONE));
        return { kind: "exited", code: 0, stdout: "", stderr: "" };
      },
    };
    const s = setup(streaming, forge(), []);
    const began = Date.now();
    const out = await run({ ...s, settings: { ...s.settings, stallMs: STALL } }, FIX);
    // the run went on for three stall times and ended on its own
    expect(Date.now() - began).toBeGreaterThanOrEqual(3 * STALL);
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "done", hung: false } });
  });

  it("does not count time the machine was asleep: a poll that took long adds at most two polls of quiet", () => {
    // awake: each poll adds the time since the last one
    expect(quietAfter({ quiet: 0, last: 0, heard: 0, now: 5000, pollMs: 5000 })).toBe(5000);
    // asleep for an hour between two polls: that hour is not quiet time
    expect(quietAfter({ quiet: 5000, last: 5000, heard: 0, now: 3_605_000, pollMs: 5000 })).toBe(15_000);
    // output since the last poll starts the quiet again from it
    expect(quietAfter({ quiet: 200_000, last: 5000, heard: 8000, now: 10_000, pollMs: 5000 })).toBe(2000);
  });

  it("keeps the run's last lines small: five at most, each cut", () => {
    const tail = ["a\nb", "\n\nc\nd\ne\nf", "g\n", `${"x".repeat(5000)}\n`].reduce(tailOf, NO_TAIL);
    const last = lastLines(tail);
    expect(last.slice(0, 4)).toEqual(["c", "d", "e", "fg"]);
    expect(last.at(-1)?.length).toBeLessThan(1000);
    expect(lastLines(NO_TAIL)).toEqual([]);
  });

  it("is 5 minutes unless FACTORY_WRITER_STALL_MINUTES lowers it; it can never be raised", () => {
    expect(stallOf({})).toEqual({ kind: "ok", value: 300_000 });
    expect(stallOf({ FACTORY_WRITER_STALL_MINUTES: "2" })).toEqual({ kind: "ok", value: 120_000 });
    for (const bad of ["0", "6", "1.5", "x", ""]) {
      expect(stallOf({ FACTORY_WRITER_STALL_MINUTES: bad }).kind).toBe("failed");
    }
  });
});

// a token prefix, joined at run time, so no secret scanner reads this file as holding a token
function fakeToken(prefix: string): string {
  return [prefix].join("");
}

describe("a writer run that stops says why, even before a change exists (#62)", () => {
  // fake tokens, built in pieces so no secret scanner reads this file as holding one
  const TOKENS = `${fakeToken("sk-ant-")}oat01-AAAAbbbbCCCCdddd ${fakeToken("gho")}_ABCDEFGHIJKLMNOPQRSTUVWX Authorization: Bearer abc.def.ghi`;

  // the agent CLI fails before it writes a report: no commit, a non-zero exit, its error on stderr
  function failing(fake: FakeBox): Box {
    return {
      ...fake.box,
      run: async (call) => {
        await fake.box.run(call);
        const stdout = '{"type":"system","subtype":"init"}\n';
        call.command.watch?.(stdout);
        const stderr = `starting\nwith ${TOKENS}\nError: Invalid API key · Please run /login\n`;
        return { kind: "exited", code: 1, stdout, stderr };
      },
    };
  }

  it("a run that exits non-zero with no report: the record has why, and the end of its output is kept, scrubbed", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const told = forge();
    const out = valueOf(await run(setup(failing(fake), told, []), FIX));
    expect(out).toMatchObject({ outcome: "blocked", patch: "" });
    expect(out.why).toBe("the run exited 1; the run said: Error: Invalid API key · Please run /login");
    // no change to post on: nothing went to the forge
    expect(told.log).toEqual([]);
    const file = out.output ?? "";
    expect(file.startsWith(join(home, "runs", "ledger", "PROJ-1", "writer-"))).toBe(true);
    const kept = readFileSync(file, "utf8");
    expect(kept).toContain("Error: Invalid API key");
    expect(kept).toContain('{"type":"system","subtype":"init"}');
    expect(kept).not.toMatch(/sk-ant-oat01|gho_ABC|abc\.def\.ghi/);
    expect(kept).toContain("[scrubbed]");
  });

  it("a blocked report: why is the writer's blocker, and no output is kept", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const report = { status: "blocked", blocker: "the spec names no endpoint to change" };
    const box = writer(fake, { commit: false, report, exit: 0 }, []);
    const out = valueOf(await run(setup(box, forge(), []), FIX));
    expect(out).toMatchObject({ outcome: "blocked", why: "the spec names no endpoint to change" });
    expect(out.output).toBeUndefined();
  });

  it("a blocked run that committed nothing still records what its result event reported (#483)", async () => {
    const result = { type: "result", total_cost_usd: 0.14, usage: { input_tokens: 148_000, output_tokens: 70 } };
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" }] });
    const report = { status: "blocked", blocker: "every Bash call fails with EPERM" };
    const box = writer(fake, { commit: false, report, exit: 0 }, []);
    const out = valueOf(await run(setup(box, forge(), []), FIX));
    expect(out).toMatchObject({ outcome: "blocked", patch: "", spend: { usd: 0.14, tokens: 148_070 } });
  });

  it("a blocked run with no result event records no spend, which usage counts as unknown (#483)", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const report = { status: "blocked", blocker: "every Bash call fails with EPERM" };
    const box = writer(fake, { commit: false, report, exit: 0 }, []);
    const out = valueOf(await run(setup(box, forge(), []), FIX));
    expect(out.outcome).toBe("blocked");
    expect(out).not.toHaveProperty("spend");
  });

  it("a done run carries no why", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const box = writer(fake, { commit: true, report: DONE, exit: 0 }, []);
    const out = valueOf(await run(setup(box, forge(), []), FIX));
    expect(out.outcome).toBe("done");
    expect(out.why).toBeUndefined();
  });
});

describe("a writer run keeps its whole output as its trace (#487)", () => {
  const traces = () => {
    const dir = join(home, "runs", "ledger", "PROJ-1");
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")) : [];
  };

  it("names the trace on the run's end, and keeps every line of its stream, scrubbed", async () => {
    const said = { type: "assistant", text: `the key is ${fakeToken("sk-ant-")}oat01-AAAAbbbbCCCCdddd` };
    const stdout = `${JSON.stringify({ type: "system", subtype: "init" })}\n${JSON.stringify(said)}\n{"type":"result"}\n`;
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout, stderr: "" }] });
    const out = valueOf(await run(setup(writer(fake, { commit: true, report: DONE, exit: 0 }, []), forge(), []), FIX));
    expect(out.trace).toMatch(/^writer-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.jsonl$/);
    expect(traces()).toEqual([out.trace]);
    const lines = readFileSync(join(home, "runs", "ledger", "PROJ-1", out.trace ?? ""), "utf8")
      .trim()
      .split("\n");
    expect(lines.map((l) => JSON.parse(l) as unknown)).toEqual([
      { type: "system", subtype: "init" },
      { type: "assistant", text: "the key is [scrubbed]" },
      { type: "result" },
    ]);
  });

  it("names the trace of a blocked run that committed nothing", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: '{"type":"system"}\n', stderr: "" }] });
    const report = { status: "blocked", blocker: "the spec names no endpoint to change" };
    const out = valueOf(await run(setup(writer(fake, { commit: false, report, exit: 0 }, []), forge(), []), FIX));
    expect(out).toMatchObject({ outcome: "blocked", trace: traces()[0] });
  });

  it("names the trace of a run whose host step failed after it, beside what it spent (#483)", async () => {
    const stdout = '{"type":"result","total_cost_usd":0.2,"usage":{"input_tokens":5}}\n';
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout, stderr: "" }] });
    const s = setup(writer(fake, { commit: true, report: DONE, exit: 0 }, []), forge(), []);
    const out = await run({ ...s, pusher: async () => ({ kind: "failed", reason: "the push failed" }) }, FIX);
    expect(out).toMatchObject({ kind: "failed", spend: { usd: 0.2, tokens: 5 }, traces: traces() });
    expect(traces()).toHaveLength(1);
  });

  it("names the trace of a run whose commits cannot be read, beside what it spent", async () => {
    const stdout = '{"type":"result","total_cost_usd":0.2,"usage":{"input_tokens":5}}\n';
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout, stderr: "" }] });
    const base = writer(fake, { commit: true, report: DONE, exit: 0 }, []);
    // the run leaves a clone git cannot read
    const box: Box = {
      ...base,
      run: async (call) => {
        const ran = await base.run(call);
        rmSync(join(started(fake).worktree, ".git"), { recursive: true, force: true });
        return ran;
      },
    };
    const out = await run(setup(box, forge(), []), FIX);
    expect(out).toMatchObject({ kind: "failed", spend: { usd: 0.2, tokens: 5 }, traces: traces() });
    expect(traces()).toHaveLength(1);
  });

  it("keeps no trace, and names none, for a run whose box never started", async () => {
    const fake = fakeBox({ runs: [] });
    const box: Box = { ...fake.box, start: async () => ({ kind: "failed", reason: "no container runtime" }) };
    const out = await run(setup(box, forge(), []), FIX);
    expect(out.kind === "ok" ? out.value : out).not.toHaveProperty("trace");
    expect(out).not.toHaveProperty("traces");
    expect(traces()).toEqual([]);
  });
});

describe("why.ts: the reason a person reads, made safe (#62)", () => {
  it("scrubs what looks like a token or a key, and keeps the words around it", () => {
    const text = [
      `login ${fakeToken("sk-ant-")}oat01-abcDEF123_-xyz failed`,
      `${fakeToken("gho")}_0123456789abcdefABCDEF ${fakeToken("ghp")}_0123456789abcdefABCDEF`,
      `${fakeToken("github_pat")}_11ABCDEFG0123456789_abcdefghijklmnop`,
      "curl -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'",
      "CLAUDE_CODE_OAUTH_TOKEN=sk-xyz GH_TOKEN: plain-secret-value",
    ].join("\n");
    const out = scrubSecrets(text);
    expect(out).not.toMatch(/abcDEF123|0123456789abcdef|11ABCDEFG|eyJhbGci|sk-xyz|plain-secret-value/);
    expect(out).toContain("login [scrubbed] failed");
    expect(out).toContain("Bearer [scrubbed]");
    expect(out).toContain("CLAUDE_CODE_OAUTH_TOKEN=[scrubbed]");
    expect(scrubSecrets("the run exited 1 at e9990c65605b")).toBe("the run exited 1 at e9990c65605b");
  });

  it("makes a reason one line, cut, and adds what the run said only to a reason the host decided", () => {
    expect(whyText("a\nb\u0007 c")).toBe("a b c");
    expect(Array.from(whyText("x".repeat(2000)))).toHaveLength(WHY_CHARS);
    const host = { kind: "blocked", reason: "the run wrote no .factory/report.json", by: "host" } as const;
    expect(whyOf(host, "Bearer abcdefgh")).toBe(
      "the run wrote no .factory/report.json; the run said: Bearer [scrubbed]",
    );
    expect(whyOf({ ...host, reason: "stuck", by: "writer" }, "anything")).toBe("stuck");
    expect(whyOf({ kind: "done", evidence: [] }, "x")).toBe("");
    const asked = whyOf({ kind: "asked", questions: [{ kind: "plain", question: "which table?" }] }, "");
    expect(asked).toBe("the writer asked: which table?");
  });

  it("names the kept output's file by the time, with no colon", () => {
    expect(outputName(Date.parse("2026-11-10T08:12:03.764Z"))).toBe("writer-2026-11-10T08-12-03-764Z.log");
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
    expect(command(fake).stdin).toMatchObject({
      kind: "text",
      text: expect.stringContaining("This run makes CI pass for ticket PROJ-1"),
    });

    const none = fakeBox({});
    const told = forge([]);
    const handed = await run(setup(none.box, told, []), { kind: "ci-red", head: p.head2 }, openLine());
    expect(handed).toEqual({
      kind: "ok",
      value: { head: p.head2, outcome: "blocked", patch: "", evidence: [], hung: false },
    });
    expect(told.log).toEqual([
      "label 12 needs-human",
      expect.stringMatching(/note 12 .*the forge names no failed job at the head/),
    ]);
    expect(none.calls).toEqual([]);
  });

  it("hands a merge run the default branch as origin/main, and pushes its merge as a fast-forward (#103)", async () => {
    // main moves on after the branch was cut
    p.write("svc/Other.java", "class Other {}\n");
    const mainTip = p.commitAll("feat: other");
    p.git("push", "-q", "origin", "main");
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const merging: Box = {
      ...fake.box,
      run: async (call) => {
        const start = fake.calls.findLast((c) => c.op === "start");
        const dir = start?.op === "start" ? start.spec.worktree : "";
        boxGit(dir, "merge", "-q", "--no-edit", "origin/main");
        writeFileSync(join(dir, ".factory", "report.json"), JSON.stringify(DONE));
        await fake.box.run(call);
        return { kind: "exited", code: 0, stdout: "{}", stderr: "" };
      },
    };
    const pushes: { lease: string; branch: string }[] = [];
    const told = forge();
    const out = await run(setup(merging, told, pushes), { kind: "conflict", head: p.head2 }, openLine());
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "done" } });
    const { head } = valueOf(out);
    expect(command(fake).stdin).toMatchObject({
      kind: "text",
      text: expect.stringContaining("This run merges main into ticket PROJ-1's branch feat/x"),
    });
    // a merge on top of the branch: its first parent the old head, its second main; the lease was the old head
    expect(origin("refs/heads/feat/x")).toBe(head);
    expect(origin(`${head}^1`)).toBe(p.head2);
    expect(origin(`${head}^2`)).toBe(mainTip);
    expect(pushes).toEqual([{ lease: p.head2, branch: "feat/x" }]);
    const message = execFileSync("git", ["log", "-1", "--format=%B", head], {
      cwd: join(p.root, "origin.git"),
      encoding: "utf8",
    });
    expect(message).toContain("Agent: writer");
  });

  it("refuses a ticket whose spec is no longer approved", async () => {
    writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), SPEC.replace("409", "423"));
    const fake = fakeBox({});
    const out = await run(setup(fake.box, forge(), []), FIX);
    expect(out).toMatchObject({ kind: "failed", reason: expect.stringContaining("the approval is stale") });
    expect(existsSync(join(p.root, "box-runs"))).toBe(false);
  });
});

const FINDING: Sorted = {
  id: "F-1",
  source: "review",
  lens: "baseline",
  axis: "standards",
  kind: "logic",
  file: "src/Renewal.java",
  line: 7,
  rule: "R-3",
  category: "bug",
  grade: "walked",
  evidence: "renew() at line 7",
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
    expect(command(fake).stdin).toMatchObject({
      kind: "text",
      text: expect.stringContaining("This run reworks ticket PROJ-1"),
    });
    expect(pushes).toEqual([{ lease: p.head2, branch: "feat/x" }]);
  });

  it("hands the writer the ready check's kept output at the head, capped (#199)", async () => {
    const at = { recordsDir: recordsDirOf(p.clone), change: 12, head: p.head2 };
    const output = `# The ready check failed\n\nrow 1 (AC1): make test exited 2\n\n${"x".repeat(MAX_TASK_CHARS)}`;
    expect((await keepText(at, READY_FILE, output)).kind).toBe("ok");
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const seen: Seen[] = [];
    await run(
      setup(writer(fake, { commit: true, report: DONE, exit: 0 }, seen), forge(), []),
      { kind: "ready-failed", head: p.head2 },
      openLine(),
    );
    expect(seen[0]?.task).toContain("row 1 (AC1): make test exited 2");
    expect(seen[0]?.task?.length).toBeLessThanOrEqual(MAX_TASK_CHARS + 100);
    expect(seen[0]?.task).toContain(`(cut at ${MAX_TASK_CHARS} characters)`);
    expect(command(fake).stdin).toMatchObject({
      kind: "text",
      text: expect.stringContaining("This run reworks ticket PROJ-1"),
    });
  });

  it("gives a person the change when the ready check kept nothing at the head, naming where it looked", async () => {
    const fake = fakeBox({});
    const told = forge();
    const out = await run(setup(fake.box, told, []), { kind: "ready-failed", head: p.head2 }, openLine());
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked" } });
    expect(told.log).toEqual([
      "label 12 needs-human",
      expect.stringMatching(
        new RegExp(`note 12 .*the rework run has no task: nothing kept at .*12/${p.head2}/ready\\.txt`),
      ),
    ]);
    expect(fake.calls).toEqual([]);
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
    expect(command(fake).stdin).toMatchObject({
      kind: "text",
      text: expect.stringContaining("This run makes CI pass for ticket PROJ-1"),
    });
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
    const seen: Seen[] = [];
    await run(
      setup(writer(fake, { commit: true, report: DONE, exit: 0 }, seen), forge(), []),
      FIX,
      openLine({ head: p.git("rev-parse", "origin/feat/x") }),
    );
    // the settings file holds only the host's allow and deny lists (#114): no hook from the branch
    expect(started(fake).readOnly).toContain(".factory/settings.json");
    expect(seen.map((s) => JSON.parse(s.settings) as unknown)).toEqual([
      { permissions: { allow: WRITER_ALLOW, deny: expect.arrayContaining(["WebFetch", "Bash(git push *)"]) } },
    ]);
  });

  it("reads each tool's first line, unwraps a code span, and quotes the lint for the hook's shell", () => {
    expect(toolsOf("lint-file: `make lint FILE=`\r\nlint-file: other\n")).toEqual({
      lint: "make lint FILE=",
      quick: "",
    });
    expect(toolsOf("no tools here\n")).toEqual({ lint: "", quick: "" });
    expect(quoted("it's")).toBe("'it'\\''s'");
    const plain = settingsOf({ lint: "", quick: "npm test" }, "/home/op");
    expect(plain.kind === "text" ? JSON.parse(plain.text) : {}).toEqual({
      permissions: { allow: WRITER_ALLOW, deny: writerDenies("/home/op") },
    });
    const hook = settingsOf({ lint: "eslint --fix", quick: "" }, "/home/op");
    expect(hook.kind === "text" ? JSON.parse(hook.text) : {}).toEqual({
      permissions: { allow: WRITER_ALLOW, deny: writerDenies("/home/op") },
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
  it("points the test-first and fix runs at the person's answers in .factory/task.md (#486)", async () => {
    const card = await readCard([], "implementer");
    if (card.kind !== "ok") throw new Error(card.reason);
    for (const mode of ["test-first", "fix"] as const) {
      const text = runPrompt({
        card: card.value,
        mode,
        names: { ticket: "PROJ-1", branch: "factory/PROJ-1", head: "abc", base: "main" },
        tools: [],
      });
      expect(text).toContain("When .factory/task.md is there, it holds the person's answers to your last questions.");
    }
  });

  it("builds the prompt from the role card: its body, the run's task, the floor, the project's instructions and tools, then the report's schema (#232)", async () => {
    const card = await readCard([], "implementer");
    if (card.kind !== "ok") throw new Error(card.reason);
    const text = runPrompt({
      card: card.value,
      mode: "fix",
      names: { ticket: "PROJ-1", branch: "factory/PROJ-1", head: "abc", base: "main" },
      tools: ["Each file you edit is linted at once with: make lint-file."],
    });
    expect(
      text.startsWith(
        `${card.value.body}\n\nThis run builds ticket PROJ-1, on branch factory/PROJ-1 at head abc. Your contract is the approved spec in .factory/spec.md: the intent, the acceptance criteria and the design. When .factory/task.md is there, it holds the person's answers to your last questions.\n\n${FLOOR}\n\n${FOREGROUND}\n\n${PROJECT_INSTRUCTIONS}\n\nEach file you edit is linted at once with: make lint-file.\n\n`,
      ),
    ).toBe(true);
    expect(text).toContain(REPORT_INSTRUCTIONS);
    expect(text).not.toContain('"deferred"');
  });

  it("names the exact programs an evidence row may start with, and that its result is the command's output, in every mode (#444)", async () => {
    const card = await readCard([], "implementer");
    if (card.kind !== "ok") throw new Error(card.reason);
    const names = { ticket: "PROJ-1", branch: "b", head: "h", base: "main" };
    for (const mode of ["fix", "test-first", "rework", "cleanup"] as const) {
      const text = runPrompt({ card: card.value, mode, names, tools: [], programs: ["./gradlew"] });
      expect(text).toContain(`${FLOOR}\n${evidenceRules(["./gradlew"])}\n\n`);
    }
    expect(evidenceRules(["./gradlew"])).toContain(
      "grep, test, wc, ls, cat, head, tail, git (only diff, log, show, status, ls-files, rev-parse), ./gradlew.",
    );
    expect(evidenceRules([])).toContain("never the evidence for what a file says");
  });

  // ledger#5 (#62): a row quoted its pattern in double quotes with a backtick inside, which a shell runs as a command,
  // so the ready check refused it three times; the rule tells the writer to use single quotes, and its own example runs
  it("tells the writer to quote patterns with single quotes, and its example is a row the ready check runs (#62)", () => {
    const rules = evidenceRules(["./gradlew"]);
    expect(rules).toContain("Quote patterns with single quotes");
    const example = /\((grep -n -E '[^']*' README\.md)\)/.exec(rules)?.[1] ?? "";
    expect(commandArgv(example, ["./gradlew"])).toEqual({
      kind: "ok",
      value: ["grep", "-n", "-E", "^## Commands|^- `./gradlew", "README.md"],
    });
    expect(commandArgv('grep -n -E "^## Commands|^- `./gradlew" README.md', ["./gradlew"])).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("needs a shell"),
    });
  });

  it("tells the writer of every mode the floor and to keep its subagents and commands in the foreground (#192, #232)", async () => {
    const card = await readCard([], "implementer");
    if (card.kind !== "ok") throw new Error(card.reason);
    const modes = ["fix", "test-first", "rework", "ci", "merge", "cleanup"] as const;
    const names = { ticket: "PROJ-1", branch: "b", head: "h", base: "main" };
    const texts = modes.map((mode) => runPrompt({ card: card.value, mode, names, tools: [] }));
    expect(texts.filter((t) => !t.includes(FOREGROUND) || !t.includes(FLOOR))).toEqual([]);
  });

  it("runs claude with no settings of the branch, skip-all, each plugin with --plugin-dir, streamed output, the cap and model only when set", () => {
    // --setting-sources user: the branch's .claude/settings.json, hooks, env, .mcp.json, CLAUDE.md and skills are not
    // loaded (#110); a real run showed the rulebook plugin and the --settings hook still load (decision on #110)
    expect(claudeArgv({ maxUsd: "", model: "" }, { kind: "none" }, 1, ["Read", "Edit", "Bash"], "vm")).toEqual([
      "claude",
      "-p",
      "--setting-sources",
      "user",
      "--dangerously-skip-permissions",
      "--plugin-dir",
      ".factory/plugins/1",
      "--tools",
      "Read,Edit,Write,Bash,TodoWrite,Skill,Task",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
    // the engine runs alone with no plugin, and hands two plugins in the project's order (#232)
    expect(claudeArgv({ maxUsd: "", model: "" }, { kind: "none" }, 0, ["Read"], "vm")).not.toContain("--plugin-dir");
    expect(claudeArgv({ maxUsd: "", model: "" }, { kind: "none" }, 2, ["Read"], "vm").slice(5, 9)).toEqual([
      "--plugin-dir",
      ".factory/plugins/1",
      "--plugin-dir",
      ".factory/plugins/2",
    ]);
    expect(claudeArgv({ maxUsd: "2", model: "opus" }, { kind: "none" }, 1, ["Read"], "vm").slice(-4)).toEqual([
      "--max-budget-usd",
      "2",
      "--model",
      "opus",
    ]);
  });

  it("gives skip-all only inside a runner, vm or srt, and hands the writer its allow and deny lists (#114, #111)", () => {
    const argv = (place: "vm" | "srt") => claudeArgv({ maxUsd: "", model: "" }, { kind: "none" }, 0, ["Read"], place);
    expect(argv("srt")).toContain("--dangerously-skip-permissions");
    expect(argv("vm")).toContain("--dangerously-skip-permissions");
    expect(skipAll("srt")).toEqual(["--dangerously-skip-permissions"]);
    expect(WRITER_ALLOW).toEqual(["Bash", "Edit(./**)"]);
    const deny = writerDenies("/Users/op/");
    expect(deny).toEqual(
      expect.arrayContaining([
        "WebFetch",
        "Bash(git push)",
        "Bash(git push *)",
        "Bash(curl)",
        "Bash(curl *)",
        "Read(//Users/op/.ssh/**)",
        "Read(//Users/op/.config/gh/**)",
        "Read(//Users/op/.config/glab-cli/**)",
        "Read(//Users/op/.git-credentials)",
        "Read(//Users/op/.netrc)",
        "Read(//Users/op/.aws/**)",
        "Read(//Users/op/.azure/**)",
        "Read(//Users/op/.config/gcloud/**)",
      ]),
    );
    // with no home known, the runner alone hides the credential paths
    expect(writerDenies("").filter((d) => d.startsWith("Read("))).toEqual([]);
  });

  it("gives a run 60 minutes unless FACTORY_WRITER_MINUTES says otherwise, from 1 to 240", () => {
    expect(minutesOf({})).toEqual({ kind: "ok", value: 3600 });
    expect(minutesOf({ FACTORY_WRITER_MINUTES: "90" })).toEqual({ kind: "ok", value: 5400 });
    for (const bad of ["0", "241", "1.5", "x"]) {
      expect(minutesOf({ FACTORY_WRITER_MINUTES: bad }).kind).toBe("failed");
    }
  });

  it("asks every question at once unless FACTORY_QUESTIONS says one-at-a-time, and refuses any other value (#320)", () => {
    expect(questionsOf({})).toEqual({ kind: "ok", value: "round" });
    expect(questionsOf({ FACTORY_QUESTIONS: "one-at-a-time" })).toEqual({ kind: "ok", value: "one-at-a-time" });
    for (const bad of ["", "all", "Round"]) {
      expect(questionsOf({ FACTORY_QUESTIONS: bad })).toEqual({
        kind: "failed",
        reason: "FACTORY_QUESTIONS must be round or one-at-a-time",
      });
    }
  });

  it("is unavailable with the reason when its setup is not there", () => {
    expect(writerStep({ kind: "failed", reason: "no box" })).toEqual({ kind: "unavailable", reason: "no box" });
  });
});

describe("the writer step: the implementer's PR body (#335)", () => {
  const PLANTED = '## Why\nRefuse a reserved loan. cc @alice\n/approve\n<img src="https://evil.example/x.png">\n';
  const ROW = { criterion: "AC1", command: "make test", result: "1 passed" };
  const JOBS: readonly FailedJob[] = [{ name: "test", log: { kind: "tail", text: "1 failed" } }];

  it("opens the first change with the engine's lines, then the implementer's PR body, cleaned, and keeps it for the cleanup run", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const told = forge();
    const out = await run(setup(writer(fake, { commit: true, report: DONE, exit: 0, pr: PLANTED }, []), told, []), FIX);
    const value = valueOf(out);
    const body = told.opened[0]?.body;
    expect(body?.prBody).toEqual({ markdown: PLANTED, host: "github.com" });
    if (body === undefined) throw new Error("no change was opened");
    const text = renderBody(body);
    expect(text).toMatchObject({ kind: "ok" });
    const posted = text.kind === "ok" ? text.text : "";
    expect(posted.split("\n")[0]).toBe("[coordinator] PROJ-1: renewals refuse a reserved loan");
    expect(posted).toContain(`- spec: ${specHash(SPEC)}`);
    expect(posted.indexOf("- spec:")).toBeLessThan(posted.indexOf("## Why"));
    expect(posted).toContain("cc @\u2060alice\n\\/approve");
    expect(posted).not.toContain("<img");
    const kept = join(recordsDirOf(p.clone), "41", value.head, "pr.md");
    expect(readFileSync(kept, "utf8")).toBe(PLANTED);
  });

  it("an implementer run on an open change sets the PR body; the cleanup run after it keeps that body under its deferred list", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const told = forge(JOBS);
    const out = await run(
      setup(writer(fake, { commit: true, report: DONE, exit: 0, pr: PLANTED }, []), told, []),
      { kind: "ci-red", head: p.head2 },
      openLine(),
    );
    const head = valueOf(out).head;
    const first = told.log.find((l) => l.startsWith("body 12")) ?? "";
    expect(first).toContain("--- |  | ## Why | Refuse a reserved loan. cc @\u2060alice | \\/approve");
    expect(first).not.toContain("evil.example");

    const cleanFake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const later = forge();
    const report = { ...DONE, deferred: ["drop the unused import"] };
    await run(
      setup(writer(cleanFake, { commit: false, report, exit: 0 }, []), later, []),
      { kind: "cleanup", head, evidence: [ROW] },
      openLine({ head }),
    );
    const cleaned = later.log.find((l) => l.startsWith("body 12")) ?? "";
    expect(cleaned).toContain("- deferred by the cleanup run: drop the unused import |  | --- |  | ## Why");
  });

  it("posts no PR body from a test-first run, or from a run that did not end done", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const told = forge();
    await run(setup(writer(fake, { commit: true, report: DONE, exit: 0, pr: PLANTED }, []), told, []), {
      kind: "test-first",
    });
    expect(told.opened[0]?.body.prBody).toBeUndefined();

    const asked = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const ask = forge(JOBS);
    const report = { status: "asked", questions: ["which loan?"] };
    await run(
      setup(writer(asked, { commit: true, report, exit: 0, pr: PLANTED }, []), ask, []),
      { kind: "ci-red", head: p.head2 },
      openLine(),
    );
    expect(ask.log.filter((l) => l.startsWith("body"))).toEqual([]);
  });
});

describe("the writer step: the cleanup run (#236)", () => {
  const ROW = { criterion: "AC1", command: "make test", result: "1 passed" };
  const CLEANUP: Task = { kind: "cleanup", head: "", evidence: [ROW] };

  it("runs from the cleanup role card, with the evidence rows and origin/main to diff against, and puts what it deferred in the PR body", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const seen: Seen[] = [];
    const report = { ...DONE, deferred: ["remove the empty catch in Renewal.java:3: it hides a failure"] };
    const told = forge();
    const out = await run(
      setup(writer(fake, { commit: true, report, exit: 0 }, seen), told, []),
      { ...CLEANUP, head: p.head2 },
      openLine(),
    );
    const value = valueOf(out);
    expect(value).toMatchObject({ outcome: "done", deferred: report.deferred, evidence: [ROW] });
    // the card's hash goes into the run record
    expect(value.card).toMatch(/^[0-9a-f]{64}$/);
    expect(command(fake).stdin).toMatchObject({ kind: "text", text: expect.stringMatching(/^# Cleanup\n/) });
    expect(command(fake).stdin).toMatchObject({ kind: "text", text: expect.stringContaining('"deferred"') });
    expect(seen[0]?.task).toContain("git diff origin/main...HEAD");
    expect(seen[0]?.task).toContain("- AC1: `make test` gave: 1 passed");
    expect(told.log.find((l) => l.startsWith("body 12"))).toContain(
      "deferred by the cleanup run: remove the empty catch in Renewal.java:3: it hides a failure",
    );
  });

  it("a cleanup with nothing to tidy commits nothing, and the PR body says nothing was deferred", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const told = forge();
    const out = await run(
      setup(writer(fake, { commit: false, report: DONE, exit: 0 }, []), told, []),
      { ...CLEANUP, head: p.head2 },
      openLine(),
    );
    expect(valueOf(out)).toMatchObject({ outcome: "done", patch: "" });
    expect(valueOf(out).deferred).toBeUndefined();
    expect(told.log.find((l) => l.startsWith("body 12"))).not.toContain("deferred");
  });

  it("a process plugin's cleanup card that asks for a tool the role does not get stops the run for a person", async () => {
    const process = join(rulebook, "skills", "crq", "process");
    mkdirSync(join(process, "roles"), { recursive: true });
    writeFileSync(join(process, "lanes.json"), JSON.stringify({ lanes: [{ lane: "tiny", approval: false }] }));
    writeFileSync(
      join(process, "roles", "cleanup.md"),
      "---\nrole: cleanup\ntools: [Read, Write, WebFetch]\n---\n\nTidy.\n",
    );
    const fake = fakeBox({});
    const told = forge();
    const out = await run(setup(fake.box, told, []), { ...CLEANUP, head: p.head2 }, openLine());
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked" } });
    expect(told.log.find((l) => l.startsWith("note 12"))).toContain("the cleanup run has no role card");
  });
});

describe("the writer step: role cards from the process plugin (#232)", () => {
  // the rulebook plugin's process, holding this implementer card
  function implementerCard(text: string): void {
    const roles = join(rulebook, "skills", "crq", "process", "roles");
    mkdirSync(roles, { recursive: true });
    writeFileSync(join(roles, "..", "lanes.json"), JSON.stringify({ lanes: [{ lane: "tiny", approval: false }] }));
    writeFileSync(join(roles, "implementer.md"), text);
  }

  it("starts the run from the plugin's card: its body leads the prompt, its tools are the run's only tools, and its hash is recorded", async () => {
    implementerCard("---\nrole: implementer\ntools: [Read, Edit]\n---\n\nBuild it the team's way.\n");
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const out = await run(setup(writer(fake, { commit: true, report: DONE, exit: 0 }, []), forge(), []), FIX);
    expect(valueOf(out).card).toMatch(/^[0-9a-f]{64}$/);
    const ran = command(fake);
    expect(ran.argv.slice(ran.argv.indexOf("--tools"), ran.argv.indexOf("--tools") + 2)).toEqual([
      "--tools",
      "Read,Edit,Write,TodoWrite,Skill,Task",
    ]);
    expect(ran.stdin).toMatchObject({ kind: "text", text: expect.stringMatching(/^Build it the team's way\.\n\n/) });
    // the card names no floor, and the run still gets it
    expect(ran.stdin).toMatchObject({ kind: "text", text: expect.stringContaining(FLOOR) });
  });

  it("a card whose must_not_see leaves out the run's task stops the run for a person, and starts no box", async () => {
    implementerCard("---\nrole: implementer\ntools: [Read]\nmust_not_see: the act_on list\n---\n\nBuild.\n");
    const kept = await keepActOn({ recordsDir: recordsDirOf(p.clone), change: 12, head: p.head2, sorted: [FINDING] });
    expect(kept.kind).toBe("ok");
    const fake = fakeBox({});
    const told = forge();
    const out = await run(setup(fake.box, told, []), { kind: "act-on", head: p.head2 }, openLine());
    expect(out).toMatchObject({ kind: "ok", value: { outcome: "blocked" } });
    expect(told.log.find((l) => l.startsWith("note 12"))).toContain("leaves out the act_on list");
    expect(fake.calls.filter((c) => c.op === "start")).toEqual([]);
  });

  it("the test-first run starts from the test-first card", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    await run(setup(writer(fake, { commit: true, report: DONE, exit: 0 }, []), forge(), []), { kind: "test-first" });
    expect(command(fake).stdin).toMatchObject({ kind: "text", text: expect.stringMatching(/^# Test-first\n/) });
  });

  it("blocks a run that edits outside its card's Edit(…) scope, and names the path (#424)", async () => {
    const dir = join(p.root, "scoped", "skills", "crq", "process");
    mkdirSync(join(dir, "roles"), { recursive: true });
    writeFileSync(join(dir, "lanes.json"), JSON.stringify({ lanes: [{ lane: "tiny", approval: false }] }));
    writeFileSync(
      join(dir, "roles", "test-first.md"),
      "---\nrole: test-first\ntools: [Read, Edit(src/test/**), Bash]\nhand_off: {status: done, evidence}\n---\n\n# Test-first\n",
    );
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const s = setup(writer(fake, { commit: true, report: DONE, exit: 0 }, []), forge(), []);
    const scoped = { ...s, settings: { ...s.settings, plugins: [{ label: "scoped", dir: join(p.root, "scoped") }] } };
    const out = await run(scoped, { kind: "test-first" });
    expect(out).toMatchObject({
      kind: "ok",
      value: {
        outcome: "blocked",
        why: expect.stringContaining("Renewal.java, outside its card's edit scope (src/test/**)"),
      },
    });
  });
});

// the roles a ticket's flow runs from cards
type Flow = Exclude<Role, "onboarder" | "retro">;

describe("a full run on each process: no plugin, the rulebook plugin, a team plugin (#232)", () => {
  const FIXTURES = join(import.meta.dirname, "..", "tests", "fixtures", "process");
  const BUILT_IN = join(import.meta.dirname, "..", "prompts", "roles");
  const ROLES: readonly Role[] = ["design-reviewer", "verify-pass", "implementer", "cleanup"];
  const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const bodyOf = (file: string) =>
    readFileSync(file, "utf8")
      .replace(/^---\n[\s\S]*?\n---\n/, "")
      .trim();

  // a plugin folder with a process: its lanes, and its role cards copied from `cards`
  function processPlugin(name: string, lanes: unknown, cards: string): string {
    const dir = join(p.root, name, "skills", "crq", "process");
    mkdirSync(join(dir, "roles"), { recursive: true });
    writeFileSync(join(dir, "lanes.json"), JSON.stringify(lanes));
    for (const role of ROLES) {
      copyFileSync(join(cards, `${role}.md`), join(dir, "roles", `${role}.md`));
    }
    return join(dir, "roles");
  }

  // the team's own cards: narrower tools, no floor of their own
  function teamCards(): string {
    const dir = join(p.root, "team-cards");
    mkdirSync(dir);
    const card = (role: Role, tools: string, hand: string) =>
      writeFileSync(
        join(dir, `${role}.md`),
        `---\nrole: ${role}\ntools: [${tools}]\nmust_not_see: none\nhand_off: ${hand}\n---\n\nThe team's ${role}.\n`,
      );
    card("design-reviewer", "Read, Grep", "{id, decision, verdict, file, line, rule, severity, grade, finding, fix}");
    card("verify-pass", "Read", "{id, bucket, why}");
    card("implementer", "Read, Edit, Bash", ".factory/report.json {status: done, evidence}");
    card("cleanup", "Read, Edit", ".factory/report.json {status: done, evidence, deferred}");
    return dir;
  }

  const DESIGN_FINDING = {
    id: "D-1",
    decision: "one table per ticket",
    verdict: "conflict",
    file: "AGENTS.md",
    line: 1,
    rule: "reuse",
    severity: "warning",
    grade: "walked",
    finding: "the table exists",
    fix: "reuse it",
  };

  // the design review and its verify pass, with a fake model; what each run was given
  async function designRuns(plugins: readonly PluginDir[]) {
    const seen: ModelRun[] = [];
    const outputs = [{ findings: [DESIGN_FINDING] }, { verdicts: [{ id: "D1", bucket: "act_on", why: "it holds" }] }];
    const design = designSteps({
      kind: "ok",
      value: {
        home,
        project: "ledger",
        repo: p.clone,
        env: p.env,
        forge: {
          defaultBranch: async () => ({ kind: "ok", value: "main" }),
          issueBody: async () => ({ kind: "failed", reason: "a local-store project reads no issue" }),
        },
        model: async (r) => {
          seen.push(r);
          return { kind: "ok", value: { output: outputs[seen.length - 1], answer: {}, costUsd: 0.1, tokens: 10 } };
        },
        modelName: "opus",
        maxUsd: "2",
        plugins,
        runsDir: join(p.root, "design-runs"),
      },
    });
    if (design.designReview.kind !== "available" || design.designVerify.kind !== "available") throw new Error("off");
    const at = { ticket: "PROJ-1", spec: specHash(SPEC), design: NO_DESIGN };
    const reviewed = await design.designReview.run(at);
    if (reviewed.kind !== "ok" || reviewed.value.kind !== "done") throw new Error(JSON.stringify(reviewed));
    const verified = await design.designVerify.run({ ...at, findings: reviewed.value.findings });
    expect(verified).toMatchObject({ kind: "ok", value: { kind: "done", kept: [{ id: "D1", bucket: "act_on" }] } });
    return { seen, card: reviewed.value.card };
  }

  // the implementer's first run, then cleanup on the change, in fake boxes
  async function writerRuns(plugins: readonly PluginDir[]) {
    const s = (box: Box) => ({
      ...setup(box, forge(), []),
      settings: { ...setup(box, forge(), []).settings, plugins },
    });
    const fixBox = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const fixed = valueOf(await run(s(writer(fixBox, { commit: true, report: DONE, exit: 0 }, [])), FIX));
    const cleanBox = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const cleanup: Task = { kind: "cleanup", head: p.head2, evidence: DONE.evidence };
    const cleaned = valueOf(
      await run(s(writer(cleanBox, { commit: false, report: DONE, exit: 0 }, [])), cleanup, openLine()),
    );
    return { fixed, cleaned, fix: command(fixBox), clean: command(cleanBox) };
  }

  const stdinOf = (c: Command) => (c.stdin.kind === "text" ? c.stdin.text : "");

  // the whole flow with fake runs: the process, the design review and its verify pass, the implementer, then cleanup;
  // each run started from the card at cards[role]
  async function fullRun(plugins: readonly PluginDir[], cards: Readonly<Record<Flow, string>>) {
    const process = await readProcess(plugins);
    if (process.kind !== "ok") throw new Error(process.reason);
    const design = await designRuns(plugins);
    const writing = await writerRuns(plugins);
    expect(design.card).toBe(sha(cards["design-reviewer"]));
    expect(writing.fixed).toMatchObject({ outcome: "done", card: sha(cards.implementer) });
    expect(writing.cleaned).toMatchObject({ outcome: "done", card: sha(cards.cleanup) });
    // each run's prompt is its card's body, then the engine's own words and floor, whatever the card left out
    const prompts = [...design.seen.map((r) => r.prompt), stdinOf(writing.fix), stdinOf(writing.clean)];
    const bodies = (["design-reviewer", "verify-pass", "implementer", "cleanup"] as const).map((r) => bodyOf(cards[r]));
    expect(prompts.map((t, i) => t.startsWith(`${bodies[i]}\n\n`))).toEqual([true, true, true, true]);
    expect(prompts.slice(0, 2).every((t) => t.includes(DESIGN_FLOOR))).toBe(true);
    expect(prompts.slice(2).every((t) => t.includes(FLOOR))).toBe(true);
    return { lanes: process.value.lanes, design: design.seen, fix: writing.fix, clean: writing.clean };
  }

  const cardsIn = (dir: string): Readonly<Record<Flow, string>> => {
    const at = (role: Role) => join(dir, `${role}.md`);
    return {
      implementer: at("implementer"),
      "test-first": at("test-first"),
      cleanup: at("cleanup"),
      "design-reviewer": at("design-reviewer"),
      "verify-pass": at("verify-pass"),
    };
  };
  const toolsAt = (argv: readonly string[]) => argv[argv.indexOf("--tools") + 1];

  it("with no plugin, the engine runs alone on its built-in process and cards", async () => {
    const ran = await fullRun([], cardsIn(BUILT_IN));
    expect(ran.lanes.map((l) => [l.name, l.approval])).toEqual([
      ["tiny", false],
      ["bug", true],
      ["feature", true],
      ["one-way door", true],
    ]);
    expect(ran.design.map((r) => r.tools)).toEqual([
      ["Read", "Grep", "Glob"],
      ["Read", "Grep", "Glob"],
    ]);
    expect(toolsAt(ran.fix.argv)).toBe("Read,Grep,Glob,Edit,Write,Bash,TodoWrite,Skill,Task");
    expect(ran.fix.argv).not.toContain("--plugin-dir");
  });

  it("with the rulebook plugin, every run starts from the rulebook's card, and the plugin is handed to the writer", async () => {
    const lanes = JSON.parse(readFileSync(join(FIXTURES, "rulebook-lanes.json"), "utf8")) as unknown;
    const roles = processPlugin("rulebook-crq", lanes, join(FIXTURES, "rulebook-roles"));
    const ran = await fullRun([{ label: "rulebook@chiyanram", dir: join(p.root, "rulebook-crq") }], cardsIn(roles));
    expect(ran.lanes.map((l) => l.name)).toEqual(["tiny", "bug", "feature", "one-way door"]);
    expect(ran.fix.argv).toContain("--plugin-dir");
    expect(toolsAt(ran.fix.argv)).toBe("Read,Grep,Glob,Edit,Write,Bash,TodoWrite,Skill,Task");
  });

  it("with a team plugin, its lanes and cards decide: its narrower tools are the runs' only tools, and the floor still holds", async () => {
    const lanes = { lanes: ["tiny", "bug", "feature", "one-way door"].map((lane) => ({ lane, approval: true })) };
    const roles = processPlugin("team", lanes, teamCards());
    const ran = await fullRun([{ label: "team@acme", dir: join(p.root, "team") }], cardsIn(roles));
    expect(ran.lanes.every((l) => l.approval)).toBe(true);
    expect(ran.design.map((r) => r.tools)).toEqual([["Read", "Grep"], ["Read"]]);
    expect(toolsAt(ran.fix.argv)).toBe("Read,Edit,Write,Bash,TodoWrite,Skill,Task");
    expect(toolsAt(ran.clean.argv)).toBe("Read,Edit,Write,TodoWrite,Skill,Task");
  });
});

describe("the writer step: the project's brief and glossary (#235)", () => {
  // an accepted brief, as agent-factory onboard accept leaves it: its cites keep each line's text
  function accepted(cites: readonly { readonly file: string; readonly line: number; readonly text: string }[]): void {
    const dir = join(home, "projects", "ledger");
    mkdirSync(dir, { recursive: true });
    const brief = "# ledger: brief\n\n- `make test` (`Makefile:1`, verified)\n";
    const glossary = "# ledger: glossary\n\n- **Renewal**: a loan extended. _Avoid_: extension.\n";
    writeFileSync(join(dir, "brief.md"), brief);
    writeFileSync(join(dir, "glossary.md"), glossary);
    writeFileSync(join(dir, "cites.json"), JSON.stringify(cites));
    const record = { version: 1, kind: "knowledge", brief_hash: specHash(brief), glossary_hash: specHash(glossary) };
    writeFileSync(join(dir, "knowledge.json"), JSON.stringify(record));
  }

  it("hands the run the accepted brief and glossary, and puts each stale cite in its record", async () => {
    accepted([
      { file: "svc/Main.java", line: 1, text: "class Main {}" },
      { file: "svc/Main.java", line: 1, text: "class Gone {}" },
    ]);
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    let brief = "";
    const reading: Box = {
      ...fake.box,
      run: async (call) => {
        const start = fake.calls.findLast((c) => c.op === "start");
        const dir = start?.op === "start" ? start.spec.worktree : "";
        brief = readFileSync(join(dir, ".factory", "brief.md"), "utf8");
        commitWork(dir, { commit: true, report: DONE, exit: 0 });
        writeFileSync(join(dir, ".factory", "report.json"), JSON.stringify(DONE));
        await fake.box.run(call);
        return { kind: "exited", code: 0, stdout: "{}", stderr: "" };
      },
    };
    const out = await run(setup(reading, forge(), []), FIX);
    expect(brief).toContain("`make test`");
    expect(command(fake).stdin).toMatchObject({ kind: "text", text: expect.stringContaining(KNOWLEDGE) });
    expect(valueOf(out).stale).toEqual(["svc/Main.java:1 is stale: its line changed"]);
  });

  it("a run with no accepted brief goes without one and reports nothing", async () => {
    const fake = fakeBox({ runs: [{ kind: "exited", code: 0, stdout: "", stderr: "" }] });
    const out = await run(setup(writer(fake, { commit: true, report: DONE, exit: 0 }, []), forge(), []), FIX);
    expect(valueOf(out).stale).toBeUndefined();
    expect(command(fake).stdin).toMatchObject({ kind: "text", text: expect.not.stringContaining(KNOWLEDGE) });
  });
});
