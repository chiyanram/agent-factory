import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Call, Runner } from "../src/core/forge/api.js";
import {
  boxToken,
  boxTokenFrom,
  checkToken,
  fileVault,
  keychainVault,
  metaFor,
  openStore,
  secret,
  tokenAge,
  type TokenStore,
} from "../src/core/token/index.js";

const TOKEN = "sk-ant-oat01-AbCdEf0123456789_xyz-TOKEN";
const NOW = new Date("2026-11-07T10:00:00Z");
const UID = process.getuid?.() ?? -1;

describe("checkToken", () => {
  it("keeps a pasted token, trimmed", () => {
    const checked = checkToken(`  ${TOKEN}\n`);
    expect(checked.kind).toBe("ok");
    expect(checked.kind === "ok" && checked.token.reveal()).toBe(TOKEN);
  });

  it.each([
    "gho_16C7e42F292c6912E7710c838347Ae178B4a",
    "ghp_16C7e42F292c6912E7710c838347Ae178B4a",
    "github_pat_11ABCDEFG0123456789_abcdef",
  ])("never takes the developer's GitHub login %s as a box token", (login) => {
    expect(checkToken(login)).toEqual({ kind: "refused", reason: expect.stringContaining("GitHub login") });
  });

  it.each([
    ["", "nothing was pasted"],
    [`${TOKEN} extra`, "space or a line break"],
    ["short", "not a token"],
    [`${TOKEN}$`, "not a token"],
  ])("refuses %j and never quotes it", (pasted, why) => {
    const checked = checkToken(pasted);
    expect(checked).toEqual({ kind: "refused", reason: expect.stringContaining(why) });
    expect(JSON.stringify(checked)).not.toContain(TOKEN);
  });

  it("never prints a token: String and JSON both hide it", () => {
    const token = secret(TOKEN);
    expect(String(token)).toBe("[secret]");
    expect(JSON.stringify({ token })).toBe('{"token":"[secret]"}');
  });
});

describe("tokenAge and boxToken", () => {
  const meta = metaFor(NOW);
  const at = (iso: string): Date => new Date(iso);

  it("gives a setup-token one year", () => {
    expect(meta).toEqual({ madeAt: "2026-11-07T10:00:00.000Z", expiresAt: "2027-11-07T10:00:00.000Z" });
  });

  it("is valid, then warns in the last 7 days, then expires", () => {
    expect(tokenAge(meta, NOW)).toEqual({ kind: "valid", daysLeft: 365 });
    expect(tokenAge(meta, at("2027-11-01T10:00:00Z"))).toEqual({ kind: "expiring", daysLeft: 6 });
    expect(tokenAge(meta, at("2027-11-07T10:00:00Z"))).toEqual({ kind: "expired", since: "2027-11-07T10:00:00.000Z" });
  });

  it("refuses to start a box with an expired token", () => {
    expect(boxToken({ token: secret(TOKEN), meta, now: at("2027-12-01T00:00:00Z") })).toEqual({
      kind: "refused",
      reason: expect.stringContaining("expired"),
    });
  });

  it("refuses to start a box when the expiry does not parse", () => {
    expect(boxToken({ token: secret(TOKEN), meta: { madeAt: "x", expiresAt: "soon" }, now: NOW }).kind).toBe("refused");
  });

  it("passes the token with the subprocess scrub on, and warns near the end", () => {
    expect(boxToken({ token: secret(TOKEN), meta, now: NOW })).toEqual({
      kind: "ready",
      env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN, CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" },
      notice: { kind: "none" },
    });
    expect(boxToken({ token: secret(TOKEN), meta, now: at("2027-11-05T10:00:00Z") })).toMatchObject({
      kind: "ready",
      notice: { kind: "warn" },
    });
  });
});

describe("the Linux file store", () => {
  let home = "";
  let store: TokenStore = {
    where: "",
    put: async () => ({ kind: "ok" }),
    get: async () => ({ kind: "missing", reason: "" }),
  };
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "factory-token-"));
    const opened = openStore({
      platform: "linux",
      home,
      owner: { uid: UID },
      run: async () => ({ code: 1, stdout: "", stderr: "" }),
      env: {},
    });
    if (opened.kind !== "store") throw new Error(opened.reason);
    store = opened.store;
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const file = (): string => join(home, "secrets", "claude-token");

  it("stores the token readable by its owner only, and reads it back with its expiry", async () => {
    expect(await store.put({ runner: "claude", token: secret(TOKEN), meta: metaFor(NOW) })).toEqual({ kind: "ok" });
    expect(statSync(file()).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, "secrets")).mode & 0o777).toBe(0o700);
    expect(readFileSync(join(home, "tokens.json"), "utf8")).not.toContain(TOKEN);
    const got = await store.get("claude");
    expect(got.kind === "found" && got.token.reveal()).toBe(TOKEN);
    expect(got).toMatchObject({ kind: "found", meta: metaFor(NOW) });
  });

  it("says missing when nothing is stored", async () => {
    expect(await store.get("claude")).toEqual({
      kind: "missing",
      reason: expect.stringContaining("agent-factory setup claude"),
    });
  });

  it("refuses a token file that group or others can read", async () => {
    await store.put({ runner: "claude", token: secret(TOKEN), meta: metaFor(NOW) });
    chmodSync(file(), 0o644);
    expect(await store.get("claude")).toEqual({
      kind: "failed",
      reason: expect.stringContaining("group or others can read it"),
    });
  });

  it("refuses a token file that is a symlink", async () => {
    await store.put({ runner: "claude", token: secret(TOKEN), meta: metaFor(NOW) });
    const other = join(home, "elsewhere");
    writeFileSync(other, `${TOKEN}\n`, { mode: 0o600 });
    rmSync(file());
    symlinkSync(other, file());
    expect(await store.get("claude")).toEqual({ kind: "failed", reason: expect.stringContaining("symlink") });
  });

  it("refuses a token file of another user", async () => {
    await store.put({ runner: "claude", token: secret(TOKEN), meta: metaFor(NOW) });
    const vault = fileVault(home, { uid: UID + 1 });
    expect(await vault.read("claude")).toEqual({ kind: "failed", reason: expect.stringContaining("belongs to uid") });
  });

  it("gives the dispatcher no token when the expiry is gone", async () => {
    await store.put({ runner: "claude", token: secret(TOKEN), meta: metaFor(NOW) });
    rmSync(join(home, "tokens.json"));
    expect(await boxTokenFrom({ store, now: NOW })).toEqual({
      kind: "refused",
      reason: expect.stringContaining("no expiry on record"),
    });
  });
});

describe("the macOS Keychain store", () => {
  it("passes the token on stdin, never on the command line", async () => {
    const calls: Call[] = [];
    const run: Runner = async (c) => {
      calls.push(c);
      return { code: 0, stdout: "", stderr: "" };
    };
    expect(await keychainVault(run, {}).write("claude", secret(TOKEN))).toEqual({ kind: "ok" });
    expect(calls[0]?.args).toEqual(["-i"]);
    expect(calls[0]?.args.join(" ")).not.toContain(TOKEN);
    expect(calls[0]?.stdin).toBe(`add-generic-password -U -s agent-factory -a claude -w ${TOKEN}\n`);
  });

  it("reads a missing item as missing, from the text security prints", async () => {
    const run: Runner = async () => ({
      code: 44,
      stdout: "",
      stderr: "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.",
    });
    expect((await keychainVault(run, {}).read("claude")).kind).toBe("missing");
  });

  it("names no store for a platform it does not know", () => {
    expect(
      openStore({
        platform: "win32",
        home: "/h",
        owner: { uid: 1 },
        run: async () => ({ code: 0, stdout: "", stderr: "" }),
        env: {},
      }).kind,
    ).toBe("refused");
  });
});

describe("files the store writes", () => {
  it("never puts a token in tokens.json", async () => {
    const home = mkdtempSync(join(tmpdir(), "factory-token-"));
    const opened = openStore({
      platform: "linux",
      home,
      owner: { uid: UID },
      run: async () => ({ code: 1, stdout: "", stderr: "" }),
      env: {},
    });
    if (opened.kind !== "store") throw new Error(opened.reason);
    await opened.store.put({ runner: "claude", token: secret(TOKEN), meta: metaFor(NOW) });
    expect(existsSync(join(home, "tokens.json"))).toBe(true);
    expect(readFileSync(join(home, "tokens.json"), "utf8")).not.toContain("sk-ant");
    rmSync(home, { recursive: true, force: true });
  });
});
