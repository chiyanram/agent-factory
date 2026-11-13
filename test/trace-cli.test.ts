import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, type Io } from "../src/app.js";
import { traceName, TRACE_DAYS } from "../src/core/dispatch/trace.js";
import { sizeOf, traceCommand } from "../src/trace-cli.js";
import { tempDir } from "./temp.js";

// agent-factory trace lists a ticket's traces, or prints one, and deletes those past 30 days first (#487).

const DAY = 24 * 60 * 60_000;
const NOW = Date.parse("2026-11-13T06:07:15.123Z");

let home = "";
let out: string[] = [];
let err: string[] = [];
const io = () => ({ home, now: () => NOW, out: (t: string) => out.push(t), err: (t: string) => err.push(t) });
const dir = () => join(home, "runs", "ledger", "PROJ-1");

beforeEach(() => {
  home = tempDir("trace-cli-");
  out = [];
  err = [];
  mkdirSync(dir(), { recursive: true });
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("agent-factory trace (#487)", () => {
  it("lists the ticket's traces with time, kind and size, after deleting those past 30 days", async () => {
    const recent = traceName({ kind: "writer", at: NOW - DAY });
    const old = traceName({ kind: "writer", at: NOW - (TRACE_DAYS + 1) * DAY });
    writeFileSync(join(dir(), recent), '{"a":1}\n');
    writeFileSync(join(dir(), old), '{"a":1}\n');
    expect(await traceCommand(["ledger", "PROJ-1"], io())).toBe(0);
    expect(out.join("")).toBe(
      [
        "traces of ledger PROJ-1, newest first, kept 30 days (times in UTC)",
        `2026-11-12T06:07:15.123Z  writer  8 B  no record line names it  ${recent}`,
        "",
      ].join("\n"),
    );
    expect(existsSync(join(dir(), old))).toBe(false);
  });

  it("prints one trace, and says when one was deleted after 30 days", async () => {
    const recent = traceName({ kind: "writer", at: NOW - DAY });
    writeFileSync(join(dir(), recent), '{"a":1}\n');
    expect(await traceCommand(["ledger", "PROJ-1", recent], io())).toBe(0);
    expect(out.join("")).toBe('{"a":1}\n');
    const old = traceName({ kind: "writer", at: NOW - (TRACE_DAYS + 1) * DAY });
    expect(await traceCommand(["ledger", "PROJ-1", old], io())).toBe(1);
    expect(err.join("")).toBe(`agent-factory trace: ${old} was deleted after 30 days\n`);
  });

  it("refuses a missing ticket or a name that is not plain", async () => {
    expect(await traceCommand(["ledger"], io())).toBe(64);
    expect(await traceCommand(["ledger", "../x"], io())).toBe(64);
    expect(err.join("")).toContain("usage: agent-factory trace <project> <ticket> [<name>]");
  });

  it("shows sizes a person reads", () => {
    expect([sizeOf(10), sizeOf(2048), sizeOf(3 * 1024 * 1024)]).toEqual(["10 B", "2.0 KB", "3.0 MB"]);
  });

  it("runs from the command line with the factory home, and is in the help", async () => {
    const lines: string[] = [];
    const cli: Io = {
      env: { FACTORY_HOME: home },
      out: (t) => lines.push(t),
      err: () => undefined,
      readSecret: async () => "",
      readStdin: async () => "",
      system: {
        platform: "linux",
        uid: 501,
        gid: 20,
        run: async () => ({ code: 1, stdout: "", stderr: "no CLI in this test" }),
        interactive: async () => 1,
        background: async () => ({ kind: "failed", reason: "no background in this test" }),
      },
    };
    expect(await runCli(["trace", "ledger", "PROJ-1"], cli)).toBe(0);
    expect(lines.join("")).toContain("traces of ledger PROJ-1");
    lines.length = 0;
    await runCli(["--help"], cli);
    expect(lines.join("")).toContain("trace <project> <ticket> [<name>]");
  });
});
