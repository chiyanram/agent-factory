#!/usr/bin/env node
// agent-factory — binds the command line (src/app.ts) to this process (#101).

import { runCli } from "./app.js";
import { runProcess } from "./core/forge/api.js";
import { readHidden } from "./core/token/index.js";

runCli(process.argv.slice(2), {
  env: process.env,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  readSecret: readHidden,
  system: { platform: process.platform, uid: process.getuid?.() ?? -1, run: runProcess },
}).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`agent-factory: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(64);
  },
);
