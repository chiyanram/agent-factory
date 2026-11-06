import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLine, parseOutput, runPoll } from "../src/core/poll.js";

// Real lines, copied from tests/github.test.sh:139-150 and tests/poll.test.sh.
const GITHUB_FRESH = "#1 head=1111abcd draft=yes claimed=no approved=yes pipeline=success needs_human=no stop=no asks=0";
const GITHUB_STALE = "#2 head=2222abcd draft=yes claimed=no approved=stale pipeline=failed needs_human=no stop=no asks=0";
const GITHUB_CLAIMED = "#4 head=4444abcd draft=no claimed=yes approved=yes pipeline=running needs_human=yes stop=no asks=1";
const GITLAB_STOP = "!5 head=eeee5555 draft=yes claimed=no approved=yes pipeline=running needs_human=no stop=yes asks=0";
const MERGED = "#9 merged claimed=yes";

describe("parseLine", () => {
  it("reads every field of an open change", () => {
    expect(parseLine(GITHUB_CLAIMED)).toEqual({
      kind: "open",
      number: 4,
      head: "4444abcd",
      draft: "no",
      claimed: "yes",
      approved: "yes",
      pipeline: "running",
      needsHuman: "yes",
      stop: "no",
      asks: 1,
    });
  });

  it("keeps a stale approval stale, never yes", () => {
    const line = parseLine(GITHUB_STALE);
    expect(line.kind).toBe("open");
    expect(line).toMatchObject({ approved: "stale", pipeline: "failed" });
  });

  it("reads a GitLab line, which starts with !", () => {
    expect(parseLine(GITLAB_STOP)).toMatchObject({ kind: "open", number: 5, stop: "yes" });
  });

  it("reads a merged change that still carries the claim", () => {
    expect(parseLine(MERGED)).toEqual({ kind: "merged", number: 9, claimed: "yes" });
  });

  it("refuses an unknown value instead of defaulting it", () => {
    const line = parseLine(GITHUB_FRESH.replace("approved=yes", "approved=maybe"));
    expect(line).toEqual({
      kind: "parse-error",
      line: GITHUB_FRESH.replace("approved=yes", "approved=maybe"),
      reason: "unknown approved=maybe",
    });
  });

  it("refuses a line with a missing field", () => {
    expect(parseLine("#1 head=1111abcd draft=yes")).toMatchObject({ kind: "parse-error" });
  });
});

describe("parseOutput", () => {
  it("gives nothing for empty output", () => {
    expect(parseOutput("")).toEqual([]);
    expect(parseOutput("\n\n")).toEqual([]);
  });

  it("keeps the order of poll's lines", () => {
    const kinds = parseOutput(`${GITHUB_FRESH}\n${GITHUB_STALE}\n${MERGED}\n`).map((line) => line.kind);
    expect(kinds).toEqual(["open", "open", "merged"]);
  });
});

function fakePoll(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "af-poll-"));
  const script = join(dir, "poll.sh");
  writeFileSync(script, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(script, 0o755);
  return script;
}

describe("runPoll", () => {
  it("returns the raw lines and the parsed records", async () => {
    const result = await runPoll(fakePoll(`printf '%s\\n' '${GITHUB_FRESH}' '${MERGED}'`));
    expect(result).toMatchObject({ kind: "ok", raw: [GITHUB_FRESH, MERGED] });
    expect(result.kind === "ok" && result.lines.map((line) => line.kind)).toEqual(["open", "merged"]);
  });

  it("reports a failed poll with its exit code and stderr, never as an empty list", async () => {
    const result = await runPoll(fakePoll("echo 'forge: not logged in' >&2; exit 3"));
    expect(result).toEqual({ kind: "failed", exitCode: 3, stderr: "forge: not logged in\n" });
  });
});
