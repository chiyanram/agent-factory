import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, loadReport, MAX_REPORT_BYTES, parseReport, REPORT_INSTRUCTIONS, type ReportFile } from "../src/core/report.js";

const ok = { kind: "exited", code: 0 } as const;
const file = (value: unknown): ReportFile => ({ kind: "text", text: typeof value === "string" ? value : JSON.stringify(value) });
const DONE = { status: "done", evidence: [{ criterion: "AC1 a reserved loan is refused", command: "make test", result: "142 passed" }] };

describe("decide (#109 done-when)", () => {
  it("a missing report is blocked", () => {
    expect(decide({ end: ok, file: { kind: "missing" } })).toEqual({ kind: "blocked", reason: "the run wrote no .factory/report.json", by: "host" });
  });

  it("a malformed report is blocked, and the reason never quotes it", () => {
    const out = decide({ end: ok, file: file("{secret: ghp_abc") });
    expect(out).toEqual({ kind: "blocked", reason: "the report is not JSON", by: "host" });
  });

  it("exit 0 with an invalid status is blocked", () => {
    for (const status of ["finished", "", 3, null]) {
      expect(decide({ end: ok, file: file({ status }) })).toMatchObject({ kind: "blocked", by: "host", reason: expect.stringContaining("status must be done, asked or blocked") });
    }
  });

  it("a non-zero exit, a timeout, a cap and a failed box are blocked, even with a valid done report", () => {
    expect(decide({ end: { kind: "exited", code: 2 }, file: file(DONE) })).toEqual({ kind: "blocked", reason: "the run exited 2", by: "host" });
    expect(decide({ end: { kind: "timedOut", seconds: 3600 }, file: file(DONE) })).toMatchObject({ kind: "blocked", reason: "the run was stopped after 3600s" });
    expect(decide({ end: { kind: "cap", what: "max turns 80" }, file: file(DONE) })).toMatchObject({ kind: "blocked", reason: "the run hit a cap: max turns 80" });
    expect(decide({ end: { kind: "failed", reason: "docker is not running" }, file: file(DONE) })).toMatchObject({ kind: "blocked", reason: "the box failed: docker is not running" });
  });
});

describe("parseReport", () => {
  it("reads the three outcomes", () => {
    expect(parseReport(JSON.stringify(DONE))).toEqual({ kind: "done", evidence: DONE.evidence });
    expect(parseReport(JSON.stringify({ status: "asked", questions: ["EUR or USD?"] }))).toEqual({ kind: "asked", questions: ["EUR or USD?"] });
    expect(parseReport(JSON.stringify({ status: "blocked", blocker: "the build needs a licence key" }))).toEqual({ kind: "blocked", reason: "the build needs a licence key", by: "writer" });
  });

  it("refuses each part the schema does not allow", () => {
    for (const [report, why] of [
      [[DONE], "one JSON object"],
      [{ status: "done" }, "evidence must be a list"],
      [{ status: "done", evidence: [] }, "at least one"],
      [{ status: "done", evidence: [{ criterion: "a", command: "b" }] }, "evidence 1 result"],
      [{ status: "done", evidence: [{ ...DONE.evidence[0], url: "x" }] }, "evidence 1 has 1 field(s)"],
      [{ status: "done", evidence: ["make test"] }, "evidence 1 must be"],
      [{ status: "done", evidence: DONE.evidence, questions: ["x"] }, "1 field(s) the schema does not name for done"],
      [{ status: "asked", questions: ["\u200b"] }, "question 1 must be non-empty"],
      [{ status: "blocked", blocker: "\u0000\u2060 " }, "blocker must be non-empty"],
      [{ status: "asked", questions: ["a", "b", "c", "d", "e", "f"] }, "more than 5"],
      [{ status: "asked", questions: ["  "] }, "question 1 must be non-empty"],
      [{ status: "blocked" }, "blocker must be non-empty"],
      [{ status: "blocked", blocker: "x".repeat(2001) }, "longer than 2000"],
    ] as const) {
      expect(parseReport(JSON.stringify(report))).toMatchObject({ kind: "blocked", by: "host", reason: expect.stringContaining(why) });
    }
  });

  it("never quotes the report in a reason, not even a key name or the status, since the reason is posted", () => {
    const leaky = [
      { status: "done", evidence: [{ ...DONE.evidence[0], ghp_SECRETTOKENVALUE1234567890: 1 }] },
      { status: "done", evidence: DONE.evidence, ghp_SECRETTOKENVALUE1234567890: 1 },
      { status: "ghp_SECRETTOKENVALUE1234567890" },
    ];
    for (const report of leaky) {
      const out = parseReport(JSON.stringify(report));
      expect(out.kind).toBe("blocked");
      expect(JSON.stringify(out)).not.toContain("SECRET");
    }
  });

  it("a status named after a built-in property is no status", () => {
    for (const status of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(parseReport(JSON.stringify({ status, blocker: "x", evidence: [] }))).toEqual({ kind: "blocked", reason: "the report's status must be done, asked or blocked", by: "host" });
    }
  });

  it("a byte-order mark before the JSON is no reason to block", () => {
    expect(parseReport(`\uFEFF${JSON.stringify(DONE)}`)).toMatchObject({ kind: "done" });
  });

  it("the writer's prompt names every status and field", () => {
    for (const word of ['"done"', '"asked"', '"blocked"', '"evidence"', '"questions"', '"blocker"', ".factory/report.json", "Never commit"]) {
      expect(REPORT_INSTRUCTIONS).toContain(word);
    }
  });
});

describe("loadReport", () => {
  let tree = "";
  beforeEach(() => {
    tree = mkdtempSync(join(tmpdir(), "factory-report-"));
  });
  afterEach(() => rmSync(tree, { recursive: true, force: true }));

  it("reads a plain report, and a missing folder or file is missing", async () => {
    expect(await loadReport({ worktree: tree })).toEqual({ kind: "missing" });
    mkdirSync(join(tree, ".factory"));
    expect(await loadReport({ worktree: tree })).toEqual({ kind: "missing" });
    writeFileSync(join(tree, ".factory", "report.json"), JSON.stringify(DONE));
    expect(await loadReport({ worktree: tree })).toEqual({ kind: "text", text: JSON.stringify(DONE) });
  });

  it("never follows a symlink, for the report or its folder, so the host never reads ~/.ssh for the writer", async () => {
    const secret = join(tree, "outside");
    writeFileSync(secret, "-----BEGIN OPENSSH PRIVATE KEY-----");
    mkdirSync(join(tree, ".factory"));
    symlinkSync(secret, join(tree, ".factory", "report.json"));
    expect(await loadReport({ worktree: tree })).toEqual({ kind: "unreadable", reason: "it is a symlink" });
    rmSync(join(tree, ".factory"), { recursive: true });
    mkdirSync(join(tree, "elsewhere"));
    writeFileSync(join(tree, "elsewhere", "report.json"), JSON.stringify(DONE));
    symlinkSync(join(tree, "elsewhere"), join(tree, ".factory"));
    expect(await loadReport({ worktree: tree })).toEqual({ kind: "unreadable", reason: ".factory is not a plain folder" });
  });

  it("refuses a FIFO without hanging, a folder in the report's place, and a file over the cap", async () => {
    mkdirSync(join(tree, ".factory"));
    execFileSync("mkfifo", [join(tree, ".factory", "report.json")]);
    expect(await loadReport({ worktree: tree })).toEqual({ kind: "unreadable", reason: "it is not a regular file" });
    rmSync(join(tree, ".factory", "report.json"));
    mkdirSync(join(tree, ".factory", "report.json"));
    expect(await loadReport({ worktree: tree })).toMatchObject({ kind: "unreadable" });
    rmSync(join(tree, ".factory", "report.json"), { recursive: true });
    writeFileSync(join(tree, ".factory", "report.json"), "x".repeat(MAX_REPORT_BYTES + 1));
    expect(await loadReport({ worktree: tree })).toEqual({ kind: "unreadable", reason: `it is larger than ${MAX_REPORT_BYTES} bytes` });
  });
});
