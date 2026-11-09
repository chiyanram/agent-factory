import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readRecords } from "../src/core/dispatch/records.js";
import { makeTargets, commandsOf } from "../src/core/onboard/listing.js";
import { staleCites } from "../src/core/onboard/cites.js";
import { accept, readKnowledge } from "../src/core/onboard/home.js";
import { knownFor } from "../src/core/onboard/known.js";
import { onboard, FLOOR, type OnboardSetup } from "../src/core/onboard/run.js";
import type { Model, ModelRun } from "../src/core/review/model.js";
import { onboardCommand } from "../src/onboard-cli.js";
import { tempDir } from "./temp.js";

// the rulebook's onboarder scenarios (chiyanram/skills plugins/rulebook/evals/onboarder/), as fixtures
const MAKEFILE = [
  ".PHONY: build test run",
  "build: ## compile and package",
  "\t./gradlew assemble",
  "test: ## unit and integration tests",
  "\t./gradlew check -PwithContainers",
  "run: ## start the api on port 8085",
  "\t./gradlew bootRun",
  "",
].join("\n");

const CONTEXT = [
  "# Context",
  "**Loan**: one book lent to one member, from checkout to return.",
  "_Avoid_: borrowing, rental",
  "**Hold**: a member's place in the queue for a book that is out.",
  "_Avoid_: reservation, booking",
  "",
].join("\n");

const REPOSITORY = "src/main/java/library/LoanRepository.java";

// the repository's lines: line 31 the field, line 44 the overdue query
function repositoryText(overdueAt: number): string {
  const lines = Array.from({ length: 50 }, (_, i) => `  // line ${i + 1}`);
  lines[30] = "  private final JdbcTemplate jdbc;";
  lines[overdueAt - 1] = "  List<Loan> overdue(final LocalDate today) {";
  return `${lines.join("\n")}\n`;
}

type Repo = { readonly root: string; readonly clone: string; readonly env: NodeJS.ProcessEnv; readonly home: string };

let r: Repo;

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, env: r.env, encoding: "utf8" }).trim();
}

function write(path: string, text: string): void {
  mkdirSync(dirname(join(r.clone, path)), { recursive: true });
  writeFileSync(join(r.clone, path), text);
}

function commitAndPush(message: string): void {
  git(r.clone, "add", "-A");
  git(r.clone, "commit", "-q", "-m", message);
  git(r.clone, "push", "-q", "origin", "main");
}

beforeEach(() => {
  const root = tempDir("factory-onboard-");
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  r = { root, clone: join(root, "clone"), env, home: join(root, "home") };
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", "origin.git"], { cwd: root, env });
  execFileSync("git", ["clone", "-q", join(root, "origin.git"), r.clone], { cwd: root, env });
  git(r.clone, "checkout", "-q", "-b", "main");
  write("Makefile", MAKEFILE);
  write("gradlew", "#!/bin/sh\n");
  write("README.md", "Build with ./gradlew build.\n");
  write("CONTEXT.md", CONTEXT);
  write("AGENTS.md", "# Agents\n");
  write("library/fines/FineSchedule.java", "class FineSchedule {}\n");
  write(REPOSITORY, repositoryText(44));
  commitAndPush("main");
});
afterEach(() => rmSync(r.root, { recursive: true, force: true }));

const ANSWER = {
  stack: [{ text: "Java with Gradle, wrapped by make", file: "gradlew", line: 0, verified: true }],
  modules: [
    {
      name: "library",
      job: "loans, holds and fines",
      file: "library/fines/FineSchedule.java",
      line: 0,
      verified: true,
    },
  ],
  gotchas: [
    {
      text: "The overdue query compares due_on with the server's local date",
      file: REPOSITORY,
      line: 44,
      verified: true,
    },
    { text: "A cite past the file's end is not kept", file: REPOSITORY, line: 900, verified: true },
  ],
  terms: [
    {
      term: "Loan",
      meaning: "one book lent to one member, from checkout to return.",
      avoid: ["borrowing"],
      file: "CONTEXT.md",
      line: 2,
      verified: true,
    },
    {
      term: "FineSchedule",
      meaning: "the fines owed per day late",
      avoid: ["penalty table"],
      file: "library/fines/FineSchedule.java",
      line: 1,
      verified: true,
    },
  ],
};

type Seen = { readonly run: ModelRun; readonly files: readonly string[]; readonly commands: string };

function model(seen: Seen[], output: unknown = ANSWER): Model {
  return async (run) => {
    seen.push({
      run,
      files: readdirSync(run.folder).toSorted(),
      commands: readFileSync(join(run.folder, "commands.md"), "utf8"),
    });
    return { kind: "ok", value: { output, answer: {}, costUsd: 0.75, tokens: 1200 } };
  };
}

function setup(m: Model): OnboardSetup {
  return {
    home: r.home,
    project: "ledger",
    repo: r.clone,
    env: r.env,
    forge: { defaultBranch: async () => ({ kind: "ok", value: "main" }) },
    model: m,
    modelName: "opus",
    maxUsd: "2",
    plugins: [],
    runsDir: join(r.home, "onboard-runs"),
    now: () => Date.parse("2026-11-09T10:00:00Z"),
  };
}

const staged = (file: string) => readFileSync(join(r.home, "projects", "ledger", "staged", file), "utf8");

describe("the engine's listing of a project's commands (#235)", () => {
  it("reads the Makefile's targets with their help, and prefers the Makefile, the front door, to the raw tool", () => {
    expect(makeTargets(MAKEFILE).map((t) => [t.command, t.help, t.line])).toEqual([
      ["make build", "compile and package", 2],
      ["make test", "unit and integration tests", 4],
      ["make run", "start the api on port 8085", 6],
    ]);
    expect(commandsOf({ makefile: MAKEFILE, wrappers: ["./gradlew"] })).toMatchObject({
      kind: "listed",
      from: "Makefile",
    });
    expect(commandsOf({ wrappers: ["./gradlew"] })).toMatchObject({ kind: "inferred" });
    expect(makeTargets("VERSION := 1\nall: build\n")).toEqual([
      { command: "make all", help: "", file: "Makefile", line: 2 },
    ]);
  });
});

describe("agent-factory onboard (#235)", () => {
  it("on a repo with a Makefile, the brief names its targets as listed, and nothing is written in the repo", async () => {
    const seen: Seen[] = [];
    const before = git(r.clone, "status", "--porcelain");
    const out = await onboard(setup(model(seen)));
    expect(out).toMatchObject({ kind: "ok", value: { spend: { usd: 0.75, tokens: 1200 } } });
    const brief = staged("brief.md");
    expect(brief).toContain("- `make build`: compile and package (`Makefile:2`, verified)");
    expect(brief).toContain("- `make test`: unit and integration tests (`Makefile:4`, verified)");
    expect(brief).toContain("- `make run`: start the api on port 8085 (`Makefile:6`, verified)");
    expect(brief).not.toMatch(/`\.\/gradlew/);
    // a cite the default branch holds is kept and verified; one it does not is marked inferred
    expect(brief).toContain(`(\`${REPOSITORY}:44\`, verified)`);
    expect(brief).toContain("- A cite past the file's end is not kept (inferred)");
    expect(brief).toContain("- [AGENTS.md](AGENTS.md) (verified)");
    expect(brief).not.toMatch(/\b\d+ modules\b/);
    // the repo is as it was, and the model ran read-only on a copy, from its card, with the engine's listing
    expect(git(r.clone, "status", "--porcelain")).toBe(before);
    expect(readdirSync(r.clone).toSorted()).toEqual([
      ".git",
      "AGENTS.md",
      "CONTEXT.md",
      "Makefile",
      "README.md",
      "gradlew",
      "library",
      "src",
    ]);
    expect(seen[0]?.files).toEqual(["code", "commands.md"]);
    expect(seen[0]?.commands).toContain("`make test`: unit and integration tests (Makefile:4)");
    expect(seen[0]?.run.prompt).toMatch(/^# Onboarder/);
    expect(seen[0]?.run.prompt).toContain(FLOOR);
    // what it spent is in the project's run records
    const read = await readRecords({ home: r.home, project: "ledger", ticket: "onboarder" });
    expect(read).toMatchObject({ kind: "ok", value: [{ kind: "spent", phase: "onboard", spend: { usd: 0.75 } }] });
  });

  it("a repo with CONTEXT.md gets a link, not a copy, and a term CONTEXT.md lacks gets an entry", async () => {
    await onboard(setup(model([])));
    const glossary = staged("glossary.md");
    expect(glossary).toContain("The project's own glossary is [CONTEXT.md](CONTEXT.md)");
    expect(glossary).toContain("- **Loan**: see [CONTEXT.md](CONTEXT.md) (verified)");
    expect(glossary).not.toContain("one book lent to one member");
    expect(glossary).not.toContain("a member's place in the queue");
    expect(glossary).toContain(
      "- **FineSchedule**: the fines owed per day late _Avoid_: penalty table. (`library/fines/FineSchedule.java:1`, verified)",
    );
  });

  it("stages for a human: accepted only with the hashes they read; a brief edited after is not handed to runs", async () => {
    const out = await onboard(setup(model([])));
    if (out.kind !== "ok") throw new Error(out.reason);
    expect(await readKnowledge(r.home, "ledger")).toEqual({ kind: "none" });
    const by = "ram";
    const at = "2026-11-09T11:00:00Z";
    const wrong = { brief: "0".repeat(64), glossary: out.value.hashes.glossary };
    expect(await accept({ home: r.home, project: "ledger", seen: wrong, by, at })).toMatchObject({ kind: "failed" });
    expect(await accept({ home: r.home, project: "ledger", seen: out.value.hashes, by, at })).toMatchObject({
      kind: "ok",
    });
    expect(existsSync(join(r.home, "projects", "ledger", "staged"))).toBe(false);
    expect(await readKnowledge(r.home, "ledger")).toMatchObject({
      kind: "accepted",
      brief: expect.stringContaining("make test"),
    });
    writeFileSync(join(r.home, "projects", "ledger", "brief.md"), "# edited\n");
    expect(await readKnowledge(r.home, "ledger")).toMatchObject({ kind: "changed" });
  });

  it("a stale file:line in the brief is reported on the next run: the line moved, or the file is gone", async () => {
    const out = await onboard(setup(model([])));
    if (out.kind !== "ok") throw new Error(out.reason);
    await accept({ home: r.home, project: "ledger", seen: out.value.hashes, by: "ram", at: "2026-11-09T11:00:00Z" });
    const known = () =>
      knownFor({ home: r.home, project: "ledger", repo: r.clone, env: r.env, ref: "refs/heads/main" });
    expect((await known()).stale).toEqual([]);
    write(REPOSITORY, repositoryText(46));
    git(r.clone, "rm", "-q", "library/fines/FineSchedule.java");
    commitAndPush("move the query");
    expect((await known()).stale).toEqual([
      "library/fines/FineSchedule.java is stale: the file is gone",
      `${REPOSITORY}:44 is stale: its line is now at 46`,
      "library/fines/FineSchedule.java:1 is stale: the file is gone",
    ]);
  });

  it("the rulebook scenario: a cite whose line now holds other code is stale, with where its line went", () => {
    const cite = { file: REPOSITORY, line: 31, text: "  List<Loan> overdue(final LocalDate today) {" };
    expect(staleCites([cite], () => repositoryText(44).split("\n"))).toEqual([
      `${REPOSITORY}:31 is stale: its line is now at 44`,
    ]);
  });

  it("onboard accept takes the project and both full hashes; anything else is the usage", async () => {
    const lines: string[] = [];
    const io = {
      home: r.home,
      out: (t: string) => lines.push(t),
      err: (t: string) => lines.push(t),
      setup: async () => ({ kind: "ok", value: setup(model([])) }) as const,
      by: async () => "ram",
      now: () => Date.parse("2026-11-09T11:00:00Z"),
    };
    expect(await onboardCommand(["accept", "ledger", "abc", "def"], io)).toBe(64);
    expect(await onboardCommand(["ledger"], io)).toBe(0);
    const hashes = lines.join("").match(/onboard accept ledger ([0-9a-f]{64}) ([0-9a-f]{64})/);
    expect(await onboardCommand(["accept", "ledger", hashes?.[1] ?? "", hashes?.[2] ?? ""], io)).toBe(0);
    expect(await readKnowledge(r.home, "ledger")).toMatchObject({ kind: "accepted" });
  });
});
