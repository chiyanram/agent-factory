import { describe, expect, it } from "vitest";
import {
  designView,
  dropRepeats,
  MAX_DESIGN_FAILURES,
  MAX_DESIGN_ROUNDS,
  MAX_MOVED_REVIEWS,
  ROUND_CAP,
  roundsBefore,
  type SpecRead,
} from "../src/core/dispatch/design.js";
import { readRecords, record, summarize, type Event } from "../src/core/dispatch/records.js";
import { appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./temp.js";
import { keep, readDesignFindings, toVerify, type DesignFinding } from "../src/core/design/findings.js";

const S = "a".repeat(64);
const D = "none";
const NOW = Date.parse("2026-11-07T10:00:00Z");

const started = (at: string, phase: "design-review" | "design-verify"): Event => ({
  at,
  kind: "started",
  phase,
  mode: "none",
  head: "",
});

const ended = (
  at: string,
  step: "review" | "verify",
  outcome: "done" | "failed",
  spec = S,
): Extract<Event, { kind: "design-ended" }> => ({
  at,
  kind: "design-ended",
  step,
  spec,
  design: D,
  outcome,
  why: outcome === "failed" ? "the model failed" : "",
  findings: [],
  kept: [],
});

// a done review's line, typed as itself
function designEnd(at: string): Extract<Event, { kind: "design-ended" }> {
  return {
    at,
    kind: "design-ended",
    step: "review",
    spec: S,
    design: D,
    outcome: "done",
    why: "",
    findings: [],
    kept: [],
  };
}

const FEATURE = { lane: "feature", planned: ["src/a.ts"] } as const;
const view = (events: readonly Event[], approvedAt = "", read: SpecRead = FEATURE, raised = "") =>
  designView({ events, spec: S, design: D, read, raised, approvedAt, now: NOW });

describe("designView (#236)", () => {
  it("runs the design-reviewer first, then the verify pass, then is done", () => {
    expect(view([])).toEqual({ kind: "run", step: "review", spec: S, design: D });
    const reviewed = [
      started("2026-11-07T09:00:00Z", "design-review"),
      ended("2026-11-07T09:01:00Z", "review", "done"),
    ];
    expect(view(reviewed)).toEqual({ kind: "run", step: "verify", spec: S, design: D });
    const verified = [...reviewed, ended("2026-11-07T09:02:00Z", "verify", "done")];
    expect(view(verified)).toEqual({ kind: "done" });
  });

  it("an edit to the spec is new hashes: the review runs afresh", () => {
    const old = [ended("2026-11-07T09:01:00Z", "review", "done", "b".repeat(64))];
    expect(view(old)).toEqual({ kind: "run", step: "review", spec: S, design: D });
  });

  it("an approval before the verify pass ended waits for an approval after it", () => {
    const verified = [ended("2026-11-07T09:01:00Z", "review", "done"), ended("2026-11-07T09:02:00Z", "verify", "done")];
    expect(view(verified, "2026-11-07T08:00:00Z")).toEqual({ kind: "early", at: "2026-11-07T09:02:00Z" });
    expect(view(verified, "2026-11-07T09:30:00Z")).toEqual({ kind: "done" });
  });

  it("a failed run backs off, a lost start counts as a failure, and three failures stop for a person", () => {
    const once = [ended("2026-11-07T09:59:55Z", "review", "failed")];
    expect(view(once)).toEqual({ kind: "later", step: "review", at: "2026-11-07T10:00:05.000Z" });
    const lost = [ended("2026-11-07T09:00:00Z", "review", "failed"), started("2026-11-07T09:59:50Z", "design-review")];
    expect(view(lost)).toEqual({ kind: "later", step: "review", at: "2026-11-07T10:00:10.000Z" });
    const many = Array.from({ length: MAX_DESIGN_FAILURES }, (_, i) =>
      ended(`2026-11-07T09:0${i}:00Z`, "review", "failed"),
    );
    expect(view(many)).toMatchObject({ kind: "stopped", why: expect.stringContaining("failed 3 times") });
  });

  it("a failure no retry fixes (a cite that does not hold) stops at once, with its reason (#489)", () => {
    const cite = {
      ...ended("2026-11-07T09:00:00Z", "review", "failed"),
      why: "a cite does not hold",
      final: true,
    } as const;
    expect(view([cite])).toEqual({ kind: "stopped", step: "review", why: "a cite does not hold" });
    // an edit is new hashes: the stop does not carry over
    expect(view([{ ...cite, spec: "b".repeat(64) }])).toEqual({ kind: "run", step: "review", spec: S, design: D });
  });

  it("a final failure reads back from the record; a final that is not a boolean is a bad line", async () => {
    const home = tempDir("factory-design-final-");
    try {
      const where = { home, project: "ledger", ticket: "PROJ-1" };
      const cite = { ...ended("2026-11-07T09:00:00Z", "review", "failed"), why: "a cite", final: true } as const;
      expect((await record({ where, event: cite })).kind).toBe("ok");
      expect(await readRecords(where)).toEqual({ kind: "ok", value: [cite] });
      appendFileSync(join(home, "runs", "ledger", "PROJ-1.jsonl"), `${JSON.stringify({ ...cite, final: "yes" })}\n`);
      expect((await readRecords(where, { warn: () => undefined })).kind).toBe("failed");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("a design run's end clears its start and counts its spend toward the ticket", () => {
    const events: Event[] = [
      started("2026-11-07T09:00:00Z", "design-review"),
      { ...designEnd("2026-11-07T09:01:00Z"), spend: { usd: 0.5, tokens: 100 } },
    ];
    const s = summarize({ events, since: "1970-01-01T00:00:00Z" });
    expect(s.interrupted).toEqual({ kind: "none" });
    expect(s.spent).toEqual({ usd: 0.5, tokens: 100 });
  });
});

describe("design findings", () => {
  const raw = (verdict: string) => ({
    id: "x",
    decision: "one table per ticket",
    verdict,
    file: "src/a.ts",
    line: 3,
    rule: "SR9",
    severity: "warning",
    grade: "cited",
    finding: "it contradicts records.ts",
    fix: "use the records",
  });

  it("are checked and renumbered; the verify pass sees only conflicts and opens; dismissed ones are not kept", () => {
    const read = readDesignFindings({ findings: [raw("aligned"), raw("conflict"), raw("open")] });
    expect(read.kind).toBe("ok");
    const findings: readonly DesignFinding[] = read.kind === "ok" ? read.value : [];
    expect(findings.map((f) => f.id)).toEqual(["D1", "D2", "D3"]);
    expect(toVerify(findings).map((f) => f.id)).toEqual(["D2", "D3"]);
    const kept = keep(toVerify(findings), [{ id: "D2", bucket: "dismissed", why: "the line says otherwise" }]);
    expect(kept.map((k) => [k.id, k.bucket])).toEqual([["D3", "consider"]]);
    expect(readDesignFindings({ findings: [{ ...raw("conflict"), verdict: "approve" }] }).kind).toBe("failed");
  });
});

// #489 (P15, review converges): a re-review only for an Act on CONFLICT, at most 2 rounds, Consider never blocks
describe("the design review converges (#489)", () => {
  const OLD = "b".repeat(64);
  const OLDER = "c".repeat(64);
  const finding: DesignFinding = {
    id: "D1",
    source: "design",
    decision: "one table",
    verdict: "conflict",
    file: "svc/Main.java",
    line: 1,
    rule: "SR9",
    severity: "blocker",
    grade: "walked",
    finding: "Main already totals",
    fix: "reuse Main",
  };
  const round = (at: string, spec: string, kept: Extract<Event, { kind: "design-ended" }>["kept"]): Event => ({
    ...designEnd(at),
    step: "verify",
    spec,
    kept,
  });
  const actOn = [{ ...finding, bucket: "act_on" as const, why: "it holds" }];
  const consider = [{ ...finding, verdict: "open" as const, bucket: "consider" as const, why: "a choice" }];

  it("after an edit, reviews again only when the last round kept an Act on CONFLICT", () => {
    expect(view([round("2026-11-07T09:02:00Z", OLD, actOn)])).toEqual({
      kind: "run",
      step: "review",
      spec: S,
      design: D,
    });
    // Consider items and opens never block: the person decides on them, with no second review
    expect(view([round("2026-11-07T09:02:00Z", OLD, consider)])).toEqual({ kind: "done" });
    expect(view([round("2026-11-07T09:02:00Z", OLD, [])])).toEqual({ kind: "done" });
  });

  it("stops at 2 rounds: the person is told once that the cap skipped a review, then decides", () => {
    const two = [round("2026-11-07T08:02:00Z", OLDER, actOn), round("2026-11-07T09:02:00Z", OLD, actOn)];
    expect(view(two)).toEqual({ kind: "note", spec: S, design: D, why: ROUND_CAP });
    const told: Event = { at: "2026-11-07T09:10:00Z", kind: "design-noted", spec: S, design: D, why: ROUND_CAP };
    expect(view([...two, told])).toEqual({ kind: "done" });
  });

  // #489 review: an edit after convergence that raises the lane or changes the Planned files is a new review, whatever
  // the round count, since no earlier round saw it
  it("reviews again after the cap when the lane rose or the Planned files changed since the last round", () => {
    const at = (spec: string, time: string): Event => ({ ...round(time, spec, actOn), ...FEATURE });
    const two = [at(OLDER, "2026-11-07T08:02:00Z"), at(OLD, "2026-11-07T09:02:00Z")];
    const run = { kind: "run", step: "review", spec: S, design: D };
    expect(view(two, "", { ...FEATURE, lane: "one-way door" })).toEqual(run);
    expect(view(two, "", { ...FEATURE, planned: ["src/a.ts", "db/V2.sql"] })).toEqual(run);
    // the same files in another order, or a lane that fell, moves nothing
    expect(view(two, "", { lane: "bug", planned: ["src/a.ts"] })).toMatchObject({ kind: "note", why: ROUND_CAP });
    // a converged round (no Act on CONFLICT) is reviewed again too when the lane rose
    const calm: Event = { ...round("2026-11-07T09:02:00Z", OLD, consider), ...FEATURE };
    expect(view([calm], "", { ...FEATURE, lane: "one-way door" })).toEqual(run);
  });

  it("an edit back to Planned files an earlier round read (A → B → A) is no new review, and moved reviews are capped too", () => {
    const files = (f: string) => ({ lane: "feature", planned: [f] }) as const;
    const r = (spec: string, time: string, f: string): Event => ({ ...round(time, spec, actOn), ...files(f) });
    const ab = [r("d".repeat(64), "2026-11-07T08:02:00Z", "a.ts"), r(OLD, "2026-11-07T09:02:00Z", "b.ts")];
    expect(view(ab, "", files("a.ts"))).toEqual({ kind: "note", spec: S, design: D, why: ROUND_CAP });
    // a pair no round read is reviewed, past the 2 rounds, MAX_MOVED_REVIEWS times; then the person decides, told once
    const run = { kind: "run", step: "review", spec: S, design: D };
    expect(view(ab, "", files("c.ts"))).toEqual(run);
    const four = [
      ...ab,
      r("e".repeat(64), "2026-11-07T09:12:00Z", "c.ts"),
      r("f".repeat(64), "2026-11-07T09:22:00Z", "d.ts"),
    ];
    expect(four).toHaveLength(MAX_DESIGN_ROUNDS + MAX_MOVED_REVIEWS);
    expect(view(four.slice(0, 3), "", files("d.ts"))).toEqual(run);
    expect(view(four, "", files("e.ts"))).toEqual({ kind: "note", spec: S, design: D, why: ROUND_CAP });
  });

  it("holds the review while the Planned files need a heavier lane: the person is told once, then it waits", () => {
    const why = "the lane is raised from feature to one-way door (db/V2.sql …)";
    expect(view([], "", FEATURE, why)).toEqual({ kind: "note", spec: S, design: D, why });
    const told: Event = { at: "2026-11-07T09:10:00Z", kind: "design-noted", spec: S, design: D, why };
    expect(view([told], "", FEATURE, why)).toEqual({ kind: "held", why });
  });

  it("earlier rounds carry their findings, what the verify pass kept and what it dismissed", () => {
    const opened = { ...finding, id: "D2", verdict: "open" as const, decision: "the currency" };
    const review: Event = { ...designEnd("2026-11-07T09:01:00Z"), spec: OLD, findings: [finding, opened] };
    const verified: Event = { ...round("2026-11-07T09:02:00Z", OLD, actOn), ...FEATURE };
    expect(roundsBefore([review, verified], { spec: S, design: D })).toEqual([
      {
        round: 1,
        spec: OLD,
        design: D,
        ...FEATURE,
        findings: [finding, opened],
        kept: actOn,
        dismissed: [opened],
      },
    ]);
  });

  it("drops a re-review's repeat of a finding an earlier round dismissed or the person answered, never an Act on CONFLICT", () => {
    const opened = { ...finding, id: "D2", verdict: "open" as const, decision: "The  Currency" };
    const rounds = roundsBefore(
      [
        { ...designEnd("2026-11-07T09:01:00Z"), spec: OLD, findings: [finding, opened] },
        round("2026-11-07T09:02:00Z", OLD, actOn),
      ],
      { spec: S, design: D },
    );
    const again = [
      { ...finding, id: "D1" },
      { ...opened, id: "D2", decision: "the currency" },
      { ...finding, id: "D3", verdict: "aligned" as const },
      { ...finding, id: "D4", decision: "a new decision" },
    ];
    expect(dropRepeats(again, rounds)).toEqual({ findings: [again[0], again[2], again[3]], dropped: 1 });
    const answered = [{ ...opened, bucket: "consider" as const, why: "a choice" }];
    const asked = roundsBefore(
      [
        { ...designEnd("2026-11-07T09:01:00Z"), spec: OLD, findings: [opened] },
        round("2026-11-07T09:02:00Z", OLD, answered),
      ],
      { spec: S, design: D },
    );
    expect(dropRepeats([{ ...opened, decision: "the currency" }], asked).dropped).toBe(1);
  });

  it("an approval given before the last round's findings still waits for one after them", () => {
    const one = [round("2026-11-07T09:02:00Z", OLD, consider)];
    expect(view(one, "2026-11-07T08:00:00Z")).toEqual({ kind: "early", at: "2026-11-07T09:02:00Z" });
    expect(view(one, "2026-11-07T09:30:00Z")).toEqual({ kind: "done" });
  });
});
