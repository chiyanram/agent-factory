import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  changedFiles,
  entryOf,
  fetchPlugin,
  folderCounts,
  targetCommit,
  type Fetched,
} from "../src/core/process/fetch.js";
import { marketplaceDir, treeHash } from "../src/core/process/pins.js";
import { commitMarket, GIT_ENV, setUpMarket } from "./market.js";
import { tempDir } from "./temp.js";

let home = "";
beforeEach(() => {
  home = tempDir("factory-fetch-");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const REF = { name: "rulebook", marketplace: "chiyanram" };

async function fetched(given?: string): Promise<Fetched> {
  const commit = await targetCommit(GIT_ENV, marketplaceDir(home, "chiyanram"), given);
  const got = commit.kind === "ok" ? await fetchPlugin({ home, env: GIT_ENV, ref: REF, commit: commit.value }) : commit;
  if (got.kind === "failed") {
    throw new Error(got.reason);
  }
  return got.value;
}

describe("fetching a plugin version (#232)", () => {
  it("fetches the plugin at the marketplace's HEAD into the home's store, by its hash, never into a repo", async () => {
    const first = setUpMarket(home);
    const f = await fetched();
    expect(f).toMatchObject({ commit: first, version: "1.1.0" });
    expect(f.dir).toBe(join(home, "plugins", "chiyanram", "rulebook", f.sha256));
    expect(f.files.map((l) => l.slice(67))).toEqual([".claude-plugin/plugin.json", "skills/crq/process/lanes.json"]);
    expect(readFileSync(join(f.dir, ".claude-plugin", "plugin.json"), "utf8")).toContain("rulebook");
    expect(await treeHash(f.dir)).toMatchObject({ kind: "ok", value: { sha256: f.sha256 } });
    // a newer commit is fetched from origin; an older one can be named, and gives the same folder again
    const second = commitMarket(home, { "plugins/rulebook/NEW.md": "x" });
    expect((await fetched()).commit).toBe(second);
    expect(await fetched(first)).toMatchObject({ sha256: f.sha256, dir: f.dir });
  });

  it("refuses a commit that is not one, read never as an option, and a plugin the marketplace does not list", async () => {
    setUpMarket(home);
    const market = marketplaceDir(home, "chiyanram");
    expect(await targetCommit(GIT_ENV, market, "--help")).toMatchObject({ kind: "failed" });
    expect(await targetCommit(GIT_ENV, market, "nothead")).toMatchObject({ kind: "failed" });
    const commit = await targetCommit(GIT_ENV, market, undefined);
    const other = { name: "other", marketplace: "chiyanram" };
    const got =
      commit.kind === "ok" ? await fetchPlugin({ home, env: GIT_ENV, ref: other, commit: commit.value }) : commit;
    expect(got).toMatchObject({ kind: "failed", reason: expect.stringContaining("lists no plugin other") });
    expect(await targetCommit(GIT_ENV, join(home, "none"), undefined)).toMatchObject({ kind: "failed" });
  });

  it("the marketplace entry must name a folder inside the marketplace; changes are listed by path", () => {
    const of = (source: unknown) => entryOf(JSON.stringify({ plugins: [{ name: "r", source }] }), "r").kind;
    expect(of("./plugins/r")).toBe("ok");
    expect([of("../r"), of("/etc"), of("."), of({ source: "github" }), of(undefined)]).toEqual(Array(5).fill("failed"));
    expect(entryOf("not json", "r").kind).toBe("failed");
    expect(changedFiles(["- a x", "- b y", "- e v"], ["- a x", "x b y", "- d z"])).toEqual(["- v", "~ y", "+ z"]);
    // a first pin: a count per folder, two parts deep (#482)
    expect(
      folderCounts([
        "- a skills/crq/references/x.md",
        "- b skills/crq/references/y.md",
        "- c skills/crq/SKILL.md",
        "- d README.md",
        "- e .claude-plugin/plugin.json",
      ]),
    ).toEqual(["+ 1 file in .", "+ 1 file in .claude-plugin", "+ 3 files in skills/crq"]);
  });
});
