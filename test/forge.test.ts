import { describe, expect, it } from "vitest";
import { forgeHost, openForge, openProject } from "../src/core/forge/index.js";
import type { Identity } from "../src/core/identity.js";
import type { Runner } from "../src/core/forge/api.js";

const never: Runner = async () => ({ code: 99, stdout: "", stderr: "a call was made" });

function open(env: NodeJS.ProcessEnv, run: Runner = never, identity: Identity = { kind: "own" }) {
  const logged: string[] = [];
  return { result: openForge({ env, log: (l) => logged.push(l), run, identity }), logged };
}

describe("openForge", () => {
  it("picks the adapter and its mark; gitlab is the default", () => {
    const gl = open({ FACTORY_PROJECT: "aruvii/agent-platform" }).result;
    expect(gl.kind === "ok" ? [gl.value.name, gl.value.mark] : []).toEqual(["gitlab", "!"]);
    const gh = open({ FACTORY_FORGE: "github", FACTORY_PROJECT: "chiyanram/ledger" }).result;
    expect(gh.kind === "ok" ? [gh.value.name, gh.value.mark] : []).toEqual(["github", "#"]);
  });

  it("refuses a setting that is set but not valid, never falls back to the default", () => {
    for (const [env, message] of [
      [{ FACTORY_FORGE: "bitbucket", FACTORY_PROJECT: "a/b" }, "FACTORY_FORGE must be gitlab or github"],
      [{ FACTORY_FORGE: "github", FACTORY_PROJECT: "ledger" }, "must be owner/name"],
      [{ FACTORY_FORGE: "github", FACTORY_PROJECT: "a/b/c" }, "must be owner/name"],
      [{ FACTORY_FORGE: "github", FACTORY_PROJECT: "../x" }, "must be owner/name"],
      [{ FACTORY_PROJECT: "group/../x" }, "full path"],
      [{ FACTORY_PROJECT: "" }, "full path"],
      [{ FACTORY_PROJECT: "a/b", FACTORY_MAX_TRIES: "0" }, "FACTORY_MAX_TRIES"],
      [{ FACTORY_PROJECT: "a/b", FACTORY_MAX_TRIES: "four" }, "FACTORY_MAX_TRIES"],
      [{ FACTORY_PROJECT: "a/b", FACTORY_DRY_RUN: "yes" }, "FACTORY_DRY_RUN"],
    ] as const) {
      expect(open(env).result).toMatchObject({ kind: "failed", reason: expect.stringContaining(message) });
    }
  });

  it("with an App, every gh call gets the App's token, and me is the App's login without a call", async () => {
    const calls: NodeJS.ProcessEnv[] = [];
    const run: Runner = async (call) => {
      calls.push(call.env);
      return { code: 0, stdout: 'HTTP/2.0 200 OK\r\n\r\n{"default_branch":"main"}', stderr: "" };
    };
    const app: Identity = {
      kind: "app",
      token: "ghs_0123456789abcdefghij",
      login: "ledger-factory[bot]",
      expiresAt: "2026-11-07T06:00:00Z",
    };
    const r = open({ FACTORY_FORGE: "github", FACTORY_PROJECT: "a/b" }, run, app).result;
    if (r.kind !== "ok") {
      throw new Error(r.reason);
    }
    expect(await r.value.me()).toEqual({ kind: "ok", value: "ledger-factory[bot]" });
    expect(calls).toHaveLength(0);
    await r.value.defaultBranch();
    expect(calls[0]!.GH_TOKEN).toBe("ghs_0123456789abcdefghij");
  });

  it("with your own login, gh gets no token from the factory", async () => {
    let seen: NodeJS.ProcessEnv = {};
    const run: Runner = async (call) => {
      seen = call.env;
      return { code: 0, stdout: 'HTTP/2.0 200 OK\r\n\r\n{"login":"ram"}', stderr: "" };
    };
    const r = open({ FACTORY_FORGE: "github", FACTORY_PROJECT: "a/b" }, run).result;
    expect(r.kind === "ok" ? await r.value.me() : {}).toEqual({ kind: "ok", value: "ram" });
    expect(seen.GH_TOKEN).toBeUndefined();
  });

  it("openProject asks the factory user for the App's token once, through sudo", async () => {
    const calls: { bin: string; args: readonly string[] }[] = [];
    const run: Runner = async (call) => {
      calls.push({ bin: call.bin, args: call.args });
      return {
        code: 0,
        stdout: JSON.stringify({
          token: "ghs_0123456789abcdefghij",
          login: "ledger-factory[bot]",
          expiresAt: "2099-01-01T00:00:00Z",
        }),
        stderr: "",
      };
    };
    const opened = await openProject({
      env: { FACTORY_FORGE: "github", FACTORY_PROJECT: "chiyanram/ledger", FACTORY_IDENTITY: "app" },
      log: () => undefined,
      run,
    });
    expect(opened.kind === "ok" ? opened.value.identity.kind : "").toBe("app");
    expect(calls).toEqual([
      {
        bin: "sudo",
        args: ["-n", "-u", "factory", "--", "/usr/local/bin/agent-factory-app-token", "chiyanram/ledger"],
      },
    ]);
    const gitlab = await openProject({
      env: { FACTORY_PROJECT: "a/b", FACTORY_IDENTITY: "app" },
      log: () => undefined,
      run,
    });
    expect(gitlab).toMatchObject({ kind: "failed", reason: expect.stringContaining("GitHub App") });
  });

  it("a dry run prints every write and makes none; reads still call the forge", async () => {
    const { result, logged } = open({ FACTORY_PROJECT: "a/b", FACTORY_DRY_RUN: "1" });
    if (result.kind !== "ok") {
      throw new Error(result.reason);
    }
    const f = result.value;
    const change = {
      number: 3,
      state: "opened",
      sha: "h",
      sourceBranch: "x",
      targetBranch: "main",
      labels: [],
      description: "",
      anchor: { kind: "gitlab", base: "b", start: "s", head: "h" },
    } as const;
    const post = { seat: "coordinator", title: "claimed", fields: [], items: [] } as const;
    expect(await f.addLabel({ number: 3, label: "agent::claimed" })).toEqual({ kind: "ok" });
    expect(await f.removeLabel({ number: 3, label: "agent::claimed" })).toEqual({ kind: "ok" });
    expect(await f.note({ number: 3, post })).toEqual({ kind: "ok" });
    expect(await f.lineFinding({ change, at: { file: "a.ts", line: 1 }, post })).toEqual({ kind: "ok" });
    expect(logged).toEqual([
      "DRY RUN: add the label agent::claimed to !3",
      "DRY RUN: remove the label agent::claimed from !3",
      "DRY RUN: note on !3: [coordinator] claimed",
      "DRY RUN: finding on !3 at a.ts:1",
    ]);
    expect(await f.me()).toMatchObject({ kind: "failed", reason: expect.stringContaining("a call was made") });
  });

  it("FACTORY_FORGE_HOST is github.com or gitlab.com unless set, and must be a plain host name", () => {
    expect(forgeHost({}, "github")).toEqual({ kind: "ok", value: "github.com" });
    expect(forgeHost({}, "gitlab")).toEqual({ kind: "ok", value: "gitlab.com" });
    expect(forgeHost({ FACTORY_FORGE_HOST: "gitlab.example.com" }, "gitlab")).toEqual({
      kind: "ok",
      value: "gitlab.example.com",
    });
    for (const host of ["", "gitlab", "evil.example/x", "user@host.com", "host.com:22", ".example.com"]) {
      expect(forgeHost({ FACTORY_FORGE_HOST: host }, "gitlab")).toMatchObject({ kind: "failed" });
    }
  });

  it("defaults gh to plain gh: the developer's own login (S14)", async () => {
    let bin = "";
    const run: Runner = async (call) => {
      bin = call.bin;
      return { code: 0, stdout: 'HTTP/2.0 200 OK\r\n\r\n{"login":"x"}', stderr: "" };
    };
    const r = open({ FACTORY_FORGE: "github", FACTORY_PROJECT: "a/b" }, run).result;
    await (r.kind === "ok" ? r.value.me() : undefined);
    expect(bin).toBe("gh");
  });

  it("calls the CLI with no update notice and no prompt", async () => {
    let seen: NodeJS.ProcessEnv = {};
    const run: Runner = async (call) => {
      seen = call.env;
      return { code: 0, stdout: 'HTTP/2.0 200 OK\r\n\r\n{"username":"ram"}', stderr: "" };
    };
    const r = open({ FACTORY_PROJECT: "a/b", FACTORY_GLAB: "/opt/glab" }, run).result;
    expect(r.kind === "ok" ? await r.value.me() : {}).toEqual({ kind: "ok", value: "ram" });
    expect(seen).toMatchObject({ GH_NO_UPDATE_NOTIFIER: "1", GH_PROMPT_DISABLED: "1", GLAB_CHECK_UPDATE: "false" });
  });
});
