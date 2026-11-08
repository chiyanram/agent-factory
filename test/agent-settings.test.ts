import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAgentSetting, noAgentSettings } from "../src/core/agent-settings.js";

describe("isAgentSetting (#110)", () => {
  it("names the root settings, their folders' files, in any letter case, and nothing else", () => {
    const yes = [".claude/settings.json", ".claude", ".agents/skills/x/SKILL.md", "AGENTS.md", "CLAUDE.md"];
    const alsoYes = [".CLAUDE/settings.json", "claude.md", "Agents.md"];
    const no = [".claudex/a", "src/.claude/settings.json", "docs/AGENTS.md", "CLAUDE.md.bak", "src/a.ts"];
    expect([...yes, ...alsoYes].filter((p) => !isAgentSetting(p))).toEqual([]);
    expect(no.filter(isAgentSetting)).toEqual([]);
  });
});

describe("noAgentSettings: the host push refuses a change to the agent's settings (#110; ADR-0012 S12)", () => {
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

  function write(path: string, content: string): void {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  function commit(message: string): string {
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  }
  const check = (sha: string, lease: string) =>
    noAgentSettings({ env: env(), defaultBranch: "main" })({ repo, commit: sha, lease: { kind: "sha", sha: lease } });

  // main holds the instructions but no .claude folder; the agent branch starts from it
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "factory-settings-"));
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", join(root, "origin.git")], { env: env() });
    repo = join(root, "clone");
    execFileSync("git", ["clone", "-q", join(root, "origin.git"), repo], { env: env() });
    git("checkout", "-q", "-b", "main");
    write("src/a.ts", "a\n");
    write("AGENTS.md", "# rules\n");
    write("docs/AGENTS.md", "# docs rules\n");
    commit("main");
    git("push", "-q", "origin", "main");
    git("checkout", "-q", "-b", "factory/PROJ-1");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("lets a change to code, and to a nested instruction file, through", async () => {
    const lease = git("rev-parse", "HEAD");
    write("src/a.ts", "b\n");
    write("docs/AGENTS.md", "# docs rules, more\n");
    expect(await check(commit("code"), lease)).toEqual({ kind: "ok" });
  });

  it("refuses a settings file the branch did not have, so none is planted for the next session", async () => {
    const lease = git("rev-parse", "HEAD");
    write(".claude/settings.json", '{ "hooks": {} }\n');
    write(".agents/skills/x/SKILL.md", "# planted\n");
    expect(await check(commit("plant"), lease)).toEqual({
      kind: "failed",
      reason: expect.stringMatching(
        /^touches the agent's settings \(\.agents\/skills\/x\/SKILL\.md, \.claude\/settings\.json\)/,
      ),
    });
  });

  it("refuses an edit to an instruction file the branch has, and one made and undone in a later commit passes", async () => {
    const lease = git("rev-parse", "HEAD");
    write("AGENTS.md", "# rules, loosened\n");
    const edited = commit("edit");
    expect(await check(edited, lease)).toMatchObject({ kind: "failed", reason: expect.stringContaining("AGENTS.md") });
    write("AGENTS.md", "# rules\n");
    // the trees are compared: the commit sent has main's version again
    expect(await check(commit("undo"), lease)).toEqual({ kind: "ok" });
  });

  it("lets a merge of main through when it brings a person's change to CLAUDE.md", async () => {
    write("src/a.ts", "agent\n");
    const lease = commit("agent work");
    git("checkout", "-q", "main");
    write("CLAUDE.md", "# a person's instructions\n");
    commit("person");
    git("push", "-q", "origin", "main");
    git("checkout", "-q", "factory/PROJ-1");
    git("merge", "-q", "--no-edit", "main");
    expect(await check(git("rev-parse", "HEAD"), lease)).toEqual({ kind: "ok" });
  });

  it("refuses the push when it cannot fetch the default branch, so nothing unchecked leaves", async () => {
    const lease = git("rev-parse", "HEAD");
    write("src/a.ts", "b\n");
    const sha = commit("code");
    const guard = noAgentSettings({ env: env(), defaultBranch: "no-such-branch" });
    expect(await guard({ repo, commit: sha, lease: { kind: "sha", sha: lease } })).toMatchObject({
      kind: "failed",
      reason: expect.stringMatching(
        /^cannot check the agent settings, so nothing is pushed: cannot fetch no-such-branch/,
      ),
    });
  });
});
