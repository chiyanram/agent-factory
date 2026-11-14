// retro/repeated (#488 AC-2, design Q8 A): a failure seen on 2 or more merged tickets is listed, one seen on 1 is not,
// and an escaped defect is listed at once. Pure; no model.
import { describe, expect, it } from "vitest";
import type { Timeline } from "../src/core/dispatch/timeline.js";
import type { MergeOutcome } from "../src/core/outcome.js";
import { repeatedOf, REPEATS, type Merge } from "../src/core/retro/repeated.js";

const AT = "2026-11-01T12:00:00Z";

// timeline : a merge's timeline line with these Act on findings and acted-on counts per rule, and these rescues
function timeline(input: {
  readonly actOn?: Readonly<Record<string, number>>;
  readonly acted?: Readonly<Record<string, number>>;
  readonly rescues?: number;
}): Timeline {
  return {
    at: AT,
    kind: "timeline",
    number: 1,
    rounds: 1,
    found: Object.fromEntries(Object.entries(input.actOn ?? {}).map(([rule, n]) => [rule, { act_on: n }])),
    acted: Object.fromEntries(Object.entries(input.acted ?? {}).map(([rule, n]) => [rule, { acted: n, of: n + 1 }])),
    spend: {},
    unmeasured: 0,
    rescues: Array.from({ length: input.rescues ?? 0 }, () => ({ at: AT, waitedMs: 60_000, why: "stuck" })),
  };
}

const fixed = (day: number): MergeOutcome => ({
  kind: "fixed",
  final: false,
  touched: [],
  by: {
    sha: "a".repeat(40),
    subject: "fix: renew a reserved loan",
    at: new Date(Date.parse(AT) + day * 86_400_000).toISOString(),
  },
});

const list = (timelines: Record<string, Timeline>, merges: Record<string, Merge> = {}) =>
  repeatedOf({ timelines: new Map(Object.entries(timelines)), merges: new Map(Object.entries(merges)), min: REPEATS });

describe("repeatedOf", () => {
  it("counts a repeat at two sightings (P12, RT6)", () => {
    expect(REPEATS).toBe(2);
  });

  it("lists a rule ID in Act on that was acted on, seen on 2 tickets, with its tickets and cites", () => {
    const failures = list({
      "12": timeline({ actOn: { "MUST-forge-seam": 1 }, acted: { "MUST-forge-seam": 1 } }),
      "15": timeline({ actOn: { "MUST-forge-seam": 2 }, acted: { "MUST-forge-seam": 1 } }),
    });
    expect(failures).toEqual([
      {
        kind: "rule",
        key: "MUST-forge-seam",
        tickets: ["12", "15"],
        cites: [`12 timeline ${AT}: MUST-forge-seam acted on 1`, `15 timeline ${AT}: MUST-forge-seam acted on 1`],
      },
    ]);
  });

  it("does not list a rule seen on 1 ticket", () => {
    const failures = list({
      "12": timeline({ actOn: { "MUST-forge-seam": 1 }, acted: { "MUST-forge-seam": 1 } }),
      "15": timeline({ actOn: { "RT9-other": 1 }, acted: { "RT9-other": 1 } }),
    });
    expect(failures).toEqual([]);
  });

  it("does not count a rule that was not acted on, was only in Consider, or has no rule ID", () => {
    const failures = list({
      "12": timeline({ actOn: { A: 1, unrecorded: 1 }, acted: { A: 0, unrecorded: 1 } }),
      "15": timeline({ actOn: { A: 1, unrecorded: 1 }, acted: { A: 0, unrecorded: 1 } }),
      "16": {
        ...timeline({ acted: { B: 1 } }),
        found: { B: { consider: 1 } },
      },
      "17": { ...timeline({ acted: { B: 1 } }), found: { B: { consider: 1 } } },
    });
    expect(failures).toEqual([]);
  });

  it("lists rescues seen on 2 tickets, not on 1", () => {
    expect(list({ "12": timeline({ rescues: 1 }), "15": timeline({}) })).toEqual([]);
    expect(list({ "12": timeline({ rescues: 1 }), "15": timeline({ rescues: 2 }) })).toEqual([
      {
        kind: "rescue",
        key: "hand-over",
        tickets: ["12", "15"],
        cites: [`12 timeline ${AT}: 1 rescue(s)`, `15 timeline ${AT}: 2 rescue(s)`],
      },
    ]);
  });

  it("lists an escaped defect at once: a fix within 14 days, even with no timeline line", () => {
    const failures = list({}, { "12": { at: AT, outcome: fixed(3) } });
    expect(failures).toEqual([
      {
        kind: "escaped",
        key: "12 fixed",
        tickets: ["12"],
        cites: [`12 merged ${AT}: fixed by aaaaaaaa fix: renew a reserved loan at 2026-11-04T12:00:00.000Z`],
      },
    ]);
  });

  it("lists a revert within 14 days, not a fix after them, nor a clean or unknown outcome", () => {
    const reverted: MergeOutcome = {
      kind: "reverted",
      final: false,
      by: { sha: "b".repeat(40), subject: 'Revert "x"', at: "2026-11-02T00:00:00Z" },
    };
    const failures = list(
      {},
      {
        "12": { at: AT, outcome: reverted },
        "13": { at: AT, outcome: fixed(20) },
        "14": { at: AT, outcome: { kind: "clean", final: true, touched: [] } },
        "15": { at: AT, outcome: { kind: "unknown", why: "no clone" } },
      },
    );
    expect(failures.map((f) => [f.kind, f.key])).toEqual([["escaped", "12 reverted"]]);
  });
});
