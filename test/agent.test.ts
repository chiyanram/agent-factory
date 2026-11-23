import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeArgs, claudeEnv, readAnswer } from "../src/core/agent/claude.js";
import { endLive, runInFolder, type FolderCall } from "../src/core/agent/folder.js";
import { openAgentCli } from "../src/core/agent/index.js";
import { LIMIT_DEFAULT, LIMIT_MOST, limitOf, type LimitId } from "../src/core/agent/limits.js";
import { EXTENSION_POINTS, readDescribe } from "../src/core/plugin/contract.js";
import type { ModelRun } from "../src/core/review/model.js";
import { settingName } from "../src/core/settings/machine.js";
import { tempDir } from "./temp.js";
import { stopOnceExited, stopOnceStarted } from "./started-first.js";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function folder(): string {
  const dir = tempDir("agent-");
  made.push(dir);
  return dir;
}

function hangingClaude(dir: string): { readonly bin: string; readonly pidFile: string } {
  const bin = join(dir, "claude");
  const pidFile = join(dir, "grandchild.pid");
  writeFileSync(bin, `#!/bin/sh\necho '{"type":"system","subtype":"init"}'\nsleep 600 &\necho $! > ${pidFile}\nwait\n`);
  chmodSync(bin, 0o755);
  return { bin, pidFile };
}

function statOf(pid: number): string {
  try {
    return readFileSync(join("/proc", String(pid), "stat"), "utf8");
  } catch {
    return "";
  }
}

function alive(pid: number): boolean {
  if (existsSync("/proc/self/stat")) {
    const stat = statOf(pid);
    return stat !== "" && !/^\d+ \(.*\) Z/.test(stat);
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function gone(pid: number): Promise<boolean> {
  for (let i = 0; i < 50 && alive(pid); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  return !alive(pid);
}

const RUN: ModelRun = {
  folder: "/x",
  model: "opus",
  schema: "{}",
  prompt: "P",
  name: "reviewer-12",
  maxUsd: "2",
  limit: { minutes: 20, setting: "FACTORY_FINDER_MINUTES" },
};

const KINDS: readonly (readonly [string, LimitId, string])[] = [
  ["finder", "review.finderMinutes", "FACTORY_FINDER_MINUTES"],
  ["verify pass", "review.verifyMinutes", "FACTORY_VERIFY_MINUTES"],
  ["design-reviewer", "design.minutes", "FACTORY_DESIGN_MINUTES"],
  ["onboarder", "onboard.minutes", "FACTORY_ONBOARD_MINUTES"],
  ["retro draft", "retro.minutes", "FACTORY_RETRO_MINUTES"],
  ["eval judge", "eval.judgeMinutes", "FACTORY_JUDGE_MINUTES"],
];

describe("limitOf (ADR-0012 S7, P7)", () => {
  it.each(KINDS)("reads the %s run's limit from %s, 20 minutes by default, at most 60", (_, id, variable) => {
    expect(settingName(id)).toBe(variable);
    expect(LIMIT_DEFAULT).toBe(20);
    expect(LIMIT_MOST).toBe(60);
    expect(limitOf({}, id)).toEqual({ kind: "ok", value: { minutes: 20, setting: variable } });
    expect(limitOf({ [variable]: "7" }, id)).toEqual({ kind: "ok", value: { minutes: 7, setting: variable } });
    expect(limitOf({ [variable]: "60" }, id)).toMatchObject({ kind: "ok" });
    for (const bad of ["61", "0", "x", "", "1.5"]) {
      expect(limitOf({ [variable]: bad }, id)).toEqual({
        kind: "failed",
        reason: `${variable} must be a whole number from 1 to 60`,
      });
    }
  });
});

describe("the Claude adapter's read-only run", () => {
  it.each(KINDS)(
    "stops a %s run that never exits at its limit, with everything it started, and records why",
    async (_, id, variable) => {
      const dir = folder();
      const stub = hangingClaude(dir);
      const limit = limitOf({ [variable]: "1" }, id);
      if (limit.kind === "failed") {
        throw new Error(limit.reason);
      }
      const agent = openAgentCli({
        env: { PATH: process.env.PATH, FACTORY_CLAUDE: stub.bin },
        run: stopOnceStarted(stub.pidFile),
        minuteMs: 300,
      });
      const began = Date.now();
      const ran = await agent.readOnly({ ...RUN, folder: dir, limit: limit.value });
      expect(Date.now() - began).toBeLessThan(5000);
      expect(ran).toMatchObject({
        kind: "failed",
        reason: `stopped at its 1-minute limit (${variable})`,
        stream: expect.stringContaining('"subtype":"init"'),
      });
      expect(await gone(Number(readFileSync(stub.pidFile, "utf8").trim()))).toBe(true);
    },
    10_000,
  );

  it("keeps the answer of a CLI that exited in time while a process it left held its output open past the limit", async () => {
    const dir = folder();
    const bin = join(dir, "claude");
    const pidFile = join(dir, "grandchild.pid");
    const result = { type: "result", is_error: false, structured_output: { ok: 1 }, total_cost_usd: 0.1 };
    const cliPid = join(dir, "cli.pid");
    writeFileSync(
      bin,
      `#!/bin/sh\necho $$ > ${cliPid}\necho '${JSON.stringify(result)}'\nsleep 600 &\necho $! > ${pidFile}\nexit 0\n`,
    );
    chmodSync(bin, 0o755);
    const agent = openAgentCli({
      env: { PATH: process.env.PATH, FACTORY_CLAUDE: bin },
      run: stopOnceExited(cliPid),
      minuteMs: 300,
    });
    const ran = await agent.readOnly({ ...RUN, folder: dir, limit: { minutes: 1, setting: "FACTORY_FINDER_MINUTES" } });
    expect(ran).toMatchObject({ kind: "ok", value: { output: { ok: 1 } } });
    expect(await gone(Number(readFileSync(pidFile, "utf8").trim()))).toBe(true);
  }, 10_000);

  it("ends a live run's group when this process exits or is signalled, and stops watching once none is live", async () => {
    const dir = folder();
    const stub = hangingClaude(dir);
    const before = process.listenerCount("SIGTERM");
    const stop = new AbortController();
    const ran = runInFolder({ bin: stub.bin, args: [], env: { PATH: process.env.PATH }, cwd: dir, stop: stop.signal });
    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    expect(process.listenerCount("SIGINT")).toBeGreaterThan(0);
    while (!existsSync(stub.pidFile)) {
      await new Promise((r) => setTimeout(r, 20));
    }
    endLive();
    expect((await ran).code).not.toBe(0);
    expect(await gone(Number(readFileSync(stub.pidFile, "utf8").trim()))).toBe(true);
    expect(process.listenerCount("SIGTERM")).toBe(before);
  }, 10_000);

  it("answers as before when the run ends within its limit", async () => {
    const dir = folder();
    const bin = join(dir, "claude");
    const result = { type: "result", is_error: false, structured_output: { ok: 1 }, total_cost_usd: 0.1 };
    writeFileSync(bin, `#!/bin/sh\necho '${JSON.stringify(result)}'\n`);
    chmodSync(bin, 0o755);
    const ran = await openAgentCli({ env: { PATH: process.env.PATH, FACTORY_CLAUDE: bin } }).readOnly({
      ...RUN,
      folder: dir,
    });
    expect(ran).toMatchObject({ kind: "ok", value: { output: { ok: 1 }, costUsd: 0.1 } });
  });

  it("calls FACTORY_CLAUDE with the argv, env and folder each call site gave before the seam, byte for byte", async () => {
    const calls: FolderCall[] = [];
    const env = { PATH: "/bin", HOME: "/h", GH_TOKEN: "t", FACTORY_REPO: "/r", FACTORY_CLAUDE: "/opt/claude" };
    const agent = openAgentCli({
      env,
      run: async (call) => {
        calls.push(call);
        return { code: 1, stdout: "", stderr: "" };
      },
    });
    await agent.readOnly({ ...RUN, tools: ["Glob", "Read"] });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.bin).toBe("/opt/claude");
    expect(call?.cwd).toBe("/x");
    expect(call?.env).toEqual({ PATH: "/bin", HOME: "/h", AGENT_FACTORY_MODEL_RUN: "1", DISABLE_AUTOUPDATER: "1" });
    expect(call?.args).toEqual([
      "-p",
      "-n",
      "reviewer-12",
      "--model",
      "opus",
      "--restricted",
      "--strict-mcp-config",
      "--tools",
      "Read,Glob",
      "--max-budget-usd",
      "2",
      "--output-format",
      "stream-json",
      "--verbose",
      "--json-schema",
      "{}",
      "P",
    ]);
  });

  it("reads claude from the PATH when FACTORY_CLAUDE is unset", async () => {
    const calls: FolderCall[] = [];
    await openAgentCli({
      env: { PATH: "/bin" },
      run: async (call) => {
        calls.push(call);
        return { code: 1, stdout: "", stderr: "" };
      },
    }).readOnly(RUN);
    expect(calls[0]?.bin).toBe("claude");
  });
});

describe("claudeArgs", () => {
  it("is restricted, with no MCP servers, Read, Grep and Glob only, a budget cap and a schema; never resumed", () => {
    const args = claudeArgs(RUN);
    expect(args).toEqual([
      "-p",
      "-n",
      "reviewer-12",
      "--model",
      "opus",
      "--restricted",
      "--strict-mcp-config",
      "--tools",
      "Read,Grep,Glob",
      "--max-budget-usd",
      "2",
      "--output-format",
      "stream-json",
      "--verbose",
      "--json-schema",
      "{}",
      "P",
    ]);
    expect(args.some((a) => /^--(resume|continue)$|^-c$|^-r$/.test(a))).toBe(false);
    expect(claudeArgs({ ...RUN, maxUsd: "" })).not.toContain("--max-budget-usd");
  });

  it("gives a role card's run the card's tools, which can narrow Read, Grep and Glob, never widen them (#232)", () => {
    expect(claudeArgs({ ...RUN, tools: ["Glob", "Read"] })).toContain("Read,Glob");
    expect(claudeArgs({ ...RUN, tools: ["Read", "Bash"] })).toContain("Read");
    expect(claudeArgs({ ...RUN, tools: ["Read", "Bash"] }).join(" ")).not.toContain("Bash");
  });

  it("puts no limit in the argv: the host keeps the time", () => {
    expect(claudeArgs({ ...RUN, limit: { minutes: 5, setting: "X" } })).toEqual(claudeArgs(RUN));
  });
});

describe("readAnswer", () => {
  it("fails a run with no result event, naming the first line of stderr", () => {
    expect(readAnswer({ code: 1, stdout: "", stderr: "boom\nmore" })).toMatchObject({ kind: "failed", reason: "boom" });
  });

  it("names the fix first when the login was refused (HTTP 401): this shell's claude login (#665)", () => {
    const stdout =
      '{"type":"result","subtype":"success","is_error":true,"api_error_status":401,"result":"Failed to authenticate. API Error: 401 OAuth access token is invalid."}\n';
    expect(readAnswer({ code: 1, stdout, stderr: "" })).toMatchObject({
      kind: "failed",
      reason:
        "the claude login was refused (HTTP 401); run claude and sign in with /login; unset a stale ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or CLAUDE_CODE_OAUTH_TOKEN in your shell; success: Failed to authenticate. API Error: 401 OAuth access token is invalid.",
    });
  });
});

describe("claudeEnv (ADR-0012 S6)", () => {
  it("hands the agent CLI no forge token and no factory setting", () => {
    expect(claudeEnv({ PATH: "/bin", GH_TOKEN: "t", FACTORY_REPO: "/r", ANTHROPIC_MODEL: "m" })).toEqual({
      PATH: "/bin",
      ANTHROPIC_MODEL: "m",
      AGENT_FACTORY_MODEL_RUN: "1",
      DISABLE_AUTOUPDATER: "1",
    });
  });

  it("marks the run as a model run, so the door seam refuses a person's word from it (#713)", () => {
    expect(claudeEnv({ AGENT_FACTORY_MODEL_RUN: "" })).toEqual({
      AGENT_FACTORY_MODEL_RUN: "1",
      DISABLE_AUTOUPDATER: "1",
    });
  });

  it("turns the CLI's self-update off, so no run updates its CLI mid-run (#902)", () => {
    expect(claudeEnv({ DISABLE_AUTOUPDATER: "0" }).DISABLE_AUTOUPDATER).toBe("1");
  });
});

describe("runInFolder", () => {
  it("runs the CLI with its stdin closed, so it never waits for input (#487)", async () => {
    const ran = await runInFolder({ bin: "cat", args: [], env: { PATH: process.env.PATH }, cwd: folder() });
    expect(ran).toEqual({ code: 0, stdout: "", stderr: "" });
  }, 3000);

  it("answers 127 for a program that cannot start, as a shell does", async () => {
    const ran = await runInFolder({ bin: join(folder(), "none"), args: [], env: {}, cwd: folder() });
    expect(ran.code).toBe(127);
    expect(ran.stderr).toMatch(/^cannot start .*: ENOENT/);
  });
});

describe("the Claude adapter's sessions list", () => {
  it("runs FACTORY_CLAUDE agents --json with the claude env, and reads the names", async () => {
    const calls: FolderCall[] = [];
    const sessions = openAgentCli({
      env: { PATH: "/bin", GH_TOKEN: "t", FACTORY_CLAUDE: "/opt/claude" },
      run: async (call) => {
        calls.push(call);
        return { code: 0, stdout: '[{"name":"writer-3"}]', stderr: "" };
      },
    }).sessions;
    expect(await sessions()).toEqual({ kind: "ok", value: ["writer-3"] });
    expect(calls[0]).toMatchObject({ bin: "/opt/claude", args: ["agents", "--json"], env: { PATH: "/bin" } });
  });

  it("fails closed when the list hangs past its limit, and stops it", async () => {
    const dir = folder();
    const stub = hangingClaude(dir);
    const sessions = openAgentCli({
      env: { PATH: process.env.PATH, FACTORY_CLAUDE: stub.bin },
      run: stopOnceStarted(stub.pidFile),
      sessionsMs: 300,
    }).sessions;
    expect(await sessions()).toEqual({
      kind: "failed",
      reason: "cannot list live runs: claude agents --json did not answer within its limit",
    });
    expect(existsSync(stub.pidFile) && (await gone(Number(readFileSync(stub.pidFile, "utf8").trim())))).toBe(true);
  }, 10_000);
});

describe("the plugin contract (ADR-0022)", () => {
  it("has no runner extension point: the agent CLI adapter lives in core", () => {
    expect(EXTENSION_POINTS).not.toContain("runner");
    const described = readDescribe(
      JSON.stringify({ protocol: 1, name: "x", version: "1", capabilities: [{ name: "runner" }] }),
    );
    expect(described.kind).toBe("failed");
  });
});
