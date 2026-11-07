import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitlabIncludes, globRegex, noCiFiles } from "../src/core/ci-files.js";
import { ciConfigOf } from "../src/core/forge/gitlab.js";
import type { CiConfig } from "../src/core/forge/types.js";

describe("gitlabIncludes (#115)", () => {
  it("reads every form of a local include at any depth, child pipelines too; leaves out files kept elsewhere", () => {
    const yaml = [
      ".inc: &shared",
      "  - local: ci/anchored.yml",
      "include:",
      "  - local: '/ci/build.yml'",
      "  - 'ci/test.yml'",
      "  - local: ci/jobs/**.yml",
      "    rules:",
      "      - if: $CI_COMMIT_BRANCH",
      "  - project: group/shared",
      "    file: /templates/a.yml",
      "  - remote: https://example.com/ci.yml",
      "  - template: Auto-DevOps.gitlab-ci.yml",
      "  - component: gitlab.com/x/y@1.0",
      "  - https://example.com/raw.yml",
      "child:",
      "  trigger:",
      "    include: ci/child.yml",
      "other:",
      "  trigger:",
      "    include:",
      "      - local: ci/child2.yml",
      "more:",
      "  include: *shared",
    ].join("\n");
    expect(gitlabIncludes(yaml)).toEqual({
      kind: "ok",
      value: ["ci/build.yml", "ci/test.yml", "ci/jobs/**.yml", "ci/child.yml", "ci/child2.yml", "ci/anchored.yml"],
    });
  });

  it("reads flow lists of maps, multi-line flow lists, a quoted key and a single map", () => {
    expect(gitlabIncludes("include: [{local: ci/a.yml}, {local: ci/b.yml}]\n")).toEqual({
      kind: "ok",
      value: ["ci/a.yml", "ci/b.yml"],
    });
    expect(gitlabIncludes("include: [\n  ci/a.yml,\n  'ci/b.yml'\n]\n")).toMatchObject({
      value: ["ci/a.yml", "ci/b.yml"],
    });
    expect(gitlabIncludes('"include":\n  - ci/q.yml\n')).toMatchObject({ value: ["ci/q.yml"] });
    expect(gitlabIncludes("include:\n  local: ci/c.yml\n")).toMatchObject({ value: ["ci/c.yml"] });
    expect(gitlabIncludes("test:\n  script: make\n")).toEqual({ kind: "ok", value: [] });
  });

  it("refuses a file that is not YAML, an include it cannot read, and one that names a variable", () => {
    expect(gitlabIncludes("include: [\n")).toMatchObject({ kind: "failed" });
    expect(gitlabIncludes("include:\n  - { weird: x }\n")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("cannot read"),
    });
    expect(gitlabIncludes("include: ci/$CI_COMMIT_REF_NAME.yml\n")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("variable"),
    });
  });

  it("matches globs as GitLab does: ** crosses folders, * does not, {a,b} is a choice", () => {
    expect(globRegex("ci/**.yml").test("ci/sub/evil.yml")).toBe(true);
    expect(globRegex("ci/*.yml").test("ci/sub/evil.yml")).toBe(false);
    expect(globRegex("ci/*.yml").test("ci/a.yml")).toBe(true);
    expect(globRegex("ci/{a,b}.yml").test("ci/b.yml")).toBe(true);
    expect(globRegex("ci/a.yml").test("ci/aXyml")).toBe(false);
  });

  it("ciConfigOf: the default, a path in this repository, and a file kept in another project", () => {
    expect(ciConfigOf("")).toEqual({ kind: "file", path: ".gitlab-ci.yml" });
    expect(ciConfigOf("/ci/pipeline.yml")).toEqual({ kind: "file", path: "ci/pipeline.yml" });
    expect(ciConfigOf(".gitlab-ci.yml@group/ci-config")).toMatchObject({ kind: "none" });
    expect(ciConfigOf("https://example.com/ci.yml")).toMatchObject({ kind: "none" });
  });
});

describe("noCiFiles: the host push refuses a change to CI (#115; ADR-0012 S9)", () => {
  let root = "";
  let repo = "";
  const env = (): NodeJS.ProcessEnv => ({
    PATH: process.env.PATH,
    HOME: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "w",
    GIT_AUTHOR_EMAIL: "w@x",
    GIT_COMMITTER_NAME: "w",
    GIT_COMMITTER_EMAIL: "w@x",
  });
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { env: env(), encoding: "utf8" }).trim();
  const CONFIG: CiConfig = { kind: "file", path: ".gitlab-ci.yml" };

  function write(path: string, content: string): void {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  function commit(message: string): string {
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  }
  const guard = (config: CiConfig = CONFIG) => noCiFiles({ env: env(), defaultBranch: "main", config });
  const check = (sha: string, lease: string, config?: CiConfig) =>
    guard(config)({ repo, commit: sha, lease: { kind: "sha", sha: lease } });

  // main holds the CI; the agent branch starts from it
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "factory-ci-"));
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", join(root, "origin.git")], { env: env() });
    repo = join(root, "clone");
    execFileSync("git", ["clone", "-q", join(root, "origin.git"), repo], { env: env() });
    git("checkout", "-q", "-b", "main");
    write("src/a.ts", "a\n");
    write(
      ".gitlab-ci.yml",
      "include:\n  - local: /ci/build.yml\n  - local: ci/jobs/**.yml\nkid:\n  trigger:\n    include: ci/child.yml\n",
    );
    write("ci/build.yml", "include: ci/deeper.yml\nbuild:\n  script: make\n");
    write("ci/deeper.yml", "deeper:\n  script: make\n");
    write("ci/jobs/lint.yml", "lint:\n  script: make lint\n");
    write("ci/child.yml", "child:\n  script: make\n");
    write("ci/pipeline.yml", "custom:\n  script: make\n");
    write(".github/workflows/ci.yml", "on: push\n");
    write(".github/actions/setup/action.yml", "runs: {}\n");
    commit("main");
    git("push", "-q", "origin", "main");
    git("checkout", "-q", "-b", "factory/PROJ-1");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("lets a change to code through", async () => {
    const lease = git("rev-parse", "HEAD");
    write("src/a.ts", "b\n");
    expect(await check(commit("code"), lease)).toEqual({ kind: "ok" });
  });

  it("refuses each CI file: the fixed paths, an include, an include of an include, a ** glob, a child pipeline", async () => {
    const lease = git("rev-parse", "HEAD");
    const paths = [
      ".gitlab-ci.yml",
      ".github/workflows/ci.yml",
      ".github/workflows/new.yml",
      ".github/actions/setup/action.yml",
      "ci/build.yml",
      "ci/deeper.yml",
      "ci/jobs/sub/new.yml",
      "ci/child.yml",
    ];
    for (const path of paths) {
      git("checkout", "-q", "--detach", lease);
      write(path, "changed: true\n");
      const out = await check(commit(`change ${path}`), lease);
      expect({ path, out }).toMatchObject({
        path,
        out: { kind: "failed", reason: expect.stringContaining(`touches CI config (${path})`) },
      });
    }
  });

  it("guards the CI file the project's settings name instead", async () => {
    const lease = git("rev-parse", "HEAD");
    write("ci/pipeline.yml", "changed: true\n");
    const sha = commit("custom");
    expect(await check(sha, lease)).toEqual({ kind: "ok" });
    expect(await check(sha, lease, { kind: "file", path: "ci/pipeline.yml" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("ci/pipeline.yml"),
    });
  });

  it("refuses a CI change hidden in a merge commit, and a move away", async () => {
    const lease = git("rev-parse", "HEAD");
    git("checkout", "-q", "-b", "side");
    write("src/b.ts", "b\n");
    commit("side");
    git("checkout", "-q", "factory/PROJ-1");
    git("merge", "-q", "--no-ff", "--no-commit", "side");
    write(".gitlab-ci.yml", "evil: true\n");
    git("add", "-A");
    git("commit", "-q", "-m", "merge side");
    expect(await check(git("rev-parse", "HEAD"), lease)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining(".gitlab-ci.yml"),
    });
    git("checkout", "-q", "--detach", lease);
    mkdirSync(join(repo, "docs"));
    git("mv", ".github/workflows/ci.yml", "docs/ci.yml");
    expect(await check(commit("move"), lease)).toMatchObject({ kind: "failed" });
  });

  it("lets a merge of the default branch bring its CI, and keeps a person's CI commit on the branch", async () => {
    // a person changes CI on the agent branch, in their own commit: the lease holds it
    write(".github/workflows/ci.yml", "on: [push, pull_request]\n");
    const person = commit("person's CI change");
    write("src/a.ts", "agent\n");
    expect(await check(commit("agent code"), person)).toEqual({ kind: "ok" });
    // main moves its CI; the writer merges main
    git("checkout", "-q", "main");
    write("ci/build.yml", "build:\n  script: make all\n");
    commit("main CI");
    git("push", "-q", "origin", "main");
    git("checkout", "-q", "factory/PROJ-1");
    const before = git("rev-parse", "HEAD");
    git("merge", "-q", "--no-edit", "main");
    expect(await check(git("rev-parse", "HEAD"), before)).toEqual({ kind: "ok" });
  });

  it("refuses a reset to a commit whose CI is neither the branch's nor the default branch's", async () => {
    write(".github/workflows/ci.yml", "old: true\n");
    const old = commit("old CI");
    git("reset", "-q", "--hard", "HEAD~1");
    write("src/a.ts", "x\n");
    const lease = commit("code");
    git("reset", "-q", "--hard", old);
    write("src/a.ts", "y\n");
    expect(await check(commit("built on the old CI"), lease)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining(".github/workflows/ci.yml"),
    });
  });

  it("checks a new branch against the default branch, even one started from another remote branch", async () => {
    git("checkout", "-q", "-b", "elsewhere", "main");
    write(".github/workflows/ci.yml", "elsewhere: true\n");
    commit("elsewhere");
    git("push", "-q", "origin", "elsewhere");
    git("checkout", "-q", "-b", "factory/PROJ-2");
    write("src/a.ts", "z\n");
    const sha = commit("code on elsewhere");
    expect(await guard()({ repo, commit: sha, lease: { kind: "absent" } })).toMatchObject({ kind: "failed" });
  });

  it("ignores replace refs: git reads the commits that are sent", async () => {
    const lease = git("rev-parse", "HEAD");
    write(".gitlab-ci.yml", "evil: true\n");
    const evil = commit("evil");
    git("replace", evil, lease);
    expect(await check(evil, lease)).toMatchObject({ kind: "failed" });
  });

  it("refuses when a CI file does not parse, and when it cannot fetch the default branch", async () => {
    const lease = git("rev-parse", "HEAD");
    write("ci/build.yml", "include: [\n");
    expect(await check(commit("broken"), lease)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("cannot check the CI files"),
    });
    const noBase = noCiFiles({ env: env(), defaultBranch: "nope", config: CONFIG });
    expect(await noBase({ repo, commit: lease, lease: { kind: "sha", sha: lease } })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("cannot fetch nope"),
    });
  });
});
