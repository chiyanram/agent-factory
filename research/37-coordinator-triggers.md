# 37 — Coordinator triggers: what starts a run, how it is seen, claimed, throttled, recovered, shown (2026-10-23)

For chiyanram/agent-factory#23 (L3 coordinator). Read-only. `refs/` = agent-platform `.scratch/one-rulebook/refs/`.
Quotes ≤15 words. "NOT OPENED" = from a search summary, page not read.

Source keys:

| key | source |
|---|---|
| PS | pstack `cursor-plugins/pstack/skills/poteto-mode/playbooks/orchestrate.md` |
| FM | kunchenguid-firstmate (`AGENTS.md`, `README.md`, `docs/architecture.md`, `docs/configuration.md`) |
| OC | openclaw (`docs/automation/*`, `docs/tools/subagents/tool-reference.md`, `docs/reference/pull-request-review-flow.md`, `.agents/skills/clawsweeper/SKILL.md`) |
| FG | rameezk-forge (`docs/adr/`, `infra/nixos/runtime.nix`, `runtime/packages/runner/src/`) |
| HL | humanlayer `hld/` daemon |
| MP | mattpocock-skills PR #1316 (`git show pr-1316:skills/in-progress/software-factory/…`, `chief-of-staff/SKILL.md`) |
| CP | GitHub Copilot coding agent — learn.microsoft.com/en-us/training/modules/github-copilot-code-agent/3-assign-track-troubleshoot-copilot-code-agent-tasks ; docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent |
| DUO | GitLab Duo triggers — docs.gitlab.com/user/duo_agent_platform/triggers/ |
| GHA | Claude Code GitHub Actions — code.claude.com/docs/en/github-actions |
| GLCI | Claude Code GitLab CI/CD — code.claude.com/docs/en/gitlab-ci-cd |
| RT | Claude Code scheduled tasks (routines) — code.claude.com/docs/en/routines |
| CUR | Cursor cloud agents — NOT OPENED (cursor.com/help/integrations/third-party 404; search summary + forum.cursor.com) |
| CDX | Codex on GitHub — learn.chatgpt.com/docs/third-party/github |
| OLD | our old Discord fleet — `research/11-hosting-problems.md` (R11), `research/24-coordinator.md` (R24) |

## (a) What triggers a run

| source | answer | evidence |
|---|---|---|
| PS | coordinator decides; completions are queue events; "frontier watcher wake" + heartbeat | `orchestrate.md:9`, `:71` "a frontier watcher wake … with a long heartbeat fallback" |
| FM | captain chat; watcher wakes on status signals, stale panes, PR merge polls, heartbeat | `architecture.md:14`; `AGENTS.md:276-280` (`stale:`, `check:`, `heartbeat:`) |
| OC | chat message; automations (one-shot/interval/cron); heartbeat; inbound webhook. ClawSweeper: PR opened / marked ready, `@clawsweeper re-review`, labels | `automation/index.md:52` "Scheduler-owned interval, default 30min"; `pull-request-review-flow.md:48-49`, `:61`; `clawsweeper/SKILL.md:52-53` |
| FG | ticket on frontier **and** labelled `forge:ready`; operator re-labels to retry | ADR-0016:18 "either condition alone does nothing" |
| HL | human launches a session (UI/CLI → `launchSession` RPC) | `hld/PROTOCOL.md:83-85` |
| MP | "ticket tracker or git host" change, a clock, or another run; label, PR open, review fail, merge, daily/nightly clock | `SKILL.md:16`; `EXAMPLE-TASKS.md:14,22,29,47,78` |
| CP | assign issue to Copilot; `@copilot` in PR comment; agents panel; schedule/events | MS Learn unit "Mention @copilot in a pull request comment to request changes" |
| DUO | Mention, Assign, Assign reviewer (service account); pipeline state; MR approved/created/marked ready/merge conflict; work item created/status | triggers page (fetched) |
| GHA | `@claude` in issue/PR comment or review; any GitHub event incl. `pull_request` ready_for_review; cron | GHA "Interactive mode" + "Run on a schedule" |
| GLCI | `@claude` note → your own listener calls pipeline trigger API; MR events; manual | GLCI "(Optional) Enable mention-driven triggers" |
| RT | schedule (≥1 h), API `/fire`, GitHub PR/release events | RT "Expressions that run more often than once per hour are rejected" |
| CUR | `@Cursor` in Slack, Linear delegate/mention, GitHub | NOT OPENED (search summary) |
| CDX | `@codex review`, auto review setting, `@codex <task>` | CDX "mention `@codex review`" |
| OLD | Discord message to an agent; peer bot messages also woke agents | R11 #57, #73 |

## (b) How triggers are DETECTED

| source | answer | evidence |
|---|---|---|
| PS | no poller of its own; harness completion notifications + armed loop wake | `orchestrate.md:70-71` |
| FM | bash watcher polls: `FM_POLL=15` s; slow checks (merge polls via `glab`/`gh`) `FM_CHECK_INTERVAL=300`; heartbeat 600 s backing off to 7200 s; Herdr native push where available | `configuration.md:2280,2291-2295`; `architecture.md:267-268`; `docs/gitlab-merge-watch.md` |
| OC | in-process scheduler; authenticated HTTP webhook with idempotency key; ClawSweeper = GitHub App events into a queue | `automation/cron-jobs/webhooks.md:65,105`; `pull-request-review-flow.md:48` |
| FG | systemd timer poller, `frontier.pollInterval` default `5min`; dispatch pass after every sync. No webhooks ("polled snapshot") | `infra/nixos/runtime.nix:275-279`, `:491`; ADR-0010:19 |
| HL | daemon event bus; `Subscribe` long-poll | `PROTOCOL.md:374` "uses long-polling" |
| MP | orchestrator "receives triggers"; CI runners use workflow triggers | `SKILL.md:41`; `RUNNERS.md:19` |
| CP / CDX / CUR | vendor-side GitHub/Slack events | CP MS Learn; CDX page |
| DUO | GitLab-internal event → flow | triggers page |
| GHA | GitHub webhook → Actions workflow | GHA workflow `on: issue_comment` |
| GLCI | none built in: needs a "Comments (notes)" project webhook + your listener | GLCI step 4 |
| RT | GitHub App webhooks; events over hourly cap "are dropped" | RT "Events beyond the limit are dropped until the window resets" |
| OLD | Discord bridge push; it was silently down after a rerun | R11 #53 |

## (c) How work is CLAIMED / deduped

| source | answer | evidence |
|---|---|---|
| PS | one writer per worktree/branch; `units.tsv` row per unit; store lock replaced when holder pid gone | `orchestrate.md:17,27,101` |
| FM | one session lock per home; lock-refused session stays read-only; queued-key dedupe of wakes | `AGENTS.md:81-82`; `architecture.md:70` |
| OC | `--run-id` reuse reported in-flight; webhook `Idempotency-Key`; ClawSweeper "creates or reuses a durable adopted job", review keyed to head SHA | `cron-jobs/how-it-works.md:23`; `clawsweeper/SKILL.md:58,224` |
| FG | store row first (`startDispatch` checks limit), then label swap `forge:ready`→`forge:running` on the ticket; claim "survives anything that happens to forge's store" | `dispatch-main.ts:237,258-262`; ADR-0016:18,22 |
| HL | n/a (human launches each) | — |
| MP | design question #5: "What stops two runs doing the same work?"; CI "concurrency group keeps two runs off the same ticket" | `SKILL.md:94`; `RUNNERS.md:19` |
| CP | assignment + one draft PR per task; "one pull request per task" | CP about page |
| GHA | GitHub concurrency groups (advised); skips PRs "that already have a comment from Claude" (review skill) | GHA "Manage costs", "Run a skill" |
| RT | none: "two PR updates produce two independent sessions" | RT GitHub trigger |
| OLD | none; Verifier ran superseded SHAs, dup job | R11 #46 |

## (d) Concurrency limits / throttling

| source | answer | evidence |
|---|---|---|
| PS | rolling window, ~10 in flight per drain; stop spawning at ~70 % of budget | `orchestrate.md:16,60` |
| FM | capacity: spawn exits 75, item stays queued (commit ac0811c) — via R11, not re-read here | R11:98 |
| OC | `subagents.maxConcurrent: 4` default example; ClawSweeper waits "for a queue slot"; repairs 10/PR, 1/head | `tool-reference.md:149-153`; `clawsweeper/SKILL.md:255-256` |
| FG | `dispatch.maxConcurrent` default **1**; over limit stays `forge:ready` until a free slot | `runtime.nix:268-273` |
| MP | start one trigger at a time, "throttled at first"; retro "one merged PR in ten" | `SKILL.md:62`; `EXAMPLE-TASKS.md:78` |
| CP | one branch / one PR per task; no session cap stated | CP about page |
| GHA / GLCI | "Limit concurrency to control parallel runs"; `--max-turns` | GLCI "Cost optimization tips" |
| RT | 100 scheduled runs/h/account, 30 fires/h/task; GitHub events hourly cap | RT "Usage and limits" |
| CUR | ~8 simultaneous cloud agents per plan; over cap = refused | NOT OPENED (forum.cursor.com/t/…/154013) |
| OLD | none; four agents shared RAM, negotiated in Discord; shared Claude token stopped all at once | R11 #8, #38 |

## (e) Failed, hung or dead run

| source | answer | evidence |
|---|---|---|
| PS | never resume to check; probe ledger/branches; synthetic postmortem; retry by mode, "Two retries, then abandon"; TIMEBOX per brief | `orchestrate.md:45,95-97` |
| FM | stale pane escalates after `FM_STALE_ESCALATE_SECS=240`; busy cap; inspection "never an automatic interrupt, signal, or restart" | `configuration.md:2360`; `architecture.md:60` |
| OC | 60-min watchdog per isolated run; timeout aborts + force-clears session; recurring backoff 30s→60m | `how-it-works.md:20,34`; `managing-jobs.md:226` |
| FG | runner heartbeat every 20 s; >120 s stale → `interrupted`; label settled next poll; retry = human re-labels | ADR-0031:20; ADR-0016:18 |
| HL | on daemon start, running/waiting sessions marked failed; interrupted stay resumable | `hld/daemon/daemon.go:199-200,341-359` |
| MP | "cap every loop of runs at a few tries before a human"; fix task files failed run as ticket | `SKILL.md:62`; `EXAMPLE-TASKS.md:63-66` |
| CP | 59 min max, "cannot be extended"; retry by reassign or repost comment | CP about page; MS Learn troubleshooting |
| GLCI | GitLab job `timeout` | GLCI "Advanced configuration" |
| RT | green = "started and exited without an infrastructure error", not success | RT "View and interact with runs" |
| OLD | dead session unnoticed ~20 h; usage-limit stalls invisible; tmux scrape liveness | R11 #5, #39, #55 |

## (f) Status shown to the human

| source | answer | evidence |
|---|---|---|
| PS | `status.md` derived from tables; three-line drain status; `gates.md` for asks | `orchestrate.md:30-32,75` |
| FM | chat with captain only on real outcomes; visible tmux windows; no-change heartbeats silent | `README.md` Features; `architecture.md:108` |
| OC | channel delivery; run history; ClawSweeper "short receipt comment right away", labels like `clawsweeper:merge-ready` | `pull-request-review-flow.md:49`; `clawsweeper/SKILL.md:234` |
| FG | labels on ticket are the only write; failure reason on dashboard only | ADR-0016:18 |
| HL | session list with status incl. `waiting_input`; SSE events | `hld/session/types.go:20-28` |
| MP | ticket tracker is the human interface; observability optional | `SKILL.md:29,45` |
| CP | 👀 on issue/comment, draft PR, "Copilot started work"/"finished work" timeline events, review request, session log | MS Learn unit |
| CDX | 👀 reaction, then review | CDX page |
| GHA | interactive: comment on the issue/PR updated as it works; automation: run log | GHA "Interactive and automation modes" |
| DUO | session status (`finished`, failed, waits for input); reply in comments | triggers page |
| RT | run list + session per run | RT "Manage scheduled tasks" |
| OLD | Discord chat log; ~8 messages/task not for the reader | R11 #58 |

## Patterns shared by ≥2 independent sources

| # | pattern | sources |
|---|---|---|
| P1 | Claim and state live **on the ticket/MR** (label or assignee), not only in the orchestrator | FG ADR-0016, ClawSweeper labels, CP assignment + draft PR, MP Q5 |
| P2 | Only a **human with write/maintainer role** can trigger; bot/agent events never trigger (loop guard) | GHA "Human actor", DUO "require a human user", CP "write permission", ClawSweeper "verifies maintainer authorization" |
| P3 | Self-hosted detection = **poll every few minutes**; hosted products use webhooks | FG 5 min, FM 300 s merge poll, OC heartbeat 30 min; GHA/RT/DUO webhooks; GLCI needs your own listener |
| P4 | Global concurrency cap; overflow **waits queued**, not dropped | FG maxConcurrent=1, PS rolling ~10, OC maxConcurrent, ClawSweeper queue slot. (RT drops, CUR refuses — the contrast) |
| P5 | **Hard wall-clock cap** per run | CP 59 min, OC 60-min watchdog, GLCI job timeout, PS TIMEBOX |
| P6 | **Heartbeat/stale → mark interrupted, release claim**; no blind auto-restart | FG ADR-0031, HL orphan→failed, PS synthetic postmortem, FM "never an automatic … restart" |
| P7 | **Retry/round cap, then a human** | MP "few tries", ClawSweeper 10/PR 1/head, PS "Two retries", OC backoff |
| P8 | **Immediate ack** on the item when a trigger is picked up | CP 👀, CDX 👀, ClawSweeper receipt comment, GHA tracking comment |
| P9 | Verdict/review **keyed to head SHA** | ClawSweeper `sha=` marker, PS ledger PR+SHA (R19:75) |
| P10 | A run **never waits for a human**: it ends, the human's change is the next trigger | MP `SKILL.md:19`; DUO "waits for input changes nothing"; PS gates.md parks, routes around |
| P11 | Human takes over → **agents stand off** | ClawSweeper `@clawsweeper stop` → `human-review`; OC "do not summon ClawSweeper … at the same time" |
| P12 | Deterministic code does the **writes** (labels, undraft, merge); LLM does judgment | ClawSweeper "Deterministic scripts own comments, labels…", PS coordinator lands mechanically, FG labels from dispatcher |

## Check of the proposed trigger table

| proposed row | verdict | why / source |
|---|---|---|
| `/approved` on draft MR → start writer (`claude --bg` worktree) | **keep, change detail** | P2: check note author is a human maintainer, not a substring match (R11 #41 regex was bypassable; GHA/DUO/ClawSweeper). P1: coordinator sets a claim label (e.g. `agent::writing`) before start (FG). P8: post ack note. |
| writer marks ready → start reviewer | **keep** | GHA example `ready_for_review`; ClawSweeper "mark a draft ready"; MP review task. Add: record reviewed head SHA (P9); re-review only on new head. |
| open Act-on threads → writer again | **change** | Add round cap (P7: ClawSweeper 1/head 10/PR; MP "few tries"); on cap → label `needs-human`, stop. MP rework "fixes only what the automated review named". |
| gate red → writer rework | **change** | Same cap (P7). Split flake vs real (PS retry by mode; R11 #64 flake). Cancel/ignore gate results for superseded SHAs (R11 #46). |
| gate green + no Act on → writer done step (undraft, assign maintainer) | **change** | Done step is mechanical: coordinator does it with `glab`, no LLM run (P12; ClawSweeper `merge-ready` label; CP "requests your review"). Only if green is for current head SHA (P9). |
| MR merged → discovery retro + sweep worktree | **keep, throttle retro** | MP retro "one merged PR in ten" at start; PS retro watcher; FM merge poll via glab. Sweep is mechanical (no LLM). |
| human Discord message → copy verbatim into MR | **keep** | FM `AGENTS.md:216` "append the captain's words"; MP ticket tracker is the human interface. The MR note, not Discord, then triggers (P10). Detect bridge-down (R11 #53). Ignore bot authors (R11 #73). |
| daily digest | **keep** | OC heartbeat/automations; GHA daily cron example; MP daily clock. Skip "no change" digests (FM `architecture.md:108`). |
| throttle: one run per MR, max N=2 | **keep** | FG default 1, queued overflow (P4). Overflow stays queued, oldest first; never dropped (contrast RT). |
| detection: poll with glab every few minutes, no webhooks | **keep** | FG 5 min, FM 300 s (P3). Make each poll idempotent: derive work from MR state + claim label, not from "new since last poll". |

### Missing rows

| missing trigger | action | source |
|---|---|---|
| run heartbeat stale / wall-clock cap hit | mark interrupted, remove claim label, note on MR; no auto-restart beyond cap | P5, P6 (FG ADR-0031, CP 59 min, PS) |
| coordinator starts / restarts | reconcile: claim labels with no live run → interrupted | HL `daemon.go:199`; PS `:101`; FM "restart must be a non-event" (R24) |
| round/retry cap reached | label `needs-human`, notify once, stop | P7 |
| human `/stop` note or human pushes to the branch | label human-owned; no agent runs until removed | P11 (ClawSweeper stop) |
| new push while a gate/review runs | drop the stale result; act only on head SHA | P9; R11 #46 |
| merge conflict with target | writer rebase run (or needs-human) | DUO "Merge conflict" trigger |
| subscription usage limit hit | pause all starts, notify with reset time | R11 #38, #39 |
| trigger picked up | ack note/emoji on the MR at once | P8 |
| events authored by agent account | never a trigger | P2; matters because agents may share one GitLab identity (R24 Identity) |

Not found / not opened: Cursor docs (404, forum only); GitHub Copilot official assign-issue page (404; MS Learn used); firstmate capacity exit-75 not re-located in this clone (cited via R11:98); forge ADR-0044 spend cap absent from clone (R24:38).
