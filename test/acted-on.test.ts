// the automated review's acted-on rate (#220; ADR-0015 R4): deterministic, with no model. A finding is acted on when a
// later commit changes its file:line region; the run records carry the rows, and `usage` sums them.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  actedRates,
  actedRows,
  actedSince,
  changedSpans,
  isActedRow,
  keepTracked,
  REGION,
  trackedOf,
  type Tracked,
} from "../src/core/review/acted-on.js";
import type { Sorted } from "../src/core/review/verdicts.js";
import { readRecords, record } from "../src/core/dispatch/records.js";
import { actedLines, readSpends } from "../src/core/dispatch/usage.js";
import { tempDir } from "./temp.js";

let dir = "";
beforeEach(() => {
  dir = tempDir("factory-acted-");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sorted = (over: Partial<Sorted>): Sorted => ({
  id: "F1",
  axis: "standards",
  kind: "rule",
  file: "a.ts",
  line: 10,
  rule: "R1",
  severity: "warning",
  finding: "x",
  fix: "y",
  bucket: "act_on",
  why: "z",
  ...over,
});

const DIFF = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -10,2 +10,3 @@ fn
-x
+y
@@ -40,0 +42 @@
+inserted
diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1 @@
+n
diff --git a/gone.ts b/gone.ts
--- a/gone.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-a
`;

describe("acted on, the parts", () => {
  it("tracks Act on and Consider findings only, by the finder that found them", () => {
    const all = [
      sorted({ id: "F1" }),
      sorted({ id: "F2", bucket: "consider", kind: "logic" }),
      sorted({ id: "F3", bucket: "noted" }),
      sorted({ id: "F4", bucket: "dismissed" }),
    ];
    expect(trackedOf(all)).toEqual([
      { id: "F1", lens: "rule", bucket: "act_on", file: "a.ts", line: 10 },
      { id: "F2", lens: "logic", bucket: "consider", file: "a.ts", line: 10 },
    ]);
  });

  it("reads the earlier head's changed spans from git diff -U0; an insertion touches the line after it", () => {
    expect(Object.fromEntries(changedSpans(DIFF))).toEqual({
      "a.ts": [
        { from: 10, to: 11 },
        { from: 40, to: 41 },
      ],
      "gone.ts": [{ from: 1, to: 3 }],
    });
  });

  it("counts a finding acted on within REGION lines of a changed span, and not one line further", () => {
    const at = (file: string, line: number): Tracked => ({ id: "F", lens: "rule", bucket: "act_on", file, line });
    const spans = changedSpans(DIFF);
    const rows = actedRows(
      [at("a.ts", 11 + REGION), at("a.ts", 12 + REGION), at("a.ts", 10 - REGION), at("gone.ts", 2), at("b.ts", 10)],
      spans,
    );
    expect(rows.map((r) => r.acted)).toEqual([true, false, true, true, false]);
  });

  it("rates all, per lens and per bucket", () => {
    const row = (lens: "rule" | "logic", bucket: "act_on" | "consider", acted: boolean) => ({
      id: "F",
      lens,
      bucket,
      file: "a.ts",
      line: 1,
      acted,
    });
    expect(
      actedRates([row("rule", "act_on", true), row("rule", "consider", false), row("logic", "act_on", true)]),
    ).toEqual({
      all: { acted: 2, of: 3 },
      lens: { logic: { acted: 1, of: 1 }, rule: { acted: 1, of: 2 } },
      bucket: { act_on: { acted: 2, of: 2 }, consider: { acted: 0, of: 1 } },
    });
    expect(isActedRow(row("rule", "act_on", true))).toBe(true);
    expect(isActedRow({ ...row("rule", "act_on", true), bucket: "noted" })).toBe(false);
    expect(isActedRow({ ...row("rule", "act_on", true), acted: "yes" })).toBe(false);
  });

  it("diffs the round's head with the head now in a real clone; none when the round kept nothing", async () => {
    const repo = join(dir, "repo");
    mkdirSync(repo);
    const env = { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: "1" };
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd: repo,
        env,
        encoding: "utf8",
      }).trim();
    git("init", "-q", "-b", "main");
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    writeFileSync(join(repo, "a.ts"), `${lines.join("\n")}\n`);
    git("add", "-A");
    git("commit", "-qm", "one");
    const since = git("rev-parse", "HEAD");
    writeFileSync(join(repo, "a.ts"), `${lines.map((l, i) => (i === 2 ? "fixed" : l)).join("\n")}\n`);
    git("commit", "-qam", "two");
    const head = git("rev-parse", "HEAD");
    const recordsDir = join(dir, "records");
    const at = { recordsDir, change: 7, head: since };
    const input = { repo, env, recordsDir, change: 7, since, head };
    expect(await actedSince(input)).toBe("none");
    await keepTracked(at, [sorted({ id: "F1", line: 3 }), sorted({ id: "F2", line: 25, bucket: "consider" })]);
    expect(await actedSince(input)).toEqual({
      since,
      rows: [
        { id: "F1", lens: "rule", bucket: "act_on", file: "a.ts", line: 3, acted: true },
        { id: "F2", lens: "rule", bucket: "consider", file: "a.ts", line: 25, acted: false },
      ],
    });
    expect(await actedSince({ ...input, head: "f".repeat(40) })).toBe("none");
  });
});

describe("acted on, in the run records and usage", () => {
  const rows = [
    { id: "F1", lens: "rule", bucket: "act_on", file: "a.ts", line: 3, acted: true },
    { id: "F2", lens: "logic", bucket: "consider", file: "a.ts", line: 25, acted: false },
  ] as const;

  it("keeps the rows on a review-ended line, and refuses a line whose rows are not as written", async () => {
    const where = { home: dir, project: "ledger", ticket: "PROJ-1" };
    const acted = { since: "1".repeat(40), rows };
    await record({
      where,
      event: { at: "2026-11-09T10:00:00Z", kind: "review-ended", head: "2".repeat(40), actOn: 0, acted },
    });
    expect(await readRecords(where)).toMatchObject({ kind: "ok", value: [{ kind: "review-ended", acted }] });
    const spends = await readSpends({ home: dir });
    expect(spends.acted).toEqual([{ project: "ledger", at: "2026-11-09T10:00:00Z", rows }]);
    expect(actedLines({ acted: spends.acted, now: Date.parse("2026-11-09T12:00:00Z") })).toEqual([
      "acted on this month: findings in Act on or Consider whose region a later commit changed, per lens and bucket",
      "all 1/2 · logic 0/1 · rule 1/1 · act_on 1/1 · consider 0/1",
      "  ledger 1/2 · logic 0/1 · rule 1/1 · act_on 1/1 · consider 0/1",
    ]);
    expect(actedLines({ acted: spends.acted, now: Date.parse("2026-12-01T00:00:00Z") })).toEqual([]);
    const bad = JSON.stringify({
      at: "2026-11-09T11:00:00Z",
      kind: "review-ended",
      head: "3".repeat(40),
      actOn: 0,
      acted: { since: "1".repeat(40), rows: [{ ...rows[0], acted: "yes" }] },
    });
    writeFileSync(join(dir, "runs", "ledger", "PROJ-1.jsonl"), `${bad}\n`, { flag: "a" });
    expect((await readRecords(where)).kind).toBe("failed");
  });
});
