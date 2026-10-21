# 24 — The coordinator: how references run it, laptop vs server, channel, identity, permissions (2026-10-20)

For chiyanram/agent-factory#1 box 2. Read-only. refs/ = agent-platform .scratch/one-rulebook/refs/.

## How each coordinator runs

| source | process · lifetime | human talks via | notices done/stuck | restart |
|---|---|---|---|---|
| pstack poteto-mode/playbooks/orchestrate.md | the user's own chat, one standing coordinator chat, multi-day (:3) | chat + gates.md, status.md (:30-32) | queue events; "Never resume an agent to check on it"; reads ledger (:9,70,95) | re-read the store (:101) |
| firstmate | any terminal harness in the repo, no app (README:38-40) | chat (README:172) | zero-token bash watcher (README:52) | "A restart must be a non-event" (AGENTS.md:128) |
| openclaw | one always-on gateway (gateway/index.md:69); LaunchAgent laptop / systemd VPS | chat apps; coordinator single point of contact | SQLite records | resumes turns |
| forge | no LLM coordinator: timer poller + runner on a VPS (ADR-0010) | labels + dashboard | runner heartbeat | claim on the ticket |
| CC --bg / agent view | supervisor process per task | `claude agents` board, hooks agent_needs_input / agent_completed | board | stops on shutdown; idle ~1 h unless pinned |
| CC channels | MCP push into a running session | Telegram/Discord/iMessage | — | only while open |
| GitLab Duo external agents | CI pipeline per mention | issue/MR comments | pipeline | n/a |
| ours (old fleet) | create-agent.sh + tmux + systemd | Discord | tmux scrape | --continue |

## Laptop-only

pstack, firstmate (tmux), openclaw (LaunchAgent), CC --bg all work with no server. The server adds uptime only. forge needs a VPS.

## Human channel

firstmate: captain's words appended verbatim to `## Captain's intent` (AGENTS.md:216). Old G16: a notifier never holds an answer. Products: the issue/MR comment or board is the record.

## Identity

forge: one shared write token; opens PRs, never merges (ADR-0017). Copilot: authored by Copilot, assigner co-author, requester cannot approve. CC routines: your user. GitLab Duo: service account `ai-<agent>-<group>` (Premium). GitLab Free: service accounts since 18.11, up to 100 per group, no seat (UNVERIFIED on our instance); project access tokens need Premium. Ours: 3 of 4 agents on the operator's PAT.

## Permissions without bypass

Bypass by default in firstmate, claudelayer, our fleet. Bounded: humanlayer --permission-prompt-tool; forge bubblewrap; openclaw sandbox no network; Claude Code auto mode + OS sandbox + disableBypassPermissionsMode; Codex workspace-write sandbox.

## Patterns (≥2)

Coordinator = plain harness session + durable state, restart re-reads it. Liveness from records/forge, never by probing. Human talks to the coordinator; answers copied verbatim to the record. Forge role stops a merge. Products bound workers with a sandbox, not bypass. Status on a board, not a chat log.

Not found: G29–G31 absent from the register (stops at G28); forge ADR-0044/0057/0063 absent from the clone.

## Identity follow-up (2026-10-20)

| source | pattern | point | URL |
|---|---|---|---|
| GitLab composite identity (Duo) | human + agent | primary author = the human who started it; service account `ai-<flow>-<group>` secondary; more restrictive permissions win | docs.gitlab.com/user/duo_agent_platform/composite_identity/ |
| GitHub Copilot cloud agent | human + agent | authored by Copilot, assigner co-author; requester cannot approve | docs.github.com/en/copilot/concepts/agents/coding-agent/risks-and-mitigations |
| GitHub Apps user-to-server | human + agent | requests attributed to the user, app badge shown | docs.github.com/en/apps/…/authenticating-with-a-github-app-on-behalf-of-a-user |
| Claude Code GitHub Actions / GitLab CI | one shared bot | Claude app or CI_JOB_TOKEN / project access token | code.claude.com/docs/en/github-actions · /gitlab-ci-cd |
| GitLab approval settings | — | "prevent approval by author/committers" is Premium; on Free approvals are optional | docs.gitlab.com/user/project/merge_requests/approvals/settings/ |
| NHI Mgmt Group | against shared | shared credentials hide the actor; revoking cuts every agent | nhimg.org/faq/what-breaks-when-ai-agents-rely-on-shared-service-accounts-or-api-keys/ |
| Mux/Coder | per-developer "-agent" account | NOT OPENED (search summary) | mux.coder.com/config/agentic-git-identity |

Vendor default is human + agent both recorded (GitLab, Copilot, GitHub Apps). Shared bot is the simple-CI default and is criticised for attribution and revocation. Per-developer service account + co-author trailer is the nearest Free-tier copy of the vendor default; no doc recommends it directly. On Free nothing enforces separation of duties — it is a team rule.
