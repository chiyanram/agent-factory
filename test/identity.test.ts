import { describe, expect, it } from "vitest";
import { identitySetting, resolveIdentity } from "../src/core/identity.js";
import type { Runner } from "../src/core/forge/api.js";

const answer =
  (stdout: string, code = 0, stderr = ""): Runner =>
  async () => ({ code, stdout, stderr });
// 2026-11-07T05:00:00Z, an hour before the token ends
const NOW = Date.parse("2026-11-07T05:00:00Z") / 1000;
const MINTED = JSON.stringify({
  token: "ghs_0123456789abcdefghij",
  login: "ledger-factory[bot]",
  expiresAt: "2026-11-07T06:00:00Z",
});

describe("identitySetting", () => {
  it("is your own login by default", () => {
    expect(identitySetting({ env: {}, forge: "gitlab" })).toEqual({ kind: "ok", value: { kind: "own" } });
  });

  it("app names the factory user and the command its sudo rule allows", () => {
    expect(identitySetting({ env: { FACTORY_IDENTITY: "app" }, forge: "github" })).toEqual({
      kind: "ok",
      value: { kind: "app", user: "factory", command: "/usr/local/bin/agent-factory-app-token" },
    });
  });

  it("refuses an unknown identity, app on GitLab, a bad user and a relative command", () => {
    for (const [env, forge, message] of [
      [{ FACTORY_IDENTITY: "bot" }, "github", "own or app"],
      [{ FACTORY_IDENTITY: "app" }, "gitlab", "GitHub App"],
      [{ FACTORY_IDENTITY: "app", FACTORY_APP_USER: "root; id" }, "github", "FACTORY_APP_USER"],
      [{ FACTORY_IDENTITY: "app", FACTORY_APP_COMMAND: "agent-factory" }, "github", "FACTORY_APP_COMMAND"],
      [{ FACTORY_IDENTITY: "app", FACTORY_APP_COMMAND: "/usr/../tmp/x" }, "github", "FACTORY_APP_COMMAND"],
    ] as const) {
      expect(identitySetting({ env, forge })).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining(message),
      });
    }
  });
});

describe("resolveIdentity", () => {
  const app = { kind: "app", user: "factory", command: "/usr/local/bin/agent-factory-app-token" } as const;

  it("asks sudo, non-interactively, for exactly the one command the rule allows", async () => {
    const seen: { bin: string; args: readonly string[] }[] = [];
    const run: Runner = async (call) => {
      seen.push({ bin: call.bin, args: call.args });
      return { code: 0, stdout: MINTED, stderr: "" };
    };
    expect(await resolveIdentity({ setting: app, project: "chiyanram/ledger", run, env: {}, now: NOW })).toEqual({
      kind: "ok",
      value: {
        kind: "app",
        token: "ghs_0123456789abcdefghij",
        login: "ledger-factory[bot]",
        expiresAt: "2026-11-07T06:00:00Z",
      },
    });
    expect(seen).toEqual([
      {
        bin: "sudo",
        args: ["-n", "-u", "factory", "--", "/usr/local/bin/agent-factory-app-token", "chiyanram/ledger"],
      },
    ]);
  });

  it("own asks nothing", async () => {
    expect(
      await resolveIdentity({ setting: { kind: "own" }, project: "a/b", run: answer("", 9), env: {}, now: NOW }),
    ).toEqual({ kind: "ok", value: { kind: "own" } });
  });

  it("fails with sudo's reason, or when the answer is not a token", async () => {
    expect(
      await resolveIdentity({
        setting: app,
        project: "a/b",
        run: answer("", 1, "sudo: a password is required\n"),
        env: {},
        now: NOW,
      }),
    ).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("sudo: a password is required"),
    });
    for (const stdout of [
      "not json",
      JSON.stringify({ token: "short", login: "x[bot]", expiresAt: "t" }),
      JSON.stringify({ token: "ghs_0123456789abcdefghij", login: "ram", expiresAt: "t" }),
    ]) {
      expect(
        await resolveIdentity({ setting: app, project: "a/b", run: answer(stdout), env: {}, now: NOW }),
      ).toMatchObject({ kind: "failed" });
    }
  });

  it("refuses a token with less than 10 minutes left, or with no expiry it can read", async () => {
    const late = Date.parse("2026-11-07T05:51:00Z") / 1000;
    expect(
      await resolveIdentity({ setting: app, project: "a/b", run: answer(MINTED), env: {}, now: late }),
    ).toMatchObject({ kind: "failed", reason: expect.stringContaining("10 minutes") });
    const undated = JSON.stringify({ token: "ghs_0123456789abcdefghij", login: "x[bot]", expiresAt: "soon" });
    expect(
      await resolveIdentity({ setting: app, project: "a/b", run: answer(undated), env: {}, now: NOW }),
    ).toMatchObject({ kind: "failed" });
  });
});
