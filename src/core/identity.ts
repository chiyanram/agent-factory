// identity — who the factory acts as on a project's forge: the developer's own login, or a GitHub App (#108; ADR-0012
// S14). The host (dispatcher, poll) acts with it; no LLM seat and no box ever gets it.
//
//   FACTORY_IDENTITY     own (default): the developer's own gh or glab login, at work and wherever there is no bot
//                        app: a GitHub App, whose key belongs to the factory OS user (src/core/app-token.ts)
//   FACTORY_APP_USER     the OS user that holds the App's key (default: factory)
//   FACTORY_APP_COMMAND  the root-owned wrapper the sudo rule names, by absolute path (default:
//                        /usr/local/bin/agent-factory-app-token); it runs `<node> <root-owned checkout>/dist/cli.js
//                        app-token "$1"` with absolute paths, so neither this user's PATH nor its files choose the program
//
// With app, the host asks for a token with `sudo -n -u <user> -- <command> <owner/name>`: -n, so a missing rule fails
// instead of asking for a password. The token lives in this process and in the environment of the gh calls and git
// pushes this process makes, never in a file of this user's or a setting. A token with less than 10 minutes left is
// refused: resolve the identity again right before a push or a post that follows a long run.
//
// Today: any process of this user can run the same sudo line and get a token, the coordinator's Bash tool included.
// The coordinator's deny list (#106) must deny sudo; until it does, keep FACTORY_IDENTITY=app off where a coordinator
// session runs unattended.

import type { Exit, Result, Runner } from "./forge/api.js";

export type IdentitySetting =
  | { readonly kind: "own" }
  | { readonly kind: "app"; readonly user: string; readonly command: string };

export type Identity =
  | { readonly kind: "own" }
  | { readonly kind: "app"; readonly token: string; readonly login: string; readonly expiresAt: string };

const USER = /^[a-z_][a-z0-9_-]{0,31}$/;

function appSetting(env: NodeJS.ProcessEnv): Result<IdentitySetting> {
  const user = env.FACTORY_APP_USER ?? "factory";
  const command = env.FACTORY_APP_COMMAND ?? "/usr/local/bin/agent-factory-app-token";
  if (!USER.test(user)) {
    return { kind: "failed", reason: `FACTORY_APP_USER must be an OS user name, got ${JSON.stringify(user)}` };
  }
  if (!/^\/[A-Za-z0-9_./@-]+$/.test(command) || command.includes("/../")) {
    return { kind: "failed", reason: `FACTORY_APP_COMMAND must be an absolute path, got ${JSON.stringify(command)}` };
  }
  return { kind: "ok", value: { kind: "app", user, command } };
}

// identitySetting : the project's identity setting. A value that is set but not known is refused, never guessed.
export function identitySetting(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly forge: "github" | "gitlab";
}): Result<IdentitySetting> {
  const kind = input.env.FACTORY_IDENTITY ?? "own";
  if (kind === "own") {
    return { kind: "ok", value: { kind: "own" } };
  }
  if (kind !== "app") {
    return { kind: "failed", reason: `FACTORY_IDENTITY must be own or app, got ${JSON.stringify(kind)}` };
  }
  return input.forge === "github"
    ? appSetting(input.env)
    : { kind: "failed", reason: "FACTORY_IDENTITY=app is a GitHub App; on GitLab a bot is its own glab login (own)" };
}

// the least time a token must have left when the host takes it
export const MIN_LEFT_SECONDS = 600;

function lasts(expiresAt: unknown, now: number): boolean {
  return typeof expiresAt === "string" && Date.parse(expiresAt) / 1000 > now + MIN_LEFT_SECONDS;
}

function parseMinted(exit: Exit, now: number): Result<Identity> {
  try {
    const raw = JSON.parse(exit.stdout) as { token?: unknown; login?: unknown; expiresAt?: unknown };
    const { token, login, expiresAt } = raw;
    const valid =
      typeof token === "string" &&
      /^[A-Za-z0-9_]{20,}$/.test(token) &&
      typeof login === "string" &&
      /^[A-Za-z0-9-]+\[bot\]$/.test(login);
    if (!valid) {
      return { kind: "failed", reason: "app-token answered with no valid token or login" };
    }
    return lasts(expiresAt, now)
      ? { kind: "ok", value: { kind: "app", token, login, expiresAt: String(expiresAt) } }
      : { kind: "failed", reason: "app-token gave a token with less than 10 minutes left" };
  } catch {
    return { kind: "failed", reason: "app-token did not answer JSON" };
  }
}

// resolveIdentity : the identity to act with. For an App, one sudo call to the factory user for a token.
export async function resolveIdentity(input: {
  readonly setting: IdentitySetting;
  readonly project: string;
  readonly run: Runner;
  readonly env: NodeJS.ProcessEnv;
  readonly now: number;
}): Promise<Result<Identity>> {
  const { setting } = input;
  if (setting.kind === "own") {
    return { kind: "ok", value: { kind: "own" } };
  }
  const args = ["-n", "-u", setting.user, "--", setting.command, input.project];
  const exit = await input.run({ bin: "sudo", args, stdin: "", env: input.env });
  if (exit.code !== 0) {
    const said = (exit.stderr.split("\n")[0] ?? "").trim();
    return {
      kind: "failed",
      reason: `cannot get the App's token as ${setting.user} (sudo -n -u ${setting.user} -- ${setting.command} ${input.project}): ${said}`,
    };
  }
  return parseMinted(exit, input.now);
}
