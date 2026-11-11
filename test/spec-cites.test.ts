// a spec's and design's `file:line@commit` cites, checked by code before the design review (#489; #456 item 13)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brokenCites, specCites } from "../src/core/spec-cites.js";
import { tempDir } from "./temp.js";

describe("specCites", () => {
  it("reads one line and a range, each once, and nothing that is not in the form", () => {
    expect(specCites("see src/a.ts:3@abc1234 and src/a.ts:3@abc1234, lines src/b.ts:2-4@abc1234ff")).toEqual([
      { text: "src/a.ts:3@abc1234", file: "src/a.ts", line: 3, end: 3, commit: "abc1234" },
      { text: "src/b.ts:2-4@abc1234ff", file: "src/b.ts", line: 2, end: 4, commit: "abc1234ff" },
    ]);
    expect(specCites("src/a.ts:3, a@b.com, src/a.ts:3@xyz")).toEqual([]);
  });

  it("reads a file with no extension and a commit in upper case", () => {
    expect(specCites("Makefile:3@ABC1234 and docker/Dockerfile:1-2@abc1234")).toEqual([
      { text: "Makefile:3@ABC1234", file: "Makefile", line: 3, end: 3, commit: "abc1234" },
      { text: "docker/Dockerfile:1-2@abc1234", file: "docker/Dockerfile", line: 1, end: 2, commit: "abc1234" },
    ]);
  });
});

describe("brokenCites, in a real clone", () => {
  let repo = "";
  let sha = "";
  const env = { PATH: process.env.PATH, HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1" };
  beforeAll(() => {
    repo = tempDir("factory-spec-cites-");
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, env, encoding: "utf8" });
    git("init", "-q");
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "a.ts"), "one\ntwo\nthree\n");
    writeFileSync(join(repo, "Makefile"), "all:\n");
    git("add", ".");
    git("commit", "-q", "-m", "one");
    sha = git("rev-parse", "--short=12", "HEAD").trim();
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("passes a valid cite and range, and stops a missing file, a line past the end and an unknown commit", async () => {
    const at = { repo, env };
    expect(await brokenCites(at, [`src/a.ts:2@${sha} and src/a.ts:1-3@${sha}`])).toEqual([]);
    expect(await brokenCites(at, [`src/gone.ts:1@${sha}`])).toEqual([
      `src/gone.ts:1@${sha}: src/gone.ts is not in ${sha}`,
    ]);
    expect(await brokenCites(at, [`src/a.ts:2-9@${sha}`])).toEqual([
      `src/a.ts:2-9@${sha}: the file has 3 lines at ${sha}`,
    ]);
    expect(await brokenCites(at, ["src/a.ts:1@0000000"])).toEqual([
      "src/a.ts:1@0000000: 0000000 is not a commit in the project's clone (fetch it, or cite one that is)",
    ]);
  });

  it("holds a cite to a file with no extension, and one whose commit is in upper case", async () => {
    const at = { repo, env };
    expect(await brokenCites(at, [`Makefile:1@${sha.toUpperCase()}`])).toEqual([]);
    expect(await brokenCites(at, [`Makefile:3@${sha}`])).toEqual([`Makefile:3@${sha}: the file has 1 lines at ${sha}`]);
  });
});

// two annotated tags whose ids share the prefix 3f1cb2d, found once by brute force over fixed content: git names
// every object by its content, so the same commands make the same two ids on any machine
describe("brokenCites, with a short commit that names more than one object", () => {
  let repo = "";
  const env = {
    PATH: process.env.PATH,
    HOME: "/nonexistent",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_DATE: "1700000000 +0000",
    GIT_COMMITTER_DATE: "1700000000 +0000",
  };
  beforeAll(() => {
    repo = tempDir("factory-spec-cites-ambiguous-");
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, env, encoding: "utf8" });
    git("init", "-q");
    writeFileSync(join(repo, "a.ts"), "one\ntwo\nthree\n");
    git("add", ".");
    git("commit", "-q", "-m", "one");
    for (const tag of ["t34596", "t38555"]) {
      git("tag", "-a", tag, "-m", tag);
    }
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("says the commit names more than one object, not that it is no commit", async () => {
    expect(await brokenCites({ repo, env }, ["a.ts:1@3f1cb2d"])).toEqual([
      "a.ts:1@3f1cb2d: 3f1cb2d names more than one object in the project's clone; cite more of the commit",
    ]);
  });
});
