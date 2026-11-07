import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostPush, plainBranch, pushEnv, pushUrlFits, type PushRequest } from "../src/core/push.js";
import type { Identity } from "../src/core/identity.js";

// A real clone whose origin is https://github.com/o/r.git; the operator's global config (trusted) maps that URL to a
// bare repository on disk, so a push really happens with no network.
let root = "";
let env: NodeJS.ProcessEnv = {};
let work = "";
let remote = "";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { env, encoding: "utf8" }).trim();
}

function commit(message: string): string {
  writeFileSync(join(work, "file.txt"), `${message}\n`);
  git(work, "add", "file.txt");
  git(work, "commit", "-q", "-m", message);
  return git(work, "rev-parse", "HEAD");
}

const APP: Identity = { kind: "app", token: "ghs_0123456789abcdefghij", login: "ledger-factory[bot]", expiresAt: "2026-11-07T06:00:00Z" };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "factory-push-"));
  const home = join(root, "home");
  mkdirSync(home);
  env = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: "1" };
  remote = join(root, "remote.git");
  work = join(root, "work");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote], { env });
  execFileSync("git", ["init", "-q", "-b", "main", work], { env });
  git(home, "config", "--global", "user.name", "Writer");
  git(home, "config", "--global", "user.email", "writer@example.invalid");
  git(home, "config", "--global", `url.${remote}.insteadOf`, "https://github.com/o/r.git");
  git(work, "remote", "add", "origin", "https://github.com/o/r.git");
  commit("base");
  git(work, "push", "-q", "origin", "main", "main:refs/heads/feat/x");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function request(over: Partial<PushRequest>): PushRequest {
  return {
    repo: work,
    forge: "github",
    project: "o/r",
    branch: "feat/x",
    commit: git(work, "rev-parse", "HEAD"),
    lease: { kind: "sha", sha: git(remote, "rev-parse", "refs/heads/feat/x") },
    protectedBranches: ["main"],
    identity: { kind: "own" },
    env,
    guards: [],
    ...over,
  };
}

describe("hostPush", () => {
  it("pushes the writer's commit onto its branch when the branch is still what the caller saw", async () => {
    const lease = { kind: "sha", sha: git(remote, "rev-parse", "refs/heads/feat/x") } as const;
    const head = commit("the writer's change");
    expect(await hostPush(request({ commit: head, lease }))).toEqual({ kind: "ok" });
    expect(git(remote, "rev-parse", "refs/heads/feat/x")).toBe(head);
  });

  it("never overwrites a push made since: the lease fails and nothing is pushed", async () => {
    const seen = git(remote, "rev-parse", "refs/heads/feat/x");
    const human = commit("a human's change");
    git(work, "push", "-q", "origin", "HEAD:refs/heads/feat/x");
    git(work, "reset", "-q", "--hard", seen);
    const head = commit("the writer's change");
    expect(await hostPush(request({ commit: head, lease: { kind: "sha", sha: seen } }))).toMatchObject({ kind: "failed", reason: expect.stringContaining("moved") });
    expect(git(remote, "rev-parse", "refs/heads/feat/x")).toBe(human);
  });

  it("refuses a protected branch, a name that is not a plain branch, and a short SHA, before any git call", async () => {
    expect(await hostPush(request({ branch: "main" }))).toMatchObject({ kind: "failed", reason: expect.stringContaining("protected") });
    for (const branch of ["--force", "a..b", "x:refs/heads/main", "HEAD", "a/", "a.lock", "a//b", "a@{1}"]) {
      expect(plainBranch(branch)).toBe(false);
      expect(await hostPush(request({ branch }))).toMatchObject({ kind: "failed", reason: expect.stringContaining("plain branch") });
    }
    expect(await hostPush(request({ commit: "abc123" }))).toMatchObject({ kind: "failed", reason: expect.stringContaining("full SHAs") });
  });

  it("refuses a commit the clone does not have, and a clone that pushes somewhere else", async () => {
    expect(await hostPush(request({ commit: "f".repeat(40) }))).toMatchObject({ kind: "failed", reason: expect.stringContaining("not a commit") });
    git(work, "remote", "set-url", "--push", "origin", "https://evil.example/o/r.git");
    expect(await hostPush(request({}))).toMatchObject({ kind: "failed", reason: expect.stringContaining("evil.example") });
  });

  it("with an App, refuses a repo whose own config sets a credential helper: the push would go out as you", async () => {
    git(work, "config", "credential.helper", "store");
    expect(await hostPush(request({ identity: APP }))).toMatchObject({ kind: "failed", reason: expect.stringContaining("credential.helper") });
  });

  it("with an App, pushes; a guard's refusal stops the push", async () => {
    const lease = { kind: "sha", sha: git(remote, "rev-parse", "refs/heads/feat/x") } as const;
    const head = commit("the writer's change");
    const refused = await hostPush(request({ commit: head, lease, identity: APP, guards: [async () => ({ kind: "failed", reason: "touches CI config" })] }));
    expect(refused).toEqual({ kind: "failed", reason: "touches CI config" });
    expect(await hostPush(request({ commit: head, lease, identity: APP }))).toEqual({ kind: "ok" });
    expect(git(remote, "rev-parse", "refs/heads/feat/x")).toBe(head);
  });

  it("can create the branch when the caller saw none", async () => {
    const head = commit("first push");
    expect(await hostPush(request({ branch: "feat/new", commit: head, lease: { kind: "absent" } }))).toEqual({ kind: "ok" });
    // the branch exists now, so "the caller saw none" no longer holds
    const next = commit("second push");
    expect(await hostPush(request({ branch: "feat/new", commit: next, lease: { kind: "absent" } }))).toMatchObject({ kind: "failed", reason: expect.stringContaining("moved") });
    expect(git(remote, "rev-parse", "refs/heads/feat/new")).toBe(head);
  });
});

describe("pushEnv", () => {
  function fill(host: string, extra: NodeJS.ProcessEnv): string {
    try {
      return execFileSync("git", ["credential", "fill"], { env: { ...env, GIT_TERMINAL_PROMPT: "0", ...extra }, input: `protocol=https\nhost=${host}\npath=o/r.git\n\n`, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      return "";
    }
  }

  it("gives git the App's token for github.com only, and drops every other helper", () => {
    git(work, "config", "--global", "credential.helper", "!f() { echo username=OPERATOR; echo password=OPERATOR_SECRET; }; f");
    const own = pushEnv({ kind: "own" }, env);
    expect(fill("github.com", own.kind === "ok" ? own.value : {})).toContain("OPERATOR_SECRET");
    const app = pushEnv(APP, { ...env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.quotepath", GIT_CONFIG_VALUE_0: "off" });
    const appEnv = app.kind === "ok" ? app.value : {};
    expect(fill("github.com", appEnv)).toContain("password=ghs_0123456789abcdefghij");
    expect(fill("github.com", appEnv)).not.toContain("OPERATOR");
    expect(fill("evil.example", appEnv)).toBe("");
    expect(appEnv.GIT_CONFIG_KEY_0).toBe("core.quotepath");
  });

  it("refuses a GIT_CONFIG_COUNT that is not a whole number", () => {
    expect(pushEnv(APP, { GIT_CONFIG_COUNT: "x" })).toMatchObject({ kind: "failed" });
  });
});

describe("pushUrlFits", () => {
  it("an App pushes over https to github.com/<owner/name> only; your own login may also use ssh", () => {
    const fits = (url: string, app: boolean, forge: "github" | "gitlab" = "github", project = "o/r") => pushUrlFits({ url, project, forge, app });
    expect(fits("https://github.com/o/r.git", true)).toBe(true);
    expect(fits("git@github.com:o/r.git", true)).toBe(false);
    expect(fits("https://github.com/o/r2.git", true)).toBe(false);
    expect(fits("https://github.com.evil.example/o/r.git", true)).toBe(false);
    expect(fits("git@github.com:o/r.git", false)).toBe(true);
    expect(fits("ssh://git@gitlab.example.com:2222/group/sub/app.git", false, "gitlab", "group/sub/app")).toBe(true);
    expect(fits("https://gitlab.example.com/group/other.git", false, "gitlab", "group/sub/app")).toBe(false);
  });
});
