#!/usr/bin/env bash
# scripts/release_notes.mjs: the release notes that the repo's release.config.mjs writes for a fixed set of commits
# match tests/fixtures/release-notes/expected.md (#157). No git, no network: the real release-notes plugin gets the
# fixture commits straight from commits.json. The date is the only part that changes, so it becomes DATE.
. "$(dirname "$0")/lib.sh"

render_notes() {
  (cd "$REPO_ROOT" && node --input-type=module -e "
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
    process.stdout.write(notes.replace(/\(\d{4}-\d{2}-\d{2}\)/, '(DATE)'))
  ")
}

expect_pass "the notes match the golden file" \
  diff -u "$REPO_ROOT/tests/fixtures/release-notes/expected.md" <(render_notes)

finish
