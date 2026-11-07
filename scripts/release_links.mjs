// The conventionalcommits preset links every `#N` in a commit subject to this repo, so `agent-factory#31` came out
// as a link to chiyanram/skills#31. This rewrites a `repo#N` or `owner/repo#N` link to point at its own repo; a bare
// repo name takes this repo's owner. scripts/release_notes.mjs calls it on each subject.

const CROSS_REPO = /(?<![\w./-])(?:([\w.-]+)\/)?([\w.-]+)\[#(\d+)\]\([^)\s]*\)/g

export function crossRepoLinks(subject, { host, owner }) {
  return subject.replace(CROSS_REPO, (_, refOwner, repo, issue) => {
    const name = `${refOwner ?? owner}/${repo}`
    return `[${name}#${issue}](${host}/${name}/issues/${issue})`
  })
}
