// macos-needed: when ci.yml's test-macos job runs. Each event and each kind of change, then the script on a fresh git
// repository whose branch changes only docs, then code.
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { changeOf, decide, isDocs } from "../scripts/macos-needed.js";
import { tempDir } from "./temp.js";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "macos-needed.ts");
const BASE = "b".repeat(40);
const HEAD = "c".repeat(40);
const pr = (changed: readonly string[] | undefined, draft = false) => decide({ kind: "pull_request", draft, changed });
const event = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ pull_request: { draft: false, base: { sha: BASE }, head: { sha: HEAD }, ...over } });

describe("isDocs", () => {
  it("counts docs/, a root .md and the PR and issue templates as docs; Markdown the code reads is not", () => {
    for (const f of ["docs/how-to/x.md", "README.md", "CONTRIBUTING.md", ".github/pull_request_template.md"]) {
      expect(isDocs(f)).toBe(true);
    }
    expect(isDocs(".github/ISSUE_TEMPLATE/bug.yml")).toBe(true);
    for (const f of ["prompts/coordinator.md", "plugins/x/README.md", "evals/reviewer/README.md", "src/a.ts"]) {
      expect(isDocs(f)).toBe(false);
    }
    expect(isDocs(".github/workflows/ci.yml")).toBe(false);
  });
});

describe("decide", () => {
  it("runs macOS on every event but a pull request: a push to main, a release, a merge group", () => {
    for (const e of ["push", "workflow_dispatch", "merge_group", ""]) {
      expect(decide({ kind: "other", event: e }).run).toBe(true);
    }
  });

  it("skips a draft, even one that touches code", () => {
    expect(pr(["src/a.ts"], true)).toEqual({ run: false, why: expect.stringContaining("draft") });
  });

  it("skips a ready pull request whose every file is docs, and runs one that touches anything else", () => {
    expect(pr(["docs/a.md", "README.md"]).run).toBe(false);
    expect(pr(["docs/a.md", "src/core/git.ts"])).toEqual({ run: true, why: "src/core/git.ts changed" });
    expect(pr(["prompts/coordinator.md"]).run).toBe(true);
    expect(pr([".github/workflows/ci.yml"]).run).toBe(true);
    expect(pr(["package-lock.json"]).run).toBe(true);
  });

  it("runs when it cannot tell: no file list, or an empty one", () => {
    expect(pr(undefined).run).toBe(true);
    expect(pr([]).run).toBe(true);
  });
});

describe("changeOf", () => {
  const none = () => {
    throw new Error("diff must not be called");
  };

  it("names any event but a pull request as other, without a diff", () => {
    expect(changeOf("push", undefined, none)).toEqual({ kind: "other", event: "push" });
  });

  it("reads the draft flag, and diffs the base and head commits", () => {
    const seen: string[] = [];
    const diff = (b: string, h: string) => {
      seen.push(b, h);
      return ["src/a.ts"];
    };
    expect(changeOf("pull_request", event({ draft: true }), diff)).toEqual({
      kind: "pull_request",
      draft: true,
      changed: ["src/a.ts"],
    });
    expect(seen).toEqual([BASE, HEAD]);
  });

  it("has no file list when the event is missing, not JSON, or names no commits", () => {
    for (const text of [undefined, "{", event({ base: {} }), event({ head: { sha: "main" } })]) {
      expect(changeOf("pull_request", text, none)).toMatchObject({ changed: undefined });
    }
  });
});

describe("macos-needed, the script", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes run=false for a docs-only branch and run=true once it touches code", () => {
    const dir = tempDir("factory-macos-");
    made.push(dir);
    const repo = join(dir, "repo");
    const put = (file: string, text: string): void => {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      writeFileSync(join(repo, file), text);
    };
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
    const commit = (m: string) => {
      git("add", "-A");
      git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", m);
      return git("rev-parse", "HEAD");
    };
    mkdirSync(repo);
    git("init", "-q", "-b", "main");
    put("src/a.ts", "a\n");
    const base = commit("base");
    git("checkout", "-qb", "change");
    put("docs/a.md", "a\n");
    const docs = commit("docs");
    put("src/a.ts", "b\n");
    const code = commit("code");

    const run = (head: string) => {
      const out = join(dir, `out-${head}`);
      const ev = join(dir, `event-${head}.json`);
      writeFileSync(out, "");
      writeFileSync(ev, JSON.stringify({ pull_request: { draft: false, base: { sha: base }, head: { sha: head } } }));
      const r = spawnSync(process.execPath, [SCRIPT], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: ev, GITHUB_OUTPUT: out },
      });
      expect(r.status).toBe(0);
      return readFileSync(out, "utf8");
    };
    expect(run(docs)).toBe("run=false\n");
    expect(run(code)).toBe("run=true\n");
  });
});
