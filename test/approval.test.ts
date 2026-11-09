import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { approvalPath, approvalState, approve } from "../src/core/approval.js";
import { specHash } from "../src/core/spec.js";
import { tempDir } from "./temp.js";

const SPEC = [
  "# PROJ-123: renewals refuse a reserved loan",
  "",
  "## Intent",
  "",
  "A member cannot renew a loan someone else has reserved.",
  "",
  "## Acceptance criteria",
  "",
  "1. Renewing a reserved loan answers 409 Conflict.",
  "",
  "## Design",
  "",
  "none",
  "",
  "## Lane",
  "",
  "bug",
  "",
].join("\n");

let home = "";
const where = (): { home: string; project: string; ticket: string } => ({
  home,
  project: "ledger",
  ticket: "PROJ-123",
});
const specFile = (): string => join(home, "specs", "ledger", "PROJ-123", "spec.md");
const writeSpec = (text: string): void => {
  mkdirSync(join(home, "specs", "ledger", "PROJ-123"), { recursive: true });
  writeFileSync(specFile(), text);
};
const seen = (text: string): string => specHash(text);
const DESIGN = "# Design\n\nA reservation check in RenewalService.\n";
const writeDesign = (text: string): void => writeFileSync(join(home, "specs", "ledger", "PROJ-123", "design.md"), text);

beforeEach(() => {
  home = tempDir("factory-home-");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("approve", () => {
  it("records the approval with the spec's full hash, the design's (none here), who, the front door and when", async () => {
    writeSpec(SPEC);
    const result = await approve({ where: where(), seenHash: seen(SPEC), by: "ram", at: "2026-11-07T09:12:00Z" });
    expect(result).toMatchObject({ kind: "approved", path: join(home, "approvals", "ledger", "PROJ-123.json") });
    const record = JSON.parse(readFileSync(join(home, "approvals", "ledger", "PROJ-123.json"), "utf8"));
    expect(record).toEqual({
      version: 2,
      kind: "approval",
      project: "ledger",
      ticket: "PROJ-123",
      spec_hash: specHash(SPEC),
      design_hash: "none",
      by: "ram",
      via: "terminal",
      at: "2026-11-07T09:12:00Z",
    });
  });

  it("refuses when the spec changed after the human saw its hash", async () => {
    writeSpec(SPEC);
    const shown = seen(SPEC);
    writeSpec(SPEC.replace("409 Conflict", "423 Locked"));
    const result = await approve({ where: where(), seenHash: shown, by: "ram", at: "t" });
    expect(result).toMatchObject({ kind: "refused" });
    expect(result.kind === "refused" ? result.reason : "").toContain("look at it again");
    expect(existsSync(join(home, "approvals"))).toBe(false);
  });

  it("refuses anything but the full 64-character hash: a prefix can be matched by a second spec", async () => {
    writeSpec(SPEC);
    for (const seenHash of [
      specHash(SPEC).slice(0, 12),
      specHash(SPEC).slice(0, 63),
      `${specHash(SPEC)}0`,
      "z".repeat(64),
      specHash(SPEC).toUpperCase(),
    ]) {
      const result = await approve({ where: where(), seenHash, by: "ram", at: "t" });
      expect(result).toMatchObject({ kind: "refused" });
    }
    expect(existsSync(join(home, "approvals"))).toBe(false);
  });

  it("returns a refusal, never a throw, when the record cannot be written, and leaves no temp file", async () => {
    writeSpec(SPEC);
    mkdirSync(join(home, "approvals"), { recursive: true });
    writeFileSync(join(home, "approvals", "ledger"), "a file where the folder should be");
    const result = await approve({ where: where(), seenHash: seen(SPEC), by: "ram", at: "t" });
    expect(result).toMatchObject({ kind: "refused" });
    expect(result.kind === "refused" ? result.reason : "").toContain("cannot write");
    expect(readdirSync(join(home, "approvals"))).toEqual(["ledger"]);
  });

  it("refuses a spec that breaks the template, such as one with no acceptance criteria", async () => {
    const noCriteria = SPEC.replace("1. Renewing a reserved loan answers 409 Conflict.", "TBD");
    writeSpec(noCriteria);
    const result = await approve({ where: where(), seenHash: seen(noCriteria), by: "ram", at: "t" });
    expect(result.kind === "refused" ? result.reason : "").toContain("Acceptance criteria");
  });

  it("refuses a ticket with no spec, and a name that would leave the store", async () => {
    expect(await approve({ where: where(), seenHash: "0".repeat(64), by: "ram", at: "t" })).toMatchObject({
      kind: "refused",
    });
    expect(
      await approve({ where: { home, project: "..", ticket: "x" }, seenHash: "0".repeat(64), by: "ram", at: "t" }),
    ).toMatchObject({ kind: "refused" });
    expect(approvalPath({ home, project: "ledger", ticket: "../../x" })).toMatchObject({ kind: "refused" });
  });

  it("leaves no temp file behind", async () => {
    writeSpec(SPEC);
    await approve({ where: where(), seenHash: seen(SPEC), by: "ram", at: "t" });
    expect(readdirSync(join(home, "approvals", "ledger"))).toEqual(["PROJ-123.json"]);
  });
});

describe("approvalState", () => {
  it("is approved while the spec has the approved hash, and carries the spec", async () => {
    writeSpec(SPEC);
    await approve({ where: where(), seenHash: seen(SPEC), by: "ram", at: "t" });
    const state = await approvalState(where());
    expect(state).toMatchObject({ kind: "approved", record: { by: "ram" } });
    expect(state.kind === "approved" ? state.spec.hash : "").toBe(specHash(SPEC));
  });

  it("goes stale when the spec is edited after approval: nothing may start", async () => {
    writeSpec(SPEC);
    await approve({ where: where(), seenHash: seen(SPEC), by: "ram", at: "t" });
    writeSpec(SPEC.replace("409 Conflict", "423 Locked"));
    expect(await approvalState(where())).toMatchObject({ kind: "stale", approvedHash: specHash(SPEC) });
  });

  it("stays approved through editor noise: line endings and trailing spaces", async () => {
    writeSpec(SPEC);
    await approve({ where: where(), seenHash: seen(SPEC), by: "ram", at: "t" });
    writeSpec(`${SPEC.replace(/\n/g, "  \r\n")}\r\n`);
    expect(await approvalState(where())).toMatchObject({ kind: "approved" });
  });

  it("is missing before any approval", async () => {
    writeSpec(SPEC);
    expect(await approvalState(where())).toEqual({ kind: "missing" });
  });

  it("refuses a record that is not JSON, names another ticket, or has a bad hash, rather than trusting it", async () => {
    writeSpec(SPEC);
    const path = join(home, "approvals", "ledger", "PROJ-123.json");
    mkdirSync(join(home, "approvals", "ledger"), { recursive: true });
    for (const text of [
      "{not json",
      JSON.stringify({ version: 1, project: "ledger", ticket: "PROJ-9", spec_hash: specHash(SPEC), by: "x", at: "t" }),
      JSON.stringify({ version: 1, project: "ledger", ticket: "PROJ-123", spec_hash: "abc", by: "x", at: "t" }),
    ]) {
      writeFileSync(path, text);
      expect(await approvalState(where())).toMatchObject({ kind: "refused" });
    }
  });

  it("refuses an approval whose spec is gone", async () => {
    writeSpec(SPEC);
    await approve({ where: where(), seenHash: seen(SPEC), by: "ram", at: "t" });
    rmSync(specFile());
    expect(await approvalState(where())).toMatchObject({ kind: "refused" });
  });
});

describe("the design hash (#227)", () => {
  it("binds the design beside the spec: approve needs its hash, and an edit to it makes the approval stale", async () => {
    writeSpec(SPEC);
    writeDesign(DESIGN);
    const without = await approve({ where: where(), seenHash: seen(SPEC), by: "ram", at: "t" });
    expect(without.kind === "refused" ? without.reason : "").toContain("design's hash is now");
    const done = await approve({
      where: where(),
      seenHash: seen(SPEC),
      seenDesign: specHash(DESIGN),
      by: "ram",
      via: "discord",
      at: "t",
    });
    expect(done).toMatchObject({ kind: "approved", record: { design_hash: specHash(DESIGN), via: "discord" } });
    expect(await approvalState(where())).toMatchObject({ kind: "approved" });
    writeDesign(DESIGN.replace("RenewalService", "LoanService"));
    expect(await approvalState(where())).toMatchObject({
      kind: "stale",
      part: "design",
      approvedHash: specHash(DESIGN),
    });
  });

  it("refuses a design with a character that does not show", async () => {
    writeSpec(SPEC);
    writeDesign("# Design\n\nhidden\u200b here\n");
    const result = await approve({ where: where(), seenHash: seen(SPEC), by: "ram", at: "t" });
    expect(result.kind === "refused" ? result.reason : "").toContain("do not show");
  });

  it("reads a record written before #227 as one that bound no design and came from the terminal", async () => {
    writeSpec(SPEC);
    mkdirSync(join(home, "approvals", "ledger"), { recursive: true });
    const old = { version: 1, project: "ledger", ticket: "PROJ-123", spec_hash: specHash(SPEC), by: "ram", at: "t" };
    writeFileSync(join(home, "approvals", "ledger", "PROJ-123.json"), JSON.stringify(old));
    expect(await approvalState(where())).toMatchObject({
      kind: "approved",
      record: { version: 2, design_hash: "none", via: "terminal" },
    });
    writeDesign(DESIGN);
    expect(await approvalState(where())).toMatchObject({ kind: "stale", part: "design" });
  });

  it("refuses a version 2 record with a front door the factory does not know", async () => {
    writeSpec(SPEC);
    mkdirSync(join(home, "approvals", "ledger"), { recursive: true });
    const bad = {
      version: 2,
      kind: "approval",
      project: "ledger",
      ticket: "PROJ-123",
      spec_hash: specHash(SPEC),
      design_hash: "none",
      by: "ram",
      via: "bot",
      at: "t",
    };
    writeFileSync(join(home, "approvals", "ledger", "PROJ-123.json"), JSON.stringify(bad));
    expect(await approvalState(where())).toMatchObject({ kind: "refused" });
  });
});
