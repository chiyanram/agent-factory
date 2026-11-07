import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localIncludes, noCiFiles } from "../src/core/ci-files.js";

describe("localIncludes (#115)", () => {
  it("reads every form of a local include, and leaves out what lives outside the repository", () => {
    const yaml = [
      "stages: [test]",
      "include:",
      "  - local: '/ci/build.yml'",
      "  - 'ci/test.yml'   # a bare path is local",
      '  - "/ci/lint.yml"',
      "  - local: ci/jobs/*.yml",
      "    rules:",
      "      - if: $CI_COMMIT_BRANCH",
      "  - project: group/shared",
      "    file: /templates/a.yml",
      "  - remote: https://example.com/ci.yml",
      "  - template: Auto-DevOps.gitlab-ci.yml",
      "  - component: gitlab.com/x/y@1.0",
      "test:",
      "  script: [make test]",
    ].join("\n");
    expect(localIncludes(yaml)).toEqual(["ci/build.yml", "ci/test.yml", "ci/lint.yml", "ci/jobs/*.yml"]);
  });

  it("reads an inline path, a flow list and a flow map; finds none in a file with no include", () => {
    expect(localIncludes("include: '/ci/a.yml'\n")).toEqual(["ci/a.yml"]);
    expect(localIncludes("include: [ci/a.yml, 'ci/b.yml']\n")).toEqual(["ci/a.yml", "ci/b.yml"]);
    expect(localIncludes("include:\n  local: ci/c.yml\n")).toEqual(["ci/c.yml"]);
    expect(localIncludes("include: { local: ci/d.yml }\n")).toEqual(["ci/d.yml"]);
    expect(localIncludes("test:\n  script: make\n")).toEqual([]);
  });
});

describe("noCiFiles: the host push refuses a change to CI (#115; ADR-0012 S9)", () => {
  let repo = "";
  const env = (): NodeJS.ProcessEnv => ({
    PATH: process.env.PATH,
    HOME: repo,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "w",
    GIT_AUTHOR_EMAIL: "w@x",
    GIT_COMMITTER_NAME: "w",
    GIT_COMMITTER_EMAIL: "w@x",
  });
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { env: env(), encoding: "utf8" }).trim();
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "factory-ci-"));
    git("init", "-q");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  function write(path: string, content: string): void {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  function commit(message: string): string {
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  }
  const check = (commitSha: string, from: string) =>
    noCiFiles(env())({ repo, commit: commitSha, lease: { kind: "sha", sha: from } });

  function base(): string {
    write("src/a.ts", "a\n");
    write(".gitlab-ci.yml", "include:\n  - local: /ci/build.yml\n  - local: ci/jobs/*.yml\ntest:\n  script: make\n");
    write("ci/build.yml", "include: ci/deeper.yml\nbuild:\n  script: make\n");
    write("ci/deeper.yml", "deeper:\n  script: make\n");
    write("ci/jobs/lint.yml", "lint:\n  script: make lint\n");
    write(".github/workflows/ci.yml", "on: push\n");
    write(".github/actions/setup/action.yml", "runs: {}\n");
    return commit("base");
  }

  it("lets a change to code through", async () => {
    const start = base();
    write("src/a.ts", "b\n");
    expect(await check(commit("code"), start)).toEqual({ kind: "ok" });
  });

  it("refuses each CI path, an included file, an include of an include, and a file under an included glob", async () => {
    const paths = [
      ".gitlab-ci.yml",
      ".github/workflows/ci.yml",
      ".github/workflows/new.yml",
      ".github/actions/setup/action.yml",
      "ci/build.yml",
      "ci/deeper.yml",
      "ci/jobs/new.yml",
    ];
    for (const path of paths) {
      git("checkout", "-q", "--detach", base());
      const start = git("rev-parse", "HEAD");
      write(path, "changed: true\n");
      const out = await check(commit(`change ${path}`), start);
      expect({ path, out }).toMatchObject({
        path,
        out: { kind: "failed", reason: expect.stringContaining(`touches CI config (${path})`) },
      });
    }
  });

  it("refuses a commit that moves a CI file away, and one touched in an earlier commit of the push", async () => {
    const start = base();
    mkdirSync(join(repo, "docs"));
    git("mv", ".github/workflows/ci.yml", "docs/ci.yml");
    expect(await check(commit("move"), start)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining(".github/workflows/ci.yml"),
    });
    const second = git("rev-parse", "HEAD");
    write("ci/build.yml", "x: 1\n");
    commit("touch");
    write("src/a.ts", "later\n");
    const last = commit("later");
    expect(await check(last, second)).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("ci/build.yml"),
    });
  });

  it("checks a new branch's commits too, those on no remote branch", async () => {
    write(".github/workflows/ci.yml", "on: push\n");
    const only = commit("first");
    expect(await noCiFiles(env())({ repo, commit: only, lease: { kind: "absent" } })).toMatchObject({
      kind: "failed",
    });
  });
});
