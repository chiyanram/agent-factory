#!/usr/bin/env node
// agent-factory — binds the command line (src/app.ts) to this process (#101).

import { spawn } from "node:child_process";
import { constants } from "node:os";
import { runCli } from "./app.js";
import { runProcess } from "./core/forge/api.js";
import { readHidden } from "./core/token/index.js";

runCli(process.argv.slice(2), {
  env: process.env,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  readSecret: readHidden,
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
    interactive: ({ bin, args, cwd, env }) =>
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
        const child = spawn(bin, [...args], { cwd, env, stdio: "inherit" });
        child.on("error", (error) => {
          process.stderr.write(`agent-factory: cannot start ${bin}: ${error.message}\n`);
          done(127);
        });
        child.on("exit", (code, signal) =>
          done(code ?? 128 + (signal === null ? 0 : (constants.signals[signal] ?? 0))),
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
