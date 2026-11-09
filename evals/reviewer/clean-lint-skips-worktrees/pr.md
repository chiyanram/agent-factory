# fix(lint): skip the repo's own worktrees in Biome, oxlint and vitest (#148) (#152)

A worktree under .claude/worktrees/ is a full second checkout inside the repo, and nothing ignored it. make lint in the
main checkout then failed: Biome found a nested root biome.json, oxlint refused a nested typeAware config, and vitest
ran every test of each worktree a second time. CI has no worktrees, so it stayed green.

- .gitignore: .claude/worktrees/. Biome (vcs.useIgnoreFile) and oxlint skip git-ignored paths.
- vitest.config.ts: include test/**/*.test.ts only.

Checked with a planted .claude/worktrees/probe holding biome.json, .oxlintrc.json and a test: make lint failed before
and passes after; neither oxlint nor vitest reads the probe.
