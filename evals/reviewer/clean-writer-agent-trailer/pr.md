# feat(writer): every writer commit carries "Agent: writer"; the host push refuses one without it (#128) (#191)

- The writer's clone gets a prepare-commit-msg hook in .git/hooks, which the
  box mounts read-only. It adds the trailer to every commit, merge and amend.
- seatOnEvery, a new push guard, reads each commit on the branch's own line
  since the run's start, as git reads trailers. A commit without the writer's
  seat blocks the change, and nothing is pushed. Commits a merge brings in
  are people's work and are not checked.

Refs #128
