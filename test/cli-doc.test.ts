import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND_NAMES, HELP_COMMANDS, INTERNAL, runCli } from "../src/app.js";

const CLI_MD = readFileSync(join(import.meta.dirname, "..", "docs", "reference", "cli.md"), "utf8");
const FOR_YOU = COMMAND_NAMES.filter((name) => !INTERNAL.has(name));
const INTERNAL_NAMES = COMMAND_NAMES.filter((name) => INTERNAL.has(name));

async function help(argv: readonly string[]): Promise<{ readonly code: number; readonly out: string }> {
  let out = "";
  const io = {
    env: {},
    out: (t: string) => (out += t),
    err: () => undefined,
    readSecret: async () => "",
    readStdin: async () => "",
    system: {
      platform: "linux" as const,
      uid: 1,
      gid: 1,
      run: async () => ({ code: 1, stdout: "", stderr: "" }),
      interactive: async () => 0,
      background: async () => ({ kind: "failed" as const, reason: "none here" }),
      agent: async () => ({ code: 127, stdout: "", stderr: "no agent CLI in this test" }),
    },
  };
  const code = await runCli(argv, io);
  return { code, out };
}

function section(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}\n`);
  if (start === -1) {
    return "";
  }
  const body = text.slice(start + heading.length + 2);
  const end = body.search(/^\S/m);
  return end === -1 ? body : body.slice(0, end);
}

function lists(text: string, name: string): boolean {
  return new RegExp(`^ {2}${name}(?:\\s|$)`, "m").test(text);
}

function mdSection(heading: string): string {
  const start = CLI_MD.indexOf(`\n## ${heading}\n`);
  if (start === -1) {
    return "";
  }
  const rest = CLI_MD.slice(start + 1);
  const next = rest.indexOf("\n## ", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

function names(text: string, name: string): boolean {
  return new RegExp(`\`agent-factory ${name}[ \`]`).test(text);
}

const FOR_YOU_HEADING = "for you:";
const INTERNAL_HEADING = "internal: the coordinator's, the orchestrator's and the hooks'";

describe("docs/reference/cli.md lists every command (#482)", () => {
  it("names each command the CLI takes as `agent-factory <command>`", () => {
    const missing = COMMAND_NAMES.filter((name) => !names(CLI_MD, name));
    expect(missing).toEqual([]);
  });

  it("puts each for-you command in 'You run these' and each internal one in another group (#767)", () => {
    const you = mdSection("You run these");
    const others = mdSection("The coordinator runs these") + mdSection("The orchestrator and the host run these");
    const misplaced = COMMAND_NAMES.filter((name) =>
      INTERNAL.has(name) ? names(you, name) || !names(others, name) : !names(you, name) || names(others, name),
    );
    expect(misplaced).toEqual([]);
  });
});

describe("--help shows the person's commands, --help --all the internal ones too (#767)", () => {
  it("every INTERNAL name is a command the CLI takes", () => {
    expect([...INTERNAL].filter((name) => !COMMAND_NAMES.includes(name))).toEqual([]);
  });

  it("each help block starts with a command's name, so no line is cut off from its command", () => {
    const first = HELP_COMMANDS.split("\n")
      .filter((line) => /^ {2}\S/.test(line))
      .map((line) => line.trim().split(/\s/)[0] ?? "");
    expect(first.filter((name) => !COMMAND_NAMES.includes(name))).toEqual([]);
  });

  it("--help lists each for-you command under 'for you:' and no internal one", async () => {
    const run = await help(["--help"]);
    expect(run.code).toBe(0);
    const yours = section(run.out, FOR_YOU_HEADING);
    expect(FOR_YOU.filter((name) => !lists(yours, name))).toEqual([]);
    expect(INTERNAL_NAMES.filter((name) => lists(run.out, name))).toEqual([]);
    expect(run.out).toContain("agent-factory --help --all");
    expect(run.out).not.toContain(INTERNAL_HEADING);
  });

  it("--help --all lists each command in exactly one group", async () => {
    const run = await help(["--help", "--all"]);
    expect(run.code).toBe(0);
    const yours = section(run.out, FOR_YOU_HEADING);
    const internal = section(run.out, INTERNAL_HEADING);
    const wrong = COMMAND_NAMES.filter((name) =>
      INTERNAL.has(name) ? !lists(internal, name) || lists(yours, name) : !lists(yours, name) || lists(internal, name),
    );
    expect(wrong).toEqual([]);
  });

  it("--help --all's command lines are today's lines, only regrouped", async () => {
    const run = await help(["--help", "--all"]);
    const shown = (section(run.out, FOR_YOU_HEADING) + section(run.out, INTERNAL_HEADING)).split("\n");
    const today = HELP_COMMANDS.split("\n");
    const sorted = (lines: readonly string[]) => lines.filter((line) => line !== "").toSorted();
    expect(sorted(shown)).toEqual(sorted(today));
  });

  it("an unknown command, and --all without --help, print the short help with exit 64", async () => {
    const short = (await help(["--help"])).out;
    for (const argv of [["no-such-command"], [], ["--all"]]) {
      const run = await help(argv);
      expect({ argv, code: run.code, short: run.out === short }).toEqual({ argv, code: 64, short: true });
    }
  });

  it("--help --all wins over a command name, as --help does", async () => {
    const all = (await help(["--help", "--all"])).out;
    expect(await help(["poll", "--help", "--all"])).toEqual({ code: 0, out: all });
  });
});
