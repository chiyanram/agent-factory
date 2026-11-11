// the clean-machine install test's verdict (#485; scripts/install-test.ts): what it accepts and what fails it
import { describe, expect, it } from "vitest";
import { failedChecks, problems, type Ran, type Seen } from "../scripts/install-test.js";

const ran = (over: Partial<Ran> = {}): Ran => ({ code: 0, signal: null, error: "", out: "", err: "", ...over });
const INIT =
  "Checks:\n  ✓ srt 0.0.82, the pinned version\n  ✗ claude token: none on record\n      fix: claude setup-token\n";
const seen = (over: Partial<Seen> = {}): Seen => ({
  version: ran({ out: "0.34.1\n" }),
  init: ran({ code: 1, out: INIT }),
  start: ran({ out: "started demo/1 by ram at t\n" }),
  dispatch: ran({ out: "1: writer (fix): started; no run yet (dry run)\n" }),
  branch: "main",
  files: { "user.json": true, "projects/demo.json": true, "coordinator/.claude/settings.json": true },
  ...over,
});

describe("the install test's verdict", () => {
  it("passes a fresh install whose only failed check is the model login, and whose dry run names a decision", () => {
    expect(problems(seen(), "0.34.1")).toEqual([]);
  });

  it("fails init on any other failed check, a refusal, or a file it did not write", () => {
    const wall = ran({ code: 1, out: `${INIT}  ✗ the coordinator's settings: no settings\n` });
    expect(problems(seen({ init: wall }), "0.34.1")).toEqual([
      "init check failed: the coordinator's settings: no settings",
    ]);
    expect(problems(seen({ init: ran({ code: 1, err: "agent-factory init: no origin\n" }) }), "0.34.1")).toEqual([
      "agent-factory init refused: agent-factory init: no origin",
    ]);
    expect(problems(seen({ files: { "user.json": false } }), "0.34.1")).toEqual(["init left no user.json"]);
  });

  it("fails a dry run that is refused, exits 1, or names no decision", () => {
    const refused = ran({ code: 1, err: "agent-factory dispatch: refused: no coordinator settings\n" });
    expect(problems(seen({ dispatch: refused }), "0.34.1")).toEqual([
      "agent-factory dispatch --dry-run exited 1: agent-factory dispatch: refused: no coordinator settings",
      "agent-factory dispatch --dry-run named no decision for ticket 1: ",
    ]);
    expect(problems(seen({ dispatch: ran({ out: "nothing to do\n" }) }), "0.34.1")).toEqual([
      "agent-factory dispatch --dry-run named no decision for ticket 1: nothing to do",
    ]);
  });

  it("fails a start that exits 1 with no crash in its output", () => {
    const refused = ran({ code: 1, err: "agent-factory start: no spec on issue 1\n" });
    expect(problems(seen({ start: refused }), "0.34.1")).toEqual([
      "agent-factory start exited 1: agent-factory start: no spec on issue 1",
    ]);
  });

  it("fails a demo clone that is not on main", () => {
    expect(problems(seen({ branch: "master" }), "0.34.1")).toEqual(['the demo clone is on "master", not main']);
  });

  it("fails a signal, a spawn error, and a crash, with or without parentheses in its frames", () => {
    const hung = ran({ code: null, signal: "SIGTERM", out: "1: writer\n" });
    expect(problems(seen({ dispatch: hung }), "0.34.1")).toContain("agent-factory dispatch was ended by SIGTERM");
    const missing = ran({ code: null, error: "spawnSync agent-factory ENOENT" });
    expect(problems(seen({ start: missing }), "0.34.1")).toContain(
      "agent-factory start could not run: spawnSync agent-factory ENOENT",
    );
    for (const err of [
      "Error: boom\n    at file:///a/b.js:1:2\n",
      "TypeError: x\n    at main (/a/b.js:1:2)\n",
      // a frame with no parentheses, and no error name before it
      "something went wrong\n    at file:///a/b.js:1:2\n",
    ]) {
      const crashed = problems(seen({ start: ran({ code: 1, err }) }), "0.34.1");
      expect(crashed.some((p) => p.startsWith("agent-factory start crashed"))).toBe(true);
    }
  });

  it("fails another version", () => {
    expect(problems(seen(), "0.35.0")).toEqual(['agent-factory --version printed "0.34.1", not 0.35.0']);
  });

  it("reads the ✗ lines of init's checks", () => {
    expect(failedChecks(INIT)).toEqual(["claude token: none on record"]);
  });
});
