import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRecords, record, type Event } from "../src/core/dispatch/records.js";
import { storeDir, treeHash, writePins } from "../src/core/process/pins.js";
import { hashesOf, runPlugins } from "../src/core/process/use.js";
import { projectPath } from "../src/core/project.js";
import { tempDir } from "./temp.js";

let home = "";
beforeEach(() => {
  home = tempDir("factory-use-");
  mkdirSync(join(home, "projects"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function project(plugins?: readonly string[]): void {
  const value = { gate: "forge-ci", ready: { programs: ["make"] }, ...(plugins === undefined ? {} : { plugins }) };
  writeFileSync(projectPath(home, "ledger"), JSON.stringify(value));
}

function folder(name: string): string {
  const dir = join(home, name);
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), `{"name": "${name}"}`);
  return dir;
}

const used = (env: NodeJS.ProcessEnv = {}) => runPlugins({ home, project: "ledger", env });

describe("the plugins a pass hands its runs (#232)", () => {
  it("no plugin and no folder setting: the engine runs alone, with no warning", async () => {
    project();
    expect(await used()).toEqual({ kind: "ok", value: { plugins: [], warnings: [] } });
  });

  it("no plugin listed: the deprecated folder setting is read, hashed, and warned about", async () => {
    project();
    const dir = folder("local");
    const hash = await treeHash(dir);
    const sha256 = hash.kind === "ok" ? hash.value.sha256 : "";
    expect(await used({ FACTORY_RULEBOOK: dir })).toEqual({
      kind: "ok",
      value: {
        plugins: [{ label: "FACTORY_RULEBOOK", dir, ref: "FACTORY_RULEBOOK", sha256 }],
        warnings: [expect.stringContaining("FACTORY_RULEBOOK is deprecated and is read for one release")],
      },
    });
    expect((await used({ FACTORY_RULEBOOK: join(home, "none") })).kind).toBe("failed");
  });

  it("listed plugins win over the folder setting, each checked against its pin, in order", async () => {
    project(["rulebook@chiyanram"]);
    expect((await used()).kind).toBe("failed");
    const work = folder("work");
    const hash = await treeHash(work);
    const sha256 = hash.kind === "ok" ? hash.value.sha256 : "";
    const dir = storeDir(home, { name: "rulebook", marketplace: "chiyanram" }, sha256);
    mkdirSync(join(dir, ".."), { recursive: true });
    rmSync(dir, { recursive: true, force: true });
    renameSync(work, dir);
    await writePins(home, "ledger", { "rulebook@chiyanram": { commit: "a".repeat(40), version: "", sha256 } });
    const got = await used({ FACTORY_RULEBOOK: folder("local") });
    expect(got).toEqual({
      kind: "ok",
      value: {
        plugins: [{ label: "rulebook@chiyanram", dir, ref: "rulebook@chiyanram", sha256 }],
        warnings: ["FACTORY_RULEBOOK is ignored: the project lists its plugins"],
      },
    });
    expect(got.kind === "ok" && hashesOf(got.value.plugins)).toEqual([{ ref: "rulebook@chiyanram", sha256 }]);
  });

  it("a run record's started line keeps each plugin's hash; an older line reads without them", async () => {
    const where = { home, project: "ledger", ticket: "PROJ-1" };
    const base: Event = { at: "2026-11-09T00:00:00Z", kind: "started", phase: "writer", mode: "fix", head: "h" };
    const plugins = [{ ref: "rulebook@chiyanram", sha256: "b".repeat(64) }];
    await record({ where, event: base });
    await record({ where, event: { ...base, plugins } });
    expect(await readRecords(where)).toEqual({ kind: "ok", value: [base, { ...base, plugins }] });
  });
});
