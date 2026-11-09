// check-musts (#221; ADR-0015 R5): each AGENTS.md MUST that code can check, planted bad one rule at a time, then the
// script on this repository and on a fresh git repository that breaks the rules.
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ALLOW, baseRef, counts, raised, scan, untested, type Allow } from "../scripts/check-musts.js";
import { claudeEnv } from "../src/core/review/settings.js";
import { tempDir } from "./temp.js";

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "check-musts.ts");
// built in two pieces, so this file holds no disable comment of its own
const DISABLE = ["// oxlint", "disable-next-line no-explicit-any"].join("-");

const findings = (file: string, text: string, allow: readonly Allow[] = []) =>
  scan([{ file, text }], allow).findings.map((f) => f.split(": ").slice(0, 2).join(": "));

describe("scan", () => {
  it("finds gh or glab named in src/ outside the forge seam, and a gh or glab command in any bash script", () => {
    expect(findings("src/core/x.ts", 'run({ bin: "gh" });\nconst b = `glab`;\n')).toEqual([
      "src/core/x.ts:1: forge-seam",
      "src/core/x.ts:2: forge-seam",
    ]);
    expect(findings("src/core/forge/x.ts", 'run({ bin: "gh" });\n')).toEqual([]);
    expect(findings("scripts/a.sh", "gh pr list\nx=$(glab mr view 1)\nif ok; then gh api user; fi\n")).toEqual([
      "scripts/a.sh:1: forge-seam",
      "scripts/a.sh:2: forge-seam",
      "scripts/a.sh:3: forge-seam",
    ]);
    expect(findings("scripts/lib/forge.sh", "gh pr list\n")).toEqual(["scripts/lib/forge.sh:1: forge-seam"]);
    expect(findings("scripts/a.sh", "# gh pr list\nforge_pr 1\necho high\n")).toEqual([]);
  });

  it("finds git named in src/ outside hostGit, and a git command in a bash script but hgit's own; a message is not a call", () => {
    expect(findings("src/core/x.ts", 'execFile("git", ["status"]);\n')).toEqual(["src/core/x.ts:1: host-git"]);
    expect(findings("src/core/git.ts", 'execFile("git", ["status"]);\n')).toEqual([]);
    expect(findings("scripts/lib/git.sh", 'git -C "$d" status\n')).toEqual([]);
    expect(findings("scripts/lib/runs.sh", 'git -C "$d" status\n')).toEqual(["scripts/lib/runs.sh:1: host-git"]);
    expect(findings("src/core/x.ts", 'failed("git push failed");\n')).toEqual([]);
    expect(findings("scripts/a.sh", 'tip=$(git rev-parse HEAD)\ngit -C "$d" fetch\nhgit -C "$d" fetch\n')).toEqual([
      "scripts/a.sh:1: host-git",
      "scripts/a.sh:2: host-git",
    ]);
  });

  it("finds node:child_process outside the reviewed runners", () => {
    expect(findings("src/core/x.ts", 'import { spawn } from "node:child_process";\n')).toEqual([
      "src/core/x.ts:1: spawn-seam",
    ]);
  });

  it("finds a forge token outside the forge seam, in src/ and in a top-level script", () => {
    expect(findings("src/core/x.ts", "const env = { ...e, GH_TOKEN: t };\n")).toEqual(["src/core/x.ts:1: forge-token"]);
    expect(findings("scripts/a.sh", 'GITLAB_TOKEN=$t claude -p "$p"\n')).toEqual(["scripts/a.sh:1: forge-token"]);
    expect(findings("src/core/forge/x.ts", "const env = { GH_TOKEN: t };\n")).toEqual([]);
  });

  it("finds a skip-permissions flag or bypass mode for an agent CLI", () => {
    const text =
      'a("--dangerously-skip-permissions");\nb("bypassPermissions");\nc("--yolo");\nd("--allow-all-tools");\n';
    expect(findings("src/core/x.ts", text)).toHaveLength(4);
    expect(findings("scripts/lib/a.sh", "claude --dangerously-skip-permissions\n")).toEqual([
      "scripts/lib/a.sh:1: skip-permissions",
    ]);
  });

  it("finds a disable comment in any code file, test files included, but not in the planted fixtures", () => {
    expect(findings("test/a.test.ts", `${DISABLE}\nconst x: any = 1;\n`)).toEqual([
      "test/a.test.ts:1: disable-comment",
    ]);
    expect(findings("src/a.ts", ["/* @ts", "nocheck */\n// @ts", "expect-error\n"].join("-"))).toHaveLength(2);
    expect(findings("tests/fixtures/x/a.ts", `${DISABLE}\n`)).toEqual([]);
  });

  it("lets an ALLOW entry through only on its file, rule and line, and names an entry that matches nothing", () => {
    const allow: Allow = { file: "src/a.ts", rule: "forge-seam", has: '"gh",', why: "a deny list" };
    expect(findings("src/a.ts", 'const deny = ["gh",\n"glab"];\n', [allow])).toEqual(["src/a.ts:2: forge-seam"]);
    expect(scan([{ file: "src/a.ts", text: "" }], [allow]).unused).toEqual([allow]);
    expect(scan([{ file: "src/b.ts", text: "" }], [allow]).unused).toEqual([]);
  });

  it("gives each ALLOW entry a reason", () => {
    expect(ALLOW.filter((a) => a.why.trim() === "")).toEqual([]);
  });
});

describe("untested", () => {
  it("names a top-level script with no tests/<script>.test.sh", () => {
    expect(untested(["scripts/a.sh", "tests/a.test.sh", "scripts/b.sh", "scripts/lib/c.sh"])).toEqual([
      "scripts/b.sh: script-test: write each script with its tests/<script>.test.sh",
    ]);
  });
});

describe("the lint baseline", () => {
  it("names a raised count and a new key; a lower count is the ratchet's business", () => {
    expect(raised({ "a x": 2, "b y": 1, "c z": 0 }, { "a x": 1, "c z": 3 })).toEqual([
      "scripts/lint-baseline.json: lint-baseline: a x is 2, above 1; it only shrinks",
      "scripts/lint-baseline.json: lint-baseline: b y is 1, above 0; it only shrinks",
    ]);
  });

  it("reads text that does not parse as no counts, and compares with FACTORY_BASE_REF, the PR's base or main", () => {
    expect(counts("{")).toEqual({});
    expect(counts('{"a x": 1, "b": "2"}')).toEqual({ "a x": 1 });
    expect(baseRef({ FACTORY_BASE_REF: "main", GITHUB_BASE_REF: "dev" })).toBe("main");
    expect(baseRef({ GITHUB_BASE_REF: "dev" })).toBe("origin/dev");
    expect(baseRef({ GITHUB_BASE_REF: "" })).toBe("origin/main");
  });
});

describe("claudeEnv (ADR-0012 S6)", () => {
  it("hands the agent CLI no forge token", () => {
    const env = {
      PATH: "/bin",
      GH_TOKEN: "t",
      GITHUB_TOKEN: "t",
      GITLAB_TOKEN: "t",
      GLAB_TOKEN: "t",
      CI_JOB_TOKEN: "t",
    };
    expect(claudeEnv(env)).toEqual({ PATH: "/bin" });
  });
});

describe("check-musts, the script", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const run = (root: string, env: NodeJS.ProcessEnv = process.env) => {
    const r = spawnSync(process.execPath, [SCRIPT, root], { encoding: "utf8", env });
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
  };

  it("passes this repository", () => {
    expect(run(ROOT)).toEqual({ code: 0, out: "" });
  });

  it("fails a repository that breaks the rules and raises the lint baseline, naming each", () => {
    const dir = tempDir("factory-musts-");
    made.push(dir);
    const put = (file: string, text: string): void => {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text);
    };
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    git("init", "-q", "-b", "main");
    put("scripts/lint-baseline.json", '{"src/a.ts eslint(complexity)": 1}\n');
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
    put("scripts/lint-baseline.json", '{"src/a.ts eslint(complexity)": 2}\n');
    put("src/a.ts", 'run({ bin: "glab" });\n');
    put("scripts/b.sh", "git status\n");
    expect(run(dir, { ...process.env, FACTORY_BASE_REF: "main" })).toEqual({
      code: 1,
      out:
        "scripts/b.sh:1: host-git: call git on a project's clone only through hostGit (src/core/git.ts) or hgit (scripts/lib/git.sh)\n" +
        "src/a.ts:1: forge-seam: call the forge only through the Forge seam in src/core/forge/ (bash: a forge_* call)\n" +
        "scripts/b.sh: script-test: write each script with its tests/<script>.test.sh\n" +
        "scripts/lint-baseline.json: lint-baseline: src/a.ts eslint(complexity) is 2, above 1; it only shrinks\n" +
        "check-musts: 4 way(s) the code breaks an AGENTS.md MUST\n",
    });
  });

  it("fails when it cannot find the default branch", () => {
    const dir = tempDir("factory-musts-");
    made.push(dir);
    execFileSync("git", ["-C", dir, "init", "-q"]);
    expect(run(dir, { ...process.env, FACTORY_BASE_REF: "origin/nowhere" })).toMatchObject({
      code: 1,
      out: expect.stringContaining("cannot find the default branch origin/nowhere; fetch it or set FACTORY_BASE_REF"),
    });
  });
});
