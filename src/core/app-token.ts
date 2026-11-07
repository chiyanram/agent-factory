// app-token — a GitHub App installation token for one repository, minted by the `factory` OS user (#108; ADR-0012 S14).
//
// On a personal project the factory may act as a GitHub App. Its private key belongs to the `factory` user, mode 600, so
// the developer's own user (and anything it runs: the coordinator, a tricked writer) cannot read it. The developer's
// user gets a token only through one sudo rule that runs exactly `agent-factory app-token <owner/name>` as `factory`:
//
//   <developer> ALL=(factory) NOPASSWD: /usr/local/bin/agent-factory-app-token chiyanram/ledger
//
// The wrapper is root-owned and runs `<absolute node> <root-owned checkout>/dist/cli.js app-token "$1"` (GUIDE).
//
// The command prints {"token", "login", "expiresAt"} on stdout:
//   token      an installation token scoped to that one repository, valid about an hour; reused from a cache in the
//              factory user's ~/.cache/agent-factory (mode 600) while it has more than 15 minutes left
//   login      "<app-slug>[bot]", the name the App posts and commits as
//   expiresAt  ISO 8601
//
// The App is set in the factory user's ~/.config/agent-factory/github-app.json, mode 600: {"appId": "123", "key":
// "/home/factory/.config/agent-factory/app.pem"}. Both files must belong to that user and be readable by it alone.
//
// No CLI can sign as an App, so this is the one place the package calls GitHub over HTTP (ADR-0013); the key is read at
// call time and never leaves this process. Nothing here throws: every outcome is a sealed result.

import { createSign } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "./forge/api.js";

export type HttpRequest = {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};
export type HttpAnswer = { readonly status: number; readonly body: string };
export type Http = (request: HttpRequest) => Promise<Result<HttpAnswer>>;

export type AppConfig = { readonly appId: string; readonly keyPem: string };
export type Minted = { readonly token: string; readonly login: string; readonly expiresAt: string };
type Cached = Minted & { readonly project: string };

export const realHttp: Http = async (request) => {
  try {
    const answer = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.method === "POST" ? { body: request.body } : {}),
    });
    return { kind: "ok", value: { status: answer.status, body: await answer.text() } };
  } catch (error) {
    return { kind: "failed", reason: `cannot reach GitHub: ${error instanceof Error ? error.message : String(error)}` };
  }
};

type Owned = { readonly uid: number };

// private : a file this user owns and no one else can read or write.
async function privateFile(path: string, me: Owned): Promise<Result<string>> {
  try {
    const s = await stat(path);
    if (!s.isFile() || s.uid !== me.uid || (s.mode & 0o077) !== 0) {
      return {
        kind: "failed",
        reason: `${path} must be a file of this user's, readable by it alone: chmod 600 ${path}`,
      };
    }
    return { kind: "ok", value: await readFile(path, "utf8") };
  } catch {
    return { kind: "failed", reason: `cannot read ${path}` };
  }
}

function parseConfig(text: string, where: string): Result<{ readonly appId: string; readonly key: string }> {
  try {
    const raw = JSON.parse(text) as { appId?: unknown; key?: unknown };
    const appId = typeof raw.appId === "number" ? String(raw.appId) : raw.appId;
    if (typeof appId !== "string" || !/^\d+$/.test(appId) || typeof raw.key !== "string" || !raw.key.startsWith("/")) {
      return { kind: "failed", reason: `${where} must be {"appId": "<digits>", "key": "<absolute path of the .pem>"}` };
    }
    return { kind: "ok", value: { appId, key: raw.key } };
  } catch {
    return { kind: "failed", reason: `${where} is not JSON` };
  }
}

// readAppConfig : the App's ID and private key, from the factory user's own files.
export async function readAppConfig(input: { readonly home: string; readonly me: Owned }): Promise<Result<AppConfig>> {
  const where = join(input.home, ".config", "agent-factory", "github-app.json");
  const text = await privateFile(where, input.me);
  const config = text.kind === "ok" ? parseConfig(text.value, where) : text;
  if (config.kind === "failed") {
    return config;
  }
  const key = await privateFile(config.value.key, input.me);
  return key.kind === "ok" ? { kind: "ok", value: { appId: config.value.appId, keyPem: key.value } } : key;
}

function b64url(data: string | Buffer): string {
  return Buffer.from(data).toString("base64url");
}

// jwt : a JSON Web Token signed with the App's key, valid 9 minutes (GitHub allows 10), back-dated 60 s for clock skew.
export function jwt(input: { readonly config: AppConfig; readonly now: number }): Result<string> {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iat: input.now - 60, exp: input.now + 540, iss: input.config.appId }));
  try {
    const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(input.config.keyPem);
    return { kind: "ok", value: `${head}.${body}.${b64url(signature)}` };
  } catch {
    return { kind: "failed", reason: "cannot sign with the App's key: is it the App's private key (.pem)?" };
  }
}

export type MintSetup = {
  readonly config: AppConfig;
  // owner/name
  readonly project: string;
  readonly http: Http;
  // seconds since the epoch
  readonly now: number;
  readonly cacheDir: string;
};

const API = "https://api.github.com";

function headers(bearer: string): Record<string, string> {
  return {
    Authorization: `Bearer ${bearer}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "agent-factory",
  };
}

// call : one GitHub REST call, its JSON on a 2xx; a 401 names the likely causes.
async function call(
  setup: MintSetup,
  bearer: string,
  method: "GET" | "POST",
  path: string,
  body: unknown,
): Promise<Result<Record<string, unknown>>> {
  const answer = await setup.http({
    method,
    url: `${API}/${path}`,
    headers: headers(bearer),
    body: JSON.stringify(body),
  });
  if (answer.kind === "failed") {
    return answer;
  }
  const { status } = answer.value;
  if (status === 401) {
    return {
      kind: "failed",
      reason: `HTTP 401 on ${method} ${path}: GitHub refused App ${setup.config.appId}; check the App ID, the key, and this machine's clock`,
    };
  }
  if (status === 404) {
    const why = path.endsWith("/installation")
      ? `the App ${setup.config.appId} is not installed on ${setup.project}`
      : `GitHub does not know this App or path`;
    return { kind: "failed", reason: `HTTP 404 on ${method} ${path}: ${why}` };
  }
  if (status < 200 || status > 299) {
    return { kind: "failed", reason: `HTTP ${status} on ${method} ${path}: ${answer.value.body.slice(0, 200)}` };
  }
  try {
    return { kind: "ok", value: JSON.parse(answer.value.body) as Record<string, unknown> };
  } catch {
    return { kind: "failed", reason: `the answer to ${method} ${path} is not JSON` };
  }
}

// one file per App and project; the name is encoded so no two projects share one ("a_b/c" and "a/b_c")
function cacheFile(setup: MintSetup): string {
  return join(setup.cacheDir, `${setup.config.appId}-${encodeURIComponent(setup.project)}.json`);
}

// cached : the cached token for this very project while it has more than 15 minutes left; else none.
async function cached(setup: MintSetup): Promise<Minted | "none"> {
  try {
    const raw = JSON.parse(await readFile(cacheFile(setup), "utf8")) as Partial<Cached>;
    const valid =
      typeof raw.token === "string" &&
      typeof raw.login === "string" &&
      typeof raw.expiresAt === "string" &&
      raw.project === setup.project;
    return valid && Date.parse(raw.expiresAt!) / 1000 > setup.now + 900
      ? { token: raw.token!, login: raw.login!, expiresAt: raw.expiresAt! }
      : "none";
  } catch {
    return "none";
  }
}

async function remember(setup: MintSetup, minted: Minted): Promise<void> {
  try {
    await mkdir(setup.cacheDir, { recursive: true, mode: 0o700 });
    // a new file, then a rename: a reader never sees half a token
    const entry: Cached = { ...minted, project: setup.project };
    await writeFile(`${cacheFile(setup)}.new`, JSON.stringify(entry), { mode: 0o600 });
    await rename(`${cacheFile(setup)}.new`, cacheFile(setup));
  } catch {
    // a cache that cannot be written only costs a new token next time
  }
}

// grant : the token GitHub minted, with the App's name.
function grant(minted: Record<string, unknown>, slug: unknown, project: string): Result<Minted> {
  const { token, expires_at: expiresAt } = minted;
  if (typeof token !== "string" || typeof expiresAt !== "string" || typeof slug !== "string") {
    return { kind: "failed", reason: `GitHub gave no token for ${project}` };
  }
  return { kind: "ok", value: { token, login: `${slug}[bot]`, expiresAt } };
}

async function fresh(setup: MintSetup, bearer: string): Promise<Result<Minted>> {
  const app = await call(setup, bearer, "GET", "app", {});
  if (app.kind === "failed") {
    return app;
  }
  const installation = await call(setup, bearer, "GET", `repos/${setup.project}/installation`, {});
  if (installation.kind === "failed") {
    return installation;
  }
  const id = installation.value.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id)) {
    return { kind: "failed", reason: `GitHub gave no installation id for ${setup.project}` };
  }
  // scoped to the one repository: the token cannot touch the App's other installations' repositories
  const name = setup.project.split("/")[1]!;
  const minted = await call(setup, bearer, "POST", `app/installations/${id}/access_tokens`, { repositories: [name] });
  return minted.kind === "ok" ? grant(minted.value, app.value.slug, setup.project) : minted;
}

// mint : a token for the one repository, from the cache while it lasts.
export async function mint(setup: MintSetup): Promise<Result<Minted>> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(setup.project)) {
    return { kind: "failed", reason: `the project must be owner/name, got ${JSON.stringify(setup.project)}` };
  }
  const hit = await cached(setup);
  if (hit !== "none") {
    return { kind: "ok", value: hit };
  }
  const bearer = jwt({ config: setup.config, now: setup.now });
  const minted = bearer.kind === "ok" ? await fresh(setup, bearer.value) : bearer;
  if (minted.kind === "ok") {
    await remember(setup, minted.value);
  }
  return minted;
}
