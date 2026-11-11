import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  decide,
  loadReport,
  MAX_REPORT_BYTES,
  parseReport,
  REPORT_INSTRUCTIONS,
  validReport,
  type ReportFile,
} from "../src/core/report.js";
import { tempDir } from "./temp.js";

const ok = { kind: "exited", code: 0 } as const;
const file = (value: unknown): ReportFile => ({
  kind: "text",
  text: typeof value === "string" ? value : JSON.stringify(value),
});
const DONE = {
  status: "done",
  evidence: [{ criterion: "AC1 a reserved loan is refused", command: "make test", result: "142 passed" }],
};

const CURRENCY = { question: "EUR or USD?", choices: ["EUR", "USD"], recommended: 0 };

describe("a writer that hung after its report (#182)", () => {
  const hung = { kind: "hungAfterReport", windowSeconds: 60 } as const;

  it("is decided from the report, like a clean exit", () => {
    expect(decide({ end: hung, file: file(DONE) })).toEqual({ kind: "done", evidence: DONE.evidence });
    expect(decide({ end: hung, file: file({ status: "blocked", blocker: "no access" }) })).toMatchObject({
      kind: "blocked",
      by: "writer",
    });
    // the report is read again after the stop: one that went bad in the window is blocked
    expect(decide({ end: hung, file: { kind: "missing" } })).toMatchObject({ kind: "blocked", by: "host" });
  });

  it("opens the window only on a report the schema accepts", () => {
    expect(validReport(file(DONE))).toBe(true);
    expect(validReport(file({ status: "blocked", blocker: "no access" }))).toBe(true);
    expect(validReport(file({ status: "done" }))).toBe(false);
    expect(validReport(file("not json"))).toBe(false);
    expect(validReport({ kind: "missing" })).toBe(false);
  });
});

describe("decide (#109 done-when)", () => {
  it("a missing report is blocked", () => {
    expect(decide({ end: ok, file: { kind: "missing" } })).toEqual({
      kind: "blocked",
      reason: "the run wrote no .factory/report.json",
      by: "host",
    });
  });

  it("a malformed report is blocked, and the reason never quotes it", () => {
    const out = decide({ end: ok, file: file("{secret: ghp_abc") });
    expect(out).toEqual({ kind: "blocked", reason: "the report is not JSON", by: "host" });
  });

  it("exit 0 with an invalid status is blocked", () => {
    for (const status of ["finished", "", 3, null]) {
      expect(decide({ end: ok, file: file({ status }) })).toMatchObject({
        kind: "blocked",
        by: "host",
        reason: expect.stringContaining("status must be done, asked or blocked"),
      });
    }
  });

  it("a non-zero exit, a timeout, a cap and a failed box are blocked, even with a valid done report", () => {
    expect(decide({ end: { kind: "exited", code: 2 }, file: file(DONE) })).toEqual({
      kind: "blocked",
      reason: "the run exited 2",
      by: "host",
    });
    expect(decide({ end: { kind: "timedOut", seconds: 3600 }, file: file(DONE) })).toMatchObject({
      kind: "blocked",
      reason: "the run was stopped after 3600s",
    });
    expect(decide({ end: { kind: "cap", what: "max turns 80" }, file: file(DONE) })).toMatchObject({
      kind: "blocked",
      reason: "the run hit a cap: max turns 80",
    });
    expect(decide({ end: { kind: "failed", reason: "docker is not running" }, file: file(DONE) })).toMatchObject({
      kind: "blocked",
      reason: "the box failed: docker is not running",
    });
  });
});

describe("parseReport", () => {
  it("reads the three outcomes", () => {
    expect(parseReport(JSON.stringify(DONE))).toEqual({ kind: "done", evidence: DONE.evidence });
    // AC-1 of #486: more than five questions are one round, the whole frontier
    const eight = Array.from({ length: 8 }, (_, i) => ({ ...CURRENCY, question: `Q${i + 1}?` }));
    expect(parseReport(JSON.stringify({ status: "asked", questions: eight }))).toMatchObject({
      kind: "asked",
      questions: expect.arrayContaining([expect.objectContaining({ question: "Q8?" })]),
    });
    expect(parseReport(JSON.stringify({ status: "asked", questions: [CURRENCY] }))).toEqual({
      kind: "asked",
      questions: [{ kind: "choices", question: "EUR or USD?", choices: ["EUR", "USD"], recommended: 0 }],
    });
    expect(parseReport(JSON.stringify({ status: "blocked", blocker: "the build needs a licence key" }))).toEqual({
      kind: "blocked",
      reason: "the build needs a licence key",
      by: "writer",
    });
  });

  it("still reads a plain question, for one release, as one with no choices (#320)", () => {
    expect(parseReport(JSON.stringify({ status: "asked", questions: ["EUR or USD?", CURRENCY] }))).toEqual({
      kind: "asked",
      questions: [
        { kind: "plain", question: "EUR or USD?" },
        { kind: "choices", question: "EUR or USD?", choices: ["EUR", "USD"], recommended: 0 },
      ],
    });
  });

  it("refuses a question whose choices or recommendation the schema does not allow (#320)", () => {
    for (const [question, why] of [
      [{ question: "x", choices: ["a"], recommended: 0 }, "question 1 choices must be a list of 2 to 4"],
      [{ question: "x", choices: ["a", "b", "c", "d", "e"], recommended: 0 }, "a list of 2 to 4"],
      [{ question: "x", recommended: 0 }, "a list of 2 to 4"],
      [{ question: "x", choices: ["a", " "], recommended: 0 }, "question 1 choice 2 must be non-empty"],
      [{ question: "x", choices: ["a", "b".repeat(201)], recommended: 0 }, "choice 2 is longer than 200"],
      [{ question: "x", choices: ["a", "b"], recommended: 2 }, "recommended must be the index of one of its choices"],
      [{ question: "x", choices: ["a", "b"], recommended: -1 }, "recommended must be the index"],
      [{ question: "x", choices: ["a", "b"], recommended: "A" }, "recommended must be the index"],
      [{ question: "x", choices: ["a", "b"] }, "recommended must be the index"],
      [{ question: " ", choices: ["a", "b"], recommended: 0 }, "question 1 question must be non-empty"],
      [{ ...CURRENCY, why: "x" }, "question 1 has 1 field(s) the schema does not name"],
      [["x"], "question 1 must be {question, choices, recommended}"],
      [7, "question 1 must be {question, choices, recommended}"],
    ] as const) {
      expect(parseReport(JSON.stringify({ status: "asked", questions: [question] }))).toMatchObject({
        kind: "blocked",
        by: "host",
        reason: expect.stringContaining(why),
      });
    }
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
      [{ status: "asked", questions: Array.from({ length: 21 }, (_, i) => `q${i}`) }, "more than 20"],
      [{ status: "asked", questions: ["  "] }, "question 1 must be non-empty"],
      [{ status: "blocked" }, "blocker must be non-empty"],
      [{ status: "blocked", blocker: "x".repeat(2001) }, "longer than 2000"],
    ] as const) {
      expect(parseReport(JSON.stringify(report))).toMatchObject({
        kind: "blocked",
        by: "host",
        reason: expect.stringContaining(why),
      });
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
      expect(parseReport(JSON.stringify({ status, blocker: "x", evidence: [] }))).toEqual({
        kind: "blocked",
        reason: "the report's status must be done, asked or blocked",
        by: "host",
      });
    }
  });

  it("a byte-order mark before the JSON is no reason to block", () => {
    expect(parseReport(`\uFEFF${JSON.stringify(DONE)}`)).toMatchObject({ kind: "done" });
  });

  it("the writer's prompt names every status and field", () => {
    for (const word of [
      '"done"',
      '"asked"',
      '"blocked"',
      '"evidence"',
      '"questions"',
      '"choices"',
      '"recommended"',
      "all at once",
      '"blocker"',
      ".factory/report.json",
      "Never commit",
    ]) {
      expect(REPORT_INSTRUCTIONS).toContain(word);
    }
  });
});

describe("loadReport", () => {
  let tree = "";
  beforeEach(() => {
    tree = tempDir("factory-report-");
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
    expect(await loadReport({ worktree: tree })).toEqual({
      kind: "unreadable",
      reason: ".factory is not a plain folder",
    });
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
    expect(await loadReport({ worktree: tree })).toEqual({
      kind: "unreadable",
      reason: `it is larger than ${MAX_REPORT_BYTES} bytes`,
    });
  });
});

describe("a stalled run (#228)", () => {
  it("is blocked, its stall time in minutes when whole, else in seconds", () => {
    const missing = { kind: "missing" } as const;
    expect(decide({ end: { kind: "stalled", seconds: 300, last: [] }, file: missing })).toEqual({
      kind: "blocked",
      reason: "the run printed nothing for 5 min; the host stopped it",
      by: "host",
    });
    expect(decide({ end: { kind: "stalled", seconds: 90, last: [] }, file: missing })).toMatchObject({
      reason: "the run printed nothing for 90 s; the host stopped it",
    });
  });
});

describe("parseReport: a cleanup run's deferred list (#236)", () => {
  const row = { criterion: "AC-1 x", command: "make test", result: "1 passed" };

  it("keeps the deferred list of a done report; an empty one is none; a bad one is malformed", () => {
    expect(
      parseReport(
        JSON.stringify({ status: "done", evidence: [row], deferred: ["drop the guard: it hides a failure"] }),
      ),
    ).toEqual({
      kind: "done",
      evidence: [row],
      deferred: ["drop the guard: it hides a failure"],
    });
    expect(parseReport(JSON.stringify({ status: "done", evidence: [row], deferred: [] }))).toEqual({
      kind: "done",
      evidence: [row],
    });
    expect(parseReport(JSON.stringify({ status: "done", evidence: [row], deferred: [3] }))).toMatchObject({
      kind: "blocked",
      reason: expect.stringContaining("deferred 1"),
    });
    // only done may carry it
    expect(parseReport(JSON.stringify({ status: "asked", questions: ["q?"], deferred: ["x"] }))).toMatchObject({
      kind: "blocked",
    });
  });
});
