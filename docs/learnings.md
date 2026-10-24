# Learnings from the old fleet

The old 4-agent fleet runs in maintenance until L7 (#27). Each fix made on it is checked and its lesson is written
here and into the factory file it changes. Process: operator, 2026-10-24.

| date | fleet fix | what it taught | where it lives in the factory |
|---|---|---|---|
| 2026-10-23 | agent-fleet #91: one heavy run at a time | two builds at once ran a 9 GB machine out of memory and cost about 3 hours on agent-platform #738 | `docs/playbooks/coordinator.md` §Triggers: one heavy run per machine |
| 2026-10-24 | agent-fleet #92: force-with-lease allowed on feature branches | a regex guard missed `-f`, `-uf` and `+refspec`; matching command text leaks | coordinator playbook §Roles (writer pushes its own branch with `--force-with-lease`); `docs/ARCHITECTURE.md` §10 (hard rules live in GitLab or CI) |
| 2026-10-22 | agent-fleet #86–#89: Verifier steps named, with inputs | a failed gate must say which step failed and with what input | L5 #25: one GitLab job per step, each result on the MR |
| 2026-10-17 | agent-fleet PR #84 (open): runner registration with `glrt-` tokens | a new GitLab runner needs the new token flow | L7 #27, runner setup |
| 2026-10-17 | agent-fleet PR #85 (open): generic image plus mise | each worktree needs its toolchain | L7 #27: `make worktree-setup` contract |

Source: research/43.
