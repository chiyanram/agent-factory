// exec — runs one plugin command (#134; ADR-0014 P1): execFile, never a shell, so no word of a request is ever parsed
// as a command; a timeout, after which the plugin is killed; and a cap on what it prints, past which it is killed too.
// The request goes in on stdin as one JSON object. Nothing here throws.

import { execFile } from "node:child_process";

export type Limits = { readonly timeoutMs: number; readonly maxBytes: number };

export const DEFAULT_LIMITS: Limits = { timeoutMs: 60_000, maxBytes: 1024 * 1024 };

export type Ran =
  | { readonly kind: "exited"; readonly code: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "timedOut"; readonly ms: number }
  | { readonly kind: "overCap"; readonly bytes: number }
  | { readonly kind: "failed"; readonly reason: string };

export type Exec = (input: {
  readonly path: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly env: NodeJS.ProcessEnv;
  readonly limits: Limits;
}) => Promise<Ran>;

function field(error: unknown, name: string): unknown {
  return typeof error === "object" && error !== null ? (Reflect.get(error, name) as unknown) : undefined;
}

// why : a non-exit end of the run: over the cap, killed for time, or a plugin that never started
function why(error: unknown, limits: Limits): Ran {
  const code = field(error, "code");
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return { kind: "overCap", bytes: limits.maxBytes };
  }
  return field(error, "killed") === true
    ? { kind: "timedOut", ms: limits.timeoutMs }
    : { kind: "failed", reason: `cannot start the plugin: ${typeof code === "string" ? code : "unknown error"}` };
}

function ended(error: unknown, out: { stdout: string; stderr: string }, limits: Limits): Ran {
  if (error === null) {
    return { kind: "exited", code: 0, ...out };
  }
  const code = field(error, "code");
  const killed = field(error, "killed") === true;
  return typeof code === "number" && !killed ? { kind: "exited", code, ...out } : why(error, limits);
}

// runPlugin : the plugin's answer, or why there is none
export const runPlugin: Exec = (input) =>
  new Promise((resolve) => {
    const child = execFile(
      input.path,
      [...input.args],
      {
        env: input.env,
        timeout: input.limits.timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: input.limits.maxBytes,
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout, stderr) => resolve(ended(error, { stdout, stderr }, input.limits)),
    );
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input.stdin);
  });
