import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs, report, touchedOf } from "../scripts/garden-pr.js";
import { tempDir } from "./temp.js";

// planted text, split so that gardener's own text match does not count it in this test file
const ESCAPE = ["export const x = 1 as", "any;"].join(" ");
const MOCKED = ["vi.mock", '("x");\nit("a", () => { expect(f).toHaveBeenCalled', "(); });\n"].join("");

const SCRIPT = join(import.meta.dirname, "..", "scripts", "garden-pr.ts");

// a throwaway repository with a main branch and a change branch made from it
function repo(): {
  readonly dir: string;
  readonly write: (path: string, text: string) => void;
  readonly commit: (m: string) => void;
  readonly git: (...a: string[]) => string;
} {
  const dir = tempDir("garden-pr-");
  const git = (...args: string[]): string =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
      {
        cwd: dir,
        encoding: "utf8",
      },
    );
  git("init", "-q", "-b", "main");
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const commit = (message: string): void => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
  };
  return { dir, write, commit, git };
}

const lines = (n: number, last = ""): string =>
  `${Array.from({ length: n - 1 }, (_, i) => `const a${i} = ${i};`).join("\n")}\n${last || "export {};"}\n`;

describe("parseArgs", () => {
  it("defaults to origin/main against HEAD, as text", () => {
    expect(parseArgs([])).toEqual({ base: "origin/main", head: "HEAD", json: false });
  });

  it("reads --base, --head and --json", () => {
    expect(parseArgs(["--base", "main", "--head", "topic", "--json"])).toEqual({
      base: "main",
      head: "topic",
      json: true,
    });
  });

  it("refuses an option it does not know, or one with no value", () => {
    expect(parseArgs(["--transcripts"])).toMatch(
      /^garden-pr: .*--transcripts.*; use --base REV --head REV \[--json\]$/,
    );
    expect(parseArgs(["--base"])).toMatch(/^garden-pr: .*--base.*; use --base REV/);
  });
});

describe("touchedOf", () => {
  it("reads changed, added and deleted paths, and pairs a rename with its old path", () => {
    const z = ["M", "a.ts", "A", "b.ts", "D", "c.ts", "R087", "old.ts", "new.ts", ""].join("\0");
    expect(touchedOf(z)).toEqual([
      { before: "a.ts", after: "a.ts" },
      { before: "b.ts", after: "b.ts" },
      { before: "c.ts", after: "c.ts" },
      { before: "old.ts", after: "new.ts" },
    ]);
  });
});

describe("report on a real repository", () => {
  it("measures each touched code file at the merge base and the head, and lists what got worse", () => {
    const r = repo();
    try {
      r.write("src/big.ts", lines(900));
      r.write("src/small.ts", lines(10));
      r.write("README.md", "hello\n");
      r.commit("base");
      r.git("checkout", "-q", "-b", "topic");
      r.write("src/big.ts", lines(950));
      r.write("src/small.ts", lines(11, ESCAPE));
      r.write("test/a.test.ts", MOCKED);
      r.write("README.md", "changed\n");
      r.commit("change");
      const out = report(r.dir, { base: "main", head: "topic", json: true });
      if (typeof out === "string") throw new Error(out);
      expect(out.largeFileLines).toBe(800);
      expect(out.rows.map((row) => row.path)).toEqual(["src/big.ts", "src/small.ts", "test/a.test.ts"]);
      expect(out.rows[0]).toMatchObject({
        before: { kind: "measured", numbers: { lines: 900 } },
        after: { kind: "measured", numbers: { lines: 950 } },
      });
      expect(out.rows[2]?.before).toEqual({ kind: "absent" });
      expect(out.worse.map((w) => `${w.rule} ${w.paths.join(",")} ${w.before}→${w.after}`)).toEqual([
        "W1 src/big.ts 900→950",
        "W2 src/small.ts 0→1",
        "W4 test/a.test.ts 0→1",
        "W4 test/a.test.ts 0→1",
      ]);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it("takes gardener's definitions from the merge base, so a head that raises the size limit is still judged by the old one", () => {
    const r = repo();
    try {
      r.write("gardener.config.json", JSON.stringify({ largeFileLines: 800 }));
      r.write("src/big.ts", lines(900));
      r.commit("base");
      r.git("checkout", "-q", "-b", "topic");
      r.write("gardener.config.json", JSON.stringify({ largeFileLines: 5000 }));
      r.write("src/big.ts", lines(950));
      r.commit("loosen the limit and grow");
      const out = report(r.dir, { base: "main", head: "topic", json: true });
      if (typeof out === "string") throw new Error(out);
      expect(out.largeFileLines).toBe(800);
      expect(out.worse.map((w) => w.rule)).toEqual(["W1"]);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it("measures a renamed file at its old path before, so a pure rename is not worse", () => {
    const r = repo();
    try {
      r.write("src/old.ts", lines(900));
      r.commit("base");
      r.git("checkout", "-q", "-b", "topic");
      r.git("mv", "src/old.ts", "src/new.ts");
      r.commit("rename");
      const out = report(r.dir, { base: "main", head: "topic", json: true });
      if (typeof out === "string") throw new Error(out);
      expect(out.rows.map((row) => row.path)).toEqual(["src/new.ts"]);
      expect(out.worse).toEqual([]);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  });
});

describe("the script's exit code", () => {
  it("exits 0 when it found something worse, since it is not a gate, and 2 when it cannot measure", () => {
    const r = repo();
    try {
      r.write("src/a.ts", lines(5));
      r.commit("base");
      r.git("checkout", "-q", "-b", "topic");
      r.write("src/a.ts", lines(5, ESCAPE));
      r.commit("escape");
      const found = spawnSync(process.execPath, [SCRIPT, "--base", "main", "--head", "topic"], {
        cwd: r.dir,
        encoding: "utf8",
      });
      expect(found.status).toBe(0);
      expect(found.stdout).toContain("- W2 type escapes in the touched files: 0 → 1 (`src/a.ts`)");
      const bad = spawnSync(process.execPath, [SCRIPT, "--base", "no-such-rev", "--head", "topic"], {
        cwd: r.dir,
        encoding: "utf8",
      });
      expect(bad.status).toBe(2);
      expect(bad.stderr).toContain("garden-pr: cannot measure:");
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  });
});
