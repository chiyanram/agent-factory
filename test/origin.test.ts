import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { checkedSetup, originProblem } from "../src/core/origin.js";
import { tempDir } from "./temp.js";

const GIT_ENV: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_CONFIG"))),
  GIT_CONFIG_NOSYSTEM: "1",
};

let dir = "";
beforeEach(() => {
  dir = tempDir("factory-origin-");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function planted(origin: string | undefined): string {
  execFileSync("git", ["-C", dir, "init", "-q"], { env: GIT_ENV, stdio: "ignore" });
  if (origin !== undefined) {
    execFileSync("git", ["-C", dir, "remote", "add", "origin", origin], { env: GIT_ENV, stdio: "ignore" });
  }
  return dir;
}

function envFor(clone: string, more: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...GIT_ENV,
    FACTORY_REPO: clone,
    FACTORY_PROJECT: "chiyanram/ledger",
    FACTORY_FORGE: "github",
    FACTORY_FORGE_HOST: undefined,
    ...more,
  };
}

describe("originProblem (#640)", () => {
  it("names both URLs when the clone's origin is another repo, or a fork", async () => {
    for (const origin of ["https://github.com/chiyanram/other.git", "git@github.com:someone/ledger.git"]) {
      rmSync(dir, { recursive: true, force: true });
      dir = tempDir("factory-origin-");
      const why = await originProblem(envFor(planted(origin)));
      expect(why).toContain(origin);
      expect(why).toContain("github.com/chiyanram/ledger");
      expect(why).toContain(dir);
    }
  });

  it("names both hosts when the origin is on another git host", async () => {
    const why = await originProblem(envFor(planted("https://gitlab.com/chiyanram/ledger.git")));
    expect(why).toContain("https://gitlab.com/chiyanram/ledger.git");
    expect(why).toContain("github.com/chiyanram/ledger");
  });

  it("passes a matching origin, ignoring a .git suffix and letter case in the host and owner", async () => {
    for (const origin of [
      "https://github.com/chiyanram/ledger.git",
      "https://github.com/chiyanram/ledger",
      "git@GitHub.com:ChiyanRam/ledger.git",
      "ssh://git@github.com/CHIYANRAM/ledger",
    ]) {
      rmSync(dir, { recursive: true, force: true });
      dir = tempDir("factory-origin-");
      expect(await originProblem(envFor(planted(origin)))).toBe("");
    }
  });

  it("matches a self-hosted GitLab's full group path on its configured host", async () => {
    const clone = planted("git@git.example.com:group/sub/app.git");
    const env = { FACTORY_FORGE: "gitlab", FACTORY_FORGE_HOST: "git.example.com", FACTORY_PROJECT: "group/sub/app" };
    expect(await originProblem(envFor(clone, env))).toBe("");
    expect(await originProblem(envFor(clone, { ...env, FACTORY_PROJECT: "group/app" }))).toContain("group/app");
  });

  it("refuses a clone with no origin, naming the clone", async () => {
    const why = await originProblem(envFor(planted(undefined)));
    expect(why).toContain(dir);
    expect(why).toContain("no origin remote");
  });

  it("says the clone cannot be read, not that it lacks an origin, when the folder is no git repo", async () => {
    const why = await originProblem(envFor(dir));
    expect(why).toContain(dir);
    expect(why).toContain("cannot read its origin");
    expect(why).not.toContain("no origin remote");
  });

  it("matches a gitHostProject written with a .git suffix", async () => {
    const clone = planted("https://github.com/chiyanram/ledger");
    expect(await originProblem(envFor(clone, { FACTORY_PROJECT: "chiyanram/ledger.git" }))).toBe("");
  });

  it("runs a pass's setup only once the clone is the project's repo", async () => {
    let ran = 0;
    const setup = async () => {
      ran += 1;
      return { kind: "ok" as const, value: "setup" };
    };
    const wrong = await checkedSetup(envFor(planted("https://github.com/someone/ledger.git")), setup);
    expect(wrong).toMatchObject({ kind: "failed", reason: expect.stringContaining("someone/ledger") });
    expect(ran).toBe(0);
    execFileSync("git", ["-C", dir, "remote", "set-url", "origin", "https://github.com/chiyanram/ledger.git"], {
      env: GIT_ENV,
      stdio: "ignore",
    });
    expect(await checkedSetup(envFor(dir), setup)).toEqual({ kind: "ok", value: "setup" });
    expect(ran).toBe(1);
  });

  it("checks nothing when the clone or the project on the git host is not set", async () => {
    const clone = planted("https://github.com/someone/else.git");
    expect(await originProblem(envFor(clone, { FACTORY_REPO: undefined }))).toBe("");
    expect(await originProblem(envFor(clone, { FACTORY_PROJECT: undefined }))).toBe("");
  });
});
