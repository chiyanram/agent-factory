// market — a plugin marketplace for the pin tests (#232): an origin repo with .claude-plugin/marketplace.json and a
// rulebook plugin that holds the rulebook's real lanes file, cloned into <home>/marketplaces/chiyanram.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectPath } from "../src/core/project.js";

export const LANES = readFileSync(
  join(import.meta.dirname, "..", "tests", "fixtures", "process", "rulebook-lanes.json"),
  "utf8",
);

export const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
};

export const BASE = { gate: "forge-ci", ready: { programs: ["make"] } };

const MARKET = {
  name: "chiyanram",
  plugins: [{ name: "rulebook", source: "./plugins/rulebook", version: "1.1.0" }],
};

const PLUGIN = {
  "plugins/rulebook/.claude-plugin/plugin.json": '{"name": "rulebook"}',
  "plugins/rulebook/skills/crq/process/lanes.json": LANES,
};

function git(dir: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { env: GIT_ENV, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

// commitMarket : the marketplace's origin with these files changed in one commit; the commit's id
export function commitMarket(home: string, files: Readonly<Record<string, string>>): string {
  const origin = join(home, "origin");
  mkdirSync(origin, { recursive: true });
  git(origin, ["init", "-q"]);
  for (const [path, text] of Object.entries({ ".claude-plugin/marketplace.json": JSON.stringify(MARKET), ...files })) {
    mkdirSync(join(origin, path, ".."), { recursive: true });
    writeFileSync(join(origin, path), text);
  }
  git(origin, ["add", "-A"]);
  git(origin, ["commit", "-q", "-m", "market"]);
  return git(origin, ["rev-parse", "HEAD"]).trim();
}

// setUpMarket : the origin's first commit, its clone in the home, and the ledger project listing these plugins
export function setUpMarket(home: string, plugins: readonly string[] = ["rulebook@chiyanram"]): string {
  mkdirSync(join(home, "projects"), { recursive: true });
  const first = commitMarket(home, PLUGIN);
  execFileSync("git", ["clone", "-q", join(home, "origin"), join(home, "marketplaces", "chiyanram")], { env: GIT_ENV });
  writeFileSync(projectPath(home, "ledger"), JSON.stringify({ ...BASE, plugins }));
  return first;
}
