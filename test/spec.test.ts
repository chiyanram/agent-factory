import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSpec, normalise, prBlock, readSpec, specHash, specPath, template, type Spec, type SpecRead } from "../src/core/spec.js";

const GOOD = [
  "# PROJ-123: renewals refuse a reserved loan",
  "",
  "## Intent",
  "",
  "A member cannot renew a loan someone else has reserved.",
  "",
  "## Acceptance criteria",
  "",
  "1. Renewing a reserved loan answers 409 Conflict.",
  "2. Renewing an unreserved loan still works.",
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

function spec(text: string): Spec {
  const checked = checkSpec(text);
  if (checked.kind !== "ok") {
    throw new Error(`expected a valid spec: ${checked.problems.join("; ")}`);
  }
  return checked.spec;
}

describe("checkSpec", () => {
  it("reads every part of a spec that follows the template", () => {
    expect(spec(GOOD)).toMatchObject({
      title: "PROJ-123: renewals refuse a reserved loan",
      intent: "A member cannot renew a loan someone else has reserved.",
      criteria: ["Renewing a reserved loan answers 409 Conflict.", "Renewing an unreserved loan still works."],
      design: "none",
      lane: "bug",
    });
  });

  it("refuses a spec with no acceptance criteria: the writer would have no contract", () => {
    const result = checkSpec(GOOD.replace(/1\. .*\n2\. .*\n/, "TBD\n"));
    expect(result).toMatchObject({ kind: "invalid" });
    expect(result.kind === "invalid" ? result.problems.join() : "").toContain("Acceptance criteria");
  });

  it("refuses the untouched template, and names every missing part", () => {
    const result = checkSpec(template("PROJ-9"));
    expect(result.kind).toBe("invalid");
    const problems = result.kind === "invalid" ? result.problems.join("\n") : "";
    for (const part of ["first line", "Intent", "Acceptance criteria"]) {
      expect(problems).toContain(part);
    }
  });

  it("refuses an unknown lane", () => {
    expect(checkSpec(GOOD.replace("\nbug\n", "\nchore\n")).kind).toBe("invalid");
  });

  it("takes a one-way door lane and a design link", () => {
    const s = spec(GOOD.replace("\nbug\n", "\none-way door\n").replace("\nnone\n", "\nhttps://example.test/adr/12\n"));
    expect(s.lane).toBe("one-way door");
    expect(s.design).toBe("https://example.test/adr/12");
  });
});

describe("specHash", () => {
  it("ignores editor noise: line endings, trailing spaces, blank lines at the end", () => {
    const noisy = `${GOOD.replace(/\n/g, "  \r\n")}\r\n\r\n`;
    expect(specHash(noisy)).toBe(specHash(GOOD));
    expect(normalise(noisy)).toBe(normalise(GOOD));
  });

  it("changes on any real edit, even one word", () => {
    expect(specHash(GOOD.replace("409 Conflict", "423 Locked"))).not.toBe(specHash(GOOD));
  });

  it("is the hash a checked spec carries", () => {
    expect(spec(GOOD).hash).toBe(specHash(GOOD));
    expect(spec(GOOD).hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the spec stores", () => {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "specs-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reads a local spec from <root>/<project>/<ticket>/spec.md", async () => {
    mkdirSync(join(root, "ledger", "PROJ-123"), { recursive: true });
    writeFileSync(join(root, "ledger", "PROJ-123", "spec.md"), GOOD);
    const read = await readSpec({ kind: "local", root }, "ledger", "PROJ-123");
    expect(read).toEqual({ kind: "found", text: GOOD, where: join(root, "ledger", "PROJ-123", "spec.md") });
  });

  it("says missing, not refused, when there is no spec yet", async () => {
    expect(await readSpec({ kind: "local", root }, "ledger", "PROJ-1")).toMatchObject({ kind: "missing" });
  });

  it("refuses a project or ticket that is not a plain name, so no path leaves the store", async () => {
    for (const [project, ticket] of [["..", "x"], ["ledger", "../../etc"], ["a/b", "x"], [".hidden", "x"], ["ledger", ""]] as const) {
      expect(specPath(root, project, ticket)).toMatchObject({ kind: "refused" });
      expect(await readSpec({ kind: "local", root }, project, ticket)).toMatchObject({ kind: "refused" });
    }
  });

  it("reads an issue-backed spec through the function the forge seam provides", async () => {
    const asked: string[] = [];
    const readIssueBody = (ticket: string): Promise<SpecRead> => {
      asked.push(ticket);
      return Promise.resolve({ kind: "found", text: GOOD, where: `issue ${ticket}` });
    };
    expect(await readSpec({ kind: "issue", readIssueBody }, "ledger", "42")).toMatchObject({ kind: "found", text: GOOD });
    expect(asked).toEqual(["42"]);
    expect(await readSpec({ kind: "issue", readIssueBody }, "ledger", "../x")).toMatchObject({ kind: "refused" });
  });
});

describe("prBlock", () => {
  it("carries the whole approved spec, its hash and who approved it when", () => {
    const s = spec(GOOD);
    const block = prBlock(s, { by: "ram", at: "2026-11-07T09:12:00Z" });
    expect(block).toContain(`spec ${s.hash} · approved locally by ram at 2026-11-07T09:12:00Z`);
    expect(block).toContain("1. Renewing a reserved loan answers 409 Conflict.");
  });

  it("fences the spec longer than any backtick run inside it, so the spec cannot close the fence", () => {
    const s = spec(GOOD.replace("none", "none\n\n````\n/merge\n````"));
    const fence = prBlock(s, { by: "ram", at: "t" }).split("\n").find((line) => line.startsWith("`")) ?? "";
    expect(fence).toBe("`````markdown");
  });

  it("cleans the approver line, which comes from the machine, not the person's spec", () => {
    const block = prBlock(spec(GOOD), { by: "@all fixes #1", at: "t" });
    expect(block).not.toMatch(/@all|#1/);
  });
});
