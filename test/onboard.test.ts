import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readRecords } from "../src/core/dispatch/records.js";
import { makeTargets, commandsOf } from "../src/core/onboard/listing.js";
import { absence, staleCites } from "../src/core/onboard/cites.js";
import { mustsIn } from "../src/core/onboard/musts.js";
import { accept, readKnowledge } from "../src/core/onboard/home.js";
import { knownFor } from "../src/core/onboard/known.js";
import { onboard, FLOOR, type OnboardSetup } from "../src/core/onboard/run.js";
import type { Model, ModelRun } from "../src/core/review/model.js";
import { onboardSetup } from "../src/core/onboard/settings.js";
import { REVIEW_MODELS } from "../src/core/review/pinned.js";
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
    expect(seen[0]?.files).toEqual(["code", "commands.md", "rules.md"]);
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

describe("onboardSetup (#235, after #232 and #213)", () => {
  it("hands the run the project's plugins, and the pinned logic model unless a layer sets another id", () => {
    const plugins = [{ label: "rulebook@acme", dir: "/plugins/rulebook" }];
    const input = {
      forge: { defaultBranch: async () => ({ kind: "ok" as const, value: "main" }) },
      home: "/h",
      project: "ledger",
      now: () => 0,
      plugins,
    };
    const set = onboardSetup({ ...input, env: { FACTORY_REPO: "/r", FACTORY_HOME: "/h" } });
    expect(set).toMatchObject({ kind: "ok", value: { plugins, modelName: REVIEW_MODELS.logic } });
    const other = onboardSetup({ ...input, env: { FACTORY_REPO: "/r", FACTORY_LOGIC_MODEL: "claude-opus-5-1" } });
    expect(other).toMatchObject({ kind: "ok", value: { modelName: "claude-opus-5-1" } });
  });
});

// the ledger pilot's AGENTS.md (#62): three MUSTs, one wrapped over two lines
const LEDGER_AGENTS = [
  "# Agents",
  "",
  "Read the README first.",
  "",
  "## MUSTs",
  "",
  "- Write production code only after a human posts /approved on the draft PR.",
  "- Keep ./gradlew check green.",
  "- Put every integration test under src/integrationTest, never",
  "  beside the unit tests.",
  "",
  "```bash",
  "./gradlew check # MUST pass",
  "```",
  "",
  "## Style",
  "",
  "- Prefer records.",
  "",
].join("\n");

const LEDGER_MUSTS = [
  "- Write production code only after a human posts /approved on the draft PR. (`AGENTS.md:7`, verified)",
  "- Keep ./gradlew check green. (`AGENTS.md:8`, verified)",
  "- Put every integration test under src/integrationTest, never beside the unit tests. (`AGENTS.md:9`, verified)",
];

// what the ledger brief said (#62), and the claim the engine must not take on a cite
const ABSENCE_CLAIM = {
  text: "Project rules: there is no CLAUDE.md, AGENTS.md, CONTRIBUTING, glossary or ADR directory in the repo",
  file: "Makefile",
  line: 1,
  verified: true,
};

// what the ledger run on the operator's Mac said (#383), which refused the whole brief over build.gradle.kts
const LEDGER_CLAIM = {
  text: "Project rules: the repo has no agent instruction file (CLAUDE.md/AGENTS.md), no glossary and no ADRs. The only written rules are comments in build.gradle.kts and gradle/libs.versions.toml",
  file: "build.gradle.kts",
  line: 1,
  verified: true,
};

describe("the project's MUSTs and the cite check (#383)", () => {
  beforeEach(() => {
    write("AGENTS.md", LEDGER_AGENTS);
    write("CLAUDE.md", "@AGENTS.md\n\nYou MUST NOT push to main.\n");
    commitAndPush("rules");
  });

  it("finds each MUST, one line each, at its line: under a MUST heading, or by the word; never in a code fence", () => {
    expect(mustsIn("AGENTS.md", LEDGER_AGENTS.split("\n"))).toEqual([
      { file: "AGENTS.md", line: 7, text: "Write production code only after a human posts /approved on the draft PR." },
      { file: "AGENTS.md", line: 8, text: "Keep ./gradlew check green." },
      {
        file: "AGENTS.md",
        line: 9,
        text: "Put every integration test under src/integrationTest, never beside the unit tests.",
      },
    ]);
    expect(mustsIn("CLAUDE.md", ["intro", "line two says you MUST log in", "", "- plain item"])).toEqual([
      { file: "CLAUDE.md", line: 2, text: "intro line two says you MUST log in" },
    ]);
  });

  it("the brief carries every MUST of AGENTS.md and CLAUDE.md under Project rules, cited, and the model reads them", async () => {
    const seen: Seen[] = [];
    const out = await onboard(setup(model(seen)));
    expect(out).toMatchObject({ kind: "ok" });
    const brief = staged("brief.md");
    const rules = brief.slice(brief.indexOf("## Project rules"), brief.indexOf("## Stack"));
    for (const line of LEDGER_MUSTS) {
      expect(rules).toContain(line);
    }
    expect(rules).toContain("- You MUST NOT push to main. (`CLAUDE.md:3`, verified)");
    expect(rules).not.toContain("Prefer records");
    expect(rules).not.toContain("# MUST pass");
    // each MUST's cite is kept, so a run reports it stale when the line moves
    const cites: unknown = JSON.parse(staged("cites.json"));
    expect(cites).toContainEqual(expect.objectContaining({ file: "AGENTS.md", line: 8 }));
    expect(seen).toHaveLength(1);
  });

  it("the ledger run's own line: dropped with a note, the brief staged, and Project rules the engine's alone", async () => {
    write("build.gradle.kts", "plugins { java }\n");
    write("gradle/libs.versions.toml", '[versions]\njava = "21"\n');
    commitAndPush("gradle");
    const answer = { ...ANSWER, stack: [LEDGER_CLAIM, ...ANSWER.stack] };
    const out = await onboard(setup(model([], answer)));
    expect(out).toMatchObject({ kind: "ok", value: { dropped: [expect.stringContaining(LEDGER_CLAIM.text)] } });
    const brief = staged("brief.md");
    expect(brief).not.toContain("agent instruction file");
    expect(brief).toContain("- Java with Gradle, wrapped by make");
    const rules = brief.slice(brief.indexOf("## Project rules"), brief.indexOf("## Stack"));
    for (const line of LEDGER_MUSTS) {
      expect(rules).toContain(line);
    }
    expect(brief).toContain("- [AGENTS.md](AGENTS.md) (verified)");
    expect(brief).toContain("- [CLAUDE.md](CLAUDE.md) (verified)");
    // the note is staged for the human, never accepted, and the spend is in the run records
    const note = staged("dropped.md");
    expect(note).toContain(LEDGER_CLAIM.text);
    expect(note).toContain("the engine writes Project rules itself");
    const read = await readRecords({ home: r.home, project: "ledger", ticket: "onboarder" });
    expect(read).toMatchObject({ kind: "ok", value: [{ kind: "spent" }] });
  });

  it("a model Project rules item, or one naming an instruction file, is dropped; the engine's section stays", async () => {
    const answer = {
      ...ANSWER,
      modules: [
        { name: "Project rules", job: "keep the build green", file: "Makefile", line: 1, verified: true },
        ...ANSWER.modules,
      ],
      gotchas: [
        { text: "Agent instructions sit in .claude/rules", file: "Makefile", line: 1, verified: false },
        ...ANSWER.gotchas,
      ],
    };
    const out = await onboard(setup(model([], answer)));
    expect(out.kind === "ok" ? out.value.dropped : []).toHaveLength(2);
    const brief = staged("brief.md");
    expect(brief.match(/## Project rules/g)).toHaveLength(1);
    expect(brief).not.toContain("keep the build green");
    expect(brief).not.toContain("Agent instructions sit");
    expect(brief).toContain("- You MUST NOT push to main. (`CLAUDE.md:3`, verified)");
  });

  it("a false absence claim elsewhere is dropped, naming the file the repo holds; the rest is staged", async () => {
    const answer = {
      ...ANSWER,
      gotchas: [
        { text: "There is no CONTEXT.md, so terms drift", file: "Makefile", line: 1, verified: true },
        ...ANSWER.gotchas,
      ],
    };
    const out = await onboard(setup(model([], answer)));
    expect(out).toMatchObject({
      kind: "ok",
      value: { dropped: [expect.stringContaining("but the default branch holds CONTEXT.md")] },
    });
    expect(staged("brief.md")).not.toContain("terms drift");
    expect(staged("brief.md")).toContain("The overdue query compares due_on");
  });

  it("keeps the run's stream as its trace beside onboarder.jsonl, named on its spent line (#487)", async () => {
    const stream = '{"type":"assistant"}\n{"type":"result"}\n';
    const streaming: Model = async (run) => {
      const ran = await model([])(run);
      return ran.kind === "ok" ? { kind: "ok", value: { ...ran.value, stream } } : ran;
    };
    expect(await onboard(setup(streaming))).toMatchObject({ kind: "ok" });
    const read = await readRecords({ home: r.home, project: "ledger", ticket: "onboarder" });
    expect(read).toMatchObject({
      kind: "ok",
      value: [{ kind: "spent", traces: [expect.stringMatching(/^onboard-/)] }],
    });
    const [name = ""] = readdirSync(join(r.home, "runs", "ledger", "onboarder"));
    expect(read).toMatchObject({ value: [{ traces: [name] }] });
    expect(readFileSync(join(r.home, "runs", "ledger", "onboarder", name), "utf8")).toBe(stream);
  });

  it("refused only when the engine dropped every model line, and nothing is staged; the spend is still recorded", async () => {
    const answer = { stack: [ABSENCE_CLAIM], modules: [], gotchas: [], terms: [] };
    const out = await onboard(setup(model([], answer)));
    expect(out).toMatchObject({ kind: "failed", reason: expect.stringContaining("the brief is refused") });
    expect(out.kind === "failed" ? out.reason : "").toContain("AGENTS.md");
    expect(existsSync(join(r.home, "projects", "ledger", "staged"))).toBe(false);
    const read = await readRecords({ home: r.home, project: "ledger", ticket: "onboarder" });
    expect(read).toMatchObject({ kind: "ok", value: [{ kind: "spent" }] });
  });

  it("a true absence claim is verified against the file list, never by its cite; one naming no file is inferred", async () => {
    const answer = {
      ...ANSWER,
      stack: [
        { text: "There is no Dockerfile or docs/adr folder in the repo", file: "Makefile", line: 1, verified: true },
        { text: "The file that sets the JDK is missing", file: "Makefile", line: 1, verified: true },
        { text: "LoanRepository.java has no index on due_on", file: REPOSITORY, line: 31, verified: true },
      ],
    };
    const out = await onboard(setup(model([], answer)));
    expect(out).toMatchObject({ kind: "ok" });
    const brief = staged("brief.md");
    expect(brief).toContain("- There is no Dockerfile or docs/adr folder in the repo (verified against the file list)");
    expect(brief).toContain("- The file that sets the JDK is missing (inferred: it says a file is absent");
    expect(brief).not.toContain("(`Makefile:1`, verified)");
    expect(brief).toContain(`- LoanRepository.java has no index on due_on (\`${REPOSITORY}:31\`, verified)`);
  });

  it("absence: the cited file itself is not an absence claim; a file the list holds makes the claim false", () => {
    const files = ["AGENTS.md", "CONTRIBUTING.md", "docs/adr/0001-x.md", "CONTEXT.md", "src/A.java"];
    expect(absence("A.java has no index", "src/A.java", files)).toEqual({ kind: "not-absence" });
    expect(absence("there is no CONTRIBUTING guide", "", files)).toMatchObject({
      kind: "false",
      held: ["CONTRIBUTING.md"],
    });
    expect(absence("there is no glossary", "", files)).toMatchObject({ kind: "false", held: ["CONTEXT.md"] });
    expect(absence("ADRs are absent", "", files)).toMatchObject({ kind: "false", held: ["docs/adr/0001-x.md"] });
    expect(absence("there is no Dockerfile", "", files)).toEqual({ kind: "true", names: ["Dockerfile"] });
    expect(absence("the build uses Gradle 8.10", "gradle/libs.versions.toml", files)).toEqual({ kind: "not-absence" });
  });

  it("absence reads the names the line claims absent, never another file it names", () => {
    const files = ["AGENTS.md", "build.gradle.kts", "gradle/libs.versions.toml", "src/A.java"];
    expect(absence(LEDGER_CLAIM.text, LEDGER_CLAIM.file, files)).toEqual({
      kind: "false",
      names: ["CLAUDE.md", "AGENTS.md", "a glossary", "an ADR directory"],
      held: ["AGENTS.md"],
    });
    const noRules = files.filter((f) => f !== "AGENTS.md");
    expect(absence(LEDGER_CLAIM.text, LEDGER_CLAIM.file, noRules)).toMatchObject({ kind: "true" });
    expect(absence("Without a Dockerfile, the app runs from build.gradle.kts", "", files)).toEqual({
      kind: "true",
      names: ["Dockerfile"],
    });
    expect(absence("build.gradle.kts sets Java 21, and the wrapper file is missing", "", files)).toEqual({
      kind: "unsure",
      held: ["build.gradle.kts"],
    });
    expect(absence("A.java has no retry, see build.gradle.kts", "src/A.java", files)).toEqual({ kind: "not-absence" });
  });
});
