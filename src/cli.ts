#!/usr/bin/env node
// agent-factory — the command line entry (#101). Thin: parse arguments, call core, print. A UI replaces only this file.

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runPoll } from "./core/poll.js";

const HELP = `usage: agent-factory <command>

commands:
  poll        one line of facts per open change (wraps scripts/poll.sh)

options:
  --help      show this help
  --version   show the package version
  --json      poll: print the parsed records as JSON
`;

function version(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version: string };
  return pkg.version;
}

async function poll(json: boolean): Promise<number> {
  const result = await runPoll();
  switch (result.kind) {
    case "failed":
      process.stderr.write(`agent-factory poll: scripts/poll.sh exited ${result.exitCode}\n${result.stderr}`);
      return result.exitCode;
    case "ok": {
      const errors = result.lines.filter((line) => line.kind === "parse-error");
      const out = json ? result.lines.map((line) => JSON.stringify(line)) : result.raw;
      process.stdout.write(out.map((line) => `${line}\n`).join(""));
      errors.forEach((e) => process.stderr.write(`agent-factory poll: ${e.reason}: ${e.line}\n`));
      return errors.length > 0 ? 2 : 0;
    }
  }
}

type Command = { readonly name: string; readonly run: (json: boolean) => Promise<number> };

const COMMANDS: readonly Command[] = [{ name: "poll", run: poll }];

async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { help: { type: "boolean" }, version: { type: "boolean" }, json: { type: "boolean" } },
  });
  if (values.version === true) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  const command = COMMANDS.find((c) => c.name === positionals[0]);
  if (values.help === true || command === undefined) {
    process.stdout.write(HELP);
    return values.help === true ? 0 : 64;
  }
  return command.run(values.json === true);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`agent-factory: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(64);
  },
);
