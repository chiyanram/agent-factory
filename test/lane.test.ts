import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_LANES,
  heavier,
  type LaneProps,
  needsApproval,
  needsTestFirst,
  oneWayDoorPathsOf,
  plannedRaise,
} from "../src/core/lane.js";
import { checkSpec, type Spec } from "../src/core/spec.js";
import { TEST_FILES } from "../src/core/ready/floor.js";
import { commentsOnly, contentLane, diffLane, fileRead, valuesOnly } from "../src/core/ready/lane.js";
import { project, type Project } from "./review-repo.js";
import { tempDir } from "./temp.js";

const SPEC = `# PROJ-7: a typo in the help

## Intent

Fix the typo.

## Acceptance criteria

1. The help reads "receive".

## Design

none

## Lane

tiny

## Planned files

- \`db/migrations/V7__loans.sql\`
- src/help.ts
`;

function spec(text = SPEC): Spec {
  const checked = checkSpec(text);
  if (checked.kind !== "ok") {
    throw new Error(checked.problems.join("; "));
  }
  return checked.spec;
}

describe("the approval floor (#230)", () => {
  it("the default lanes need an approval in every lane above tiny", () => {
    expect(DEFAULT_LANES.map((l) => [l.name, needsApproval(l.name)])).toEqual([
      ["tiny", false],
      ["bug", true],
      ["feature", true],
      ["one-way door", true],
    ]);
  });

  it("reads a lane's approval from the project's lanes: a process may make tiny need one; a lane left out needs one", () => {
    const strict = DEFAULT_LANES.map((l) => ({ name: l.name, approval: true, lenses: l.lenses }));
    expect(needsApproval("tiny", strict)).toBe(true);
    expect(needsApproval("tiny", DEFAULT_LANES)).toBe(false);
    expect(needsApproval("bug", [{ name: "tiny", approval: false, lenses: 1 }])).toBe(true);
  });

  it("goes by the lane's name, not its place: whatever lanes are passed, bug, feature and one-way door need an approval (#483)", () => {
    const HEAVY = ["bug", "feature", "one-way door"] as const;
    const shapes: readonly (readonly LaneProps[])[] = [
      [{ name: "bug", approval: false, lenses: 1 }],
      [{ name: "one-way door", approval: false, lenses: 1 }],
      DEFAULT_LANES.toReversed().map((l) => ({ name: l.name, approval: false, lenses: l.lenses })),
      DEFAULT_LANES.map((l) => ({ name: l.name, approval: l.name !== "bug", lenses: l.lenses })),
      [],
    ];
    for (const lanes of shapes) {
      expect(HEAVY.map((l) => needsApproval(l, lanes))).toEqual([true, true, true]);
    }
  });
});

describe("test-first, a lane's property (#417)", () => {
  it("starts only the bug lane with a failing test by default", () => {
    expect(DEFAULT_LANES.map((l) => needsTestFirst(l.name))).toEqual([false, true, false, false]);
  });

  it("reads it from the lanes, keeps the default lane's when left out, and lets a process turn it off for bug", () => {
    const lanes: readonly LaneProps[] = [
      { name: "tiny", approval: false, lenses: 1 },
      { name: "bug", approval: true, lenses: 3, testFirst: false },
      { name: "feature", approval: true, lenses: 3, testFirst: true },
    ];
    expect([needsTestFirst("tiny", lanes), needsTestFirst("bug", lanes), needsTestFirst("feature", lanes)]).toEqual([
      false,
      false,
      true,
    ]);
  });
});

describe("raise only", () => {
  it("keeps the heavier of two lanes, whichever comes first", () => {
    expect(heavier("tiny", "bug")).toBe("bug");
    expect(heavier("feature", "bug")).toBe("feature");
    expect(heavier("one-way door", "tiny")).toBe("one-way door");
  });
});

describe("the lane before the build: the planned files (#230)", () => {
  it("raises a spec to the one-way door when a planned file is under a one-way-door path", () => {
    expect(spec().planned).toEqual(["db/migrations/V7__loans.sql", "src/help.ts"]);
    expect(plannedRaise(spec(), ["db/migrations/**"])).toEqual({
      kind: "raised",
      from: "tiny",
      to: "one-way door",
      why: "db/migrations/V7__loans.sql is under a one-way-door path",
    });
  });

  it("keeps the lane with no one-way-door path, no planned file there, or a spec already a one-way door", () => {
    expect(plannedRaise(spec(), [])).toEqual({ kind: "kept" });
    expect(plannedRaise(spec(), ["api/**"])).toEqual({ kind: "kept" });
    expect(plannedRaise(spec(SPEC.replace("\ntiny\n", "\none-way door\n")), ["db/**"])).toEqual({ kind: "kept" });
  });
});

describe("oneWayDoorPathsOf", () => {
  let home = "";
  beforeEach(() => {
    home = tempDir("factory-lane-");
    mkdirSync(join(home, "projects"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const write = (value: unknown) => writeFileSync(join(home, "projects", "ledger.json"), JSON.stringify(value));

  it("reads the project file's list, and none with no file or no key", async () => {
    expect(await oneWayDoorPathsOf({ home, project: "ledger" })).toEqual({ kind: "ok", value: [] });
    write({ gate: "forge-ci" });
    expect(await oneWayDoorPathsOf({ home, project: "ledger" })).toEqual({ kind: "ok", value: [] });
    write({ lanes: { oneWayDoor: ["db/migrations/**", "api/openapi.yaml"] } });
    expect(await oneWayDoorPathsOf({ home, project: "ledger" })).toEqual({
      kind: "ok",
      value: ["db/migrations/**", "api/openapi.yaml"],
    });
  });

  it("refuses a key that is there but not a list of globs, so a typo never drops them", async () => {
    write({ lanes: { oneWayDoor: "db/**" } });
    expect(await oneWayDoorPathsOf({ home, project: "ledger" })).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining('"lanes.oneWayDoor" must list globs'),
    });
  });
});

const diff = (lines: string) => `diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n${lines}`;

describe("the lane a file's lines need", () => {
  it("reads comments only as tiny, and any code as bug", () => {
    expect(commentsOnly(["// a typo fixed", "* @param x the total", "# a note", ""])).toBe(true);
    expect(commentsOnly(["#include <x.h>"])).toBe(false);
    expect(commentsOnly(["--i;"])).toBe(false);
    expect(contentLane(["src/a.ts"], diff("-// recieve\n+// receive\n"))).toBe("tiny");
    expect(contentLane(["src/a.ts"], diff("-return 1;\n+return 2;\n"))).toBe("bug");
  });

  it("reads a config file's changed values as tiny, and a new or removed key as bug", () => {
    expect(valuesOnly(diff('-  "timeout": 30,\n+  "timeout": 60,\n'))).toBe(true);
    expect(contentLane(["app.yaml"], diff("-retries: 3\n+retries: 5\n"))).toBe("tiny");
    expect(contentLane(["app.yaml"], diff("+cache: true\n"))).toBe("bug");
    expect(contentLane(["app.yaml"], diff("-retries: 3\n+attempts: 3\n"))).toBe("bug");
    expect(contentLane(["app.ts"], diff("-retries: 3\n+retries: 5\n"))).toBe("bug");
  });

  it("reads a file moved or changed in mode with no line changed as code", () => {
    expect(contentLane(["src/a.ts", "src/b.ts"], "")).toBe("bug");
  });

  it("gives a file the heaviest lane its conditions ask for: a doc under a one-way-door path is the one-way door", () => {
    expect(fileRead(["db/migrations/README.md"], ["db/migrations/**"], undefined)).toEqual({
      lane: "one-way door",
      why: "is under a one-way-door path",
    });
  });
});

describe("the lane the real diff needs, through hostGit (#230)", () => {
  let p: Project;
  beforeEach(() => {
    p = project("feat/x");
    p.write("src/help.ts", "// recieve the loan\nexport const help = 1;\n");
    p.write("config/app.yaml", "retries: 3\n");
    p.write("db/migrations/V1__init.sql", "create table loans (id int);\n");
    p.commitAll("main");
    p.git("push", "-q", "origin", "main");
    p.git("checkout", "-q", "-b", "factory/PROJ-7");
  });
  afterEach(() => rmSync(p.root, { recursive: true, force: true }));

  async function lane(oneWayDoor: readonly string[] = ["db/migrations/**"]) {
    const head = p.commitAll("the writer's change");
    p.git("push", "-q", "origin", "factory/PROJ-7");
    return diffLane(
      {
        repo: p.clone,
        env: p.env,
        base: "main",
        branch: "factory/PROJ-7",
        head,
        testFiles: TEST_FILES,
        judgeFiles: [],
        waived: "none",
      },
      oneWayDoor,
    );
  }

  it("is tiny for docs, comments and config values only", async () => {
    p.write("README.md", "# fixed\n");
    p.write("src/help.ts", "// receive the loan\nexport const help = 1;\n");
    p.write("config/app.yaml", "retries: 5\n");
    expect(await lane()).toEqual({
      kind: "ok",
      value: { lane: "tiny", why: "README.md changes only docs, comments or config values" },
    });
  });

  it("is at least bug for any code change, and names the file", async () => {
    p.write("README.md", "# fixed\n");
    p.write("src/help.ts", "// recieve the loan\nexport const help = 2;\n");
    expect(await lane()).toEqual({ kind: "ok", value: { lane: "bug", why: "src/help.ts changes code" } });
  });

  it("is the one-way door when the diff touches a one-way-door path, or moves a file out of one", async () => {
    p.write("db/migrations/V2__due.sql", "alter table loans add due date;\n");
    p.write("src/help.ts", "export const help = 2;\n");
    expect(await lane()).toEqual({
      kind: "ok",
      value: { lane: "one-way door", why: "db/migrations/V2__due.sql is under a one-way-door path" },
    });
  });

  it("follows a move out of a one-way-door path", async () => {
    p.write("old/.keep", "");
    p.git("mv", "db/migrations/V1__init.sql", "old/V1__init.sql");
    expect(await lane()).toMatchObject({ kind: "ok", value: { lane: "one-way door" } });
  });

  it("fails rather than read a lane when the head moved", async () => {
    p.write("README.md", "# fixed\n");
    p.commitAll("the writer's change");
    p.git("push", "-q", "origin", "factory/PROJ-7");
    const out = await diffLane(
      {
        repo: p.clone,
        env: p.env,
        base: "main",
        branch: "factory/PROJ-7",
        head: "0".repeat(40),
        testFiles: TEST_FILES,
        judgeFiles: [],
        waived: "none",
      },
      [],
    );
    expect(out).toMatchObject({ kind: "failed", reason: expect.stringContaining("the head moved") });
  });
});
