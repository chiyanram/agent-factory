// a fail is a fail (#485; #456 decision 3): only a person quarantines a check, with an owner, an expiry and a ticket;
// a quarantined check still runs and shows, and does not block until its expiry
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { heldBy, live, quarantineLine, quarantineOf } from "../src/core/process/quarantine.js";
import { readProcess } from "../src/core/process/read.js";
import { tempDir } from "./temp.js";

const Q = { check: "e2e", owner: "ram", expires: "2026-11-30", ticket: "#512" };
const NOW = Date.parse("2026-11-11T10:00:00Z");

describe("quarantineOf", () => {
  it("reads every field, and refuses an entry with no owner, a bad day or no ticket", () => {
    expect(quarantineOf({ quarantine: [Q] }, "/q.json")).toEqual({ kind: "ok", value: [Q] });
    for (const bad of [
      { ...Q, owner: "" },
      { ...Q, expires: "next week" },
      { ...Q, ticket: undefined },
    ]) {
      expect(quarantineOf({ quarantine: [bad] }, "/q.json").kind).toBe("failed");
    }
    expect(quarantineOf({}, "/q.json").kind).toBe("failed");
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

  it("names the owner, the expiry and the ticket", () => {
    expect(quarantineLine([Q])).toBe(
      "red, but quarantined by a person: e2e (owner ram, until 2026-11-30, #512); it does not block",
    );
  });
});

describe("the process plugin's quarantine.json", () => {
  let dir = "";
  beforeEach(() => {
    dir = tempDir("factory-quarantine-");
    const process = join(dir, "skills", "process", "process");
    mkdirSync(process, { recursive: true });
    writeFileSync(join(process, "lanes.json"), JSON.stringify({ lanes: [{ lane: "tiny", approval: false }] }));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is none when the process has no file, read when it has one, and refuses the process when it is bad", async () => {
    const none = await readProcess([{ label: "team", dir }]);
    expect(none.kind === "ok" ? none.value.quarantine : none.reason).toEqual([]);
    const path = join(dir, "skills", "process", "process", "quarantine.json");
    writeFileSync(path, JSON.stringify({ quarantine: [Q] }));
    const one = await readProcess([{ label: "team", dir }]);
    expect(one.kind === "ok" ? one.value.quarantine : one.reason).toEqual([Q]);
    writeFileSync(path, JSON.stringify({ quarantine: [{ check: "e2e" }] }));
    expect((await readProcess([{ label: "team", dir }])).kind).toBe("failed");
  });
});
