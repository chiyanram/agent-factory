// timeline (#488 AC-1): a merge's timeline line, read from the ticket's run records with no model, and written and read
// back as a record line.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readRecords, record, type Event } from "../src/core/dispatch/records.js";
import { timelineOf, UNRECORDED } from "../src/core/dispatch/timeline.js";
import { tempDir } from "./temp.js";

const H = "1".repeat(40);
const row = (rule: string | undefined, acted: boolean) => ({
  id: "F1",
  lens: "rule" as const,
  category: "bug" as const,
  bucket: "act_on" as const,
  file: "a.ts",
  line: 3,
  acted,
  ...(rule === undefined ? {} : { rule }),
});

// a ticket that ran a writer, two review rounds and a failed one, was handed over and taken back, and merged
const EVENTS: readonly Event[] = [
  { at: "2026-11-13T08:00:00Z", kind: "begun", by: "ram", via: "terminal" },
  {
    at: "2026-11-13T09:00:00Z",
    kind: "writer-ended",
    mode: "fix",
    head: H,
    outcome: "done",
    patch: "p",
    evidence: [],
    hung: false,
    spend: { usd: 1.5, tokens: 1000 },
  },
  {
    at: "2026-11-13T09:30:00Z",
    kind: "review-ended",
    head: H,
    actOn: 2,
    spend: { usd: 0.4, tokens: 300 },
    found: { CR1: { act_on: 2, noted: 1 }, logic: { consider: 1 } },
  },
  {
    at: "2026-11-13T10:00:00Z",
    kind: "writer-ended",
    mode: "rework",
    head: H,
    outcome: "done",
    patch: "p",
    evidence: [],
    hung: false,
  },
  { at: "2026-11-13T10:10:00Z", kind: "blocked", why: "the writer asked for a person" },
  { at: "2026-11-13T11:10:00Z", kind: "begun", by: "mo", via: "terminal" },
  {
    at: "2026-11-13T11:30:00Z",
    kind: "review-ended",
    head: H,
    actOn: 0,
    spend: { usd: 0.6, tokens: 500 },
    found: { CR1: { dismissed: 1 } },
    acted: { since: H, rows: [row("CR1", true), row("CR1", false), row("logic", true), row(undefined, false)] },
  },
  { at: "2026-11-13T11:40:00Z", kind: "spent", phase: "review", head: H, spend: { usd: 0.1, tokens: 50 } },
  // a later hand-over no one took back: not a rescue, and not the earlier rescue's why
  { at: "2026-11-13T11:50:00Z", kind: "blocked", why: "the ready check failed twice" },
  { at: "2026-11-13T12:00:00Z", kind: "merged", number: 9, sha: "a".repeat(40), by: "mo" },
];

describe("a merge's timeline (#488 AC-1)", () => {
  const line = timelineOf(EVENTS, { number: 9, at: "2026-11-13T12:00:00Z" });

  it("counts the review rounds, and every round's findings per rule ID and bucket", () => {
    expect(line).toMatchObject({ at: "2026-11-13T12:00:00Z", kind: "timeline", number: 9, rounds: 2 });
    expect(line.found).toEqual({ CR1: { act_on: 2, noted: 1, dismissed: 1 }, logic: { consider: 1 } });
  });

  it("counts acted-on per rule ID; a row kept before rows carried their rule is unrecorded", () => {
    expect(line.acted).toEqual({
      CR1: { acted: 1, of: 2 },
      logic: { acted: 1, of: 1 },
      [UNRECORDED]: { acted: 0, of: 1 },
    });
  });

  it("adds up what each run kind spent, and counts a run that was not measured", () => {
    expect(line.spend).toEqual({
      implementer: { usd: 1.5, tokens: 1000 },
      "automated review": { usd: 1.1, tokens: 850 },
    });
    expect(line.unmeasured).toBe(1);
  });

  it("names each rescue: the hand-over a person took back, its wait and why", () => {
    expect(line.rescues).toEqual([
      { at: "2026-11-13T11:10:00Z", waitedMs: 3_600_000, why: "the writer asked for a person", by: "mo" },
    ]);
  });

  it("is empty for a ticket that merged with no run", () => {
    expect(timelineOf([], { number: 3, at: "2026-11-13T12:00:00Z" })).toEqual({
      at: "2026-11-13T12:00:00Z",
      kind: "timeline",
      number: 3,
      rounds: 0,
      found: {},
      acted: {},
      spend: {},
      unmeasured: 0,
      rescues: [],
    });
  });
});

describe("a timeline line in the run records (#488)", () => {
  let home = "";
  beforeEach(() => {
    home = tempDir("timeline-");
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });
  const where = () => ({ home, project: "ledger", ticket: "PROJ-9" });

  it("is written and read back as it was", async () => {
    const line = timelineOf(EVENTS, { number: 9, at: "2026-11-13T12:00:00Z" });
    expect((await record({ where: where(), event: line })).kind).toBe("ok");
    const read = await readRecords(where());
    expect(read.kind === "ok" ? read.value : read).toEqual([line]);
  });

  it.each([
    ["a count that is not whole", { rounds: 1.5 }],
    ["acted above of", { acted: { CR1: { acted: 3, of: 2 } } }],
    ["a bucket that is not one", { found: { CR1: { later: 1 } } }],
    ["a rescue with no why", { rescues: [{ at: "2026-11-13T11:10:00Z", waitedMs: 0 }] }],
    ["a rescue whose wait is not a count", { rescues: [{ at: "2026-11-13T11:10:00Z", waitedMs: "1h", why: "w" }] }],
    ["a spend that is not one", { spend: { implementer: { usd: -1, tokens: 0 } } }],
    ["no found at all", { found: undefined }],
  ])("refuses a line with %s", async (_why, over) => {
    const line = { ...timelineOf([], { number: 9, at: "2026-11-13T12:00:00Z" }), ...over };
    mkdirSync(join(home, "runs", "ledger"), { recursive: true });
    appendFileSync(join(home, "runs", "ledger", "PROJ-9.jsonl"), `${JSON.stringify(line)}\n`);
    expect((await readRecords(where())).kind).toBe("failed");
  });
});
