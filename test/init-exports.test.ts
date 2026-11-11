import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportPlaces, exportsIn, exportsText } from "../src/core/init/exports.js";
import { tempDir } from "./temp.js";

let root = "";
beforeEach(() => {
  root = tempDir("factory-exports-");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("init names the profile line of each export the files now hold (#482, row 14)", () => {
  it("finds sh and fish exports, and only of the names asked", () => {
    const text = [
      "# setup",
      "export FACTORY_FORGE=github",
      "  export FACTORY_REPO=/x",
      "set -gx FACTORY_BOX srt",
      "export PATH=/y",
    ].join("\n");
    expect(exportsIn("p", text, ["FACTORY_FORGE", "FACTORY_REPO", "FACTORY_BOX"])).toEqual([
      { name: "FACTORY_FORGE", file: "p", line: 2 },
      { name: "FACTORY_REPO", file: "p", line: 3 },
      { name: "FACTORY_BOX", file: "p", line: 4 },
    ]);
  });

  it("names the file a symlinked profile points to, and reads it once", async () => {
    const home = join(root, "home");
    const dotfiles = join(root, "dotfiles");
    mkdirSync(home, { recursive: true });
    mkdirSync(dotfiles, { recursive: true });
    writeFileSync(join(dotfiles, "zshrc"), "alias x=y\nexport FACTORY_PROJECT=me/ledger\n");
    symlinkSync(join(dotfiles, "zshrc"), join(home, ".zshrc"));
    symlinkSync(join(dotfiles, "zshrc"), join(home, ".zprofile"));
    const places = await exportPlaces(home, ["FACTORY_PROJECT"]);
    expect(places).toEqual([{ name: "FACTORY_PROJECT", file: join(dotfiles, "zshrc"), line: 2 }]);
    expect(exportsText(["FACTORY_PROJECT"], places)).toBe(
      `\nThe files now hold FACTORY_PROJECT: you can remove these exports:\n  ${join(dotfiles, "zshrc")}:2  (FACTORY_PROJECT)\n`,
    );
  });

  it("says so plainly when no profile under the home holds them, and nothing when none moved", async () => {
    expect(await exportPlaces(join(root, "none"), ["FACTORY_REPO"])).toEqual([]);
    expect(exportsText(["FACTORY_REPO"], [])).toContain("from wherever your shell sets them");
    expect(exportsText([], [])).toBe("");
  });
});
