import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { specHash } from "../src/core/spec.js";
import { readReviewAgain, reviewAgain, reviewAgainPath, type ReviewAgainRequest } from "../src/core/review-again.js";
import { tempDir } from "./temp.js";

const SPEC = [
  "# PROJ-1: x",
  "",
  "## Intent",
  "",
  "It works.",
  "",
  "## Acceptance criteria",
  "",
  "1. It answers 200.",
  "",
  "## Design",
  "",
  "One table.",
  "",
  "## Lane",
  "",
  "feature",
  "",
].join("\n");

let home = "";
beforeEach(() => {
  home = tempDir("factory-review-again-");
  mkdirSync(join(home, "specs", "ledger", "PROJ-1"), { recursive: true });
  writeFileSync(join(home, "specs", "ledger", "PROJ-1", "spec.md"), SPEC);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const request = (over: Partial<ReviewAgainRequest> = {}): ReviewAgainRequest => ({
  where: { home, project: "ledger", ticket: "PROJ-1" },
  seenHash: specHash(SPEC),
  by: "ram",
  via: "terminal",
  at: "2026-11-27T08:00:00Z",
  ...over,
});

describe("review once more: the person's word at the design-review cap", () => {
  it("records the spec hash, who said it and the door under review-again/<project>/<ticket>.json", async () => {
    expect(await reviewAgain(request())).toMatchObject({ kind: "review-again" });
    expect(JSON.parse(readFileSync(join(home, "review-again", "ledger", "PROJ-1.json"), "utf8"))).toEqual({
      version: 1,
      kind: "review-again",
      project: "ledger",
      ticket: "PROJ-1",
      spec_hash: specHash(SPEC),
      by: "ram",
      via: "terminal",
      at: "2026-11-27T08:00:00Z",
    });
    expect(await readReviewAgain(request().where)).toMatchObject({ kind: "record", record: { by: "ram" } });
  });

  it("refuses a hash that is not the current spec's, or not a full hash, and writes nothing", async () => {
    for (const seenHash of [specHash("an older spec"), specHash(SPEC).slice(0, 12)]) {
      expect(await reviewAgain(request({ seenHash }))).toMatchObject({ kind: "refused" });
    }
    expect(await readReviewAgain(request().where)).toEqual({ kind: "missing" });
  });

  it("refuses a ticket with no spec, a name that leaves the folder, and a broken record", async () => {
    const none = { home, project: "ledger", ticket: "PROJ-2" };
    expect(await reviewAgain(request({ where: none }))).toMatchObject({ kind: "refused" });
    expect(reviewAgainPath({ home, project: "ledger", ticket: "../x" })).toMatchObject({ kind: "refused" });
    mkdirSync(join(home, "review-again", "ledger"), { recursive: true });
    const path = join(home, "review-again", "ledger", "PROJ-1.json");
    const good = { version: 1, kind: "review-again", project: "ledger", ticket: "PROJ-1", by: "r" };
    for (const bad of [
      "{not json",
      JSON.stringify({ ...good, spec_hash: specHash(SPEC), via: "slack", at: "2026-11-27T08:00:00Z" }),
      JSON.stringify({ ...good, spec_hash: "abc", via: "terminal", at: "2026-11-27T08:00:00Z" }),
    ]) {
      writeFileSync(path, bad);
      expect(await readReviewAgain(request().where)).toMatchObject({ kind: "refused" });
    }
  });
});
