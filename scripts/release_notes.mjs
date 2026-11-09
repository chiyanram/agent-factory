// The shape of the release notes (#157): emoji sections, one bullet per change as
// `**scope** — subject · #ticket (PR #pr)`, and an install line. release.config.mjs imports `releaseNotes`;
// test/release-notes.test.ts renders fixture commits with it and compares them to a golden file.
//
// A squash merge on GitHub appends `(#pr)` to the PR title, so the last `(#N)` at the end of a subject is the PR and
// any before it are the tickets. The commit hash and the `closes` list are left out: the preset turns every `#N` in a
// commit body into `closes #N`, even an issue the change only waits on.
import createPreset from 'conventional-changelog-conventionalcommits'
import { crossRepoLinks } from './release_links.mjs'

const types = [
  { type: 'feat', section: '✨ Features' },
  { type: 'fix', section: '🐛 Fixes' },
  { type: 'perf', section: '⚡ Performance' },
  { type: 'revert', section: '⏪ Reverts' },
  ...['docs', 'style', 'chore', 'refactor', 'test', 'build', 'ci'].map((type) => ({ type, hidden: true })),
]

const mainTemplate = `{{> header}}
{{#if noteGroups}}

### ⚠️ Breaking changes

{{#each noteGroups}}
{{#each notes}}
* {{#if commit.scope}}**{{commit.scope}}** — {{/if}}{{text}}
{{/each}}
{{/each}}
{{/if}}
{{#each commitGroups}}

### {{title}}

{{#each commits}}
{{> commit root=@root}}
{{/each}}
{{/each}}
{{> footer}}
`

const commitPartial = `* {{#if scope}}**{{scope}}** — {{/if}}{{#if subject}}{{subject}}{{else}}{{header}}{{/if}}{{#if refs}} · {{refs}}{{/if}}
`

const footerPartial = `
Install: \`npm i -g github:{{owner}}/{{repository}}#{{currentTag}}\`
`

const TRAILING_REFS = /(?:\s*\(#\d+\))+\s*$/

// "the dispatcher (#103) (#154)" → { text: "the dispatcher", tickets: ["103"], pr: "154" }
export function splitRefs(subject) {
  const tail = subject.match(TRAILING_REFS)?.[0] ?? ''
  const numbers = [...tail.matchAll(/#(\d+)/g)].map(([, n]) => n)
  return { text: subject.slice(0, subject.length - tail.length), tickets: numbers.slice(0, -1), pr: numbers.at(-1) }
}

function refsLine({ tickets, pr }, { host, owner, repository }) {
  const repo = `${host}/${owner}/${repository}`
  const ticketLinks = tickets.map((n) => `[#${n}](${repo}/issues/${n})`).join(', ')
  const prLink = pr ? `PR [#${pr}](${repo}/pull/${pr})` : ''
  return ticketLinks && prLink ? `${ticketLinks} (${prLink})` : ticketLinks || prLink
}

const preset = createPreset({ types }).writer

function transform(commit, context) {
  const refs = typeof commit.subject === 'string' ? splitRefs(commit.subject) : { text: commit.subject, tickets: [] }
  const entry = preset.transform({ ...commit, subject: refs.text }, context)
  if (!entry) return entry
  const subject = typeof entry.subject === 'string' ? crossRepoLinks(entry.subject, context) : entry.subject
  return { ...entry, subject, references: [], refs: refsLine(refs, context) }
}

export const releaseNotes = {
  preset: 'conventionalcommits',
  presetConfig: { types },
  writerOpts: { mainTemplate, commitPartial, footerPartial, transform },
}
