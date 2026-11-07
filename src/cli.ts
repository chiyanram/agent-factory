#!/usr/bin/env node
// agent-factory — the command line entry (#101). Thin: parse arguments, call core, print. A UI replaces only this file.

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { runPoll } from "./core/poll.js";
import { checkSpec, readSpec, template } from "./core/spec.js";

const HELP = `usage: agent-factory <command>

commands:
  poll                         one line of facts per open change (wraps scripts/poll.sh)
  spec <project> <ticket>      check a ticket's local spec: its hash, or what it is missing
  spec --template <ticket>     print an empty spec to fill in

options:
  --help      show this help
  --version   show the package version
  --json      poll: print the parsed records as JSON

settings:
  FACTORY_HOME   where specs and approvals live (default ~/.factory): <home>/specs/<project>/<ticket>/spec.md
`;

type Args = { readonly json: boolean; readonly template: boolean; readonly positionals: readonly string[] };

function factoryHome(): string {
  return process.env.FACTORY_HOME ?? join(homedir(), ".factory");
}

function version(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version: string };
  return pkg.version;
}

async function poll({ json }: Args): Promise<number> {
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

// spec : one line "spec <project>/<ticket> <hash> <path>" for a spec that follows the template (exit 0); its problems
// (exit 2); or why it cannot be read (exit 1). The hash is what `approve` (#104) asks the human to confirm.
async function spec({ template: wantTemplate, positionals }: Args): Promise<number> {
  if (wantTemplate) {
    const [ticket] = positionals;
    if (ticket === undefined) {
      process.stderr.write("usage: agent-factory spec --template <ticket>\n");
      return 64;
    }
    process.stdout.write(template(ticket));
    return 0;
  }
  const [project, ticket] = positionals;
  if (project === undefined || ticket === undefined) {
    process.stderr.write("usage: agent-factory spec <project> <ticket>\n");
    return 64;
  }
  const read = await readSpec({ kind: "local", root: join(factoryHome(), "specs") }, project, ticket);
  switch (read.kind) {
    case "refused":
      process.stderr.write(`agent-factory spec: ${read.reason}\n`);
      return 1;
    case "missing":
      process.stderr.write(`agent-factory spec: no spec at ${read.where}; start one with: agent-factory spec --template ${ticket}\n`);
      return 1;
    case "found": {
      const checked = checkSpec(read.text);
      if (checked.kind === "invalid") {
        process.stderr.write(`agent-factory spec: ${read.where} is not ready:\n${checked.problems.map((p) => `  - ${p}\n`).join("")}`);
        return 2;
      }
      process.stdout.write(`spec ${project}/${ticket} ${checked.spec.hash} ${read.where}\n`);
      return 0;
    }
  }
}

type Command = { readonly name: string; readonly run: (args: Args) => Promise<number> };

const COMMANDS: readonly Command[] = [
  { name: "poll", run: poll },
  { name: "spec", run: spec },
];

async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      help: { type: "boolean" },
      version: { type: "boolean" },
      json: { type: "boolean" },
      template: { type: "boolean" },
    },
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
  return command.run({ json: values.json === true, template: values.template === true, positionals: positionals.slice(1) });
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`agent-factory: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(64);
  },
);
