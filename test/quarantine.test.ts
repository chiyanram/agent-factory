// a fail is a fail (#485; #456 decision 3): only a person quarantines a check, in the project's own settings, with an
// owner, the day it was added, an expiry at most quarantine.maxDays later, and a ticket; a quarantined check still runs
// and shows, and does not block until it expires
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  heldBy,
  live,
  quarantineItems,
  quarantineLine,
  quarantineOf,
  readQuarantine,
} from "../src/core/process/quarantine.js";
import { readProcess } from "../src/core/process/read.js";
import { tempDir } from "./temp.js";

const Q = { check: "e2e", owner: "ram", added: "2026-11-10", expires: "2026-11-20", ticket: "#512" };
const NOW = Date.parse("2026-11-11T10:00:00Z");

describe("quarantineOf", () => {
  it("reads every field, and refuses an entry with no owner, no added day, a bad day or no ticket", () => {
    expect(quarantineOf([Q], "/q.json")).toEqual({ kind: "ok", value: [Q] });
    for (const bad of [
      { ...Q, owner: "" },
      { ...Q, added: undefined },
      { ...Q, expires: "next week" },
      { ...Q, ticket: undefined },
    ]) {
      expect(quarantineOf([bad], "/q.json").kind).toBe("failed");
    }
    expect(quarantineOf({}, "/q.json").kind).toBe("failed");
  });

  it("refuses an expiry more than maxDays after the added day (14 by default), or before it", () => {
    expect(quarantineOf([{ ...Q, expires: "2026-11-24" }], "/q.json").kind).toBe("ok");
    expect(quarantineOf([{ ...Q, expires: "2026-11-25" }], "/q.json")).toEqual({
      kind: "failed",
      reason: "/q.json: the quarantine of e2e lasts 15 days; quarantine.maxDays allows 14",
    });
    expect(quarantineOf([Q], "/q.json", 7).kind).toBe("failed");
    expect(quarantineOf([{ ...Q, expires: "2026-11-01" }], "/q.json").kind).toBe("failed");
  });
});

describe("heldBy", () => {
  it("passes a red head only when every failed job is quarantined and unexpired", () => {
    expect(heldBy(["e2e"], [Q], NOW)).toEqual({ kind: "quarantined", shown: [Q] });
    expect(heldBy(["e2e", "unit"], [Q], NOW)).toEqual({ kind: "blocks" });
    expect(heldBy([], [Q], NOW)).toEqual({ kind: "blocks" });
    expect(heldBy(["e2e"], [{ ...Q, expires: "2026-11-10" }], NOW)).toEqual({ kind: "blocks" });
  });

  it("holds through the end of the expiry day, UTC", () => {
    expect(live({ ...Q, expires: "2026-11-11" }, Date.parse("2026-11-11T23:59:59Z"))).toBe(true);
    expect(live({ ...Q, expires: "2026-11-11" }, Date.parse("2026-11-12T00:00:00Z"))).toBe(false);
  });

  it("names the owner, the expiry and the ticket in the log and in the ping", () => {
    expect(quarantineLine([Q])).toBe(
      "red, but quarantined by a person: e2e (owner ram, until 2026-11-20, #512); it does not block",
    );
    expect(quarantineItems([Q])).toEqual(["quarantined: e2e, owner ram, since 2026-11-10, until 2026-11-20, #512"]);
  });
});

describe("where a quarantine lives: the project's own settings, never the rules pack", () => {
  let home = "";
  beforeEach(() => {
    home = tempDir("factory-quarantine-");
    mkdirSync(join(home, "projects"), { recursive: true });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const project = (value: object) => writeFileSync(join(home, "projects", "ledger.json"), JSON.stringify(value));

  it("is none with no key, read from the project file, and refused when it is bad or too long", async () => {
    project({});
    expect(await readQuarantine({ home, project: "ledger" })).toEqual({ kind: "ok", value: [] });
    project({ quarantine: { checks: [Q] } });
    expect(await readQuarantine({ home, project: "ledger" })).toEqual({ kind: "ok", value: [Q] });
    project({ quarantine: { checks: [Q], maxDays: 3 } });
    expect((await readQuarantine({ home, project: "ledger" })).kind).toBe("failed");
  });

  it("a process plugin's quarantine.json is not read", async () => {
    const dir = join(home, "team");
    const process = join(dir, "skills", "process", "process");
    mkdirSync(process, { recursive: true });
    writeFileSync(join(process, "lanes.json"), JSON.stringify({ lanes: [{ lane: "tiny", approval: false }] }));
    writeFileSync(join(process, "quarantine.json"), JSON.stringify({ quarantine: [Q] }));
    const read = await readProcess([{ label: "team", dir }]);
    expect(read.kind === "ok" ? Object.keys(read.value) : read.reason).not.toContain("quarantine");
  });
});

describe("only the project file holds a quarantine (#485)", () => {
  let home = "";
  beforeEach(() => {
    home = tempDir("factory-quarantine-user-");
    mkdirSync(join(home, "projects"), { recursive: true });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("a user file that sets quarantine.checks refuses the read", async () => {
    writeFileSync(join(home, "projects", "ledger.json"), "{}");
    writeFileSync(join(home, "user.json"), JSON.stringify({ quarantine: { checks: [Q] } }));
    const read = await readQuarantine({ home, project: "ledger" });
    expect(read).toMatchObject({ kind: "failed", reason: expect.stringContaining("quarantine.checks") });
  });
});
