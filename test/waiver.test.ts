import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { judgeFiles, TEST_CONFIG, verifyFiles } from "../src/core/ready/judge.js";
import { TEST_FILES } from "../src/core/ready/floor.js";
import { BUILD_FILES } from "../src/core/review/status.js";
import { readWaiver, waive, waiverPath, type WaiveRequest } from "../src/core/waiver.js";
import { tempDir } from "./temp.js";

let home = "";
beforeEach(() => {
  home = tempDir("factory-waiver-");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const HEAD = "a".repeat(40);

const request = (over: Partial<WaiveRequest> = {}): WaiveRequest => ({
  where: { home, project: "ledger", ticket: "PROJ-1" },
  head: HEAD,
  by: "ram",
  via: "terminal",
  at: "2026-11-09T08:00:00Z",
  ...over,
});

describe("waive (#231)", () => {
  it("records { ticket, kind: test-change, head, by, via, at } under waivers/<project>/<ticket>.json", async () => {
    expect(await waive(request())).toMatchObject({ kind: "waived" });
    expect(JSON.parse(readFileSync(join(home, "waivers", "ledger", "PROJ-1.json"), "utf8"))).toEqual({
      version: 1,
      kind: "test-change",
      project: "ledger",
      ticket: "PROJ-1",
      head: HEAD,
      by: "ram",
      via: "terminal",
      at: "2026-11-09T08:00:00Z",
    });
    expect(await readWaiver(request().where)).toMatchObject({ kind: "record", record: { head: HEAD } });
  });

  it("a waiver given again replaces the one before, at its new head", async () => {
    await waive(request());
    await waive(request({ head: "b".repeat(64), via: "discord", at: "2026-11-09T09:00:00Z" }));
    expect(await readWaiver(request().where)).toMatchObject({ record: { head: "b".repeat(64), via: "discord" } });
  });

  it("refuses a head that is not a full commit id, a name that leaves the folder, and a bad record", async () => {
    expect(await waive(request({ head: "aaaaaaaa" }))).toMatchObject({ kind: "refused" });
    expect(await readWaiver(request().where)).toEqual({ kind: "missing" });
    expect(waiverPath({ home, project: "ledger", ticket: "../x" })).toMatchObject({ kind: "refused" });
    mkdirSync(join(home, "waivers", "ledger"), { recursive: true });
    const path = join(home, "waivers", "ledger", "PROJ-1.json");
    const good = { version: 1, kind: "test-change", project: "ledger", ticket: "PROJ-1", head: HEAD, by: "r" };
    for (const bad of [
      "{not json",
      JSON.stringify({ ...good, via: "terminal", at: "2026-11-09T08:00:00Z", ticket: "PROJ-2" }),
      JSON.stringify({ ...good, via: "slack", at: "2026-11-09T08:00:00Z" }),
      JSON.stringify({ ...good, via: "terminal", at: "2026-11-09T08:00:00Z", head: "abc" }),
      JSON.stringify({ ...good, via: "terminal", at: "2026-11-09T08:00:00Z", kind: "approval" }),
    ]) {
      writeFileSync(path, bad);
      expect(await readWaiver(request().where)).toMatchObject({ kind: "refused" });
    }
  });
});

describe("the verify command's files (#231)", () => {
  it("names the files the program reads, and each word that is a path", () => {
    expect(verifyFiles(["make", "verify"])).toEqual(["Makefile", "makefile", "GNUmakefile"]);
    expect(verifyFiles(["./gradlew", "check"])).toEqual(["gradlew", "gradle/wrapper/**"]);
    expect(verifyFiles(["bash", "scripts/verify.sh", "--fast"])).toEqual(["scripts/verify.sh"]);
    expect(verifyFiles(["pytest", "-q", "tests/"])).toEqual([
      "pytest.ini",
      "setup.cfg",
      "pyproject.toml",
      "tox.ini",
      "tests/**",
    ]);
    expect(verifyFiles(["sh", "../outside.sh"])).toEqual([]);
  });

  it("is a deny-list: the project's globs add to the built-in ones and never take any away", () => {
    const ready = { programs: ["make"], timeoutSeconds: 60, testFiles: TEST_FILES };
    const none = judgeFiles({ gate: { kind: "forge-ci" }, ready: { ...ready, judgeFiles: [] }, egress: { allow: [] } });
    expect(none).toEqual([...BUILD_FILES, ...TEST_CONFIG]);
    const more = judgeFiles({
      gate: { kind: "local", verify: ["make", "verify"] },
      ready: { ...ready, judgeFiles: ["ci/**"] },
      egress: { allow: [] },
    });
    expect(more).toEqual(expect.arrayContaining([...none, "Makefile", "ci/**"]));
  });
});
