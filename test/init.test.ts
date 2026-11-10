import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../src/app.js";
import { SRT_VERSION } from "../src/core/box/srt-plan.js";
import { majorOf, owner, toolCheck, type Probes } from "../src/core/init/checks.js";
import { detect, hostOf, parseRemote, projectName, toolsOf } from "../src/core/init/detect.js";
import { answersOf, type Question } from "../src/core/init/round.js";
import { projectPath, runSettings } from "../src/core/project.js";
import { layered, refusals } from "../src/core/settings/layers.js";
import { initCommand, type InitIo } from "../src/init-cli.js";
import { commitMarket, GIT_ENV, LANES } from "./market.js";
import { tempDir } from "./temp.js";

let root = "";
let home = "";

beforeEach(() => {
  root = tempDir("factory-init-");
  home = join(root, "home");
  mkdirSync(home);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function git(dir: string, args: readonly string[]): void {
  execFileSync("git", ["-C", dir, ...args], { env: GIT_ENV, stdio: "ignore" });
}

// a clone with these files and this origin
function clone(name: string, files: Readonly<Record<string, string>>, origin: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git(dir, ["init", "-q"]);
  git(dir, ["remote", "add", "origin", origin]);
  return dir;
}

// the ledger pilot's clone: Gradle, Spock tests and ITs, Flyway, CI on GitHub, mise declares the JDK
const LEDGER = {
  gradlew: "#!/bin/sh\n",
  "build.gradle": "plugins { id 'java' }\n",
  "src/test/groovy/LedgerSpec.groovy": "class LedgerSpec {}\n",
  "src/integrationTest/groovy/LedgerIT.groovy": "class LedgerIT {}\n",
  "src/main/resources/db/migration/V1__init.sql": "create table t (id int);\n",
  ".github/workflows/check.yml": "on: push\n",
  "mise.toml": '[tools]\njava = "27"\n',
};

function ledger(): string {
  return clone("ledger", LEDGER, "https://github.com/chiyanram/ledger.git");
}

// a marketplace origin holding the rulebook plugin, which init clones into the factory home
let marketDir = "";
function market(): string {
  if (marketDir.startsWith(root) && root !== "") {
    return marketDir;
  }
  marketDir = join(root, "origin");
  commitMarket(root, {
    "plugins/rulebook/.claude-plugin/plugin.json": '{"name": "rulebook"}',
    "plugins/rulebook/skills/crq/process/lanes.json": LANES,
  });
  return join(root, "origin");
}

const USER_HOME = "/home/dev";

// probes on which every check passes
function probes(over: Partial<Probes> = {}): Probes {
  const found: Readonly<Record<string, string>> = {
    srt: "/opt/node/bin/srt",
    claude: "/opt/node/bin/claude",
    "agent-factory": "/opt/node/bin/agent-factory",
    node: "/opt/node/bin/node",
    java: `${USER_HOME}/.local/share/mise/installs/java/27.0.1/bin/java`,
  };
  return {
    run: async () => ({ code: 0, stdout: `${SRT_VERSION}\n`, stderr: "" }),
    env: {},
    which: async (name) => {
      const real = found[name];
      return real === undefined ? "none" : { found: real, real };
    },
    execPath: "/opt/node/bin/node",
    home: USER_HOME,
    platform: "darwin",
    now: new Date("2026-11-10T00:00:00Z"),
    version: "0.31.0",
    gitHost: async () => ({ kind: "ok", value: "main" }),
    wall: async () => ({ kind: "ok", value: "" }),
    ...over,
  };
}

type Ran = { readonly code: number; readonly out: string; readonly err: string; readonly asked: readonly string[] };

async function init(
  dir: string,
  opts: {
    readonly yes?: boolean;
    readonly replies?: readonly string[];
    readonly env?: NodeJS.ProcessEnv;
    readonly probes?: Partial<Probes>;
    readonly project?: string;
  } = {},
): Promise<Ran> {
  let out = "";
  let err = "";
  const asked: string[] = [];
  const replies = [...(opts.replies ?? [])];
  const io: InitIo = {
    env: { ...GIT_ENV, ...opts.env },
    out: (t) => (out += t),
    err: (t) => (err += t),
    home,
    ...(opts.replies === undefined
      ? {}
      : {
          readLine: async (prompt: string) => {
            asked.push(prompt);
            return replies.shift() ?? "";
          },
        }),
    probes: probes(opts.probes),
    markets: { chiyanram: market() },
  };
  const code = await initCommand({ project: opts.project, dir, yes: opts.yes === true }, io);
  return { code, out, err, asked };
}

function token(expiresAt: string): void {
  writeFileSync(join(home, "tokens.json"), JSON.stringify({ claude: { madeAt: "2026-11-01", expiresAt } }));
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("init reads the clone (#369)", () => {
  it("reads the host and the project from origin, in each URL form", () => {
    expect(parseRemote("https://github.com/chiyanram/ledger.git")).toEqual({
      host: "github.com",
      path: "chiyanram/ledger",
    });
    expect(parseRemote("git@github.com:chiyanram/ledger.git")).toEqual({
      host: "github.com",
      path: "chiyanram/ledger",
    });
    expect(parseRemote("ssh://git@gitlab.example.com:2222/group/sub/app.git")).toEqual({
      host: "gitlab.example.com",
      path: "group/sub/app",
    });
    expect(parseRemote("https://gitlab.com/group/app")).toEqual({ host: "gitlab.com", path: "group/app" });
    expect(parseRemote("/srv/repo.git")).toBe("bad");
    expect(parseRemote("https://github.com/onlyowner")).toBe("bad");
    expect(hostOf("github.com")).toEqual({ kind: "github", name: "" });
    expect(hostOf("gitlab.com")).toEqual({ kind: "gitlab", name: "" });
    expect(hostOf("git.example.com")).toEqual({ kind: "gitlab", name: "git.example.com" });
  });

  it("detects the ledger: Gradle, its ITs, Flyway, CI and mise's JDK", async () => {
    const got = await detect(join(ledger(), "src", "test"), GIT_ENV);
    expect(got).toMatchObject({
      kind: "ok",
      value: {
        clone: join(root, "ledger"),
        name: "ledger",
        host: "github",
        hostName: "",
        project: "chiyanram/ledger",
        builds: [
          {
            name: "Gradle",
            programs: ["./gradlew"],
            egress: ["repo.maven.apache.org", "repo1.maven.org", ".gradle.org"],
          },
        ],
        oneWayDoor: [{ glob: "src/main/resources/db/migration/**", tool: "Flyway" }],
        ci: [".github/workflows/check.yml"],
        toolchain: { file: "mise.toml", manager: "mise", tools: [{ name: "java", version: "27" }] },
      },
    });
    // the built-in test globs already hold the ITs, so the project file needs no testFiles
    expect(got).toMatchObject({ value: { integrationTests: true, testFiles: "default" } });
  });

  it.each([
    [{ mvnw: "", "pom.xml": "" }, "Maven", ["./mvnw"], ["repo.maven.apache.org", "repo1.maven.org"]],
    [{ "pom.xml": "" }, "Maven", ["mvn"], ["repo.maven.apache.org", "repo1.maven.org"]],
    [{ "package.json": "{}" }, "npm", ["npm"], [".npmjs.org"]],
    [{ Makefile: "test:\n" }, "make", ["make"], []],
  ])("detects the build tool %#", async (files, name, programs, egress) => {
    const got = await detect(clone("app", files, "git@git.example.com:group/app.git"), GIT_ENV);
    expect(got).toMatchObject({
      kind: "ok",
      value: {
        host: "gitlab",
        hostName: "git.example.com",
        project: "group/app",
        builds: [{ name, programs, egress }],
      },
    });
    expect(got.kind === "ok" && got.value.testFiles).toBe("default");
  });

  it("finds Liquibase one module down, and no CI", async () => {
    const dir = clone("multi", { "api/src/main/resources/db/changelog/a.xml": "" }, "https://gitlab.com/g/multi.git");
    expect(await detect(dir, GIT_ENV)).toMatchObject({
      kind: "ok",
      value: { host: "gitlab", hostName: "", oneWayDoor: [{ glob: "api/src/main/resources/db/changelog/**" }], ci: [] },
    });
  });

  it("reads each toolchain file's tools", () => {
    expect(
      toolsOf(
        "mise.toml",
        '[env]\nX = "1"\n[tools]\njava = "temurin-27"\nnode = ["22"]\ngo = { version = "1.23" }\n[x]\nruby = "3"',
      ),
    ).toEqual([
      { name: "java", version: "temurin-27" },
      { name: "node", version: "22" },
      { name: "go", version: "1.23" },
    ]);
    expect(toolsOf(".tool-versions", "java temurin-27.0.1\n# c\nnodejs 22.1.0\n")).toEqual([
      { name: "java", version: "temurin-27.0.1" },
      { name: "nodejs", version: "22.1.0" },
    ]);
    expect(toolsOf(".sdkmanrc", "java=27.0.1-tem\n")).toEqual([{ name: "java", version: "27.0.1-tem" }]);
    expect(projectName("/w/My Ledger!")).toBe("My-Ledger-");
  });

  it("refuses a folder that is not a clone, and a clone with no origin", async () => {
    mkdirSync(join(root, "plain"));
    expect(await init(join(root, "plain"), { yes: true })).toMatchObject({
      code: 1,
      err: expect.stringContaining("not a git clone"),
    });
    const bare = join(root, "bare");
    mkdirSync(bare);
    git(bare, ["init", "-q"]);
    expect(await init(bare, { yes: true })).toMatchObject({
      code: 1,
      err: expect.stringContaining("no origin remote"),
    });
  });
});

describe("the round (#369)", () => {
  const QS: readonly Question[] = [
    {
      id: "a",
      text: "a?",
      choices: [
        { label: "x", value: 1 },
        { label: "y", value: 2 },
      ],
      recommended: 0,
    },
    {
      id: "b",
      text: "b?",
      choices: [
        { label: "x", value: 1 },
        { label: "y", value: 2 },
        { label: "z", value: 3 },
      ],
      recommended: 1,
    },
  ];

  it("takes every recommendation on Enter or accept all, and a letter per question otherwise", () => {
    expect(answersOf(QS, "")).toEqual({ kind: "ok", picks: [0, 1] });
    expect(answersOf(QS, "accept all")).toEqual({ kind: "ok", picks: [0, 1] });
    expect(answersOf(QS, "2c")).toEqual({ kind: "ok", picks: [0, 2] });
    expect(answersOf(QS, "1B, 2 A")).toEqual({ kind: "ok", picks: [1, 0] });
    expect(answersOf(QS, "1D")).toEqual({ kind: "bad", why: "question 1 has no choice D" });
    expect(answersOf(QS, "3A")).toMatchObject({ kind: "bad" });
  });
});

describe("agent-factory init --yes on the ledger (#369)", () => {
  it("writes the project file and user.json, pins the plugin, and every check passes", async () => {
    token("2027-11-01T00:00:00Z");
    const dir = ledger();
    const ran = await init(dir, { yes: true });
    expect(ran.err).toBe("");
    expect(ran.code).toBe(0);
    expect(json(join(home, "user.json"))).toEqual({ runner: "srt" });
    const file = json(projectPath(home, "ledger"));
    expect(file).toMatchObject({
      gitHost: "github",
      gitHostProject: "chiyanram/ledger",
      clone: dir,
      gate: "forge-ci",
      ready: { programs: ["./gradlew"] },
      egress: { allow: ["api.anthropic.com", "repo.maven.apache.org", "repo1.maven.org", ".gradle.org"] },
      lanes: { oneWayDoor: ["src/main/resources/db/migration/**"] },
      plugins: ["rulebook@chiyanram"],
      connectors: {},
    });
    expect(file).not.toHaveProperty("verify");
    expect(json(join(home, "projects", "ledger.plugins.json"))).toHaveProperty(["rulebook@chiyanram", "sha256"]);
    expect(ran.out).toContain("1. Which project on the git host is this clone?");
    expect(ran.out).toContain("(recommended)");
    expect(ran.out).toContain(`✓ srt ${SRT_VERSION}, the pinned version`);
    expect(ran.out).toContain("✓ java: mise 27.0.1, as mise.toml declares");
    expect(ran.out).toContain("✓ config check ledger: settings ok");
    expect(ran.out).toContain("agent-factory onboard ledger");
    expect(ran.out.indexOf("agent-factory onboard ledger")).toBeLessThan(ran.out.indexOf("agent-factory start ledger"));
    expect(ran.out).toContain("agent-factory coordinator ledger");
    // its settings now resolve with no FACTORY_* variable at all
    const settings = await runSettings({ home, project: "ledger", env: {} });
    expect(settings).toMatchObject({
      kind: "ok",
      value: {
        env: { FACTORY_FORGE: "github", FACTORY_PROJECT: "chiyanram/ledger", FACTORY_REPO: dir, FACTORY_BOX: "srt" },
      },
    });
  });

  it("a rerun asks nothing, writes nothing and passes again", async () => {
    token("2027-11-01T00:00:00Z");
    const dir = ledger();
    await init(dir, { yes: true });
    const before = readFileSync(projectPath(home, "ledger"), "utf8");
    const again = await init(dir, { replies: [] });
    expect(again.code).toBe(0);
    expect(again.asked).toEqual([]);
    expect(again.out).toContain("Nothing to ask");
    expect(again.out).not.toContain("wrote ");
    expect(again.out).toContain(`${projectPath(home, "ledger")}: no change`);
    expect(again.out).toContain("plugin rulebook@chiyanram pinned at");
    expect(readFileSync(projectPath(home, "ledger"), "utf8")).toBe(before);
  });

  it("shows a changed value as a diff: --yes keeps it (exit 3), a yes replaces it, a list only grows", async () => {
    token("2027-11-01T00:00:00Z");
    const dir = ledger();
    await init(dir, { yes: true });
    const path = projectPath(home, "ledger");
    const text = readFileSync(path, "utf8");
    writeFileSync(path, text.replace(JSON.stringify(dir), '"/old/ledger"').replace('"./gradlew"', '"make"'));
    const kept = await init(dir, { yes: true });
    expect(kept.code).toBe(3);
    expect(kept.out).toContain(`~ clone: "/old/ledger" -> ${JSON.stringify(dir)}`);
    expect(kept.out).toContain('~ ready.programs: ["make"] -> ["make","./gradlew"]');
    expect(json(path)).toMatchObject({ clone: "/old/ledger", ready: { programs: ["make"] } });
    const no = await init(dir, { replies: ["n", "y"] });
    expect(no.asked[0]).toContain("Replace the 2 value(s)");
    expect(json(path)).toMatchObject({ clone: "/old/ledger" });
    const yes = await init(dir, { replies: ["y"] });
    expect(yes.code).toBe(0);
    expect(json(path)).toMatchObject({ clone: dir, ready: { programs: ["make", "./gradlew"] } });
  });

  it("asks only what is missing, and takes the answers given", async () => {
    token("2027-11-01T00:00:00Z");
    const dir = ledger();
    writeFileSync(join(home, "user.json"), JSON.stringify({ runner: "srt" }));
    const ran = await init(dir, { replies: ["2B 3B 4B", "y"] });
    expect(ran.out).not.toContain("Where do runs run");
    expect(json(projectPath(home, "ledger"))).toMatchObject({
      gate: "local",
      verify: ["./gradlew", "check"],
      plugins: [],
    });
    expect(json(projectPath(home, "ledger"))).not.toHaveProperty("lanes");
  });

  it("refuses: off a terminal without --yes, a stop answer, a project file it cannot read", async () => {
    const dir = ledger();
    expect(await init(dir)).toMatchObject({ code: 1, err: expect.stringContaining("pass --yes") });
    expect(await init(dir, { replies: ["1B"] })).toMatchObject({
      code: 1,
      err: expect.stringContaining("nothing was written"),
    });
    mkdirSync(join(home, "projects"));
    writeFileSync(projectPath(home, "ledger"), "{ not json");
    expect(await init(dir, { yes: true })).toMatchObject({ code: 1, err: expect.stringContaining("fix it by hand") });
    expect(readFileSync(projectPath(home, "ledger"), "utf8")).toBe("{ not json");
    expect(await init(dir, { yes: true, project: "../x" })).toMatchObject({
      code: 1,
      err: expect.stringContaining("plain project name"),
    });
  });

  it("refuses to write a result config check refuses, such as FACTORY_FORGE set to another git host", async () => {
    const ran = await init(ledger(), { yes: true, env: { FACTORY_FORGE: "gitlab" } });
    expect(ran).toMatchObject({ code: 1, err: expect.stringContaining("gitHost") });
    expect(ran.err).toContain("nothing was written");
  });

  it("prints a ✗ with its fix, and never reads the token: srt off the pin, no token, a git host login that fails", async () => {
    const ran = await init(ledger(), {
      yes: true,
      probes: {
        run: async () => ({ code: 0, stdout: "0.0.81\n", stderr: "" }),
        gitHost: async () => ({ kind: "failed", reason: "HTTP 401" }),
        wall: async () => ({ kind: "failed", reason: "no coordinator settings" }),
      },
    });
    expect(ran.code).toBe(1);
    expect(ran.out).toContain(`✗ srt is "0.0.81", not the pinned ${SRT_VERSION}`);
    expect(ran.out).toContain(`fix: npm install --global --omit=optional @anthropic-ai/sandbox-runtime@${SRT_VERSION}`);
    expect(ran.out).toContain("✗ claude token: none on record");
    expect(ran.out).toContain("fix: claude setup-token, then agent-factory setup claude");
    expect(ran.out).toContain("fix: gh auth login");
    expect(ran.out).toContain("fix: agent-factory setup coordinator");
  });
});

describe("the toolchain check names the manager that wins (#369, friction row 4)", () => {
  it("reads a manager and a version from a program's real path", () => {
    expect(owner(`${USER_HOME}/.sdkman/candidates/java/25.0.1-tem/bin/java`, USER_HOME)).toEqual({
      manager: "SDKMAN!",
      version: "25.0.1-tem",
    });
    expect(owner("/usr/bin/java", USER_HOME)).toBe("none");
    expect([majorOf("temurin-27.0.1"), majorOf("25.0.1-tem"), majorOf("latest")]).toEqual(["27", "25", ""]);
  });

  it("SDKMAN!'s Java 25 first on PATH while mise declares 27 is a ✗ with the fix", async () => {
    const sdk = `${USER_HOME}/.sdkman/candidates/java/25.0.1-tem/bin/java`;
    const check = await toolCheck(
      probes({ which: async () => ({ found: `${USER_HOME}/.sdkman/candidates/java/current/bin/java`, real: sdk }) }),
      { file: "mise.toml", manager: "mise", tools: [] },
      { name: "java", version: "27" },
    );
    expect(check).toMatchObject({ ok: false, line: expect.stringContaining("SDKMAN!'s 25.0.1-tem") });
    expect(check !== "skip" && check.fix).toContain("mise activate");
    expect(
      await toolCheck(probes(), { file: "mise.toml", manager: "mise", tools: [] }, { name: "rust", version: "1" }),
    ).toBe("skip");
  });
});

describe("the project's identity in the settings layers (#369)", () => {
  const project = (value: object): { path: string; text: string; value: object } => ({
    path: projectPath(home, "ledger"),
    text: JSON.stringify(value),
    value,
  });
  const FILE = { gitHost: "github", gitHostProject: "chiyanram/ledger", clone: "/w/ledger" };

  it("the variables still win, with a warning that names the file", async () => {
    const got = await layered({
      home,
      env: { FACTORY_PROJECT: "chiyanram/other", FACTORY_REPO: "/w/ledger" },
      project: project(FILE),
    });
    expect(refusals(got)).toBe("");
    expect(got.values.find((r) => r.key.id === "gitHostProject")).toMatchObject({ value: "chiyanram/other" });
    expect(got.problems).toEqual([
      expect.objectContaining({ level: "warning", text: expect.stringContaining("FACTORY_PROJECT") }),
    ]);
  });

  it("a team or user file may not set them, and a bad value is refused", async () => {
    writeFileSync(join(home, "user.json"), JSON.stringify({ clone: "/w/ledger" }));
    expect(refusals(await layered({ home, env: {}, project: project({}) }))).toContain("names one project's own place");
    rmSync(join(home, "user.json"));
    expect(refusals(await layered({ home, env: {}, project: project({ clone: "ledger" }) }))).toContain("clone in");
    expect(refusals(await layered({ home, env: {}, project: project({ gitHostProject: "ledger" }) }))).toContain(
      "gitHostProject in",
    );
  });
});

describe("agent-factory init on the command line (#369)", () => {
  it("runs no program but its probes' and no human-only command, and needs an absolute --repo", async () => {
    const dir = ledger();
    // the marketplace is already cloned, so nothing reaches the network
    execFileSync("git", ["clone", "-q", market(), join(home, "marketplaces", "chiyanram")], { env: GIT_ENV });
    const calls: string[] = [];
    const errs: string[] = [];
    let secretAsked = false;
    const run = async (argv: readonly string[]): Promise<number> =>
      runCli(argv, {
        env: { ...GIT_ENV, FACTORY_HOME: home },
        out: () => undefined,
        err: (t) => errs.push(t),
        readSecret: async () => ((secretAsked = true), ""),
        readStdin: async () => "",
        system: {
          platform: "linux",
          uid: 0,
          gid: 0,
          run: async (call) => (calls.push([call.bin, ...call.args].join(" ")), { code: 1, stdout: "", stderr: "no" }),
          interactive: async () => 0,
          background: async () => ({ kind: "failed", reason: "no" }),
        },
      });
    expect(await run(["init", "--repo", "ledger"])).toBe(64);
    errs.length = 0;
    expect({ code: await run(["init", "--repo", dir, "--yes"]), errs }).toMatchObject({ code: 1 });
    expect(errs.join("")).not.toContain("agent-factory init:");
    expect(json(projectPath(home, "ledger"))).toMatchObject({ gitHostProject: "chiyanram/ledger" });
    expect(secretAsked).toBe(false);
    expect(calls.filter((c) => /\b(setup|onboard|start|approve|waive)\b/.test(c))).toEqual([]);
  });
});
