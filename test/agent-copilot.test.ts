import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  copilotArgs,
  copilotEnv,
  copilotModel,
  readCopilotAnswer,
  type CopilotSetup,
} from "../src/core/agent/copilot.js";
import { endLive, type FolderCall } from "../src/core/agent/folder.js";
import { openCopilotCli } from "../src/core/agent/index.js";
import { COPILOT_ON } from "../src/core/agent/switch.js";
import type { BoxToken } from "../src/core/token/index.js";
import type { ModelRun } from "../src/core/review/model.js";
import { tempDir } from "./temp.js";
import { stopOnceStarted } from "./started-first.js";

const made: string[] = [];
afterEach(() => {
  endLive();
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function folder(): string {
  const dir = tempDir("copilot-");
  made.push(dir);
  return dir;
}

const COPILOT_FLAGS_NEVER: readonly string[] = [
  "--allow-all",
  "--yolo",
  "--allow-all-paths",
  "--allow-all-tools",
  "--allow-all-urls",
  "--allow-url",
  "--trust-folder",
  "--add-dir",
  "--plugin-dir",
  "--agent",
];

const PAT = `github_pat_11ABCDEFG0${"a1B2_".repeat(16)}`;
const SCHEMA = JSON.stringify({
  type: "object",
  required: ["findings"],
  properties: { findings: { type: "array", items: { type: "string" } } },
  additionalProperties: false,
});

function runIn(dir: string, over: Partial<ModelRun> = {}): ModelRun {
  return {
    folder: dir,
    model: "opus",
    schema: SCHEMA,
    prompt: "Review ./code against ./pack.md.",
    name: "reviewer-12",
    maxUsd: "2",
    limit: { minutes: 20, setting: "FACTORY_FINDER_MINUTES" },
    ...over,
  };
}

const READY: BoxToken = { kind: "ready", env: { COPILOT_GITHUB_TOKEN: PAT }, notice: { kind: "none" } };

const HOST_ENV: NodeJS.ProcessEnv = {
  PATH: "/usr/bin",
  HOME: "/home/me",
  USER: "me",
  LANG: "en_US.UTF-8",
  LC_ALL: "C",
  HTTPS_PROXY: "http://proxy:3128",
  SSL_CERT_FILE: "/etc/ca.pem",
  GH_TOKEN: "ghp_host",
  GITHUB_TOKEN: "ghs_host",
  GH_HOST: "github.example",
  COPILOT_GITHUB_TOKEN: "github_pat_from_the_host_env",
  COPILOT_ALLOW_ALL: "true",
  ANTHROPIC_API_KEY: "sk-ant-host",
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-host",
  FACTORY_HOME: "/home/me/.factory",
};

describe("copilotArgs (#690)", () => {
  it("runs -p silent, with no self-update, no MCP, no questions, no branch instructions, no temp folder", () => {
    expect(copilotArgs(runIn("/x"), { home: "/h", aiCredits: "" })).toEqual([
      "-p",
      expect.stringContaining("Review ./code against ./pack.md."),
      "-s",
      "--no-auto-update",
      "--disable-builtin-mcps",
      "--no-ask-user",
      "--no-custom-instructions",
      "--disallow-temp-dir",
      "--available-tools",
      "view,grep,glob",
      "--secret-env-vars",
      "COPILOT_GITHUB_TOKEN",
      "--usage-output-file",
      "/h/usage.json",
    ]);
  });

  it("asks for one JSON value that matches the run's schema", () => {
    const prompt = copilotArgs(runIn("/x"), { home: "/h", aiCredits: "" })[1];
    expect(prompt).toBe(
      `Review ./code against ./pack.md.\n\nAnswer with one JSON value that matches this JSON schema, and nothing else:\n${SCHEMA}`,
    );
  });

  it("maps the card's tools to Copilot's, narrowing, never widening", () => {
    const args = (tools: readonly string[]) =>
      copilotArgs(runIn("/x", { tools }), { home: "/h", aiCredits: "" }).join(" ");
    expect(args(["Read"])).toContain("--available-tools view ");
    expect(args(["Grep", "Glob"])).toContain("--available-tools grep,glob ");
    expect(args(["Read", "Bash", "Edit"])).toContain("--available-tools view ");
  });

  it("starts nothing when the card leaves no read-only tool, so an empty list never reaches the CLI", async () => {
    const fake = fakeRunner({ code: 0, stdout: "{}" });
    expect(await copilotModel(setupWith(fake.run))(runIn(folder(), { tools: ["Edit"] }))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("no read-only tool"),
    });
    expect(fake.calls).toEqual([]);
  });

  it("passes caps.aiCreditsPerRun as --max-ai-credits, never the claude model or dollar cap", () => {
    const args = copilotArgs(runIn("/x"), { home: "/h", aiCredits: "40" });
    expect(args.slice(-2)).toEqual(["--max-ai-credits", "40"]);
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--max-budget-usd");
    expect(args).not.toContain("opus");
  });

  it("never passes a flag that widens its reach, whatever the run asks", () => {
    for (const tools of [undefined, [], ["Read", "Grep", "Glob", "Edit", "Bash"]]) {
      for (const aiCredits of ["", "30"]) {
        const args = copilotArgs(runIn("/x", tools === undefined ? {} : { tools }), { home: "/h", aiCredits });
        for (const flag of COPILOT_FLAGS_NEVER) {
          expect(args).not.toContain(flag);
        }
      }
    }
    expect(COPILOT_FLAGS_NEVER).toEqual(
      expect.arrayContaining([
        "--allow-all",
        "--yolo",
        "--allow-all-paths",
        "--allow-all-tools",
        "--allow-url",
        "--trust-folder",
      ]),
    );
  });
});

describe("copilotEnv (#690; ADR-0012 S6, S15)", () => {
  it("is an allowlist: the private home, the stored token, and no git host token or host login", () => {
    expect(copilotEnv(HOST_ENV, "/h", READY)).toEqual({
      PATH: "/usr/bin",
      USER: "me",
      LANG: "en_US.UTF-8",
      LC_ALL: "C",
      HTTPS_PROXY: "http://proxy:3128",
      SSL_CERT_FILE: "/etc/ca.pem",
      HOME: "/h",
      COPILOT_HOME: "/h/.copilot",
      TMPDIR: "/h",
      COPILOT_AUTO_UPDATE: "false",
      AGENT_FACTORY_MODEL_RUN: "1",
      COPILOT_GITHUB_TOKEN: PAT,
    });
  });
});

describe("readCopilotAnswer (#690)", () => {
  const ok = (stdout: string) => readCopilotAnswer({ code: 0, stdout, stderr: "" }, SCHEMA);

  it("reads one JSON value, alone or in one json fence, and leaves its cost unmeasured, never $0", () => {
    for (const out of [
      '{"findings":["a"]}\n',
      '```json\n{"findings":["a"]}\n```\n',
      '```json\r\n{"findings":["a"]}\r\n```\r\n',
    ]) {
      expect(ok(out)).toEqual({
        kind: "ok",
        value: { output: { findings: ["a"] }, answer: { findings: ["a"] }, spend: "unmeasured", stream: out },
      });
    }
  });

  it("fails an answer that is not JSON, or does not match the schema, with the reason", () => {
    expect(ok("Here are the findings: none")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("not one JSON value"),
    });
    expect(ok('{"findings":[1]}')).toMatchObject({ kind: "failed", reason: expect.stringContaining("findings") });
    expect(ok('{"findings":[],"extra":1}')).toMatchObject({ kind: "failed", reason: expect.stringContaining("extra") });
  });

  it("names how a failed run ended: a non-zero exit, an answer that is not JSON, one off its schema", () => {
    expect(readCopilotAnswer({ code: 1, stdout: "", stderr: "Error" }, SCHEMA)).toMatchObject({ end: "launch_failed" });
    expect(ok("Here are the findings: none")).toMatchObject({ end: "output_invalid" });
    expect(ok('{"findings":[1]}')).toMatchObject({ end: "output_invalid" });
  });

  it("keeps stderr in the trace of a run that failed", () => {
    const failed = readCopilotAnswer({ code: 1, stdout: "partial", stderr: "line one\nline two" }, SCHEMA);
    expect(failed.kind === "failed" && failed.stream).toBe("partial\nline one\nline two");
  });

  it("fails a run that exited non-zero with stderr's first line", () => {
    expect(
      readCopilotAnswer({ code: 1, stdout: "", stderr: "Error: No authentication information found.\nmore" }, SCHEMA),
    ).toMatchObject({
      kind: "failed",
      reason: "copilot exited 1: Error: No authentication information found.",
    });
  });
});

function fakeRunner(answer: { code: number; stdout: string; stderr?: string }) {
  const calls: { call: FolderCall; homeHeld: readonly string[]; homeMode: number }[] = [];
  const run = async (call: FolderCall) => {
    const home = call.env.HOME ?? "";
    calls.push({ call, homeHeld: readdirSync(home), homeMode: statSync(home).mode & 0o777 });
    writeFileSync(join(home, "usage.json"), '{"credits":1}');
    return { code: answer.code, stdout: answer.stdout, stderr: answer.stderr ?? "" };
  };
  return { run, calls };
}

function onlyOf<T>(items: readonly T[]): T {
  const [only] = items;
  if (only === undefined || items.length !== 1) {
    throw new Error(`expected one item, got ${items.length}`);
  }
  return only;
}

function setupWith(run: CopilotSetup["run"], login: BoxToken = READY, over: Partial<CopilotSetup> = {}): CopilotSetup {
  return {
    bin: "copilot",
    env: HOST_ENV,
    run,
    minuteMs: 60_000,
    login: async () => login,
    aiCredits: "",
    tempRoot: folder(),
    ...over,
  };
}

describe("copilotModel (#690)", () => {
  it("runs in the run's folder with a fresh, private, empty home, removed after the run", async () => {
    const dir = folder();
    const fake = fakeRunner({ code: 0, stdout: '{"findings":[]}' });
    const result = await copilotModel(setupWith(fake.run))(runIn(dir));
    expect(result).toMatchObject({ kind: "ok", value: { output: { findings: [] }, spend: "unmeasured" } });
    expect(fake.calls).toHaveLength(1);
    const { call, homeHeld, homeMode } = onlyOf(fake.calls);
    const home = String(call.env.HOME);
    expect(call).toMatchObject({ bin: "copilot", cwd: dir });
    expect([homeHeld, homeMode]).toEqual([[], 0o700]);
    expect(home).not.toBe(HOST_ENV.HOME);
    expect(call.env.COPILOT_GITHUB_TOKEN).toBe(PAT);
    expect(call.args).toContain(`${home}/usage.json`);
    expect(existsSync(home)).toBe(false);
  });

  it("keeps the usage file's raw text in the trace", async () => {
    const fake = fakeRunner({ code: 0, stdout: '{"findings":[]}' });
    const result = await copilotModel(setupWith(fake.run))(runIn(folder()));
    expect(result.kind === "ok" && result.value.stream).toContain('{\\"credits\\":1}');
  });

  it("removes the private home after a failed run too", async () => {
    const fake = fakeRunner({ code: 2, stdout: "", stderr: "boom" });
    expect(await copilotModel(setupWith(fake.run))(runIn(folder()))).toMatchObject({ kind: "failed" });
    expect(existsSync(fake.calls[0]?.call.env.HOME ?? "/")).toBe(false);
  });

  it("answers failed, never throws, when its private home cannot be made", async () => {
    const fake = fakeRunner({ code: 0, stdout: "{}" });
    const run = copilotModel(setupWith(fake.run, READY, { tempRoot: "/nonexistent/for/this/test" }));
    expect(await run(runIn(folder()))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("private home"),
    });
    expect(fake.calls).toEqual([]);
  });

  it("starts nothing without a valid copilot token on record", async () => {
    const fake = fakeRunner({ code: 0, stdout: "{}" });
    const refused: BoxToken = {
      kind: "refused",
      reason: "no copilot token in the store; run: agent-factory setup copilot",
    };
    expect(await copilotModel(setupWith(fake.run, refused))(runIn(folder()))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("setup copilot"),
    });
    expect(fake.calls).toEqual([]);
  });

  it("starts nothing for a schema whose keywords the checker does not run", async () => {
    const fake = fakeRunner({ code: 0, stdout: "{}" });
    const schema = JSON.stringify({ type: "object", properties: { n: { type: "number", minimum: 0 } } });
    expect(await copilotModel(setupWith(fake.run))(runIn(folder(), { schema }))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("minimum"),
    });
    expect(fake.calls).toEqual([]);
  });

  it("stops a copilot that never exits at its limit, with everything it started, and removes the home", async () => {
    const dir = folder();
    const bin = join(dir, "copilot");
    const pidFile = join(dir, "grandchild.pid");
    writeFileSync(
      bin,
      `#!/bin/sh\necho "$HOME" > ${join(dir, "home")}\n/bin/sleep 600 &\necho $! > ${pidFile}\nwait\n`,
    );
    chmodSync(bin, 0o755);
    const run = copilotModel(setupWith(stopOnceStarted(pidFile), READY, { bin, minuteMs: 300 }));
    const result = await run(runIn(dir, { limit: { minutes: 1, setting: "FACTORY_FINDER_MINUTES" } }));
    expect(result).toMatchObject({
      kind: "failed",
      reason: "stopped at its 1-minute limit (FACTORY_FINDER_MINUTES)",
      end: "timed_out",
    });
    expect(await gone(Number(readFile(pidFile)))).toBe(true);
    expect(existsSync(readFile(join(dir, "home")).trim())).toBe(false);
  });
});

describe("openCopilotCli and the switch (#690)", () => {
  it("starts FACTORY_COPILOT, else copilot", async () => {
    const fake = fakeRunner({ code: 0, stdout: '{"findings":[]}' });
    const login = async () => READY;
    await openCopilotCli({
      env: { ...HOST_ENV, FACTORY_COPILOT: "/opt/copilot" },
      login,
      aiCredits: "",
      run: fake.run,
    }).readOnly(runIn(folder()));
    await openCopilotCli({ env: HOST_ENV, login, aiCredits: "", run: fake.run }).readOnly(runIn(folder()));
    expect(fake.calls.map((c) => c.call.bin)).toEqual(["/opt/copilot", "copilot"]);
  });

  it("keeps both Copilot run kinds off until a real run is checked (#697, #698)", () => {
    expect(COPILOT_ON).toEqual({ readOnly: false, writer: false });
  });
});

function readFile(path: string): string {
  return readFileSync(path, "utf8");
}

async function gone(pid: number): Promise<boolean> {
  const alive = (): boolean => {
    const stat = join("/proc", String(pid), "stat");
    if (existsSync("/proc/self/stat")) {
      return existsSync(stat) && !/^\d+ \(.*\) Z/.test(readFileSync(stat, "utf8"));
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 50 && alive(); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  return !alive();
}
