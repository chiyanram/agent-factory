#!/usr/bin/env node
// agent-factory — binds the command line (src/app.ts) to this process (#101).

import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { constants } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./app.js";
import { runInFolder } from "./core/agent/folder.js";
import { latestRelease } from "./core/init/latest.js";
import { runProcess } from "./core/forge/api.js";
import { readHidden } from "./core/token/index.js";
import { createInterface, type Interface } from "node:readline/promises";

// readLine : one line typed at the terminal, for init's questions (#369); one reader for the whole command
let lines: Interface | undefined;
function readLine(prompt: string): Promise<string> {
  lines ??= createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY });
  return lines.question(prompt).catch(() => "");
}

// background : this command line again, detached from this terminal, its output appended to the log, so it outlives
// the command that started it (the orchestrator loop, #305). It gets this process's own environment, so it resolves
// the settings layers itself.
function background(call: {
  readonly args: readonly string[];
  readonly log: string;
}): Promise<{ readonly kind: "ok"; readonly value: number } | { readonly kind: "failed"; readonly reason: string }> {
  let out: number;
  try {
    mkdirSync(dirname(call.log), { recursive: true, mode: 0o700 });
    out = openSync(call.log, "a", 0o600);
  } catch {
    return Promise.resolve({ kind: "failed", reason: `cannot open ${call.log}` });
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...call.args], {
      detached: true,
      stdio: ["ignore", out, out],
      env: process.env,
    });
    closeSync(out);
    child.once("error", (error) => resolve({ kind: "failed", reason: error.message }));
    child.once("spawn", () => {
      child.unref();
      resolve({ kind: "ok", value: child.pid ?? 0 });
    });
  });
}

runCli(process.argv.slice(2), {
  env: process.env,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  readSecret: readHidden,
  ...(process.stdin.isTTY ? { readLine } : {}),
  latestRelease: () => latestRelease((url) => fetch(url, { signal: AbortSignal.timeout(5000) })),
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks).toString("utf8");
  },
  system: {
    platform: process.platform,
    uid: process.getuid?.() ?? -1,
    gid: process.getgid?.() ?? -1,
    run: runProcess,
    background,
    agent: runInFolder,
    interactive: ({ bin, args, cwd, env, signal }) =>
      new Promise((resolve) => {
        // Ctrl-C reaches the session, which uses it to stop a turn; the launcher waits for the session to end
        const ignore = (): void => undefined;
        process.on("SIGINT", ignore);
        process.on("SIGQUIT", ignore);
        const done = (code: number): void => {
          process.off("SIGINT", ignore);
          process.off("SIGQUIT", ignore);
          resolve(code);
        };
        const child = spawn(bin, [...args], { cwd, env, stdio: "inherit", ...(signal ? { signal } : {}) });
        child.on("error", (error) => {
          // an abort ends the session on purpose: its exit resolves the launch
          if (error.name === "AbortError") {
            return;
          }
          process.stderr.write(`agent-factory: cannot start ${bin}: ${error.message}\n`);
          done(127);
        });
        child.on("exit", (code, killedBy) =>
          done(code ?? 128 + (killedBy === null ? 0 : (constants.signals[killedBy] ?? 0))),
        );
      }),
  },
}).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`agent-factory: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(64);
  },
);
