// retro-cli (#488 AC-2, the listing): agent-factory retro <project> [--json] on planted run records, with the outcomes
// stubbed; no model, no git host.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Event } from "../src/core/dispatch/records.js";
import type { MergeOutcome } from "../src/core/outcome.js";
import { cloneOutcomes, retroCommand, type Merged, type Outcomes } from "../src/retro-cli.js";
import { tempDir } from "./temp.js";

const AT = "2026-11-01T12:00:00Z";
let home = "";

beforeEach(() => {
  home = tempDir("factory-retro-");
  mkdirSync(join(home, "runs", "loans"), { recursive: true });
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const merged = (n: number): Event => ({
  at: AT,
  kind: "merged",
  number: n,
  sha: String(n).repeat(40).slice(0, 40),
  by: "ram",
});

const timeline = (n: number, rule: string): Event => ({
  at: AT,
  kind: "timeline",
  number: n,
  rounds: 1,
  found: { [rule]: { act_on: 1 } },
  acted: { [rule]: { acted: 1, of: 1 } },
  spend: {},
  unmeasured: 0,
  rescues: [],
});

function plant(ticket: string, events: readonly Event[]): void {
  writeFileSync(join(home, "runs", "loans", `${ticket}.jsonl`), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
}

// run : the command's exit, stdout and stderr, with each merge's outcome from the stub
async function run(args: readonly string[], outcomes: Readonly<Record<string, MergeOutcome>> = {}) {
  let out = "";
  let err = "";
  const asked: Merged[][] = [];
  const stub: Outcomes = (m) => {
    asked.push([...m]);
    return Promise.resolve(
      new Map(
        m.flatMap((x): [string, MergeOutcome][] => {
          const o = outcomes[x.ticket];
          return o === undefined ? [] : [[x.ticket, o]];
        }),
      ),
    );
  };
  const code = await retroCommand(args, { home, outcomes: stub, out: (t) => (out += t), err: (t) => (err += t) });
  return { code, out, err, asked };
}

const clean: MergeOutcome = { kind: "clean", final: false, touched: [] };

describe("agent-factory retro", () => {
  it("lists a rule acted on in Act on on 2 merged tickets, with the lines it cites", async () => {
    plant("12", [merged(12), timeline(12, "MUST-forge-seam")]);
    plant("15", [merged(15), timeline(15, "MUST-forge-seam")]);
    const r = await run(["loans"], { "12": clean, "15": clean });
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      [
        "retro loans: 2 merged ticket(s), 1 failure(s)",
        "rule MUST-forge-seam: on 2 tickets (12, 15)",
        `  12 timeline ${AT}: MUST-forge-seam acted on 1`,
        `  15 timeline ${AT}: MUST-forge-seam acted on 1`,
        "",
      ].join("\n"),
    );
    expect(r.asked[0]?.map((m) => m.ticket)).toEqual(["12", "15"]);
  });

  it("does not list a rule seen on 1 ticket, and names a merge with no timeline line", async () => {
    plant("12", [merged(12), timeline(12, "MUST-forge-seam")]);
    plant("9", [merged(9)]);
    plant("20", [{ at: AT, kind: "begun", by: "ram", via: "terminal" }]);
    const r = await run(["loans"], { "12": clean, "9": clean });
    expect(r.out).toBe(
      [
        "retro loans: 2 merged ticket(s), 0 failure(s)",
        "no failure seen on 2 or more tickets, and no escaped defect",
        "no timeline line (merged before #624, or the write failed): 9",
        "",
      ].join("\n"),
    );
  });

  it("lists an escaped defect at once, and names an outcome it could not read, as JSON", async () => {
    plant("12", [merged(12), timeline(12, "A")]);
    plant("13", [merged(13), timeline(13, "B")]);
    const fix: MergeOutcome = {
      kind: "fixed",
      final: false,
      touched: [],
      by: { sha: "c".repeat(40), subject: "fix: renew", at: "2026-11-03T12:00:00Z" },
    };
    const r = await run(["loans", "--json"], { "12": fix, "13": { kind: "unknown", why: "no clone" } });
    expect(JSON.parse(r.out)).toEqual({
      project: "loans",
      merged: 2,
      failures: [
        {
          kind: "escaped",
          key: "12 fixed",
          tickets: ["12"],
          cites: [`12 merged ${AT}: fixed by cccccccc fix: renew at 2026-11-03T12:00:00Z`],
        },
      ],
      untimed: [],
      unknown: [{ ticket: "13", why: "no clone" }],
    });
  });

  it("names a ticket whose records cannot be read, and exits 1", async () => {
    plant("12", [merged(12)]);
    writeFileSync(join(home, "runs", "loans", "14.jsonl"), "not json\n{}\n");
    const r = await run(["loans"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("14.jsonl line 1 is not a record");
  });

  it("refuses a bad command line with 64, --draft included until it is built", async () => {
    for (const args of [[], ["loans", "extra"], ["../x"], ["loans", "--draft"]]) {
      const r = await run(args);
      expect(r.code).toBe(64);
      expect(r.err).toBe("usage: agent-factory retro <project> [--json]\n");
    }
  });

  it("reads every outcome as unknown when the project's clone is not set", async () => {
    const read = await cloneOutcomes({}, () => 0)([{ ticket: "12", at: AT, sha: "1".repeat(40) }]);
    expect(read.get("12")).toEqual({ kind: "unknown", why: "the project's clone is not set" });
  });
});
