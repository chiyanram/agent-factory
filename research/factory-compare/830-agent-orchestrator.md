# #830 — Profile: Agent Orchestrator (AO) and the orchestrator.inc agent plugins

Map: #826. Prior read: map #654 at AO `b5f4911` (2026-11-16). Read on 2026-11-20.

Sources:
- Repo `OrchestratorInc/agent-orchestrator` at HEAD **`cab1f8d1570ea64eab9aeb8daa1ffd992a2b2425`** (2026-11-20,
  "feat(hermes): qualify the v0.23 release line"). Blobless clone, read only, no code or build tool run. 146 commits
  after `b5f4911`; 1536 files changed.
- Docs site https://docs.orchestrator.inc/plugins/agents/ and https://docs.orchestrator.inc/plugins/agents/claude-code.
  Their text matches the repo's docs source `frontend/src/docs/content/plugins/agents/index.mdx` at HEAD.

Marks: **D** = *documented* (link); **C** = *inferred from code* (`file:line` at `cab1f8d`); **unknown** = not found,
with the reason. Paths under `backend/` are written from `backend/`.

## What it is

| fact | mark |
|---|---|
| "A local desktop workspace" to run a fleet of coding agents: every task gets its own agent, branch and worktree; code stays on the machine | D: `README.md` "Why Orchestrator.inc" (https://github.com/OrchestratorInc/agent-orchestrator) |
| For a developer who runs several coding agents at once and follows each change through CI, review and merge | D: same README section |
| One project "orchestrator" agent plans and spawns workers; a reviewer agent can read each PR | D: README "Features" |
| Open source, Apache-2.0 | D: `LICENSE:1-3`, `README.md:222-224` |
| A hosted part, "AO Cloud" (cloud workspaces, plans, trials), is a private submodule `private/ao-cloud` → `Untrivial-ai/ao-cloud`, `update = none` | C: `.gitmodules`; D: README "Cloud Agents" (https://docs.orchestrator.inc/guides/cloud). Its licence is **unknown**: the repo is private |
| Telemetry on by default (PostHog, GitHub username, install ID), opt out in Settings | D: `README.md:220` |

## Stack

| part | what | mark |
|---|---|---|
| Language, backend | Go 1.27.4; module `github.com/aoagents/agent-orchestrator/backend` | C: `backend/go.mod:1-3` |
| Runtime | One local daemon (`ao daemon`, hidden command) plus `ao` CLI; Electron 44 + React 19 + Vite 8 desktop app; Expo 57 phone app | C: `internal/cli/root.go:398-405`; `frontend/package.json:69,76,136`; `packages/mobile/package.json:30` |
| Storage | SQLite (`modernc.org/sqlite`), goose migrations (262 files) | C: `go.mod:35`, `go.mod` goose line; `internal/storage/sqlite/migrations/` |
| Queue | No outside queue. Durable report batches and review runs are SQLite rows driven by in-daemon loops (report coordinator, runtime reaper) | C: `internal/service/report/coordinator.go`; `internal/review/run_lifecycle.go:40` |
| Sandbox | No OS sandbox for workers. Reviewer runs on Codex use Codex's own read-only sandbox, probed before launch; "Experimental reviewer modes and prompts do not sandbox tools or network access" | C: `internal/adapters/chatdriver/codexappserver/driver.go:44-52`, commit `6248e7ad4`; D: https://docs.orchestrator.inc/plugins/agents/ |
| Agent hosts | Native PTY on macOS/Linux, tmux as fallback, ConPTY on Windows | D: https://docs.orchestrator.inc/plugins/ |
| LLM providers | None called directly for work. AO drives about 40 agent CLIs, each with its own login. Docker Agent builds a config from `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_API_KEY`; Unreal Agent is built in | D: https://docs.orchestrator.inc/plugins/agents/ ; C: `internal/adapters/agent/registry/registry.go` |
| Network | Daemon on `127.0.0.1:3001`, unauthenticated; an opt-in authenticated LAN listener for the phone | D: `frontend/src/docs/content/architecture.mdx:77-81,99` |

## Where docs and code live

| what | where | mark |
|---|---|---|
| Public docs | https://docs.orchestrator.inc, source `frontend/src/docs/content/*.mdx` | C |
| Contributor docs | `AGENTS.md` (167 lines), `docs/architecture.md`, `docs/adr/`, `docs/documentation-map.md`, `docs/harnesses/` | C |
| Agent adapters | `backend/internal/adapters/agent/<harness>/` (58 folders, some shared helpers) | C |
| Adapter port | `backend/internal/ports/agent.go:225` | C |
| Role prompts | `backend/internal/session_manager/prompt.go`, `backend/internal/review/prompt.go` | C |

## The agent-plugin model and lifecycle

- **Not plugins: compiled-in adapters.** "New capabilities are implemented as Go adapters behind the daemon's port
  boundaries and compiled into Orchestrator"; no npm plugins, no `ao plugin create`, no marketplace. D:
  `frontend/src/docs/content/plugins/authoring.mdx:5-9`, https://docs.orchestrator.inc/plugins/
- **Catalog.** The docs table lists 40 harnesses with three capability flags: Terminal UI, Chat, Reviewer. D:
  https://docs.orchestrator.inc/plugins/agents/. The code registry also registers `tau` (`registry.go:51,92`), which
  the docs table does not list; C. So the docs lag the code by at least one harness.
- **Port.** One `Agent` interface: `GetConfigSpec`, `GetLaunchCommand`, `GetPromptDeliveryStrategy`, `GetAgentHooks`,
  `GetRestoreCommand`, `SessionInfo`. C: `ports/agent.go:225-247`. Each adapter also has a `Manifest` with
  capabilities. C: `internal/adapters/registry.go:12-20`.
- **Lifecycle.**
  1. `ao agent ls --refresh` probes each CLI: supported, installed, authenticated. Spawn does the final check. D:
     https://docs.orchestrator.inc/plugins/agents/
  2. `ao spawn --agent <name> --mode chat|tui` makes a session with a worktree. Chat goes over ACP (Claude Code via
     `claude-agent-acp`, Codex via its app-server); TUI runs the native CLI in a PTY. D: same page.
  3. The workspace setup installs the adapter's activity hook. D: https://docs.orchestrator.inc/plugins/agents/claude-code
  4. Activity state: `active`, `idle`, `waiting_input`, `blocked`, `exited`. C: `internal/domain/activity.go:21-25`.
  5. Restore rebuilds the launch with `GetRestoreCommand` (native resume where the CLI has it). C: `ports/agent.go:243`.
- **Credentials.** AO reuses the CLI's own login; it bundles no provider credentials. D: https://docs.orchestrator.inc/plugins/agents/
- **Permission mapping** (unchanged since `b5f4911`). Claude: `acceptEdits`/`auto`/`bypassPermissions` flags, default
  passes none (`pkg/agentruntime/command.go:184-195`). Codex: default and bypass both map to
  `--dangerously-bypass-approvals-and-sandbox` (`command.go:198-208`). Cloud "standard" → `auto` (`command.go:173-181`).
  A session with no saved permission gets `auto` (`internal/session_manager/manager.go:2830-2832`, was `2679`). C.

## Topics 1–12 (first notes, for the matrix)

| # | topic | AO at `cab1f8d` | mark |
|---|---|---|---|
| 1 | user interaction | Desktop Kanban board, per-session chat or terminal, phone app (reply, approve, start, review), Cmd+K search over all paired machines | D: README "Features"; C: commit "feat(search): search every connected AO machine" |
| 2 | CLI | `ao` (cobra), grouped by noun, 13 `Hidden: true` commands; new `ao session interrupt` and `ao session switch --force` | C: `internal/cli/*.go` (grep `Hidden: true`: 13), `prompt.go:271` |
| 3 | flow + state machine | Session columns `building`, `validating`, `needs_review`, `ready`, `archive`, derived from facts, not stored; review runs are now an explicit state machine `queued → launching → running → completed`, plus `cancelling`, `failed`, `cancelled`, `superseded` | C: `pkg/contract/kanban.go:17-34`; `internal/domain/review.go:188-206` |
| 4 | roles + prompts | Orchestrator (plans, no implementation, no subagents), worker, native reviewer; prompts are Go strings | C: `prompt.go:259-290, 385`; `review/prompt.go:98-108` |
| 5 | handoff | Free prompt or issue body with a trust line in front; orchestrator ↔ worker by `ao send`; reports batched and delivered durably to the orchestrator | C: `prompt.go:73-95` (task), `prompt.go:234-238` (`issueContextTrustBoundary`); `service/report/coordinator.go` |
| 6 | review | Native reviewer on each PR head, read-only allowlist, exact submit shapes (now pipe or quoted heredoc), "AO review done" notice to the worker, findings must carry evidence, drafts skipped; may not run tests | C: `claudecode/reviewer_policy.go:36-50, 73-102`; `review/prompt.go:98-108`; `reactions.go:304-309` |
| 7 | plugins | No plugin system: about 40 adapters compiled in, no install, no third-party code | D: `plugins/authoring.mdx:5-9` |
| 8 | adapters | Agent, runtime, workspace (worktree, scratch), tracker (GitHub, GitLab), SCM (GitHub, GitLab), notifications, terminal | D: https://docs.orchestrator.inc/plugins/ |
| 9 | internals | One Go daemon, SQLite + change log, poll SCM with ETags, runtime reaper every 5 s now also watches reviewers, per-session agent hosts | D: `architecture.mdx:71`; C: commit `77aeb0458` body |
| 10 | security | No worker sandbox; unauthenticated loopback API; children inherit the daemon env (only `AO_*` keys are AO's: `agentlaunch/env.go:22-41`); `auto` default; Codex bypass; reviewer "untrusted evidence" rule in prompt only | C: cites above; D: `architecture.mdx:77` |
| 11 | docs | Public mdx docs site, translated READMEs, ADRs, `docs/documentation-map.md`, harness pages; the agents table lags the registry (`tau`) | C |
| 12 | stack | Go daemon, Electron/React desktop, Expo phone, SQLite, about 40 agent CLIs | C: see Stack |

## #654's key cites re-checked at `cab1f8d`

| cite (from `b5f4911`) | changed? | what changed |
|---|---|---|
| `internal/session_manager/prompt.go` | yes, small (+4/−3) | Orchestrator: interrupt a stuck worker first (`ao session interrupt`), wait for two idle reads, then kill; new command listed. Worker native review: AO now sends one "AO review done" message instead of "check `ao review ls`". Trust line and "no subagents" unchanged (`prompt.go:238`, `260`, `385`) |
| `pkg/agentruntime/command.go` | **no** | permission mapping as before; only line numbers in #654 notes may differ |
| `internal/lifecycle/reactions.go` | yes (+54) | Review-done notice after review nudges; provider times (`Submitted at`, `Newest comment posted at`) in nudge text; merged/closed notices use the provider's time; review comments to Chat sessions go a separate path. CI tail fence now at `reactions.go:872-885` (was `859-871`); `markdownCodeFence` at `1002` |
| `internal/service/report/` | yes, large (`coordinator.go` +395) | Done batches flush early once no other worker is working; bounded delivery retries (exponential backoff to 64×, max attempts, expiry, terminal `failed` state); "unacknowledged delivery" counted |
| `adapters/agent/claudecode/reviewer_policy.go` | yes (+45) | Submit shape check moved to shared `ports` patterns; a quoted-heredoc shape is added beside `printf '%s' … \|`, and a body line equal to the delimiter is refused |
| `pkg/contract/kanban.go` | yes (+118) | Stacked PRs: a PR on another open PR's branch is never `ready` ("Waiting on base PR"). **Priority flipped**: a session is now placed by its *least* ready live PR (was most actionable); a PR that needs fixing speaks first |

Other changes since `b5f4911` that touch the map:
- Review runs became a guarded state machine with time limits, failure reason codes, a mass-death breaker for
  reviewers, and sleep time not counted. C: commit `77aeb0458`; `review/run_lifecycle.go`; migration
  `20261115072835107_review_run_state_machine.sql`.
- Reviewer preflight fails if the Codex read-only sandbox cannot start. C: commit `6248e7ad4`.
- `.worktreeinclude` copies named files into session worktrees. C: commit `6211d2763`.
- New harnesses: `open-interpreter`, `tau`, `mastra-code`. C: migrations `20261116125847855`, `20261117090000000`,
  `20261119090000000`.
- Coder can host a project's orchestrator (cloud). C: commit `3a69e1c7c`.

## Unknowns

- AO Cloud's code, licence and trust model: private submodule, not readable.
- Exact LLM models used inside each CLI: chosen per CLI login and per session, not fixed by AO.
- Whether the docs site is deployed from `cab1f8d`: the site has no version stamp; its agents page text matches HEAD.
- Pages not read this pass: `codex`, `opencode`, `cursor`, `hermes`, `aider` agent pages, `guides/cloud`.
