// rules — the model-only token's decisions, all pure (#136; ADR-0012 S6, S15). A run holds one token that "can only
// make model requests": Claude's from `claude setup-token`, one year; Copilot's a fine-grained GitHub token with only
// the "Copilot requests" permission, until the date its maker picked. Nothing here sees a real token except as a
// Secret, which never prints: String(), JSON and a template all give "[secret]".

// what the store keeps: each agent CLI's model-only token, the Discord webhook the dispatcher pings through, and the
// coordinator's own claude token, kept in the coordinator's own user's store (seatHome)
export type Runner = "claude" | "copilot" | "discord" | "claude-coordinator";

export type Secret = {
  readonly kind: "secret";
  readonly reveal: () => string;
  readonly toString: () => string;
  readonly toJSON: () => string;
};

export function secret(value: string): Secret {
  return { kind: "secret", reveal: () => value, toString: () => "[secret]", toJSON: () => "[secret]" };
}

export type Checked =
  | { readonly kind: "ok"; readonly token: Secret }
  | { readonly kind: "refused"; readonly reason: string };

type Rule = { readonly fails: (t: string) => boolean; readonly why: string };

// The developer's own GitHub login can push to or delete any repo they can reach (concern 2 on #30), so it is never
// taken as a box token, whatever the runner.
const GITHUB_LOGIN = /^(gho_|ghp_|ghu_|ghs_|ghr_|github_pat_)/;

const RULES: readonly Rule[] = [
  { fails: (t) => t.length === 0, why: "nothing was pasted" },
  {
    fails: (t) => GITHUB_LOGIN.test(t),
    why: "that is a GitHub login, not a model-only token; run: claude setup-token",
  },
  { fails: (t) => /\s/.test(t), why: "it holds a space or a line break; paste the token alone" },
  {
    fails: (t) => !/^[A-Za-z0-9._-]{20,512}$/.test(t),
    why: "it is not a token: 20 to 512 letters, digits, '.', '_' or '-'",
  },
];

// checked : the pasted text, trimmed at both ends, against the rules; the reason never quotes the text
function checked(pasted: string, rules: readonly Rule[]): Checked {
  const text = pasted.trim();
  const broken = rules.find((r) => r.fails(text));
  return broken === undefined ? { kind: "ok", token: secret(text) } : { kind: "refused", reason: broken.why };
}

// checkToken : a pasted claude token
export function checkToken(pasted: string): Checked {
  return checked(pasted, RULES);
}

// A fine-grained token is the only GitHub token whose permissions can stop at "Copilot requests"; a classic or app
// token reaches the person's repositories. Setup makes no call, so the permission itself is the person's word.
const COPILOT_RULES: readonly Rule[] = [
  { fails: (t) => t.length === 0, why: "nothing was pasted" },
  {
    fails: (t) => /^(gho_|ghp_|ghu_|ghs_|ghr_)/.test(t),
    why: "that is a classic or app token; make a fine-grained token with only the Copilot requests permission",
  },
  { fails: (t) => /\s/.test(t), why: "it holds a space or a line break; paste the token alone" },
  {
    fails: (t) => !/^github_pat_[A-Za-z0-9_]{20,255}$/.test(t),
    why: "it is not a fine-grained token: github_pat_ and 20 to 255 letters, digits or '_'",
  },
];

// checkCopilotToken : a pasted copilot token
export function checkCopilotToken(pasted: string): Checked {
  return checked(pasted, COPILOT_RULES);
}

export type Meta = { readonly madeAt: string; readonly expiresAt: string };

const DAY_MS = 24 * 60 * 60 * 1000;
export const WARN_DAYS = 7;

// metaFor : `claude setup-token` makes a "one-year OAuth token" (code.claude.com/docs/en/authentication)
export function metaFor(now: Date): Meta {
  const expires = new Date(now);
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  return { madeAt: now.toISOString(), expiresAt: expires.toISOString() };
}

export type Age =
  | { readonly kind: "valid"; readonly daysLeft: number }
  | { readonly kind: "expiring"; readonly daysLeft: number }
  | { readonly kind: "expired"; readonly since: string }
  | { readonly kind: "unknown"; readonly reason: string };

// tokenAge : a date that does not parse is unknown, and an unknown age never starts a box
export function tokenAge(meta: Meta, now: Date): Age {
  const expires = Date.parse(meta.expiresAt);
  if (Number.isNaN(expires)) {
    return { kind: "unknown", reason: `the expiry ${JSON.stringify(meta.expiresAt)} is not a date` };
  }
  const daysLeft = Math.floor((expires - now.getTime()) / DAY_MS);
  if (expires <= now.getTime()) {
    return { kind: "expired", since: meta.expiresAt };
  }
  return daysLeft < WARN_DAYS ? { kind: "expiring", daysLeft } : { kind: "valid", daysLeft };
}

// the longest a fine-grained token may live (GitHub's own limit is a year), in days from the start of today
const COPILOT_MOST_DAYS = 366;

// dateOf : the start of the day a YYYY-MM-DD names, in UTC, or undefined for text that names no real date. Pure.
function dateOf(text: string): Date | undefined {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : undefined;
  return at !== undefined && !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === text ? at : undefined;
}

// expiryProblem : why a token may not expire then, or "": it must be after today and at most COPILOT_MOST_DAYS away
function expiryProblem(expires: Date, now: Date): string {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (expires.getTime() <= today) {
    return "the expiry must be after today";
  }
  return expires.getTime() > today + COPILOT_MOST_DAYS * DAY_MS
    ? `the expiry must be at most ${COPILOT_MOST_DAYS} days away`
    : "";
}

// copilotMeta : the meta of a copilot token that expires on the date typed (YYYY-MM-DD), at the start of that day in
// UTC, so a warning comes early, never late; a date that is past, too far, or not a date is refused
export function copilotMeta(
  typed: string,
  now: Date,
): { readonly kind: "ok"; readonly value: Meta } | { readonly kind: "failed"; readonly reason: string } {
  const expires = dateOf(typed.trim());
  if (expires === undefined) {
    return { kind: "failed", reason: "the expiry must be the date GitHub shows for the token, as YYYY-MM-DD" };
  }
  const problem = expiryProblem(expires, now);
  return problem === ""
    ? { kind: "ok", value: { madeAt: now.toISOString(), expiresAt: expires.toISOString() } }
    : { kind: "failed", reason: problem };
}

export type Notice = { readonly kind: "none" } | { readonly kind: "warn"; readonly text: string };

export type BoxToken =
  | { readonly kind: "ready"; readonly env: Readonly<Record<string, string>>; readonly notice: Notice }
  | { readonly kind: "refused"; readonly reason: string };

export const RENEW = "renew it: claude setup-token, then agent-factory setup claude";

// boxToken : the env a box gets for its model login, or why no box may start. SUBPROCESS_ENV_SCRUB keeps the token out
// of Bash, hooks and MCP servers (ADR-0012 S6). The token comes only from the store, never from the host env.
export function boxToken(input: { readonly token: Secret; readonly meta: Meta; readonly now: Date }): BoxToken {
  const age = tokenAge(input.meta, input.now);
  const env = { CLAUDE_CODE_OAUTH_TOKEN: input.token.reveal(), CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" };
  switch (age.kind) {
    case "valid":
      return { kind: "ready", env, notice: { kind: "none" } };
    case "expiring":
      return {
        kind: "ready",
        env,
        notice: { kind: "warn", text: `the claude token expires in ${age.daysLeft} days; ${RENEW}` },
      };
    case "expired":
      return { kind: "refused", reason: `the claude token expired at ${age.since}; ${RENEW}` };
    case "unknown":
      return { kind: "refused", reason: `the claude token's age is unknown (${age.reason}); ${RENEW}` };
  }
}

const COPILOT_RENEW = "renew it: make a new fine-grained token, then agent-factory setup copilot";

// copilotLogin : the env a Copilot run gets for its login, or why none may start: COPILOT_GITHUB_TOKEN alone, because
// the CLI also takes GH_TOKEN, GITHUB_TOKEN and gh's stored login, each a git host token (ADR-0012 S6)
export function copilotLogin(input: { readonly token: Secret; readonly meta: Meta; readonly now: Date }): BoxToken {
  const age = tokenAge(input.meta, input.now);
  const env = { COPILOT_GITHUB_TOKEN: input.token.reveal() };
  switch (age.kind) {
    case "valid":
      return { kind: "ready", env, notice: { kind: "none" } };
    case "expiring":
      return {
        kind: "ready",
        env,
        notice: { kind: "warn", text: `the copilot token expires in ${age.daysLeft} days; ${COPILOT_RENEW}` },
      };
    case "expired":
      return { kind: "refused", reason: `the copilot token expired at ${age.since}; ${COPILOT_RENEW}` };
    case "unknown":
      return { kind: "refused", reason: `the copilot token's age is unknown (${age.reason}); ${COPILOT_RENEW}` };
  }
}

// A Discord webhook URL (#119): whoever holds it can post to its channel, so it is kept like a token. Only Discord's own
// hosts, an id and a token: no query, no fragment, nothing else a pasted text could carry.
const WEBHOOK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{1,30}\/[A-Za-z0-9_-]{20,200}$/;

// checkWebhook : the pasted text, trimmed, as a Discord webhook URL; the reason never quotes the text
export function checkWebhook(pasted: string): Checked {
  const text = pasted.trim();
  return WEBHOOK.test(text)
    ? { kind: "ok", token: secret(text) }
    : {
        kind: "refused",
        reason:
          "it is not a Discord webhook URL (https://discord.com/api/webhooks/<id>/<token>); copy it from the channel's Integrations",
      };
}

// webhookMeta : a webhook does not expire; it holds until someone deletes it in Discord
export function webhookMeta(now: Date): Meta {
  return { madeAt: now.toISOString(), expiresAt: "9999-12-31T00:00:00.000Z" };
}
