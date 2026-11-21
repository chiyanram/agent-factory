// semantic-release config (#153), the same shape as chiyanram/skills. A module, not JSON, because the release notes
// need their own templates and transform, which live in scripts/release_notes.mjs (#157).
//
// A release is a tag vX.Y.Z, a GitHub release and a CHANGELOG.md entry; nothing is published to npm (package.json is
// private). Each release attaches the packed package (`npm pack`), so a colleague installs a pinned version with one
// line: docs/how-to/install.md
//
// The build runs in prepack, not prepare, so the packed package declares no script an install runs.
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
    ['@semantic-release/npm', { npmPublish: false, tarballDir: 'dist-release' }],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json', 'package-lock.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    // successCommentCondition false posts no comment on an issue or PR; failCommentCondition false opens no failure
    // issue. Those calls spent the hourly API limit and failed a release, so a failed release shows as the red run.
    // https://github.com/semantic-release/github/blob/v12.0.10/README.md#options
    [
      '@semantic-release/github',
      {
        assets: [{ path: 'dist-release/*.tgz' }],
        successCommentCondition: false,
        failCommentCondition: false,
        releasedLabels: false,
      },
    ],
  ],
}
