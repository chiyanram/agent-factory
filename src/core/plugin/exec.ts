// exec — runs one plugin command (#134; ADR-0014 P1): spawned, never through a shell, so no word of a request is ever parsed
// as a command; a timeout, after which the plugin is killed; and a cap on what it prints, past which it is killed too.
// The request goes in on stdin as one JSON object. The plugin runs in a process group of its own, and the timeout, the
// cap and the end of the call kill the whole group, so no write goes on after a call ends. Each stream decodes through
// its own StringDecoder, so a UTF-8 character split across two chunks stays whole. Nothing here throws.

import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { signalGroup } from "../forge/api.js";

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

type End = { readonly code: number | null; readonly signal: NodeJS.Signals | null };

function finished(end: End, out: { stdout: string; stderr: string }): Ran {
  return end.code === null
    ? { kind: "failed", reason: `the plugin was killed by ${end.signal ?? "a signal"}` }
    : { kind: "exited", code: end.code, ...out };
}

export const runPlugin: Exec = (input) =>
  new Promise((resolve) => {
    const out = { stdout: "", stderr: "" };
    const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
    let size = 0;
    let stop: Ran | "none" = "none";
    let failed = "";
    const child = spawn(input.path, [...input.args], {
      env: input.env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const halt = (why: Ran): void => {
      stop = stop === "none" ? why : stop;
      failed += signalGroup(child.pid, "SIGKILL");
    };
    const timer = setTimeout(() => halt({ kind: "timedOut", ms: input.limits.timeoutMs }), input.limits.timeoutMs);
    const take = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      size += chunk.length;
      if (size > input.limits.maxBytes) {
        halt({ kind: "overCap", bytes: input.limits.maxBytes });
        return;
      }
      out[stream] += decoders[stream].write(chunk);
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
      failed += signalGroup(child.pid, "SIGKILL");
      out.stdout += decoders.stdout.end();
      out.stderr += decoders.stderr.end() + failed;
      resolve(stop === "none" ? finished({ code, signal }, out) : stop);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input.stdin);
  });
