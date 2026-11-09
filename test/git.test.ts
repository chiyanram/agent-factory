import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { callerCount, hostGit, plan, trustedPath, type GitRequest, type GitResult } from "../src/core/git.js";
import { tempDir } from "./temp.js";

// Real repos in a temp folder. The operator's config is a temp global file; the system config is off.
let base = "";
let repo = "";
let ran = "";
let env: NodeJS.ProcessEnv = {};

function git(args: readonly string[], cwd: string = repo): string {
  return execFileSync("git", [...args], { cwd, env, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}
function gitTry(args: readonly string[], input = ""): void {
  try {
    execFileSync("git", ["-C", repo, ...args], { env, input, stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    // plain git may fail after running the plant; the plant's trace is what counts
  }
}
// plant NAME : a program that records that it ran
function plant(name: string): string {
  const file = join(base, name);
  writeFileSync(file, `#!/bin/sh\necho ${name} >> "${ran}"\n`);
  chmodSync(file, 0o755);
  return file;
}
function ranBy(name: string): boolean {
  return existsSync(ran) && readFileSync(ran, "utf8").split("\n").includes(name);
}
function request(args: readonly string[], more: Partial<GitRequest> = {}): GitRequest {
  return {
    args,
    repo: { kind: "repo", path: repo },
    env,
    ownHelper: { kind: "none" },
    stdin: { kind: "none" },
    ...more,
  };
}
function ok(result: GitResult): string {
  if (result.kind !== "ok") {
    throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  }
  return result.stdout;
}
// the helpers that apply: the ones after the last empty value, which resets the list
function effective(values: string): readonly string[] {
  const list = values.split("\n").filter((_v, i, all) => i < all.length - 1 || all[i] !== "");
  return list.slice(list.lastIndexOf("") + 1);
}

beforeEach(() => {
  base = tempDir("hostgit-");
  repo = join(base, "repo");
  ran = join(base, "ran");
  writeFileSync(join(base, "global.gitconfig"), "");
  env = {
    PATH: process.env.PATH ?? "",
    HOME: base,
    GIT_CONFIG_GLOBAL: join(base, "global.gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
  execFileSync("git", ["init", "-q", "--bare", join(base, "origin.git")], { env });
  execFileSync("git", ["init", "-q", repo], { env });
  git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]);
  git(["remote", "add", "origin", join(base, "origin.git")]);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("hostGit runs no program the repo's own config or hooks name", () => {
  it("a planted core.fsmonitor: plain git runs it, hostGit does not", async () => {
    git(["config", "core.fsmonitor", plant("fsmonitor")]);
    gitTry(["status"]);
    expect(ranBy("fsmonitor")).toBe(true);
    rmSync(ran);
    ok(await hostGit(request(["status"])));
    expect(ranBy("fsmonitor")).toBe(false);
  });

  it("a planted pre-push hook: plain git runs it, hostGit pushes without it", async () => {
    writeFileSync(join(repo, ".git/hooks/pre-push"), readFileSync(plant("pre-push")));
    chmodSync(join(repo, ".git/hooks/pre-push"), 0o755);
    gitTry(["push", "-q", "origin", "HEAD:refs/heads/a"]);
    expect(ranBy("pre-push")).toBe(true);
    rmSync(ran);
    ok(await hostGit(request(["push", "-q", "origin", "HEAD:refs/heads/b"])));
    expect(ranBy("pre-push")).toBe(false);
    expect(git(["rev-parse", "--verify", "-q", "refs/heads/b"], join(base, "origin.git")).trim()).toMatch(
      /^[0-9a-f]{40}$/,
    );
  });

  it("a planted filter driver, also one whose name holds =", async () => {
    writeFileSync(join(repo, ".gitattributes"), "*.txt filter=x\n*.md filter=a=b\n");
    writeFileSync(join(repo, "a.txt"), "hi\n");
    writeFileSync(join(repo, "b.md"), "hi\n");
    git(["add", "-A"]);
    git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "files"]);
    git(["config", "filter.x.smudge", plant("smudge")]);
    git(["config", "filter.a=b.smudge", plant("eq-smudge")]);
    rmSync(join(repo, "a.txt"));
    gitTry(["checkout", "-q", "--", "a.txt"]);
    expect(ranBy("smudge")).toBe(true);
    rmSync(ran);
    rmSync(join(repo, "a.txt"));
    rmSync(join(repo, "b.md"));
    ok(await hostGit(request(["checkout", "-q", "--", "a.txt", "b.md"])));
    expect(ranBy("smudge") || ranBy("eq-smudge")).toBe(false);
  });

  it("a planted textconv is not run, and the diff still completes in full", async () => {
    writeFileSync(join(repo, ".gitattributes"), "*.txt diff=x\n");
    writeFileSync(join(repo, "a.txt"), "one\n");
    git(["add", "-A"]);
    git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "one"]);
    writeFileSync(join(repo, "a.txt"), "two\n");
    git(["config", "diff.x.textconv", plant("textconv")]);
    expect(ok(await hostGit(request(["diff"])))).toContain("+two");
    expect(ranBy("textconv")).toBe(false);
  });

  it("a planted credential helper: plain git runs it, hostGit does not", async () => {
    git(["config", "credential.helper", `!${plant("helper")}`]);
    gitTry(["credential", "fill"], "protocol=https\nhost=example.invalid\n\n");
    expect(ranBy("helper")).toBe(true);
    rmSync(ran);
    await hostGit(
      request(["credential", "fill"], { stdin: { kind: "text", text: "protocol=https\nhost=example.invalid\n\n" } }),
    );
    expect(ranBy("helper")).toBe(false);
  });

  it("an ssh planted in a relative or in-repo PATH entry is never run", async () => {
    mkdirSync(join(repo, "bin"));
    writeFileSync(join(repo, "bin/ssh"), readFileSync(plant("ssh")));
    chmodSync(join(repo, "bin/ssh"), 0o755);
    git(["remote", "set-url", "origin", "ssh://git@example.invalid/x.git"]);
    await hostGit(
      request(["fetch", "-q", "origin"], { env: { ...env, PATH: `bin:${join(repo, "bin")}:${env.PATH ?? ""}` } }),
    );
    expect(ranBy("ssh")).toBe(false);
  });
});

describe("hostGit refuses what it cannot neutralise", () => {
  for (const key of [
    "diff.external",
    "diff.x.command",
    "merge.x.driver",
    "url.file:///bad/.insteadOf",
    "http.proxy",
    "http.https://github.com/.proxy",
    "http.sslVerify",
    "http.curloptResolve",
    "remote.origin.proxy",
  ]) {
    it(`a repo-set ${key} is refused, and git does not run`, async () => {
      git(["config", key, plant("evil")]);
      const result = await hostGit(request(["status"]));
      expect(result).toMatchObject({ kind: "refused" });
      expect(result.kind === "refused" ? result.reason : "").toContain("the repo's own config sets");
    });
  }

  it("a refused key the operator also sets takes the operator's value", async () => {
    git(["config", "--global", "http.proxy", "http://proxy.example:3128"]);
    git(["config", "http.proxy", "http://evil.example"]);
    expect(ok(await hostGit(request(["config", "--get", "http.proxy"]))).trim()).toBe("http://proxy.example:3128");
  });

  it("leaves alone http keys that cannot redirect: GitHub checkout's extraheader, a corporate CA", async () => {
    git(["config", "http.https://github.com/.extraheader", "AUTHORIZATION: basic x"]);
    git(["config", "http.sslCAInfo", "/etc/ssl/corp-ca.pem"]);
    ok(await hostGit(request(["status"])));
  });
});

describe("hostGit keeps what the operator chose", () => {
  it("keeps the operator's own credential helper, and only it", async () => {
    git(["config", "--global", "credential.helper", "store-trusted"]);
    git(["config", "credential.helper", "!/evil"]);
    expect(effective(ok(await hostGit(request(["config", "--get-all", "credential.helper"]))))).toEqual([
      "store-trusted",
    ]);
  });

  it("does not add back a system helper that GIT_CONFIG_NOSYSTEM turns off (#167)", async () => {
    const system = join(base, "system.gitconfig");
    writeFileSync(system, "[credential]\n\thelper = system-helper\n");
    git(["config", "credential.helper", "!/evil"]);
    const read = (nosystem: string) =>
      hostGit(
        request(["config", "--get-all", "credential.helper"], {
          env: { ...env, GIT_CONFIG_SYSTEM: system, GIT_CONFIG_NOSYSTEM: nosystem },
        }),
      );
    expect(effective(ok(await read("1")))).toEqual([]);
    expect(effective(ok(await read("")))).toEqual(["system-helper"]);
  });

  it("keeps the factory's own App helper at its exact path, never a look-alike", async () => {
    const own = "!/opt/agent-factory/scripts/github-app.sh git-credential";
    const key = "credential.https://github.com.helper";
    git(["config", "--add", key, ""]);
    git(["config", "--add", key, own]);
    git(["config", "--add", key, "!/elsewhere/github-app.sh git-credential"]);
    expect(
      effective(
        ok(await hostGit(request(["config", "--get-all", key], { ownHelper: { kind: "helper", value: own } }))),
      ),
    ).toEqual([own]);
  });

  it("an always-set key takes the operator's own value when there is one", async () => {
    git(["config", "--global", "core.pager", "trusted-pager"]);
    git(["config", "core.pager", "/evil-pager"]);
    expect(ok(await hostGit(request(["config", "--get", "core.pager"]))).trim()).toBe("trusted-pager");
  });

  it("keeps a caller's own GIT_CONFIG_COUNT entries", async () => {
    const more = { ...env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.quotepath", GIT_CONFIG_VALUE_0: "false" };
    expect(ok(await hostGit(request(["config", "--get", "core.quotepath"], { env: more }))).trim()).toBe("false");
  });

  it("without a repo, git runs outside any repo and reads no folder's config", async () => {
    git(["config", "diff.external", "/evil"]); // would be refused, if hostGit read this repo's config
    const before = process.cwd();
    process.chdir(repo);
    const result = await hostGit({
      args: ["hash-object", "--stdin"],
      repo: { kind: "none" },
      env,
      ownHelper: { kind: "none" },
      stdin: { kind: "text", text: "x" },
    }).finally(() => process.chdir(before));
    expect(ok(result).trim()).toBe(
      execFileSync("git", ["hash-object", "--stdin"], { env, input: "x", encoding: "utf8" }).trim(),
    );
  });

  it("runs git with GIT_TERMINAL_PROMPT=0, so a missing login fails and never asks", async () => {
    const fake = join(base, "fakebin");
    mkdirSync(fake);
    writeFileSync(
      join(fake, "git"),
      '#!/bin/sh\ncase "$*" in *config*) exit 0 ;; esac\necho "prompt=$GIT_TERMINAL_PROMPT"\n',
    );
    chmodSync(join(fake, "git"), 0o755);
    const result = await hostGit(
      request(["fetch"], { env: { ...env, PATH: `${fake}:${env.PATH ?? ""}`, GIT_TERMINAL_PROMPT: "1" } }),
    );
    expect(ok(result).trim()).toBe("prompt=0");
  });
  it("refuses a GIT_CONFIG_COUNT that is not a whole number, before git runs", async () => {
    expect(callerCount("x")).toMatchObject({ kind: "refused" });
    expect(callerCount(undefined)).toEqual({ kind: "count", n: 0 });
    expect(await hostGit(request(["status"], { env: { ...env, GIT_CONFIG_COUNT: "1x" } }))).toMatchObject({
      kind: "refused",
    });
  });

  it("refuses when git cannot list the repo's own keys, never runs unchecked", async () => {
    git(["config", "filter.x.smudge", plant("smudge-old")]);
    const old = join(base, "oldgit");
    mkdirSync(old);
    const real = execFileSync("sh", ["-c", "command -v git"], { env, encoding: "utf8" }).trim();
    writeFileSync(join(old, "git"), `#!/bin/sh\ncase "$*" in *--show-scope*) exit 129 ;; esac\nexec "${real}" "$@"\n`);
    chmodSync(join(old, "git"), 0o755);
    const result = await hostGit(request(["status"], { env: { ...env, PATH: `${old}:${env.PATH ?? ""}` } }));
    expect(result).toMatchObject({ kind: "refused" });
    expect(result.kind === "refused" ? result.reason : "").toContain("cannot list the repo's own config keys");
  });
});

describe("trustedPath and plan", () => {
  it("drops relative entries and entries inside the repo", () => {
    expect(trustedPath("bin:/usr/bin:/r/x/bin:/r/x:/opt/bin", { kind: "repo", path: "/r/x" })).toBe(
      "/usr/bin:/opt/bin",
    );
    expect(trustedPath(".:/usr/bin", { kind: "none" })).toBe("/usr/bin");
  });

  it("plans the always-set keys even for a repo that sets nothing", () => {
    const planned = plan([], [], () => [], { kind: "none" });
    expect(planned).toMatchObject({ kind: "ok" });
    const keys = planned.kind === "ok" ? planned.overrides.map((o) => o.key) : [];
    expect(keys).toContain("core.fsmonitor");
    expect(keys).toContain("core.hookspath");
  });
});
