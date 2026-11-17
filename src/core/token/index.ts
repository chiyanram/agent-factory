// index — `agent-factory setup claude`, `setup copilot` and the token half of `setup status` (#136). The operator makes the token
// (`claude setup-token` prints it once) and pastes it at a hidden prompt; setup claude tries it with one login call
// through the claude CLI, which has no tools, then stores it. No agent run sees it, and it is never printed,
// logged, passed in argv or put in an env file. The dispatcher calls boxTokenFrom before each run.

import {
  boxToken,
  checkCopilotToken,
  checkToken,
  copilotLogin,
  copilotMeta,
  checkWebhook,
  metaFor,
  tokenAge,
  webhookMeta,
  type Age,
  type BoxToken,
  type Meta,
  type Secret,
} from "./rules.js";
import type { Login } from "../agent/login.js";
import type { Result } from "../forge/api.js";
import type { TokenStore } from "./store.js";

export {
  boxToken,
  checkCopilotToken,
  checkToken,
  copilotLogin,
  copilotMeta,
  checkWebhook,
  metaFor,
  RENEW,
  secret,
  tokenAge,
  WARN_DAYS,
  type Age,
  type BoxToken,
  type Meta,
  type Notice,
  type Secret,
} from "./rules.js";
export {
  fileVault,
  keychainVault,
  openStore,
  tokenRecord,
  unsafeFile,
  type Owner,
  type StoreInput,
  type Stored,
  type TokenStore,
} from "./store.js";
export { readHidden } from "./prompt.js";

export type Saved =
  | { readonly kind: "saved"; readonly where: string; readonly meta: Meta }
  | { readonly kind: "refused"; readonly reason: string };

// the claude token saved, with what its login call found, for the person
export type ClaudeSaved =
  | { readonly kind: "saved"; readonly where: string; readonly meta: Meta; readonly note: string }
  | { readonly kind: "refused"; readonly reason: string };

// a login call with the env a box gets for its model login (agent/login.ts)
export type TryLogin = (env: Readonly<Record<string, string>>) => Promise<Login>;

// tried : the pasted token tried by one real call before it is stored: a token the provider refuses is not stored, so
// the one stored before stays; one the call could not check is stored, with why
async function tried(token: Secret, meta: Meta, now: Date, login: TryLogin): Promise<Result<string>> {
  const box = boxToken({ token, meta, now });
  return box.kind === "refused" ? { kind: "failed", reason: box.reason } : noteOf(await login(box.env));
}

// noteOf : what a login call means for storing the token. Pure.
function noteOf(got: Login): Result<string> {
  switch (got.kind) {
    case "authorized":
      return { kind: "ok", value: "Anthropic accepted it (a real one-word call)" };
    case "refused":
      return {
        kind: "failed",
        reason: `Anthropic refused this token (HTTP ${got.status}); make a new one with claude setup-token`,
      };
    case "unknown":
      return { kind: "ok", value: `could not check it with Anthropic: ${got.reason}` };
    case "missing":
      return { kind: "ok", value: "could not check it with Anthropic: claude did not start" };
  }
}

export async function saveClaudeToken(input: {
  readonly store: TokenStore;
  readonly pasted: string;
  readonly now: Date;
  readonly login: TryLogin;
}): Promise<ClaudeSaved> {
  const checked = checkToken(input.pasted);
  if (checked.kind === "refused") {
    return { kind: "refused", reason: `not stored: ${checked.reason}` };
  }
  const meta = metaFor(input.now);
  const note = await tried(checked.token, meta, input.now, input.login);
  if (note.kind === "failed") {
    return { kind: "refused", reason: `not stored: ${note.reason}` };
  }
  const put = await input.store.put({ runner: "claude", token: checked.token, meta });
  return put.kind === "ok"
    ? { kind: "saved", where: input.store.where, meta, note: note.value }
    : { kind: "refused", reason: put.reason };
}

// saveCopilotToken : the copilot token, checked, kept until the expiry date the person typed
export async function saveCopilotToken(input: {
  readonly store: TokenStore;
  readonly pasted: string;
  readonly expires: string;
  readonly now: Date;
}): Promise<Saved> {
  const meta = copilotMeta(input.expires, input.now);
  if (meta.kind === "failed") {
    return { kind: "refused", reason: `not stored: ${meta.reason}` };
  }
  const checked = checkCopilotToken(input.pasted);
  if (checked.kind === "refused") {
    return { kind: "refused", reason: `not stored: ${checked.reason}` };
  }
  const put = await input.store.put({ runner: "copilot", token: checked.token, meta: meta.value });
  return put.kind === "ok"
    ? { kind: "saved", where: input.store.where, meta: meta.value }
    : { kind: "refused", reason: put.reason };
}

export type Status =
  | { readonly kind: "age"; readonly age: Age; readonly meta: Meta }
  // missing: no token was ever stored, as against one the store cannot read
  | { readonly kind: "none"; readonly reason: string; readonly missing: boolean };

export function claudeTokenStatus(input: { readonly store: TokenStore; readonly now: Date }): Promise<Status> {
  return tokenStatus({ ...input, runner: "claude" });
}

// tokenStatus : the age of a runner's token on record, or why there is none
export async function tokenStatus(input: {
  readonly store: TokenStore;
  readonly runner: "claude" | "copilot";
  readonly now: Date;
}): Promise<Status> {
  const stored = await input.store.get(input.runner);
  return stored.kind === "found"
    ? { kind: "age", age: tokenAge(stored.meta, input.now), meta: stored.meta }
    : { kind: "none", reason: stored.reason, missing: stored.kind === "missing" };
}

// boxTokenFrom : the dispatcher's one call before a box starts; no stored, unexpired token means no run
export async function boxTokenFrom(input: { readonly store: TokenStore; readonly now: Date }): Promise<BoxToken> {
  const stored = await input.store.get("claude");
  return stored.kind === "found"
    ? boxToken({ token: stored.token, meta: stored.meta, now: input.now })
    : { kind: "refused", reason: stored.reason };
}

// copilotLoginFrom : a Copilot run's login from the store, or why none may start
export async function copilotLoginFrom(input: { readonly store: TokenStore; readonly now: Date }): Promise<BoxToken> {
  const stored = await input.store.get("copilot");
  return stored.kind === "found"
    ? copilotLogin({ token: stored.token, meta: stored.meta, now: input.now })
    : { kind: "refused", reason: stored.reason };
}

// saveDiscordWebhook : the webhook the dispatcher pings through (#119), checked, then kept like the claude token
export async function saveDiscordWebhook(input: {
  readonly store: TokenStore;
  readonly pasted: string;
  readonly now: Date;
}): Promise<Saved> {
  const checked = checkWebhook(input.pasted);
  if (checked.kind === "refused") {
    return { kind: "refused", reason: `not stored: ${checked.reason}` };
  }
  const meta = webhookMeta(input.now);
  const put = await input.store.put({ runner: "discord", token: checked.token, meta });
  return put.kind === "ok"
    ? { kind: "saved", where: input.store.where, meta }
    : { kind: "refused", reason: put.reason };
}
