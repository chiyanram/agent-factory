// semantic-release config (#153), the same shape as chiyanram/skills. A module, not JSON, because the release notes
// need their own templates and transform, which live in scripts/release_notes.mjs (#157).
//
// A release is a tag vX.Y.Z, a GitHub release and a CHANGELOG.md entry; nothing is published to npm (package.json is
// private). A colleague installs a pinned version from its packed tarball: GUIDE.md#install-a-pinned-version
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
    // sets "version" in package.json and package-lock.json; publishes nothing, because the package is private
    ['@semantic-release/npm', { npmPublish: false }],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json', 'package-lock.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    // no "released in" comments or labels on each closed issue and PR: they spent the account's hourly API limit and
    // failed the v0.29.0 run after the release was out. The release page and CHANGELOG.md list what shipped.
    ['@semantic-release/github', { successComment: false, releasedLabels: false }],
  ],
}
