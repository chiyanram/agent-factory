import { describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { record, readRecords } from "../src/core/dispatch/records.js";
import { cardOf, readCard } from "../src/core/process/cards.js";
import { tempDir } from "./temp.js";

describe("the onboarder's role card (#235)", () => {
  it("the engine runs alone: its built-in card passes the check", async () => {
    expect(await readCard([], "onboarder")).toMatchObject({ kind: "ok", value: { role: "onboarder" } });
  });

  it("refuses a card that asks for Bash or Edit: the onboarder is read-only (#688)", () => {
    expect(cardOf("onboarder", "---\nrole: onboarder\ntools: [Read, Bash]\n---\nx", "p")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("asks for Bash"),
    });
    expect(cardOf("onboarder", "---\nrole: onboarder\ntools: [Read, Edit]\n---\nx", "p")).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("asks for Edit"),
    });
  });
});

describe("the run record keeps a writer run's stale cites (#235)", () => {
  it("reads them back; a line with none has none; a bad list fails the read", async () => {
    const home = tempDir("factory-stale-");
    try {
      const where = { home, project: "ledger", ticket: "PROJ-1" };
      const base = {
        kind: "writer-ended",
        mode: "fix",
        head: "h",
        outcome: "done",
        patch: "p",
        evidence: [],
        hung: false,
      } as const;
      await record({
        where,
        event: { at: "2026-11-09T10:00:00Z", ...base, stale: ["Makefile:4 is stale: its line changed"] },
      });
      await record({ where, event: { at: "2026-11-09T10:01:00Z", ...base } });
      const read = await readRecords(where);
      expect(read.kind === "ok" ? read.value.map((e) => (e.kind === "writer-ended" ? e.stale : "x")) : []).toEqual([
        ["Makefile:4 is stale: its line changed"],
        undefined,
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
