import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pinsPath } from "../src/core/process/pins.js";
import { projectPath } from "../src/core/project.js";
import { chosenProject, projectNames } from "../src/core/which-project.js";
import { tempDir } from "./temp.js";

let home = "";
beforeEach(() => {
  home = tempDir("factory-which-");
  mkdirSync(join(home, "projects"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const board = () => chosenProject({ home, project: undefined, env: {}, usage: "agent-factory board" });

describe("projectNames", () => {
  it("lists one project per project file, sorted, and none when the folder is missing", async () => {
    writeFileSync(projectPath(home, "zeta"), "{}");
    writeFileSync(projectPath(home, "ledger"), "{}");
    mkdirSync(join(home, "projects", "ledger"));
    expect(await projectNames(home)).toEqual(["ledger", "zeta"]);
    expect(await projectNames(join(home, "nowhere"))).toEqual([]);
  });

  it("does not count a project's pins file as a second project", async () => {
    writeFileSync(projectPath(home, "ledger"), "{}");
    writeFileSync(pinsPath(home, "ledger"), "{}");
    expect(await projectNames(home)).toEqual(["ledger"]);
  });

  it("does not count a pins file with no project file beside it", async () => {
    writeFileSync(pinsPath(home, "ledger"), "{}");
    expect(await projectNames(home)).toEqual([]);
  });
});

describe("chosenProject with no project named", () => {
  it("picks the one project when the folder also holds its pins file", async () => {
    writeFileSync(projectPath(home, "ledger"), "{}");
    writeFileSync(pinsPath(home, "ledger"), "{}");
    expect(await board()).toEqual({ kind: "ok", value: "ledger" });
  });

  it("asks for a project when there are two, and lists only projects", async () => {
    writeFileSync(projectPath(home, "ledger"), "{}");
    writeFileSync(projectPath(home, "aruvii"), "{}");
    writeFileSync(pinsPath(home, "ledger"), "{}");
    const chosen = await board();
    expect(chosen.kind).toBe("failed");
    expect(chosen.kind === "failed" ? chosen.reason : "").toContain("holds 2 projects (aruvii, ledger)");
  });
});
