// semantic-release config (#153), the same shape as chiyanram/skills. A module, not JSON, because the release notes
// need their own templates and transform, which live in scripts/release_notes.mjs (#157).
//
// A release is a tag vX.Y.Z, a GitHub release and a CHANGELOG.md entry; nothing is published to npm (package.json is
// private). Each release attaches the packed package (`npm pack`), so a colleague installs a pinned version with one
// line: docs/how-to/install.md
import { releaseNotes } from './scripts/release_notes.mjs'

export default {
  branches: ['main'],
  tagFormat: 'v${version}',
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
    ['@semantic-release/release-notes-generator', releaseNotes],
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md',
        changelogTitle:
          '# Changelog\n\nWhat agent-factory ships, by version. semantic-release writes this file from the commit messages on `main`;\ndo not edit it by hand.',
      },
    ],
    // sets "version" in package.json and package-lock.json, then packs the package into dist-release/ (npm pack runs
    // the prepack script, which builds dist/); publishes nothing, because the package is private. The build is prepack,
    // not prepare, so the packed package declares no script an install runs (#482)
    ['@semantic-release/npm', { npmPublish: false, tarballDir: 'dist-release' }],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json', 'package-lock.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    // no "released in" comments or labels on each closed issue and PR: they spent the account's hourly API limit and
    // failed the v0.29.0 run after the release was out. The release page and CHANGELOG.md list what shipped.
    // The packed package goes on the release page as chiyanram-agent-factory-<version>.tgz for the one-line install.
    [
      '@semantic-release/github',
      { assets: [{ path: 'dist-release/*.tgz' }], successComment: false, releasedLabels: false },
    ],
  ],
}
