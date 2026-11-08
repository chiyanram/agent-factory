#!/usr/bin/env node
// agent-factory — binds the command line (src/app.ts) to this process (#101).

import { spawn } from "node:child_process";
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
        const child = spawn(bin, [...args], { cwd, env, stdio: "inherit" });
        child.on("error", (error) => {
          process.stderr.write(`agent-factory: cannot start ${bin}: ${error.message}\n`);
          resolve(127);
        });
        child.on("exit", (code) => resolve(code ?? 1));
      }),
  },
}).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`agent-factory: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(64);
  },
);
