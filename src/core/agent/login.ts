// login — whether the agent CLI's login works, proved by one real call through the CLI (#665). A token's date on record
// says only that it should work; the provider can revoke it, and a CLI change can stop it working for -p runs,
// with nothing changed on disk. So only a call the provider answers may say "authorized", only a 401 may say
// "refused", and anything else is "could not check", which never reads as worse than it is.
//
// The call is `claude -p` with one fixed prompt: no tools, no MCP servers, no settings files, one turn, with the
// environment a run of that kind gets. It is a model call holding a model-only login and nothing else (ADR-0012 S6):
// no git host token, no FACTORY_* setting, no skip-permissions flag. It costs about a cent.
//
// Through the CLI, never a direct HTTP call: the CLI is what a run uses, and a direct call with a setup-token would
// have to present itself as Claude Code. Any later direct key check must not follow a redirect (fetch's redirect:
// "manual"), reading a 3xx as could-not-check, so a key is never sent on to another host.

import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prop } from "../dispatch/records.js";
import { NO_STREAM, streamOf } from "../dispatch/spend.js";
import type { Exit } from "../forge/api.js";
import { CANNOT_START, timed, type FolderRunner } from "./folder.js";

export type Login =
  | { readonly kind: "authorized" }
  | { readonly kind: "refused"; readonly status: number }
  | { readonly kind: "unknown"; readonly reason: string }
  | { readonly kind: "missing" };

// how long the call may take: a refusal came back in 4 s; offline, the CLI retries for minutes
export const LOGIN_MS = 60_000;

export const LOGIN_ARGS: readonly string[] = [
  "-p",
  "Reply with the word ok",
  "--restricted",
  "--strict-mcp-config",
  "--tools",
  "",
  "--max-turns",
  "1",
  "--output-format",
  "stream-json",
  "--verbose",
];

// how to renew the login a run on this host gets from this shell (claude.ts CLAUDE_ENV) once Anthropic refused it
export const SIGN_IN =
  "run claude and sign in with /login; unset a stale ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or CLAUDE_CODE_OAUTH_TOKEN in your shell";

// refusedLogin : the run's result event says the provider refused its login (HTTP 401). Pure.
export function refusedLogin(answer: unknown): boolean {
  return prop(answer, "api_error_status") === 401;
}

// loginOf : what one login call proved. A call past its limit stands on a result event it printed in time. It never
// quotes the CLI's output. Pure.
export function loginOf(exit: Exit, late: boolean, limitMs: number): Login {
  const answer = streamOf(NO_STREAM, `${exit.stdout}\n`).result;
  if (late && answer === undefined) {
    return {
      kind: "unknown",
      reason: `no answer within ${Math.round(limitMs / 1000)} s (offline, or a proxy that holds the call?)`,
    };
  }
  return exit.code === CANNOT_START ? { kind: "missing" } : answered(exit.code, answer);
}

// answered : the verdict of a call that ran: only a 401 is refused, only a result the CLI marked ok is authorized
function answered(code: number, answer: unknown): Login {
  if (refusedLogin(answer)) {
    return { kind: "refused", status: 401 };
  }
  return code === 0 && prop(answer, "is_error") === false ? { kind: "authorized" } : unsure(code, answer);
}

// unsure : why a call that was neither accepted nor refused could not tell
function unsure(code: number, answer: unknown): Login {
  const status = prop(answer, "api_error_status");
  if (typeof status === "number") {
    return { kind: "unknown", reason: `the API answered HTTP ${status}` };
  }
  return { kind: "unknown", reason: `claude exited ${code} with no ${answer === undefined ? "result" : "answer"}` };
}

// what a login of its own must not inherit from this shell: another login, and the CLI's own config folder
function ownLogin(name: string): boolean {
  return (
    name.startsWith("ANTHROPIC_") ||
    name === "CLAUDE_CODE_OAUTH_TOKEN" ||
    name === "CLAUDE_CONFIG_DIR" ||
    name === "HOME"
  );
}

// loginEnv : the call's environment. With a token, the token alone in a private empty HOME, as a writer's box gets it
// (S15); without one, the claude env as this shell gives it, which is what the read-only runs on this host use. Pure.
export function loginEnv(
  env: NodeJS.ProcessEnv,
  token: Readonly<Record<string, string>> | undefined,
  folder: string,
): NodeJS.ProcessEnv {
  if (token === undefined) {
    return env;
  }
  const kept = Object.fromEntries(Object.entries(env).filter(([name]) => !ownLogin(name)));
  return { ...kept, HOME: folder, ...token };
}

export type LoginSetup = {
  readonly bin: string;
  // the claude env (claude.ts claudeEnv): no git host token, no FACTORY_*
  readonly env: NodeJS.ProcessEnv;
  readonly run: FolderRunner;
  // the call's limit; LOGIN_MS unless a test shortens it
  readonly ms: number | undefined;
};

// claudeLogin : one login call in a fresh empty folder, removed after; the token, when given, is the only login
export function claudeLogin(setup: LoginSetup): (token?: Readonly<Record<string, string>>) => Promise<Login> {
  return async (token) => {
    // by its real path: on macOS the temp folder sits behind a symlink, and HOME must name the folder the CLI runs in
    const folder = await realpath(await mkdtemp(join(tmpdir(), "factory-login-")));
    try {
      const call = { bin: setup.bin, args: LOGIN_ARGS, env: loginEnv(setup.env, token, folder), cwd: folder };
      const ms = setup.ms ?? LOGIN_MS;
      const { exit, late } = await timed(setup.run, call, ms);
      return loginOf(exit, late, ms);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  };
}
