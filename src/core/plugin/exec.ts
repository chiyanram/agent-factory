// exec — runs one plugin command (#134; ADR-0014 P1): spawned, never through a shell, so no word of a request is ever parsed
// as a command; a timeout, after which the plugin is killed; and a cap on what it prints, past which it is killed too.
// The request goes in on stdin as one JSON object. Nothing here throws.

import { spawn } from "node:child_process";

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

// killGroup : the plugin and every process it started; a plugin never outlives its call, so no write goes on after a
// timeout or a cut
function killGroup(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // the group is gone already
  }
}

type End = { readonly code: number | null; readonly signal: NodeJS.Signals | null };

function finished(end: End, out: { stdout: string; stderr: string }): Ran {
  return end.code === null
    ? { kind: "failed", reason: `the plugin was killed by ${end.signal ?? "a signal"}` }
    : { kind: "exited", code: end.code, ...out };
}

// runPlugin : the plugin's answer, or why there is none. spawn with no shell, in a process group of its own, so the
// timeout, the cap and the end of the call kill all of it; stdout and stderr together may hold at most maxBytes.
export const runPlugin: Exec = (input) =>
  new Promise((resolve) => {
    const out = { stdout: "", stderr: "" };
    let size = 0;
    let stop: Ran | "none" = "none";
    const child = spawn(input.path, [...input.args], {
      env: input.env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const halt = (why: Ran): void => {
      stop = stop === "none" ? why : stop;
      killGroup(child.pid);
    };
    const timer = setTimeout(() => halt({ kind: "timedOut", ms: input.limits.timeoutMs }), input.limits.timeoutMs);
    const take = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      size += chunk.length;
      if (size > input.limits.maxBytes) {
        halt({ kind: "overCap", bytes: input.limits.maxBytes });
        return;
      }
      out[stream] += chunk.toString("utf8");
    };
    child.stdout.on("data", take("stdout"));
    child.stderr.on("data", take("stderr"));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        kind: "failed",
        reason: `cannot start the plugin: ${"code" in error ? String(error.code) : error.message}`,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      killGroup(child.pid);
      resolve(stop === "none" ? finished({ code, signal }, out) : stop);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input.stdin);
  });
