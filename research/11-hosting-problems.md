# 11 — Hosting problems of the current setup (2026-10-18)

Ticket: chiyanram/agent-factory#9. Read-only. Lists every failure caused by **where and how agents run**. It gives no fixes.
Sources, cited inline: `sk#61/62/63` = chiyanram/skills issues · `R00` `R35` `R37` `R38` `R39` `R46` `R64a–e` =
`~/workspace/skills/research/<n>-*.md` · `F01` `F02` `F03` `F05` `F10` = `~/workspace/agent-factory/research/<n>-*.md` ·
`af#`/`af!` = chiyanram/agent-fleet issue/PR · `@080aabb` = old fleet file at that commit · `#`/`!` = agent-platform
GitLab · `AGENTS.md` = agent-platform AGENTS.md · `DEV` = agent-platform `docs/guides/DEVELOPING.md`.
Categories: **C** compute/memory · **P** ports/stack · **E** env/toolchain · **A** auth/tokens · **W** checkout/worktree
staleness · **L** liveness/stuck · **N** channel/noise · **G** gate capacity · **S** subscription/cost · **X** security.

## 1. Problems

| # | problem | where | evidence | cost / frequency | affects | cat |
|---|---|---|---|---|---|---|
| 1 | Hard per-agent `MemoryMax`. The kernel OOM-kills inside the slice even with host RAM free, and nobody is told | VM | af#10 (cap 6G, host 16G free) | 116 OOM kills on 09-27 (113× llama-server, 3× java). Smoke 46 failed, misread as "box capacity" | developer | C |
| 2 | No swap: any peak goes straight to the OOM killer | VM | af#13 (`swapon` empty, 0 B) | every spike | all agents | C |
| 3 | Claude sessions and tmux ran in root's login scope, outside the agent's cap. Gradle/Playwright escaped the cap. Agent lifetime tied to a root session | VM | af#14 (`session-217.scope`) | all agents until af!16 | all agents | C |
| 4 | Default `MemoryHigh` (90 %) throttles anon-heavy JVM+Ollama work. Code pages evicted, stall | VM | af#21 | load 85 on 8 vCPU, 79 % pressure, smoke poisoned by 60 s timeouts. 3 agents blamed "other agents" | qa (and all who read it) | C |
| 5 | An OOM-killed test JVM stopped the whole tmux scope (`OOMPolicy=stop`). The session died | VM | af#34 | developer down ~20 h until `list-agent` flagged it | developer | C/L |
| 6 | JVM heap = 75 % of what it sees, no `mem_limit`. Api heap ceiling 5.9 G per container. Ollama OOM under smoke | VM (any shared box) | #583 (`Dockerfile:115,131`) | fed the 116 kills. Ollama limit raised 3g → 4g on 09-30 | developer, qa stacks | C |
| 7 | `make verify` OOM: a second `-Xmx4g` Gradle + containers next to the Verifier | VM | R00 (developer), R38 "not the cause: memory" | recurring. R29 measured 10 GB free / 0 kills in a Verifier-only run | developer | C |
| 8 | ~8 GB shared by every agent and human (old recipe). Agents told to check `free -m` < 3500 MB and negotiate in Discord who goes first | VM | `create-agent.sh:344-352 @080aabb` | per heavy step | all agents | C/N |
| 9 | Playwright smoke workers 3–4 fail on API/DB host strain. Held at 2 | both | R39 (E7/#38, `playwright.smoke.config.ts:32-41`), sk#62 Q27 re-grill | caps smoke speed | gate | C/G |
| 10 | Parallel fresh workers inside one unix user's slice hit the af#10/#21 caps again | VM (planned) | R39 §2 "new risk" | not yet measured | new workers | C |
| 11 | `docker-compose.yml` publishes 5 literal host ports, so one stack per machine. QA kept a hand-forked `docker-compose-qa.yml`, stale after a rebase | both | #318 (open), `DEV:405-406` | since 08-25 | qa, developer | P/W |
| 12 | A second isolated stack needs hand edits (ports, baseURL, absolute URLs in specs, deploy probe, smoke pre-warm on the default project) | VM | #581 (open) | QA 48 of 56 min fixing ports (09-28). Then 31/43 smoke red, stack recreated underneath | qa, developer | P |
| 13 | Developer's assigned port block (20200) cannot run a local stack. Needs a one-run operator OK for the default ports | VM | F10 q5 (developer) | per local stack | developer | P |
| 14 | One Compose project + fixed ports: **last deploy wins**. Smoke can test another branch's images and report green for code never built | both | AGENTS.md worktree block, `DEV:567-575`, R37 F7 | silent. Visible only if `make status`/banner is read | operator, every agent, gate | P |
| 15 | `COMPOSE_PROJECT_NAME=agent-platform make smoke FULL=1 DEPLOY=0` smokes the main checkout's images | laptop | AGENTS.md worktree block | false green | operator sessions | P |
| 16 | `make secrets` in a worktree regenerates the master key, which then cannot decrypt the shared postgres volume | both | AGENTS.md worktree block, #581 §4 | stack data lost | any worktree | P/X |
| 17 | Concurrent IT suites on one container daemon → "Could not connect to Ryuk", then `NoClassDefFoundError` for the whole module. Hook only advises | both | `.claude/hooks/guard-concurrent-build.sh:4-7`, R37 F5 | 71 tests failed in one session, none real | anyone building in parallel | P/C |
| 18 | Rootless podman needs `TESTCONTAINERS_RYUK_DISABLED=true`, so nothing reaps the shared postgres/redis singletons | VM | `DEV:438-446`, R37 F6 | leftover containers after every run | all agents | P |
| 19 | Verifier slot ports vs agent `app.port` blocks: overlap check needed, slots > 1 refused unless the project honours a port base | VM | af#28, `setup-verifier.sh:94-113 @080aabb` | one slot only | gate | P/G |
| 20 | `JAVA_HOME` unset and husky `npx: not found` in non-interactive shells | VM | sk#61 #3, R00 | every fresh shell | developer | E |
| 21 | `runuser -l` gives `LANG=` (POSIX). Gradle cannot write test reports with an em dash. check-antipatterns gives a C-locale false positive | VM | af#44, sk#61 #12 | `make verify` failed 09-30; hand `LC_ALL` workaround | developer | E |
| 22 | `DOCKER_HOST` not exported for the agents' podman socket → ITs "no Docker environment" | VM | af#46, R00 | QA !230 ITs failed 10-01; developer hit it earlier | qa, developer | E |
| 23 | `/tmp/spring.log` owned by another unix user | VM | R00 (qa), R37 F4, ADR 0002 `@080aabb` | collisions on `/tmp` lock dirs too | qa | E |
| 24 | Background subshell dying mid-run | VM | R00 (qa) | — | qa | E/L |
| 25 | No default registry: short image names fail for every agent but one | VM | af#1 | first pull fails | qa, spec-reviewer | E |
| 26 | Storage config drift: `fuse-overlayfs` left on developer, no `storage.conf` elsewhere. create-agent only, never reconciled | VM | af#2 | slower Testcontainers | developer, others | E |
| 27 | No sudo, no supported OS-package path. Agent side-loaded 9 `.deb`s via `LD_LIBRARY_PATH` | VM | af#7 | 204 UI tests failed (`libatk`). Never patched, invisible | developer, then qa | E/X |
| 28 | Repo-pinned JDK/Node vs OS packages confused. SDKMAN needs `zip`. Developer side-loaded `make`. Host prereqs not reconciled | VM | af#12 | QA paused !214 waiting on a human | qa, developer | E/L |
| 29 | podman API `service_timeout` 5 s drops compose/Testcontainers connections | VM | af!37 (testcontainers-java#7310) | IT suite breaks | all agents, slot | E |
| 30 | Verifier slot `UMask=0007` → checkout 0660 → Keycloak cannot read the realm file | VM | af!38 | 3 `SsoFlowIT` fails (dry run 3) | gate | E |
| 31 | Two rootless user namespaces after a pause reset → no healthcheck ever passes | VM | af!39 | smoke deploy "unhealthy" (dry run 4) | gate | E |
| 32 | Fresh worktrees have no `node_modules`. Playwright/Angular fail; symlink workaround | both | sk#61 #17, `aruvii-git/references/worktrees.md:44-48` | every new worktree | developer, operator | E |
| 33 | Network in the gate image build: `npm ci ECONNRESET` → INCOMPLETE job | VM | R39 (!230 10-01) | one of 5 jobs on !230 | gate | E/G |
| 34 | Toolchain split: JDK/Gradle/Node baked into the worker image. Gate runner host has no JDK. `make worktree-setup` run on the host fails | VM | af#83 (open), F03:45-46 | blocks developer spawn until #713 | new workers, runner | E |
| 35 | Runner registration with a `glrt-` token refuses `--tag-list`/`--run-untagged` | VM | af!84 (open) | first real registration failed | runner | E |
| 36 | `glab mr update` with a long body times out | VM | sk#61 #18 | — | developer | E |
| 37 | Host user-level `~/.claude/CLAUDE.md` injects `Co-Authored-By` against the repo ban. Which wins is unclear | both | sk#61 #10, F10 q3 | every commit | developer | E |
| 38 | One Claude token per fleet → shared limit. **All four agents stopped at once** on the session limit | VM | af#50, ADR 0001 `@080aabb` | 10-01, whole fleet | all agents | A/S |
| 39 | Usage-limit stalls invisible. `make smoke` dead ~25 min. 89 % weekly warning seen by chance. Reset time in Berlin TZ, operator reads IST | VM | af#4, af#54 | per limit hit | operator | A/L |
| 40 | 3 of 4 agents logged in as the operator's own GitLab PAT. Agent notes look like human notes | VM | af#5 (open), R46:20 | until bots exist | operator, reviewers | A/X |
| 41 | `/approved` gate = regex in fleet-guard. Blocks notes that *mention* the token, and is bypassable | VM | af#5, af#9, F10 q3 (qa) | 4 blocked notes 09-27 + 2 more on 09-27 | analyst, developer, qa | A/X |
| 42 | Split per-agent tokens are a fixed binding with no failover. Moving an agent = edit + relaunch | VM | af#50 | per limit | operator | A/S |
| 43 | Agent clones show local master stale → wrong diffs. `git show origin/master` ×7 | VM | sk#61 #4 | per review | spec-reviewer, qa | W |
| 44 | Discord plugin at project scope wrote tracked `.claude/settings.json`. `git pull --ff-only` failed; hand merge needed | VM | af#70 | every create-agent rerun re-dirtied it | qa, spec-reviewer, analyst | W/N |
| 45 | Merging master into the MR voids the gate. Each rebase-before-done costs ~1 h of gate | VM | R39 (!230 10-01; §2 post-status) | per rebase | developer, gate | W/G |
| 46 | Verifier runs superseded SHAs. No cancel, no dedupe, no queue position (dup job `ddf23e`) | VM | af#56 (open), sk#61 #1 | ~2 h lost 10-02. Operator cancelled twice by hand as root | operator, developer | W/G |
| 47 | Verifier refuses a git worktree (aruvii refuses secrets/smoke there) → plain clone per job | VM | af!36 | — | gate | W |
| 48 | QA got nothing for 5 h after creation. Developer's handoff mention unanswered for hours; nobody noticed | VM | af#4 | 09-27 | qa, developer | L |
| 49 | Developer "3 days silent". Sessions ~100 turns | VM | R00 (developer, analyst) | 3 days | developer | L |
| 50 | Reconcile restarts a busy slot: `setup-verifier.sh --register` killed !230's gate run (~20 min in) | VM | af#48 | 1 ERROR job | gate | L/G |
| 51 | `update-agent.sh` always restarted the agent's podman API → a running Testcontainers suite loses Docker | VM | af#48 | every update | all agents | L |
| 52 | `unattended-upgrades` → needrestart restarted a Verifier slot → running job ERROR | VM | af!66 | 10-02 06:30 | gate | L/G |
| 53 | Discord bridge silently down after a rerun ("already installed", not re-enabled). "Enabled" printed from exit code → agent deaf | VM | af!77 | regression of af!71 | any agent | L/N |
| 54 | `fleet-say` reported "not delivered" when the message was queued behind a busy agent | VM | af!69 | false alarms | operator | L |
| 55 | Liveness read by screen-scraping tmux panes / diffing screens | VM | F05:52, `list-agent.sh:146-181 @080aabb` | brittle | operator | L |
| 56 | Verifier wait times out longer than one tool call. Agent must background `wait` | VM | sk#61 #18, `create-agent.sh:361-366 @080aabb` | per job | developer | L/G |
| 57 | Upstream Discord plugin drops every bot message → patched bridge + rate cap so agents can hand over | VM | `patch-discord-plugin.py:1-15 @080aabb` | patch breaks if upstream changes (exit 1) | all agents | N |
| 58 | ~8 channel messages per task not addressed to the reader. 100-message history limit. "home channel" vs "thread" conflict | VM | sk#61 #6 #7, R00 (analyst) | context per wake | qa, analyst, spec-reviewer | N/S |
| 59 | "@here when blocked" vs "tag the owner" | VM | F10 q3 (all four) | — | all agents | N |
| 60 | Gate result relayed by hand; known-flake list lived only in Discord; early-stopped Verifier → "gate status unclear" | VM | R37 F8, R39 (!230), R00 (qa) | QA needed analyst to confirm flakes | qa, operator | N/G |
| 61 | New coordinator has no notifier at all (no Discord, ntfy, webhook) | VM | F03:32 | — | operator | N |
| 62 | Gate is 61 min on the VM vs < 30 min on the laptop: smoke 24.5 (CPU Ollama), one serial 790-test IT task 18.8, deploy ~10 (6.5 waiting healthy) | VM | R38, sk#62 | every gate run | all MRs | G |
| 63 | One slot, ~1 h 05 per run, a fail reruns in full, no test filter, no failed-run worker log | VM | F10 q1/q4/q8 (qa, developer) | !259 ~5 h on K03c fail + rerun | qa, developer | G |
| 64 | Flaky K03c (smoke-63): same head failed then passed | VM | F10 q4 | 1 h 04 lost | developer | G |
| 65 | !230: 5 Verifier jobs, 3 QA rounds, 2 days. ADR 0002 sized it at ~1 h 45 → ~13 jobs/day | VM | R00, R39, ADR 0002 `@080aabb` | 2 days | #554 | G |
| 66 | GitLab instance runners: 400-min Free quota | remote | #440, R39 | 100 pipelines: 98 failed, 0 succeeded | all MRs | G/S |
| 67 | `@llm` smoke flakes on CPU Ollama. Only smoke-92/69 scripted; #609 open → most `@llm` leaves the gate or stays slow | VM | R39, sk#62 Q27, #609 | coverage hole | gate | G |
| 68 | VM down = no gate = no merges; no bypass documented. Double-queue risk (agent submit + pipeline) | VM | R39 §2 | — | everyone | G |
| 69 | Before the Verifier, every agent ran full stacks; every ticket paid two full runs | VM | R39 (09-27/28), af#23 | #554 1.5 h, OOM, Keycloak timeout | developer, qa | G/C |
| 70 | Review cost per run: architecture-reviewer 130–180k tokens, 6 runs/day; QA subagents ~135k + ~167k per round | VM | F10 q6, R00 | daily | analyst, qa | S |
| 71 | 70 % budget pause is off unless an env var is set | VM | F03:13 | — | operator | S |
| 72 | Agents run `claude --dangerously-skip-permissions --channels plugin:discord` | VM | F03:56 (`create-agent.sh:710-720`) | always | all agents | X |
| 73 | Peer bots may wake agents: agent text can instruct other agents | VM | R46:41 | — | all agents | X/N |
| 74 | Identity files are root 0444, but in an agent-owned `~/.claude`, so replaceable by rename | VM | R46:35 | — | all agents | X |
| 75 | Branch code runs as the slot/runner user: it can read `.git-credentials` and log it into `log.gz`. Shell executor carries `CI_JOB_TOKEN` | VM | R46:51, R37:217 | low while token read-only | gate | X |
| 76 | Host-wide sshd drop-in strips the operator's own agent forwarding. Host-wide managed settings also load for the coordinator | VM | F03:24, F03:59 | — | operator, coordinator | X |
| 77 | One unix user for all workers removes home isolation: one podman socket, all containers | VM (planned) | R46:37-39 | — | new workers | X |

## 2. Per category — what the references and products hit and changed

**C compute/memory.**
- forge: the full check was OOM-killed on a 3.7 GB box and slow on a Mac. Workers fell back "and mentioned it only in passing". ADR-0064 made scoped checks the standing rule (R64d:110,115).
- mattpocock #1261: 6–7 parallel subagents, load ~140, false flaky failures. The reporter capped at 3 (F01:78).
- firstmate ac0811c (#5343): project capacity. Spawn exits 75 and the item stays queued, because surplus workers burned retry turns (R64b:39).
- Our own change: the Verifier and the developer minimum (R39).

**P ports/stack.**
- Products give each worker a fresh disposable VM or container (Claude cloud, Codex, Copilot, Cursor, Devin), so no host ports are shared (F02:163).
- Locally, Claude Code worktrees still share one Compose stack. F02:180: "single-tenant resource".
- forge: a systemd unit per workload on NixOS (F01:181).
- Our response: #581 role stacks (open), and the runner owns its own stack (sk#61 comment, af#74).

**E env/toolchain.**
- Products: "env setup is the #1 friction" (GH-ENV, AMP-ORB, CUR in F02:169). Their answer is a setup script → snapshot (F02:163).
- forge ADR-0072: missing `node_modules` was read as "cannot run" → the repo installs its own deps (R64d:115).
- forge #490/#489: a dev-shell `gh` shadowed forge's (F01:116).
- Ours: machine.env (ND-15, af#74) and the generic worker image (af#83).

**A auth/tokens.**
- forge: one shared GitHub write token on purpose (ADR-0017). A token file is swapped atomically when the App token expires mid-run (#365) (R64d:169, F05:53).
- forge #438: a token that cannot rerun jobs → agents push empty commits (F01:116).
- Ours: per-role bots (af#74/#81) and a per-agent Claude token split (af#50).

**W checkout/worktree staleness.**
- firstmate #3058: spawn cuts from origin, "silently dropping" local commits. #6854: worktrees never reclaimed, 12 GB. 6a7b391: wrong base branch (F01:44-45, R64b:40).
- pstack #449/#470: cleanup `rm -rf`s untracked files (F01:67).
- Claude Code: `-p` worktrees are not auto-cleaned. A subagent in a worktree reads the main conversation's instruction files. openclaw #129411: same class (F02:54,63, F01:139).
- Ours: rebase at spawn / before verify / before done (sk#61 #4).

**L liveness/stuck.**
- firstmate: a worker on a modal "is indistinguishable from a healthy idle composer" (#4754 → 138cf11). Busy-deferred doorbells escalate at a bound (#6445). Quiet-but-healthy lanes were wrongly escalated (#6958). A gone tmux window was reported alive (#7409) (R64b:58-59, F01:23-28).
- forge #509/#511: a crash leaves "only the journal".
- pstack forbids probing the agent and reads the ledger (F05:52).

**N channel/noise.**
- Products report to a status board (needs-input / working / ready), not a chat log (F02:166).
- forge #529: a block note sat "where the operator does not look" → posted on the PR/ticket (F01:105).
- Ours: GitLab comment = record, Discord = ping (sk#61 #7). Workers talk only to the coordinator (#6).

**G gate capacity.**
- openclaw 299d289e9: "only 33% of 3,133 box runs exited 0", 1,040 lane-hours vs ~9 min PR CI → reversed "local proof" to PR CI as broad proof (R64d:112-114).
- firstmate: sharded on CI timings and never added local workers. It also auto-cancels superseded runs (R39 §3).
- Ours: the Verifier → a self-hosted runner, scripted model (Q26/Q27, R39).

**S subscription/cost.**
- firstmate #4237: one waiting worker took 129 turns / 21.9M tokens. #4238: 26.5 % of spend went to cold pipeline agents → a spend ledger (R64b:39,104).
- forge: 5 USD / 2 h hard stop per workload (ADR-0044).
- Cursor cloud requires a spend limit (F02:105).

**X security.**
- forge: bwrap plus a per-run empty `CLAUDE_CONFIG_DIR`, because a shared writable dir lets "any workload change what later runs load" (ADR-0057, R64d:164-168).
- Codex/Copilot/Claude sandbox: network off by default. The Copilot firewall is "not compatible with self-hosted runners" (F02:92, R64e:168-170).
- pstack: workers run in the cloud by default (R64a:140).
- Ours: three layers at once — container + iptables + 3 unix zones (F05:50).

## 3. Problems that exist on the laptop flow too

| # | laptop form | evidence |
|---|---|---|
| 14, 15 | many operator Claude Code sessions/worktrees share one Compose stack. Last deploy wins; `STALE` shows only if read | AGENTS.md worktree block |
| 16 | `make secrets` in a worktree breaks the shared postgres volume | AGENTS.md |
| 17 | two worktrees running ITs at once → Ryuk contention, whole-module false failures (71 in one session) | `guard-concurrent-build.sh:4-7` |
| 11 | fixed ports: one stack per laptop | #318, `DEV:405` |
| 32 | fresh worktree without `node_modules` | `worktrees.md:44` |
| 37 | user-level `~/.claude` rules leak into project work (attribution) | sk#61 #10 |
| — | `cd` inside the project silently moves the session's cwd (3× in one session) | R35 §3 |
| — | harness-pinned worktree names lie about their branch. A write to another worktree is refused | R35 §9 |
| — | zsh `==` / no GNU `timeout`: errors in 25 of 51 subagents | R35 §10 |
| — | a long subagent stalled ("no progress for 600s") and saved nothing. User waited 07:39 → 12:20 | R35 §7 |
| — | 86K-token baseline before the first word. 35 KB skill listing injected 11×. Session 363M cache-read + 51 subagents 308M | R35 §12, R35:13-14 |
| 9 | Playwright workers > 2 flake on host strain (first seen on dev machines) | R39 (E7/#38) |
| — | laptop as gate: asleep/offline = no gate, contends with the operator's own worktrees, VM agents can't use it | R37 option C |

## 4. Open questions the operator must answer

1. Laptop per-phase gate timings (`make verify FRESH=1`, `make smoke FULL=1`) are still missing. Is the VM slower, or is the gate this big? (R38, sk#62)
2. Do agents and the gate runner share one 8-vCPU / 23 GB VM? What is the RAM reserve per building worker? (R38, R39 §2 "parallel fresh workers")
3. Where do smoke stacks live: one runner-owned stack, or one stack per work item? Is #581/#318 still wanted once agents never deploy? (sk#61 note, #581)
4. Is there a bypass when the VM is down, and who may use it? (R39 §2)
5. What may cancel a running gate job, and does a newer push auto-cancel it? Is teardown on cancel proven? (af#56)
6. Is "Pipelines must succeed" switched on, and checked by `glab api`? (R39 §2, REQ-067 AC6)
7. How are flakes recorded so a fresh worker can see them (file or quarantine tag, not chat)? (R39, F10 K03c)
8. How many Claude subscriptions, and how are agents bound to them? What happens when one hits its limit (wait, move, stop)? (af#50, af#54)
9. Which notifier reaches the operator now that the coordinator has no Discord? (F03:32)
10. Is the operator's SSH agent forwarding loss on the VM acceptable? Are host-wide managed settings OK for the coordinator? (F03:24,59)
11. Is the runner trusted to run any pushed branch's code with a `CI_JOB_TOKEN`? (R37:217, R46:51)
12. Do the old Discord agents keep running beside the new fleet, and for how long? (F03:56-58)
