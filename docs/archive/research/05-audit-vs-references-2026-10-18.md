# Audit — what we built vs the references (size + complexity)

Sources: agent-fleet `origin/main` @8738986 (old fleet = @080aabb, the last commit before #78) ·
open PRs #84 (gate-runner register flags, +14/-8) and #85 (generic worker base, +929/-279) ·
agent-platform !263 (#671, runner pipeline, +1104 lines over 16 files) · refs under
`.scratch/one-rulebook/refs/` · `~/workspace/skills/research/64*.md`.

## Size at a glance

```
agent-fleet code (non-test, non-md)   old @080aabb  3,795  ──▶  now  8,338   (+4,547)
  + tests added since old                                       +3,881
  + markdown added since old                                    +767
  + PR #85 (open)                                               +929
  + agent-platform !263 (open)                                  +1,104   (ci.yml 139, 3 scripts+tests 462, spec 277)
per area now: scripts/ 43 files 10,171 · verifier/ 2 files 1,405 · .devcontainer/ 10 files 661
              enforcement/ 5 files 382 · docs/ 7 files 395 · templates/ 3 files 114
design decisions cited in headers: skills G1..G32, ND-15, R28 — ~35 numbered decisions
```

| reference | total size | of which code | shape |
|---|---|---|---|
| pstack orchestrate | 111-line playbook (+ orch.ts 578, store.ts 1,607) | ~2.2k (bookkeeping CLI only) | coordinator = ONE markdown file; Task tool spawns; cloud env isolates |
| mattpocock chief-of-staff | 45-line SKILL.md (in-progress) | 0 | "all work in subagents", context pointers |
| humanlayer rpi | ~4.0k lines, 20 files @653b641 | 0 | router SKILL.md + per-phase process.md + templates |
| firstmate | bin/ 120,213 lines; AGENTS.md 426; skills 4.9k | ~120k bash | tmux/zellij/herdr backends, fm-spawn 5,487, fm-watch 3,250 |
| rameezk-forge | ~25k lines; 37 ADRs | runner 2.1k + shared 1.8k TS + 17 Nix files | NixOS VM, bubblewrap, sops, dashboard |
| openclaw | AGENTS.md 145 lines (34 nested AGENTS.md) | n/a (product) | rule file shape only |

Note: we are **lighter than firstmate and forge**, **far heavier than pstack/matt/rpi** — and the
operator's stated model was the latter (small md, coordinator-in-a-playbook) on the old fleet's substrate.

## Per concern

| concern | ours (what + size) | closest reference (what + size, cite) | how ours differs | vs ref |
|---|---|---|---|---|
| coordinator | `plugin/agents/coordinator.md` 66 + `fleet-coordinator` 280 (tmux + systemd/launchd keep-alive, `templates/*.service`/`.plist` 67) + `coord-forge`/`coord_forge.py` 185 | pstack `playbooks/orchestrate.md` 111 lines; spawn via Task tool, `orch.ts` only for bookkeeping (`orchestrate.md:15`) | the md is pstack-sized; but we added a supervised daemon, own unix user, own bot, own forge CLI around it | heavier |
| worker spawn | `fleet-spawn` 515 + `fleet-launch-worker` 407 + `worker-container` 203 + sudo rule in `fleet-zones` | pstack: Task tool, `environment:"cloud"` (`:17`); firstmate `fm-spawn.sh` 5,487 into worktree+tmux | fresh container per (item,role,stage), sudo hop to another user, `make worktree-setup` inside box; pstack = 0 code | heavier than pstack, lighter than firstmate |
| brief | `plugin/briefs/worker-brief.md` 44 + brief.yaml validated by `fleet-spawn` (refuses missing field) | pstack 9-field template in md, "missing fields are refuse-to-spawn" (`orchestrate.md:38-57`); firstmate `fm-brief.sh` 701 | same idea; ours enforces in Python rather than coordinator judgement | same / slightly heavier |
| status / escalation | `post-status` 249 + `fleet-watch` 457 (crash/hang/stall/budget/question-box rules) + `fleet_state.py` 127 + `fleet-digest` 192 | pstack: completions as inbox events, `status.md` derived from tables, escalate via `gates.md` (`:69-110`); firstmate `fm-watch` 3,250 + `fm-crew-state` 1,320 | ours screen-scrapes tmux + reads transcripts for tokens; pstack never probes the agent ("never resume to check", `:100`) | heavier than pstack, lighter than firstmate |
| isolation / sandbox | `.devcontainer/` 661 (Dockerfile, iptables `init-firewall.sh` 98, egress allow-list, managed-settings) + `fleet-zones` 511 (3 unix users, rootless podman each, sudoers, sshd drop-in) + `enforcement/` 382 | forge: bubblewrap, one Nix module (ADR-0024); firstmate: worktree only, "stop if in primary checkout" (AGENTS.md:211); pstack: cloud env | we stack container + firewall + zones; no reference does all three; old fleet used one unix user/agent + slice | heavier than every ref |
| identity / tokens | per-role forge bots (coord=Reporter, worker=Developer), per-worker secrets folder copied by launcher, `setup-claude-token.sh` 78, ADR 0001 | forge: ONE shared GitHub write token (ADR-0017), sops (ADR-0029); firstmate: harness's own auth, captain owns pins | more identities, more secret plumbing; forge chose one token deliberately | heavier |
| verification gate / runner | old `verifier/fleet-verify` 755 + `setup-verifier.sh` 353 (still on main) **and** new `setup-gate-runner.sh` 199 + `fleet-runner` zone + !263 `.gitlab-ci.yml` 139 + gate-stack/probe-delivery/check-mr-title 462 | pstack: ledger keyed PR+SHA, "CI green is an input to a verdict" (`:90`), verifier only when expensive (`:88`); forge: NixOS VM tests as a required check (ADR-0036) | TWO gate systems coexist (`docs/gate-runner.md`: "The Verifier keeps serving the old fleet until cutover"); new one is a GitLab runner + own podman stack | heavier (duplicated) |
| per-host config | `machine_env.py` 169 + `templates/machine.env.example` 47 + `fleet-update` 167; #85 rewrites it again | forge: one typed config + NixOS module (ADR-0002/0005); firstmate `docs/configuration.md` | a parser/validator in Python for a KEY=value file; derived keys refused | heavier than needed |
| human channel | GitLab thread via `coord-forge` (Reporter bot) + `post-status`; tmux attach for live; Discord dropped for the coordinator | old fleet: Discord per agent (plugin, static access.json); firstmate: tmux + optional chat; pstack: the chat itself + `gates.md` | moved off Discord to forge comments — added a bot identity and a CLI to get there | different / heavier |
| instruction files / skills | `CLAUDE.md` 35, `CONTEXT.md` 174, `worker-rules.md` 64, `PRINCIPLES.md` 19, 4 role agents ~12 each, `.claude/skills/*` (create/update/list/delete) ~400 | openclaw AGENTS.md 145; matt skills ≤170 each; rpi router + references; firstmate AGENTS.md 426 | this part matches the references — small md files | same |

## Where we are heavier than every reference

- **Isolation in three layers at once**: container + iptables egress firewall + three unix privilege zones with sudoers. Forge picks one (bwrap), firstmate one (worktree), pstack delegates (cloud).
- **Two verification systems**: old machine-wide Verifier (1,108 code + 650 test) left on main beside the new gate runner (199 + !263 1,104). No reference keeps two.
- **Liveness by screen-scraping**: `fleet-watch` reads tmux panes for question boxes and diffs screens for hangs, and parses transcripts for token budget. pstack forbids probing the agent; it reads the ledger/branches.
- **Identity count**: coordinator bot, per-role worker bots, runner token, per-worker secrets copies. Forge ADR-0017 chose one write token on purpose.
- **Decision ledger in headers**: ~35 numbered decisions (G1..G32, ND-15, R28) cited across script headers — a reader needs `skills#NN` to understand a script.

## Where a reference does it in markdown and we do it in code

| job | reference (markdown) | ours (code) |
|---|---|---|
| brief field check | pstack: "missing fields are refuse-to-spawn" — coordinator rule (`orchestrate.md:57`) | `fleet-spawn` brief.yaml validator |
| capacity / queueing | pstack: rolling window ~10, prose (`:16,63`) | `fleet-spawn` caps (2 builders/host, 3 waiting, token window) + exit 3 queue |
| retry policy | pstack: "two retries, then abandon" (`:103`) | `fleet-watch` crash/hang rules, one fresh restart then blocked |
| status page | pstack: `status.md` derived from tables at each drain (`:34`) | `fleet_state.py` + `fleet-digest` 192 |
| escalation lanes | pstack `gates.md`; firstmate `ask-user-authority` skill (57 lines) | `fleet-watch` kinds → coordinator relay table (md) + `post-status` enforcement |
| the coordinator loop | pstack: whole loop in 111 lines; matt chief-of-staff 45 | coordinator.md 66 **plus** fleet-coordinator daemon 280 |
| phase routing | humanlayer rpi: router SKILL.md + `process.md` per phase, zero code | stage numbers baked into fleet-spawn ids (`72-developer-s6`) |

## What the old fleet already did that the new one re-does

```
old (@080aabb, 3,795 code)                       new (re-done as)
create-agent.sh 743  unix user + tmux + claude   fleet-zones 511 + worker-container 203 + fleet-launch-worker 407
                     + CLAUDE.md from yaml       + fleet-spawn 515 (prompt+brief into container)
update-agent.sh 443  reconcile live agent        fleet-update 167 + fleet-zones apply (rerunnable)
list-agent.sh 299    liveness, usage, limits     fleet-watch 457 + fleet_state.py 127
fleet-say.sh 90      relay msg into tmux         fleet-watch "wrap up" nudge, coordinator relay
Discord plugin/agent operator channel            coord-forge 185 + post-status 249 + forge.py 281
fleet-lib.sh 390     DOCKER_HOST, locale, podman machine_env.py 169 (+ #85 rewrite)
                     socket, slices, swap
verifier/ 755 +      verify pushed SHA, slots,   setup-gate-runner 199 + fleet-runner zone
setup-verifier 353   ports, memory, result.md    + !263 ci.yml/gate-stack/probe (1,104)
fleet-guard.py 175   machine-wide hook           kept; plus .devcontainer managed-settings + firewall
setup-claude-token   shared OAuth token          kept; plus per-role bot tokens copied per worker
```

- Old: long-lived agent = one unix user in tmux, operator on Discord, Verifier on the VM — the operator's
  stated target shape. New keeps tmux but swaps users→containers, Discord→forge thread, Verifier→GitLab runner.
- The genuinely new pieces with a reference behind them: fresh worker per stage (pstack "never resume-chain",
  `orchestrate.md:57`), brief template (pstack), done-at-SHA (pstack ledger, forge ADR-0065). Each is
  markdown-sized in the reference; each became 200–500 lines of Python here.
- Old fleet is still on main beside the new one (create/update/list/delete-agent, fleet-verify): the repo
  carries both generations until cutover.
