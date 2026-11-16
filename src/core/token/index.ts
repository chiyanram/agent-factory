// index — `agent-factory setup claude`, `setup copilot` and the token half of `setup status` (#136). The operator makes the token
// (`claude setup-token` prints it once), pastes it at a hidden prompt, and setup stores it: no agent ever sees it, and
// it is never printed, logged or put in an env file. The dispatcher calls boxTokenFrom before each run.

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
} from "./rules.js";
import type { TokenStore } from "./store.js";

export {
  boxToken,
  checkCopilotToken,
  checkToken,
  copilotLogin,
  copilotMeta,
  checkWebhook,
  metaFor,
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

export async function saveClaudeToken(input: {
  readonly store: TokenStore;
  readonly pasted: string;
  readonly now: Date;
}): Promise<Saved> {
  const checked = checkToken(input.pasted);
  if (checked.kind === "refused") {
    return { kind: "refused", reason: `not stored: ${checked.reason}` };
  }
  const meta = metaFor(input.now);
  const put = await input.store.put({ runner: "claude", token: checked.token, meta });
  return put.kind === "ok"
    ? { kind: "saved", where: input.store.where, meta }
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
