// rules — the model-only token's decisions, all pure (#136; ADR-0012 S6, S15). The box holds one token that "can only
// make model requests" (Claude: `claude setup-token`, one year). Nothing here sees a real token except as a Secret,
// which never prints: String(), JSON and a template all give "[secret]".

export type Runner = "claude";

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

// checkToken : the pasted text, trimmed at both ends, against the rules; the reason never quotes the text
export function checkToken(pasted: string): Checked {
  const text = pasted.trim();
  const broken = RULES.find((r) => r.fails(text));
  return broken === undefined ? { kind: "ok", token: secret(text) } : { kind: "refused", reason: broken.why };
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

export type Notice = { readonly kind: "none" } | { readonly kind: "warn"; readonly text: string };

export type BoxToken =
  | { readonly kind: "ready"; readonly env: Readonly<Record<string, string>>; readonly notice: Notice }
  | { readonly kind: "refused"; readonly reason: string };

const RENEW = "renew it: claude setup-token, then agent-factory setup claude";

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
