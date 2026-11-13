import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addedOf, fetchDefault, outcomeLines, outcomeOf, verdict, type Commit } from "../src/core/outcome.js";
import { usageCommand } from "../src/usage-cli.js";
import { tempDir } from "./temp.js";

// What became of a merged ticket's change, from the project's clone: watched to 2 weeks, then clean, reverted or fixed
// on the same lines, updated up to 30 days (#487 AC-3).

const DAY = 86_400_000;
const MERGED = Date.parse("2026-10-01T12:00:00Z");

let root = "";
let env: NodeJS.ProcessEnv = {};
const work = () => join(root, "work");
const clone = () => join(root, "clone");

const git = (dir: string, args: readonly string[], when?: number): string => {
  const date =
    when === undefined
      ? {}
      : { GIT_AUTHOR_DATE: new Date(when).toISOString(), GIT_COMMITTER_DATE: new Date(when).toISOString() };
  return execFileSync("git", [...args], { cwd: dir, env: { ...env, ...date }, encoding: "utf8" }).trim();
};

// commit : one commit on main in the working repo, at a day after the merge, pushed to origin; its SHA
function commit(file: string, text: string, message: string, day: number): string {
  writeFileSync(join(work(), file), text);
  git(work(), ["add", "-A"]);
  git(work(), ["commit", "-q", "-m", message], MERGED + day * DAY);
  git(work(), ["push", "-q", "origin", "main"]);
  return git(work(), ["rev-parse", "HEAD"]);
}

beforeEach(() => {
  root = tempDir("factory-outcome-");
  mkdirSync(join(root, "home"));
  env = {
    PATH: process.env.PATH,
    HOME: join(root, "home"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  git(root, ["init", "-q", "--bare", "-b", "main", "origin.git"]);
  git(root, ["clone", "-q", join(root, "origin.git"), work()]);
  commit("loan.ts", "a\nb\nc\n", "chore: start", -10);
  git(root, ["clone", "-q", join(root, "origin.git"), clone()]);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// the ticket's merge: two lines added to loan.ts
const merge = () => commit("loan.ts", "a\nb\nrenew\nrefuse\nc\n", "feat: refuse a reserved loan (#12)", 0);
const read = (sha: string, day: number) =>
  outcomeOf({ repo: clone(), env, merged: { at: new Date(MERGED).toISOString(), sha }, now: MERGED + day * DAY });

describe("the outcome of a merge (#487 AC-3)", () => {
  it("is watched before 2 weeks; a later change to other lines touches nothing", async () => {
    const sha = merge();
    commit("other.ts", "x\n", "feat: another thing", 1);
    expect(await read(sha, 3)).toEqual({ kind: "watching", day: 3, touched: [] });
  });

  it("is clean at 2 weeks, and final at 30 days; a later feature on the same lines is shown, not counted", async () => {
    const sha = merge();
    const feature = commit("loan.ts", "a\nb\nrenew now\nrefuse\nc\n", "feat: renew now", 5);
    const out = await read(sha, 20);
    expect(out).toMatchObject({ kind: "clean", final: false, touched: [{ sha: feature, subject: "feat: renew now" }] });
    expect(await read(sha, 31)).toMatchObject({ kind: "clean", final: true });
  });

  it("is fixed on the same lines when a fix commit changes a line the merge added", async () => {
    const sha = merge();
    const fix = commit("loan.ts", "a\nb\nrenew\nrefuse 409\nc\n", "fix(loans): refuse with 409", 6);
    expect(await read(sha, 15)).toMatchObject({
      kind: "fixed",
      final: false,
      by: { sha: fix, subject: "fix(loans): refuse with 409" },
    });
  });

  it("is reverted when a later commit reverts the merge", async () => {
    const sha = merge();
    git(work(), ["revert", "--no-edit", sha], MERGED + 8 * DAY);
    git(work(), ["push", "-q", "origin", "main"]);
    const out = await read(sha, 16);
    expect(out).toMatchObject({ kind: "reverted", final: false, by: { subject: expect.stringContaining("Revert") } });
  });

  it("stops watching at 30 days: a fix after that does not change a final outcome", async () => {
    const sha = merge();
    commit("loan.ts", "a\nb\nrenew\nrefuse 409\nc\n", "fix: late", 40);
    expect(await read(sha, 45)).toEqual({ kind: "clean", final: true, touched: [] });
  });

  it("fetches only into its own ref: the person's branches, working tree and HEAD are as they were", async () => {
    const sha = merge();
    const before = [
      git(clone(), ["status", "--porcelain"]),
      git(clone(), ["for-each-ref", "refs/heads", "refs/remotes"]),
      git(clone(), ["rev-parse", "HEAD"]),
    ];
    await read(sha, 3);
    const after = [
      git(clone(), ["status", "--porcelain"]),
      git(clone(), ["for-each-ref", "refs/heads", "refs/remotes"]),
      git(clone(), ["rev-parse", "HEAD"]),
    ];
    expect(after).toEqual(before);
    expect(git(clone(), ["for-each-ref", "--format=%(refname)", "refs/factory"])).toBe("refs/factory/outcome-target");
  });

  it("is unknown when the fetch fails, and leaves no ref behind", async () => {
    const sha = merge();
    git(clone(), ["remote", "set-url", "origin", join(root, "gone.git")]);
    expect(await read(sha, 15)).toMatchObject({ kind: "unknown", why: expect.stringContaining("git fetch") });
    expect(git(clone(), ["for-each-ref", "refs/factory"])).toBe("");
  });

  it("reads from the ref already fetched when told it is: no second fetch, so a gone origin does not matter", async () => {
    const sha = merge();
    expect(await fetchDefault({ repo: clone(), env })).toBe("");
    git(clone(), ["remote", "set-url", "origin", join(root, "gone.git")]);
    const out = await outcomeOf({
      repo: clone(),
      env,
      merged: { at: new Date(MERGED).toISOString(), sha },
      now: MERGED + 20 * DAY,
      fetched: true,
    });
    expect(out).toEqual({ kind: "clean", final: false, touched: [] });
  });

  it("is unknown, with the reason, when the merge's commit is not on the default branch", async () => {
    merge();
    expect(await read("1".repeat(40), 15)).toMatchObject({
      kind: "unknown",
      why: expect.stringContaining("not on the default branch"),
    });
  });
});

describe("agent-factory usage <project> shows a merged ticket's outcome (#487 AC-3)", () => {
  it("reads it from the project's clone, with the merge the records hold", async () => {
    const sha = merge();
    const feature = commit("loan.ts", "a\nb\nrenew now\nrefuse\nc\n", "feat: renew now", 5);
    const home = join(root, "factory");
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    const line = { at: new Date(MERGED).toISOString(), kind: "merged", number: 12, sha, by: "mo" };
    writeFileSync(join(home, "runs", "ledger", "PROJ-1.jsonl"), `${JSON.stringify(line)}\n`);
    const out: string[] = [];
    const io = {
      env: { ...env, FACTORY_REPO: clone() },
      home,
      now: () => MERGED + 20 * DAY,
      out: (t: string) => out.push(t),
      err: () => undefined,
    };
    expect(await usageCommand(["ledger"], io)).toBe(0);
    const text = out.join("");
    expect(text).toContain("    outcome: clean at 2 weeks\n");
    expect(text).toContain(`      touched by ${feature.slice(0, 8)} feat: renew now\n`);
  });

  // usage over two merged tickets, with git's trace written to a file; the lines it printed
  async function twoMerged(env2: NodeJS.ProcessEnv): Promise<{ readonly text: string; readonly trace: string }> {
    const first = merge();
    const second = commit("other.ts", "x\n", "feat: other (#13)", 1);
    const home = join(root, "factory");
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    const line = (sha: string, n: number) =>
      JSON.stringify({ at: new Date(MERGED).toISOString(), kind: "merged", number: n, sha, by: "mo" });
    writeFileSync(join(home, "runs", "ledger", "PROJ-1.jsonl"), `${line(first, 12)}\n`);
    writeFileSync(join(home, "runs", "ledger", "PROJ-2.jsonl"), `${line(second, 13)}\n`);
    const trace = join(root, "trace.txt");
    const out: string[] = [];
    const io = {
      env: { ...env2, GIT_TRACE: trace },
      home,
      now: () => MERGED + 20 * DAY,
      out: (t: string) => out.push(t),
      err: () => undefined,
    };
    expect(await usageCommand(["ledger"], io)).toBe(0);
    return { text: out.join(""), trace: existsSync(trace) ? readFileSync(trace, "utf8") : "" };
  }

  it("fetches the default branch once for every merged ticket of the run", async () => {
    const { text, trace } = await twoMerged({ ...env, FACTORY_REPO: clone() });
    expect(text.match(/ {4}outcome: clean at 2 weeks\n/g)).toHaveLength(2);
    expect(trace.match(/built-in: git fetch /g)).toHaveLength(1);
  });

  it("shows each merged ticket's outcome as unknown, with the reason, when the one fetch fails", async () => {
    git(clone(), ["remote", "set-url", "origin", join(root, "gone.git")]);
    const { text } = await twoMerged({ ...env, FACTORY_REPO: clone() });
    expect(text.match(/ {4}outcome: unknown: git fetch/g)).toHaveLength(2);
  });
});

describe("the outcome's parts (#487)", () => {
  it("reads the lines each file gained from git diff -U0; a deleted file and a pure deletion gain none", () => {
    const diff = [
      "diff --git a/loan.ts b/loan.ts",
      "+++ b/loan.ts",
      "@@ -2,0 +3,2 @@ x",
      "@@ -7 +9 @@ y",
      "@@ -12,3 +13,0 @@ z",
      "+++ /dev/null",
      "@@ -1,4 +0,0 @@",
    ].join("\n");
    expect(addedOf(diff)).toEqual([
      { file: "loan.ts", from: 3, count: 2 },
      { file: "loan.ts", from: 9, count: 1 },
    ]);
  });

  it("reads each outcome as a line, and lists every touching commit but the one that decided it", () => {
    const c = (sha: string, subject: string): Commit => ({ sha: sha.repeat(40), subject, at: "" });
    const [fix, feat] = [c("a", "fix: y"), c("b", "feat: z")];
    expect(outcomeLines({ kind: "watching", day: 3, touched: [] })).toEqual(["    outcome: watching, day 3 of 14"]);
    expect(outcomeLines({ kind: "clean", final: true, touched: [] })).toEqual(["    outcome: clean, final at 30 days"]);
    expect(outcomeLines({ kind: "reverted", by: c("r", "Revert x"), final: true })).toEqual([
      "    outcome: reverted by rrrrrrrr Revert x, final",
    ]);
    expect(outcomeLines({ kind: "fixed", by: fix, final: false, touched: [feat, fix] })).toEqual([
      "    outcome: fixed on the same lines by aaaaaaaa fix: y",
      "      touched by bbbbbbbb feat: z",
    ]);
    expect(outcomeLines({ kind: "unknown", why: "no clone" })).toEqual(["    outcome: unknown: no clone"]);
  });

  it("counts only a fix or a revert subject against the outcome; a revert of the merge wins over a fix", () => {
    const c = (subject: string): Commit => ({ sha: subject, subject, at: "" });
    expect(verdict({ day: 15, touched: [c("feat: more"), c("refactor: tidy")] })).toMatchObject({ kind: "clean" });
    expect(verdict({ day: 15, touched: [c("feat: more"), c("fix!: wrong")] })).toMatchObject({
      kind: "fixed",
      by: c("fix!: wrong"),
    });
    expect(verdict({ day: 15, touched: [c('Revert "feat: x"')] })).toMatchObject({ kind: "fixed" });
    expect(verdict({ day: 3, touched: [c("fix: y")], reverted: c("r") })).toEqual({
      kind: "reverted",
      by: c("r"),
      final: false,
    });
    expect(verdict({ day: 30, touched: [] })).toEqual({ kind: "clean", final: true, touched: [] });
  });
});
