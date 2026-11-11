import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND_NAMES, runCli } from "../src/app.js";

const CLI_MD = readFileSync(join(import.meta.dirname, "..", "docs", "reference", "cli.md"), "utf8");

describe("docs/reference/cli.md lists every command (#482)", () => {
  it("names each command the CLI takes as `agent-factory <command>`", () => {
    const missing = COMMAND_NAMES.filter((name) => !CLI_MD.includes(`\`agent-factory ${name}`));
    // a name here: add the command to its group in docs/reference/cli.md
    expect(missing).toEqual([]);
  });

  it("the list is the CLI's: each name is a command it runs, not the help text", async () => {
    let help = "";
    const io = {
      env: {},
      out: (t: string) => (help += t),
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
      },
    };
    expect(await runCli(["--help"], io)).toBe(0);
    const listed = COMMAND_NAMES.filter((name) => new RegExp(`^  ${name}\\b`, "m").test(help));
    expect(listed).toEqual(COMMAND_NAMES);
  });
});
