# Orchestrator landscape — open-source / self-hostable tools that run coding agents in parallel

Ticket: agent-factory#8. Researched 2026-10-18. Stars / pushes / releases read via `gh api repos/<r>` and
`/releases` on that date. Primary sources only (repo README/docs/issues, vendor docs). Quotes ≤15 words.
Not repeated here: Claude Code agent view / teams / `/batch`, Codex, Copilot, Cursor, Devin, Factory,
Amp, Jules, Duo Developer Flow (→ `02-agent-products`); firstmate, forge, pstack (→ `01-refs-refresh`).

## Sources

| key | URL |
|---|---|
| CSQ | github.com/smtg-ai/claude-squad (README; issues #100, #260, #275) |
| VK | github.com/BloopAI/vibe-kanban (README; #1697, #877, #3354, #765) · vibekanban.com/blog/shutdown |
| SCU | github.com/imbue-ai/sculptor (README; docs/help/workspaces.md, pull_requests.md, experimental/container_backend.md) |
| UZI | github.com/devflowinc/uzi (README) |
| CU | github.com/dagger/container-use (README; #101, #142, #300) |
| CRY | github.com/stravu/crystal (README: deprecated → Nimbalyst) |
| CON | conductor.build/docs/concepts/git-worktrees (no public source repo found via `gh search repos`) |
| OH | github.com/OpenHands/OpenHands (README "Agent Canvas"; #17546, #7752) · docs.openhands.dev/openhands/usage/cloud/gitlab-installation |
| AID | github.com/Aider-AI/aider · aider.chat/docs/usage/lint-test.html |
| PLX | github.com/plandex-ai/plandex (README) |
| SWE | github.com/SWE-agent/SWE-agent (README) |
| RUF | github.com/ruvnet/ruflo (ex claude-flow; README; #3189, #2970, #933) |
| CCM | github.com/kbwo/ccmanager (README) |
| WMX | github.com/raine/workmux (README; #267, #161, #252) |
| AO | github.com/OrchestratorInc/agent-orchestrator (ex ComposioHQ; README, docs/STATUS.md, backend/internal/adapters/{scm,tracker}/gitlab; #4206–4208, #4840, #3738, #5790, #2523) |
| XUM | github.com/coder/xum (ex coder/mux; README) · xum.cdr.dev/runtime/ssh |
| FARM | github.com/Dicklesworthstone/claude_code_agent_farm (README) |
| OMN | github.com/omnara-ai/omnara (README) |
| GL-FL | docs.gitlab.com/user/duo_agent_platform/flows/ |
| GL-EXT | docs.gitlab.com/user/duo_agent_platform/agents/external/ |
| ARCH | `gh api repos/RooCodeInc/Roo-Code` and `repos/coder/agentapi` → `archived: true` |

## Per-tool

| tool | lead/worker shape | isolation | human sees + answers | verification | forge | size + maturity (2026-10-18) | documented problems |
|---|---|---|---|---|---|---|---|
| **claude-squad** (CSQ) | none — N peer sessions you start | git worktree per task, tmux session | TUI: list, preview/diff tabs, attach to reprompt; `-y` autoyes "[experimental]" | none built in; you review diff | push needs `gh`; GitLab user told "easy to swap out gh" (#100) | 8.6k★, AGPL, v1.0.20 2026-08-20 | no worktree setup hook for deps/env/ports (#260 open); Windows broken (#275); a #100 commenter dropped it for native Claude Code agents |
| **Vibe Kanban** (VK) | kanban issue → workspace per agent; no lead agent | worktree + branch + terminal + dev server per workspace | web UI: kanban, diff with inline comments sent to agent, built-in browser | your review; "review on GitHub, and merge" | GitHub PRs; GitLab self-hosted request open (#1697), on-prem fails (#877) | 28.4k★, Apache-2.0, last release 2026-04-24; **sunsetting** — Bloop shut down 2026-04-10, project "community maintained" (VK blog) | remote kanban/projects removed; users ask for local projects back (#3354); worktree cleanup (#765); 544 open issues |
| **Sculptor** (Imbue) (SCU) | workspaces; several agents may share one workspace | worktree default; backend-in-Docker/SSH/VM "experimental" | desktop app (Mac/Linux): chat, terminal, changes view | bundled skills, e.g. fix-bug "writes failing tests, then makes them pass" | "opens a pull request on GitHub" via `gh`; PR shows CI + approvals | 240★, MIT, v0.48.0 2026-09-21 | self-described "experimental research preview"; not taking large external contributions |
| **uzi** (UZI) | N agents on one prompt (`--agents claude:3,codex:2`), `broadcast` | worktree + tmux + port per agent | CLI `uzi ls -w`; `uzi auto` presses Enter on every tool call | none; `checkpoint` merges | forge-agnostic (local git) | 582★, MIT, v0.0.2 2025-06-03, no push since 2025-06 — **stale** | — |
| **container-use** (Dagger) (CU) | none — an MCP server any agent calls | **container per agent + own git branch** | `cu` CLI: logs, command history, drop into terminal; `git checkout` branch to review | none; you review the branch | forge-agnostic | 4.1k★, Apache-2.0, v0.4.2 2025-08-19 ("early development") | Claude Code fails to connect (#101); git exit 128 (#142); fork lock failure (#300) |
| **Crystal** (CRY) | parallel sessions, compare approaches | worktree | desktop app | — | — | 3.1k★; **deprecated Feb 2026** → Nimbalyst | — |
| **Conductor** (CON) | parallel workspaces | worktree per workspace; "not a security boundary" | Mac desktop app: diff, checks, PR state | setup/run scripts, checks view | PR flow; host not named | closed source — no repo found; fails "open-source" bar | — |
| **OpenHands / Agent Canvas** (OH) | control center + automations (e.g. "decomposing GitHub issues into tasks") | none, Docker sandbox, VM, or remote agent-server backends | web UI; Slack; `@openhands` / label on issue | automations e.g. code review; runs own or ACP agents (Claude Code, Codex…) | **GitLab: Cloud only** — label `openhands` or `@openhands` → opens MR (OH gitlab doc); self-hosted GitLab not documented | 91.2k★, MIT, v1.27.1 2026-10-12 | 1,055 open issues; port fixed at 3001 (#17546, 100 comments); one repo per conversation (#7752) |
| **Aider** (AID) | single agent, no parallelism | none (your checkout; auto-commits) | terminal chat | **`--auto-test` / `--lint-cmd`**, non-zero exit → it "will try and fix" | none | 49.6k★, v0.86.0 2025-08-09 — no release in 14 months | GitHub/GitLab action request open since 2025-03 (#3620); 1,922 open issues |
| **Plandex** (PLX) | single agent, plan → steps | "cumulative diff review sandbox"; Docker for server | terminal REPL | diff review before apply | none | 15.8k★, last release 2025-07-16; Cloud "winding down as of 10/3/2025" | — |
| **SWE-agent** (SWE) | single agent per issue; batch mode for benchmarks | Docker via SWE-ReX | none (batch) | benchmark harness | GitHub issue URL in | 20.6k★, v1.1.0 2025-05-22; README: "use mini-SWE-agent instead" | GitLab asked 2024 (#220, #760), closed |
| **Ruflo (ex claude-flow)** (RUF) | "100+ specialized agents, coordinated swarms" via MCP + hooks in Claude Code/Codex | not stated in README | Claude Code plugin console `/ruflo` | claims "plans, remembers, tests"; no gate described | not stated | 76.1k★, v3.57.0 2026-10-17, 1,042 open issues | its own release-verification fails: "Witness signature verification fails" (#3189, 69 comments); "bad links in the docs" (#933) |
| **ccmanager** (CCM) | none — session manager, multi-project | worktree; **devcontainer integration**; `.worktreeinclude` | TUI with busy/waiting/idle state per session; status-change hooks | none; "Auto Approval (experimental)" by AI | forge-agnostic | 1.3k★, MIT, v4.4.8 2026-10-17, 5 open issues | low issue volume; Claude-Squad autoyes criticised as bypassing confirmations (its README) |
| **workmux** (WMX) | none; `/worktree` skill lets an agent delegate to worktree agents | worktree + tmux window; **sandbox in container or Lima VM** | tmux; TUI dashboard + sidebar; agent status in window names | `pre_merge` hook "aborts on failure" | GitHub PRs; **`--forge gitlab` works** (#267, closed) | 2.9k★, MIT, v0.1.276 2026-10-14 | multi-repo workspaces (#161); status misroute without `TMUX_PANE` (#252) |
| **Agent Orchestrator (Orchestrator.inc, ex Composio)** (AO) | **lead + workers**: persistent project orchestrator plans, spawns/redirects workers; workers own code, tests, PR | worktree + branch per worker; "not OS or network isolation" (STATUS) | desktop/web/mobile; Kanban: Working / **Needs you** / In review / Ready to merge, derived from PR + CI + review facts | reviewer agents (Claude Code, Codex, Aider…); CI + review comments routed back to owning worker | **GitLab SCM + tracker adapters** (REST v4: MR state, pipeline, approvals, job logs; "GitLab.com and self-managed") | 13.3k★, Apache-2.0, nightly 2026-10-17, 923 open issues | self-managed gaps: doctor "hardcodes gitlab.com" (#4206), custom CA (#4208), http/path prefix (#4207); Codex default "falls through to bypass approvals and sandbox" (#4840); session shown Exited while agent runs (#5790); status overwritten after Stop (#3738); no per-spawn memory ceiling (#2523) |
| **Xum (ex Mux, Coder)** (XUM) | parallel workspaces, own agent loop (not Claude Code) | local, worktree, or **SSH runtime** (repo sent as git archive; tools run remote) | desktop app + VS Code extension | Plan/Exec modes | not stated | 2.1k★, AGPL, nightly 2026-10-17 | perf: ~9.8 MB JS first load (#5971); 494 open issues |
| **claude_code_agent_farm** (FARM) | 20–50 Claude Code panes on one sweep (bug-fix / best-practice), lock-file coordination | one checkout, file locks; no worktree | tmux + HTML run report | stack-specific lint/type checks (34 stacks incl. Java) | none | 922★, no releases | requires `--dangerously-skip-permissions` alias; monitoring Claude-specific |
| **Omnara** (OMN) | managed-agent API (agent.yaml → machine pool) | managed sandboxes / your machines | dashboard, CLI chat | — | — | 2.9k★, Apache-2.0, 2026-10-16 | pivoted from Claude Code remote-control to agent platform |
| **GitLab Duo flows + external agents** (GL-FL, GL-EXT) | event → flow (foundational or custom) → agent; no fan-out lead | **CI/CD pipeline on your runner** | mention / assign / request review of agent's service account in issue/MR; replies as MR or comment | your pipeline; Duo review | **GitLab-native**, self-managed | custom flows GA 19.2; external Claude Code + Codex on self-managed since 18.6; Premium/Ultimate, feature-flagged | "limited isolation compared with GitLab native agents"; prompt scanning "not available for external agents"; custom external agents self-managed only, behind flag |

Agent-teams community wrappers: `gh search repos "agent teams claude code"` → top result 3★. **No wrapper with real adoption exists**;
everyone uses Claude Code's own teams/subagents (02) or one of the session managers above.

## Patterns every tool shares

1. **Unit of work = worktree + branch (+ tmux pane or app tab).** Every active tool (CSQ, VK, SCU, UZI, CCM, WMX, AO, XUM, CON). Containers are the add-on, not the default (CU, WMX sandbox, SCU experimental, OH backends).
2. **The worktree starts broken** — no `.env`, deps, ports. Every tool grows a setup hook / copy list / `.worktreeinclude` (WMX, CCM, CON, UZI `devCommand`); where missing, it is the top request (CSQ #260).
3. **Status board of sessions, not a chat log**: busy / waiting / idle (CCM), Needs you (AO), list+diff (CSQ). The human's real job is answering "waiting" sessions.
4. **Auto-approve is everywhere and always flagged experimental/unsafe** (CSQ `-y`, UZI `auto`, CCM AI approval, FARM `--dangerously-skip-permissions`, AO #4840).
5. **Verification is not the tool's job** — almost none gate "done". Exceptions: Aider test/lint loop, workmux `pre_merge` abort, AO routes CI/review failures back to the worker. Everyone else = "you review the diff".
6. **Forge = GitHub via `gh`.** GitLab only in AO (real adapter, self-managed gaps), workmux (`--forge gitlab`), OpenHands Cloud, and GitLab's own flows.
7. **Lead+worker is rare.** Only AO ships a planning orchestrator over workers; Ruflo claims swarms. The rest are N peers the human dispatches.
8. **High churn.** Within ~18 months: Vibe Kanban company shut down, Crystal deprecated, Plandex Cloud wound down, SWE-agent superseded, Roo Code archived, agentapi archived, Mux renamed, claude-flow renamed, Composio AO moved org. Several stars ≠ maintained (uzi, Aider releases).

## What a one-person team on GitLab + one VM + a laptop could adopt instead of building (ranked)

| # | adopt | covers | why ranked here | gap left for us |
|---|---|---|---|---|
| 1 | **workmux on the VM** (tmux, reached by SSH from laptop) | worktree+tmux per issue, setup hooks (`post_create` for Gradle/compose ports), dashboard, `pre_merge` hook = our gate, `--forge gitlab` | terminal-native, forge-aware, active (release 4 days ago), MIT, no daemon/GUI; matches "tools you already use" | no lead; no issue intake; merge is local — we keep MR + human merge |
| 2 | **GitLab external agent (Claude Code) on our runner** (GL-EXT) | issue/MR mention → pipeline on the VM runner → MR or comment; flow YAML in `.gitlab/duo/flows/` | GitLab-native, MR approvals stay GitLab's, rules come from repo clone | Premium/Ultimate + feature flag; "limited isolation"; one agent per event, no lead |
| 3 | **Agent Orchestrator (AO)** daemon on VM | only tool with lead+workers *and* GitLab MR/pipeline/approval observation + Needs-you board | closest feature match | heavy desktop/daemon product, 923 open issues, self-managed GitLab gaps (#4206–4208), Codex sandbox fall-through (#4840); Claude Code needs explicit bypass for Chat |
| 4 | **ccmanager** on laptop | session states + status hooks + devcontainer, multi-project | tiny, stable, forge-agnostic | no forge, no gate, no lead |
| 5 | **container-use** for risky runs | container + branch per agent via MCP | Dagger-backed isolation without writing Docker glue | release stalled since 2025-08; connect bugs (#101); one Compose stack conflicts with per-agent containers |
| — | skip | Vibe Kanban (sunset), Crystal (deprecated), uzi (stale), Conductor (closed, Mac), Sculptor/Xum (GitHub-only / own loop), Ruflo (unverifiable claims, own verification failing #3189), Aider/Plandex/SWE-agent (single agent) | | |

## Where none of them fits our needs

| our need | best available | why it still falls short |
|---|---|---|
| GitLab (self-managed-grade) | AO adapter, workmux `--forge gitlab`, Duo external agents | AO self-managed bugs open; workmux only checks out MRs; Duo needs paid tier + flag. Everyone else is `gh` only |
| Java/Gradle monorepo | worktree setup hooks (WMX, CCM) | no tool knows Gradle cache, Testcontainers, or a **single shared Compose stack** — parallel worktrees on one VM all deploy to the same stack ("last-deployed wins") and nothing models that as a lock |
| VM gate as "done" | workmux `pre_merge`, AO CI routing, Aider `--auto-test` | gates run at *merge* or per-edit, not "`make verify-full` green at MR head SHA, evidence on MR". AO reads GitLab pipelines — we have no CI (VM run, not pipeline) |
| Operator approves design, then merges | AO "Ready to merge" column; Duo MR | no tool has a **design-approval stop before implementation** (our `/approved` on a spec-only draft MR); all start coding on dispatch |
| Rulebook identical on laptop and VM | every tool just launches the agent CLI in a worktree | none manages rules; Claude Code loads `CLAUDE.md`/`.claude/rules` from the worktree but user `~/.claude` differs per machine (02 CC-ENV). Rule parity stays our job (repo-only rules + managed-settings on VM) |
| Lead that splits work | AO orchestrator; Claude Code teams (02) | AO's lead plans product direction, not our stage pipeline; teams share one checkout (02 CC-PAR) |

Net: adopt a worktree/tmux manager (workmux) as the substrate; build only the thin parts nobody ships —
GitLab issue → worktree dispatch, the stack lock, the spec-approval stop, and the VM-gate evidence on the MR.

## Not reached / weak

- Conductor: docs page only; open-source status inferred from no repo found. Nimbalyst not examined.
- OpenHands self-hosted GitLab: not documented on pages read; may exist elsewhere.
- Ruflo isolation and verification: README does not state; not checked in code.
- Xum: whether it can drive Claude Code CLI not stated on runtime page (README: "custom agent loop").
- GitLab flow trigger list for custom flows: not on GL-FL page; external-agent triggers from GL-EXT.
- Issue counts include PRs (`open_issues_count`).
