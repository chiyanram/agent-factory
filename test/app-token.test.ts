import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jwt, mint, readAppConfig, type AppConfig, type Http, type HttpRequest } from "../src/core/app-token.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const config: AppConfig = { appId: "123", keyPem: PEM };
const NOW = 1_800_000_000;
const me = { uid: process.getuid?.() ?? 0 };

let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "factory-app-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeGithub(answers: Record<string, { status: number; body: unknown }>): { http: Http; seen: HttpRequest[] } {
  const seen: HttpRequest[] = [];
  const http: Http = async (request) => {
    seen.push(request);
    const hit = answers[`${request.method} ${request.url.replace("https://api.github.com/", "")}`];
    return hit === undefined ? { kind: "ok", value: { status: 599, body: "no fake" } } : { kind: "ok", value: { status: hit.status, body: JSON.stringify(hit.body) } };
  };
  return { http, seen };
}

const GITHUB = {
  "GET app": { status: 200, body: { slug: "ledger-factory" } },
  "GET repos/chiyanram/ledger/installation": { status: 200, body: { id: 77 } },
  "POST app/installations/77/access_tokens": { status: 201, body: { token: "ghs_minted0123456789abcd", expires_at: "2027-01-15T09:00:00Z" } },
};

describe("jwt", () => {
  it("is signed with the App's key, issued by the App, valid 9 minutes and back-dated 60 s", () => {
    const token = jwt({ config, now: NOW });
    expect(token.kind).toBe("ok");
    const [head, body, signature] = (token.kind === "ok" ? token.value : "").split(".");
    expect(createVerify("RSA-SHA256").update(`${head}.${body}`).verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(body!, "base64url").toString())).toEqual({ iat: NOW - 60, exp: NOW + 540, iss: "123" });
  });

  it("a key that is not a private key fails, never throws", () => {
    expect(jwt({ config: { appId: "1", keyPem: "nope" }, now: NOW })).toMatchObject({ kind: "failed" });
  });
});

describe("mint", () => {
  const setup = (http: Http, now = NOW) => ({ config, project: "chiyanram/ledger", http, now, cacheDir: join(home, "cache") });

  it("mints a token scoped to the one repository, with the App's [bot] login, and caches it mode 600", async () => {
    const gh = fakeGithub(GITHUB);
    expect(await mint(setup(gh.http))).toEqual({ kind: "ok", value: { token: "ghs_minted0123456789abcd", login: "ledger-factory[bot]", expiresAt: "2027-01-15T09:00:00Z" } });
    expect(JSON.parse(gh.seen[2]!.body)).toEqual({ repositories: ["ledger"] });
    expect(gh.seen[0]!.headers.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(statSync(join(home, "cache", "123-chiyanram_ledger.json")).mode & 0o777).toBe(0o600);
  });

  it("reuses the cached token while it has more than 5 minutes left, then mints again", async () => {
    const first = fakeGithub(GITHUB);
    await mint(setup(first.http));
    const again = fakeGithub(GITHUB);
    expect(await mint(setup(again.http))).toMatchObject({ kind: "ok" });
    expect(again.seen).toHaveLength(0);
    const late = Date.parse("2027-01-15T09:00:00Z") / 1000 - 200;
    await mint(setup(again.http, late));
    expect(again.seen).toHaveLength(3);
  });

  it("names the likely cause of a 401 and a 404, and refuses a project that is not owner/name", async () => {
    expect(await mint(setup(fakeGithub({ "GET app": { status: 401, body: {} } }).http))).toMatchObject({ kind: "failed", reason: expect.stringContaining("clock") });
    expect(await mint(setup(fakeGithub({ ...GITHUB, "GET repos/chiyanram/ledger/installation": { status: 404, body: {} } }).http))).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("not installed on chiyanram/ledger"),
    });
    expect(await mint({ ...setup(fakeGithub(GITHUB).http), project: "../x" })).toMatchObject({ kind: "failed", reason: expect.stringContaining("owner/name") });
  });
});

describe("readAppConfig", () => {
  function files(configMode: number, keyMode: number, text?: string): void {
    const dir = join(home, ".config", "agent-factory");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "app.pem"), PEM);
    chmodSync(join(dir, "app.pem"), keyMode);
    writeFileSync(join(dir, "github-app.json"), text ?? JSON.stringify({ appId: 123, key: join(dir, "app.pem") }));
    chmodSync(join(dir, "github-app.json"), configMode);
  }

  it("reads the App's ID and key from the factory user's own private files", async () => {
    files(0o600, 0o400);
    expect(await readAppConfig({ home, me })).toEqual({ kind: "ok", value: { appId: "123", keyPem: PEM } });
  });

  it("refuses a file others can read, another user's file, a missing file and a bad config", async () => {
    files(0o644, 0o600);
    expect(await readAppConfig({ home, me })).toMatchObject({ kind: "failed", reason: expect.stringContaining("chmod 600") });
    files(0o600, 0o640);
    expect(await readAppConfig({ home, me })).toMatchObject({ kind: "failed", reason: expect.stringContaining("app.pem") });
    files(0o600, 0o600);
    expect(await readAppConfig({ home, me: { uid: me.uid + 1 } })).toMatchObject({ kind: "failed" });
    files(0o600, 0o600, JSON.stringify({ appId: "x", key: "relative.pem" }));
    expect(await readAppConfig({ home, me })).toMatchObject({ kind: "failed", reason: expect.stringContaining("appId") });
    expect(await readAppConfig({ home: join(home, "nobody"), me })).toMatchObject({ kind: "failed", reason: expect.stringContaining("cannot read") });
  });
});
