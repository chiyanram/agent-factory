// release notes (#157; ported from tests/release_notes.test.sh, #138): the notes that this repo's release.config.mjs
// writes for a fixed set of commits match tests/fixtures/release-notes/expected.md. No git, no network: the real
// release-notes plugin gets the fixture commits straight from commits.json, in a child node, as a release run would
// load the config. The date is the only part that changes, so it becomes DATE.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

const RENDER = `
import { readFileSync } from 'node:fs'
import { generateNotes } from '@semantic-release/release-notes-generator'
import config from './release.config.mjs'

const [, pluginConfig] = config.plugins.find((p) => p[0] === '@semantic-release/release-notes-generator')
const notes = await generateNotes(pluginConfig, {
  cwd: process.cwd(),
  commits: JSON.parse(readFileSync('tests/fixtures/release-notes/commits.json', 'utf8')),
  lastRelease: { gitTag: 'v0.1.0' },
  nextRelease: { gitTag: 'v0.2.0', version: '0.2.0' },
  options: { repositoryUrl: 'https://github.com/chiyanram/agent-factory.git' },
})
process.stdout.write(notes.replace(/\\(\\d{4}-\\d{2}-\\d{2}\\)/, '(DATE)'))
`;

describe("release notes", () => {
  it("match the golden file", () => {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", RENDER], { cwd: ROOT, encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(readFileSync(join(ROOT, "tests/fixtures/release-notes/expected.md"), "utf8"));
  });
});
