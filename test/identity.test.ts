import { describe, expect, it } from "vitest";
import { identitySetting, resolveIdentity } from "../src/core/identity.js";
import type { Runner } from "../src/core/forge/api.js";

const answer = (stdout: string, code = 0, stderr = ""): Runner => async () => ({ code, stdout, stderr });
const MINTED = JSON.stringify({ token: "ghs_0123456789abcdefghij", login: "ledger-factory[bot]", expiresAt: "2026-11-07T06:00:00Z" });

describe("identitySetting", () => {
  it("is your own login by default", () => {
    expect(identitySetting({ env: {}, forge: "gitlab" })).toEqual({ kind: "ok", value: { kind: "own" } });
  });

  it("app names the factory user and the command its sudo rule allows", () => {
    expect(identitySetting({ env: { FACTORY_IDENTITY: "app" }, forge: "github" })).toEqual({
      kind: "ok",
      value: { kind: "app", user: "factory", command: "/usr/local/bin/agent-factory" },
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
      expect(identitySetting({ env, forge })).toMatchObject({ kind: "failed", reason: expect.stringContaining(message) });
    }
  });
});

describe("resolveIdentity", () => {
  const app = { kind: "app", user: "factory", command: "/usr/local/bin/agent-factory" } as const;

  it("asks sudo, non-interactively, for exactly the one command the rule allows", async () => {
    const seen: { bin: string; args: readonly string[] }[] = [];
    const run: Runner = async (call) => {
      seen.push({ bin: call.bin, args: call.args });
      return { code: 0, stdout: MINTED, stderr: "" };
    };
    expect(await resolveIdentity({ setting: app, project: "chiyanram/ledger", run, env: {} })).toEqual({
      kind: "ok",
      value: { kind: "app", token: "ghs_0123456789abcdefghij", login: "ledger-factory[bot]", expiresAt: "2026-11-07T06:00:00Z" },
    });
    expect(seen).toEqual([{ bin: "sudo", args: ["-n", "-u", "factory", "--", "/usr/local/bin/agent-factory", "app-token", "chiyanram/ledger"] }]);
  });

  it("own asks nothing", async () => {
    expect(await resolveIdentity({ setting: { kind: "own" }, project: "a/b", run: answer("", 9), env: {} })).toEqual({ kind: "ok", value: { kind: "own" } });
  });

  it("fails with sudo's reason, or when the answer is not a token", async () => {
    expect(await resolveIdentity({ setting: app, project: "a/b", run: answer("", 1, "sudo: a password is required\n"), env: {} })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("sudo: a password is required"),
    });
    for (const stdout of ["not json", JSON.stringify({ token: "short", login: "x[bot]", expiresAt: "t" }), JSON.stringify({ token: "ghs_0123456789abcdefghij", login: "ram", expiresAt: "t" })]) {
      expect(await resolveIdentity({ setting: app, project: "a/b", run: answer(stdout), env: {} })).toMatchObject({ kind: "failed" });
    }
  });
});
