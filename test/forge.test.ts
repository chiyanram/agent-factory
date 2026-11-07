import { describe, expect, it } from "vitest";
import { openForge } from "../src/core/forge/index.js";
import type { Runner } from "../src/core/forge/api.js";

const never: Runner = async () => ({ code: 99, stdout: "", stderr: "a call was made" });

function open(env: NodeJS.ProcessEnv, run: Runner = never) {
  const logged: string[] = [];
  return { result: openForge({ env, log: (l) => logged.push(l), run }), logged };
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
      [{ FACTORY_PROJECT: "" }, "full path"],
      [{ FACTORY_PROJECT: "a/b", FACTORY_MAX_TRIES: "0" }, "FACTORY_MAX_TRIES"],
      [{ FACTORY_PROJECT: "a/b", FACTORY_MAX_TRIES: "four" }, "FACTORY_MAX_TRIES"],
      [{ FACTORY_PROJECT: "a/b", FACTORY_DRY_RUN: "yes" }, "FACTORY_DRY_RUN"],
      [{ FACTORY_PROJECT: "a/b", FACTORY_LOGIN: "ram; rm -rf" }, "FACTORY_LOGIN"],
    ] as const) {
      expect(open(env).result).toMatchObject({ kind: "failed", reason: expect.stringContaining(message) });
    }
  });

  it("FACTORY_LOGIN answers me without a call", async () => {
    const r = open({ FACTORY_FORGE: "github", FACTORY_PROJECT: "a/b", FACTORY_LOGIN: "ledger-factory[bot]" }).result;
    expect(r.kind === "ok" ? await r.value.me() : {}).toEqual({ kind: "ok", value: "ledger-factory[bot]" });
  });

  it("a dry run prints every write and makes none; reads still call the forge", async () => {
    const { result, logged } = open({ FACTORY_PROJECT: "a/b", FACTORY_DRY_RUN: "1" });
    if (result.kind !== "ok") {
      throw new Error(result.reason);
    }
    const f = result.value;
    const change = { number: 3, state: "opened", sha: "h", sourceBranch: "x", targetBranch: "main", labels: [], description: "", anchor: { kind: "gitlab", base: "b", start: "s", head: "h" } } as const;
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
