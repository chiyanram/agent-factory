import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CANNOT_START } from "../src/core/agent/folder.js";
import { openAgentCli } from "../src/core/agent/index.js";
import { LOGIN_ARGS, loginOf, refusedLogin } from "../src/core/agent/login.js";
import { tempDir } from "./temp.js";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function folder(): string {
  const dir = tempDir("agent-login-");
  made.push(dir);
  return dir;
}

// What claude 2.1.326 printed for a revoked setup-token (`claude -p … --output-format stream-json --verbose`), trimmed
// to the fields the reader looks at, its session ids zeroed: it retried the 401 twice, then ended in 4 s with exit 1
const REFUSED = [
  '{"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"error_status":401,"error":"authentication_failed","session_id":"00000000-0000-0000-0000-000000000000"}',
  '{"type":"system","subtype":"api_retry","attempt":2,"max_retries":10,"error_status":401,"error":"authentication_failed","session_id":"00000000-0000-0000-0000-000000000000"}',
  '{"type":"result","subtype":"success","is_error":true,"api_error_status":401,"terminal_reason":"api_error","result":"Failed to authenticate. API Error: 401 OAuth access token is invalid.","total_cost_usd":0,"session_id":"00000000-0000-0000-0000-000000000000"}',
].join("\n");

// What the same CLI printed last for a login it accepted, trimmed the same way
const ACCEPTED =
  '{"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed","result":"ok","total_cost_usd":0.0083009,"session_id":"00000000-0000-0000-0000-000000000000"}';

const LIMIT = 60_000;

describe("loginOf (#665: only a real call says the login works)", () => {
  it("reads a 401 in the result event as refused, never as unknown", () => {
    expect(loginOf({ code: 1, stdout: REFUSED, stderr: "" }, false, LIMIT)).toEqual({ kind: "refused", status: 401 });
  });

  it("reads a result the CLI marked ok as authorized", () => {
    expect(loginOf({ code: 0, stdout: ACCEPTED, stderr: "" }, false, LIMIT)).toEqual({ kind: "authorized" });
  });

  it("never reads a worse verdict than it can prove: other statuses, garbage and silence are unknown", () => {
    const forbidden = REFUSED.replaceAll('"api_error_status":401', '"api_error_status":403');
    expect(loginOf({ code: 1, stdout: forbidden, stderr: "" }, false, LIMIT)).toEqual({
      kind: "unknown",
      reason: "the API answered HTTP 403",
    });
    expect(loginOf({ code: 1, stdout: "not json at all", stderr: "boom" }, false, LIMIT)).toEqual({
      kind: "unknown",
      reason: "claude exited 1 with no result",
    });
    // exit 0 without a result event is not a yes
    expect(loginOf({ code: 0, stdout: "", stderr: "" }, false, LIMIT)).toMatchObject({ kind: "unknown" });
  });

  it("says a CLI that cannot start is missing, and one stopped at the limit is unknown", () => {
    expect(loginOf({ code: CANNOT_START, stdout: "", stderr: "cannot start claude: ENOENT\n" }, false, LIMIT)).toEqual({
      kind: "missing",
    });
    expect(loginOf({ code: 143, stdout: REFUSED.split("\n")[0] ?? "", stderr: "" }, true, LIMIT)).toEqual({
      kind: "unknown",
      reason: "no answer within 60 s (offline, or a proxy that holds the call?)",
    });
  });

  it("keeps a result event printed in time, though a process the CLI left ran past the limit", () => {
    expect(loginOf({ code: 143, stdout: REFUSED, stderr: "" }, true, LIMIT)).toEqual({ kind: "refused", status: 401 });
  });

  it("never quotes the CLI's output, which could hold what the person pasted", () => {
    const echoed = ACCEPTED.replace('"is_error":false', '"is_error":true').replace('"ok"', '"sk-ant-oat01-SECRET"');
    const read = loginOf({ code: 1, stdout: echoed, stderr: "sk-ant-oat01-SECRET" }, false, LIMIT);
    expect(JSON.stringify(read)).not.toContain("SECRET");
  });
});

describe("refusedLogin", () => {
  it("is true only for a result event that says 401", () => {
    expect(refusedLogin(JSON.parse(REFUSED.split("\n")[2] ?? "{}"))).toBe(true);
    expect(refusedLogin(JSON.parse(ACCEPTED))).toBe(false);
    expect(refusedLogin(undefined)).toBe(false);
  });
});

// fakeClaude : a FACTORY_CLAUDE stand-in, a Node script, that writes its argv, cwd and environment to seen.json and
// then plays one fault: prints the given stream and exits with the code, or hangs (and starts a grandchild that hangs
// with it, whose pid it writes, so a stop must reach the whole group)
function fakeClaude(
  dir: string,
  play: { readonly stdout: string; readonly code: number } | "hang",
): { readonly bin: string; readonly seen: string; readonly pidFile: string } {
  const bin = join(dir, "claude");
  const seen = join(dir, "seen.json");
  const pidFile = join(dir, "grandchild.pid");
  const act =
    play === "hang"
      ? `const c = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));
setInterval(() => {}, 1000);`
      : `process.stdout.write(${JSON.stringify(`${play.stdout}\n`)}, () => process.exit(${play.code}));`;
  writeFileSync(
    bin,
    `#!${process.execPath}
require("node:fs").writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: process.env }));
${act}
`,
  );
  chmodSync(bin, 0o755);
  return { bin, seen, pidFile };
}

// what the fake saw: its argv, the folder it ran in, and each variable of its environment
type Seen = { readonly argv: unknown; readonly cwd: string; readonly env: (name: string) => unknown };

function seenOf(file: string): Seen {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const env: unknown = Reflect.get(Object(parsed), "env");
  return {
    argv: Reflect.get(Object(parsed), "argv"),
    cwd: String(Reflect.get(Object(parsed), "cwd")),
    env: (name) => Reflect.get(Object(env), name),
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function gone(pid: number): Promise<boolean> {
  for (let i = 0; i < 100 && alive(pid); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  return !alive(pid);
}

// the host's environment, with a stale login and a git host token in it, which no login call may pass on
const HOST: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? "",
  HOME: "/home/dev",
  LANG: "en_US.UTF-8",
  HTTPS_PROXY: "http://proxy.example:3128",
  ANTHROPIC_API_KEY: "sk-ant-api03-stale",
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-host",
  GH_TOKEN: "ghp_host",
  FACTORY_HOME: "/home/dev/.factory",
};

const WRITER = { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-stored", CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" };

describe("the Claude adapter's login call (#665, ADR-0012 S6)", () => {
  it("runs one fixed prompt with no tools, no MCP servers and no settings files, for one turn; never skip-all", () => {
    expect(LOGIN_ARGS).toEqual([
      "-p",
      "Reply with the word ok",
      "--restricted",
      "--strict-mcp-config",
      "--tools",
      "",
      "--max-turns",
      "1",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
    expect(LOGIN_ARGS.join(" ")).not.toMatch(/dangerously|skip-permissions|bypass/);
  });

  it("checks the implementer's token alone: a private empty HOME, the token given, no host login, no git host token", async () => {
    const dir = folder();
    const fake = fakeClaude(dir, { stdout: ACCEPTED, code: 0 });
    const login = await openAgentCli({ env: { ...HOST, FACTORY_CLAUDE: fake.bin } }).login(WRITER);
    expect(login).toEqual({ kind: "authorized" });
    const seen = seenOf(fake.seen);
    expect(seen.argv).toEqual(LOGIN_ARGS);
    expect(seen.env("CLAUDE_CODE_OAUTH_TOKEN")).toBe("sk-ant-oat01-stored");
    expect(seen.env("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB")).toBe("1");
    expect(seen.env("ANTHROPIC_API_KEY")).toBeUndefined();
    expect(seen.env("GH_TOKEN")).toBeUndefined();
    expect(seen.env("FACTORY_HOME")).toBeUndefined();
    expect(seen.env("HTTPS_PROXY")).toBe("http://proxy.example:3128");
    expect(seen.env("HOME")).toBe(seen.cwd);
    expect(seen.cwd).not.toBe(dir);
    // the folder it ran in, with the CLI's own files, is gone after the call
    expect(existsSync(seen.cwd)).toBe(false);
  });

  it("checks the read-only runs' login as those runs get it: this shell's claude env, never a git host token", async () => {
    const dir = folder();
    const fake = fakeClaude(dir, { stdout: REFUSED, code: 1 });
    const login = await openAgentCli({ env: { ...HOST, FACTORY_CLAUDE: fake.bin } }).login();
    expect(login).toEqual({ kind: "refused", status: 401 });
    const seen = seenOf(fake.seen);
    expect(seen.env("HOME")).toBe("/home/dev");
    expect(seen.env("ANTHROPIC_API_KEY")).toBe("sk-ant-api03-stale");
    expect(seen.env("CLAUDE_CODE_OAUTH_TOKEN")).toBe("sk-ant-oat01-host");
    expect(seen.env("GH_TOKEN")).toBeUndefined();
    expect(existsSync(seen.cwd)).toBe(false);
  });

  it("stops a call that hangs at its limit, with everything it started, and says it could not check", async () => {
    const dir = folder();
    const fake = fakeClaude(dir, "hang");
    const login = await openAgentCli({ env: { ...HOST, FACTORY_CLAUDE: fake.bin }, loginMs: 1_500 }).login(WRITER);
    expect(login).toMatchObject({ kind: "unknown", reason: expect.stringContaining("no answer within") });
    const pid = Number(readFileSync(fake.pidFile, "utf8"));
    expect(await gone(pid)).toBe(true);
    expect(existsSync(seenOf(fake.seen).cwd)).toBe(false);
  }, 20_000);

  it("says missing for a CLI that is not there", async () => {
    const login = await openAgentCli({ env: { ...HOST, FACTORY_CLAUDE: join(folder(), "no-claude") } }).login(WRITER);
    expect(login).toEqual({ kind: "missing" });
  });

  it("reads garbage from the CLI as could-not-check", async () => {
    const dir = folder();
    const fake = fakeClaude(dir, { stdout: "Segmentation fault", code: 139 });
    expect(await openAgentCli({ env: { ...HOST, FACTORY_CLAUDE: fake.bin } }).login(WRITER)).toEqual({
      kind: "unknown",
      reason: "claude exited 139 with no result",
    });
  });
});
