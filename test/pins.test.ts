import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pinnedPlugins, pinsPath, readPins, storeDir, treeHash, writePins } from "../src/core/process/pins.js";
import { projectPath } from "../src/core/project.js";
import { tempDir } from "./temp.js";

let home = "";
beforeEach(() => {
  home = tempDir("factory-pins-");
  mkdirSync(join(home, "projects"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const REF = { name: "rulebook", marketplace: "chiyanram" };
const COMMIT = "a".repeat(40);
const pinned = () => pinnedPlugins({ home, project: "ledger", env: {} });

function project(plugins?: readonly string[]): void {
  const value = { gate: "forge-ci", ready: { programs: ["make"] }, ...(plugins === undefined ? {} : { plugins }) };
  writeFileSync(projectPath(home, "ledger"), JSON.stringify(value));
}

// stored : a plugin folder in the store under its own hash, and pinned; its folder
async function stored(): Promise<string> {
  const work = join(home, "work");
  mkdirSync(join(work, "skills", "crq", "process"), { recursive: true });
  writeFileSync(join(work, "skills", "crq", "process", "lanes.json"), "{}");
  writeFileSync(join(work, "plugin.json"), '{"name": "rulebook"}');
  const hash = await treeHash(work);
  const sha256 = hash.kind === "ok" ? hash.value.sha256 : "";
  const dir = storeDir(home, REF, sha256);
  mkdirSync(join(dir, ".."), { recursive: true });
  renameSync(work, dir);
  await writePins(home, "ledger", { "rulebook@chiyanram": { commit: COMMIT, version: "1.1.0", sha256 } });
  return dir;
}

describe("plugin pins (#232)", () => {
  it("the hash covers each file's path, mode and bytes, sorted; a symlink is refused", async () => {
    const dir = join(home, "p");
    mkdirSync(join(dir, "b"), { recursive: true });
    writeFileSync(join(dir, "b", "x.md"), "x");
    writeFileSync(join(dir, "a.sh"), "#!/bin/sh\n", { mode: 0o755 });
    const one = await treeHash(dir);
    expect(one).toMatchObject({
      kind: "ok",
      value: { files: [expect.stringMatching(/^x \w{64} a\.sh$/), expect.stringMatching(/^- \w{64} b\/x\.md$/)] },
    });
    writeFileSync(join(dir, "b", "x.md"), "y");
    const two = await treeHash(dir);
    expect(two.kind === "ok" && one.kind === "ok" && two.value.sha256 !== one.value.sha256).toBe(true);
    symlinkSync("/etc/hostname", join(dir, "link"));
    expect((await treeHash(dir)).kind).toBe("failed");
  });

  it("a listed plugin runs only once pinned, and only while its stored folder has the pin's hash", async () => {
    project(["rulebook@chiyanram"]);
    expect(await pinned()).toEqual({
      kind: "failed",
      reason:
        "rulebook@chiyanram is listed but not pinned: run agent-factory plugin update <project> rulebook@chiyanram",
    });
    const dir = await stored();
    expect(await pinned()).toMatchObject({
      kind: "ok",
      value: [
        { label: "rulebook@chiyanram", ref: "rulebook@chiyanram", dir, pin: { commit: COMMIT, version: "1.1.0" } },
      ],
    });
    appendFileSync(join(dir, "skills", "crq", "process", "lanes.json"), " ");
    expect(await pinned()).toMatchObject({ kind: "failed", reason: expect.stringContaining("does not match the pin") });
  });

  it("a file added to the store, or the folder gone, is refused", async () => {
    project(["rulebook@chiyanram"]);
    const dir = await stored();
    writeFileSync(join(dir, "extra.md"), "x");
    expect((await pinned()).kind).toBe("failed");
    rmSync(join(dir, "extra.md"));
    expect((await pinned()).kind).toBe("ok");
    rmSync(dir, { recursive: true });
    expect((await pinned()).kind).toBe("failed");
  });

  it("no plugin listed, or no project file: nothing to pin, and the run goes on", async () => {
    expect(await pinned()).toEqual({ kind: "ok", value: [] });
    project();
    expect(await pinned()).toEqual({ kind: "ok", value: [] });
  });

  it("the pins file: none is no pin; one that is not a map of pins is refused", async () => {
    expect(await readPins(home, "ledger")).toEqual({ kind: "ok", value: {} });
    for (const bad of ['{"rulebook@chiyanram": {"commit": "HEAD"}}', "[]", "not json", '{"r@m": null}']) {
      writeFileSync(pinsPath(home, "ledger"), bad);
      expect((await readPins(home, "ledger")).kind).toBe("failed");
    }
    expect(pinsPath(home, "ledger")).toBe(join(home, "projects", "ledger.plugins.json"));
  });
});
