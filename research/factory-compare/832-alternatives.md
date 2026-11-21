# #832 — close alternatives to the factory (scan)

Question (#832, map #826): which products or open-source projects are closest to agent-factory — a coordinator AI
that talks with the human, plus code that starts fresh implementer and automated-review runs on a sandboxed runner,
ticket → spec → PR, with human approval gates? Rank the top 5, profile the top 2, one line for the rest. Round 1 picks
at most 2 to add. Devin, Agent Orchestrator and Mattock are out of scope here (other tickets on #826).

Read on 2026-11-20. Evidence rule (#826 Notes): each claim is *documented* (link) or *inferred from code*
(`repo@sha path:line`). "unknown" means not found, with the reason.

Pinned reads:

- Optio: `jonwiggins/optio@8d116d8` (full sha `8d116d80c45d3ebc15776672e0028b80fb439ec9`).
- Symphony: `openai/symphony@be10a1b` (full sha `be10a1b79df723d6d7612b5651c8522704dafb2e`, 2026-09-15).

## What "close" means here

The yardstick is agent-factory at `main` `1d681d7` (`README.md:9-24`):

| trait | agent-factory |
|---|---|
| A | A coordinator AI talks the ticket through and writes the spec. |
| B | Code (not a model) decides each step. |
| C | Each implementer run is fresh, on a sandboxed runner, with no git-host login. |
| D | A separate automated review runs, and its findings go back to the implementer. |
| E | A human starts, approves the spec, and merges. The AI never approves. |
| F | Tickets on GitHub or GitLab. |

## Ranking

| # | candidate | open? | A coord. AI | B code decides | C fresh sandboxed run | D separate review | E human gates | F tracker→PR | why this rank |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Optio** | MIT | no | **yes** (pure reconciler) | yes (K8s pod per run) | **yes** (review subtask blocks parent) | merge by human unless auto-merge is on | GitHub, GitLab, Jira, Linear, Notion | Same shape as the orchestrator, review and Act-on loop; no coordinator or spec gate |
| 2 | **OpenAI Symphony** | Apache-2.0 | no | **yes** (orchestrator state machine) | per-issue workspace; Codex sandbox | no (agent sweeps PR feedback itself) | **yes** (`Human Review` → human moves to `Merging`) | Linear, GitHub, GitLab, Jira, Asana | Code scheduler + host-side tracker tools (token kept from the run) + in-repo `WORKFLOW.md` policy |
| 3 | Factory.ai (Droids) | closed | **yes** (Workstreams orchestrator you talk to) | no (orchestrator is a model) | cloud computers + OS sandbox | yes (Automated Code Review) | spec/plan approval | Linear, Jira, Slack | Closest to trait A and the spec gate, but a model routes the work |
| 4 | GitHub Copilot coding agent | closed | no | no | yes (Actions runner / cloud sandbox, firewall) | yes (Copilot code review, separate product) | workflows wait for "Approve and run"; human reviews | GitHub only | Closest hosted issue→draft PR with sandbox and a CI gate |
| 5 | OpenHands (Agent Canvas) | MIT | no | no | Docker / VM backends | yes (`/codereview` skill) | not enforced | GitHub label/mention; automations for Linear, Slack | Open-source resolver + review skill + sandbox, no gated flow |

Recommend for round 1: **Optio** and **Symphony**. Both are open source, so the matrix can cite code, and both
share trait B, which the closed products lack. Factory.ai is the runner-up; add it only if trait A (coordinator) is
the topic round 1 wants a peer for.

## 1. Optio — full profile

**What, who, licence.** Self-hosted orchestration for coding agents, workflows and interactive sessions, on your
Kubernetes cluster or your own machines — *documented*
([README](https://github.com/jonwiggins/optio/blob/8d116d80c45d3ebc15776672e0028b80fb439ec9/README.md), lines 4-5).
For teams that self-host; workspaces with admin/member/viewer roles — *documented* (README:91). MIT — *documented*
(README:128; GitHub API `license: MIT`). Created 2026-03-19, ~1.1k stars — GitHub API.

**Stack.**

| part | value | evidence |
|---|---|---|
| language | TypeScript; Swift and Kotlin mobile clients | *documented* README:126 |
| runtime | Next.js web, Fastify API, Kubernetes pods; "Optio Local" on paired machines | *documented* README:86,90,126 |
| storage | PostgreSQL | *documented* README:126 |
| queue | Redis / BullMQ | *documented* README:126 |
| sandbox | container runtime seam: Docker, Kubernetes, process, fake | *inferred from code* `packages/container-runtime/src/{docker,kubernetes,process,fake}.ts`, interface `types.ts:90` |
| LLM providers | through the agent CLI chosen per run: Claude Code, Codex, Copilot, Gemini, Cursor, OpenCode, Pi, OpenClaw; optional LiteLLM proxy | *documented* README:19,120; *inferred from code* `packages/agent-adapters/src/index.ts:29-32` |

**Docs and code.** Docs: <https://optio.host/docs/> and repo `docs/` (`tasks.md`, `reconciliation.md`,
`security-review-2026-10.md`). Code: <https://github.com/jonwiggins/optio> — `apps/{api,web,cli,ios,android}`,
`packages/{shared,agent-adapters,container-runtime,ticket-providers,mcp-bridge}` — *inferred from code* (tree at pin).

**Topics 1–12.**

1. **User interaction** — web "Work" feed with a `needs_you` queue, iOS and Android apps, Slack trigger; no
   coordinator AI that writes a spec — *documented* README:17,66, `docs/tasks.md:67-76`. Coordinator: unknown, not
   found in README or `tasks.md`.
2. **CLI** — `apps/cli` (commander), for example `task review <id>` posts to `/api/tasks/:id/review` — *inferred from
   code* `apps/cli/src/commands/task/review.ts:7-14`.
3. **Flow** — trigger (15 types incl. ticket, GitHub, GitLab, Linear, Jira) → worktree in pod → PR → PR watcher
   (CI, review, merge) → optional review agent → resume on CI failure / conflict / changes requested → done on
   merge — *documented* README:34, `docs/tasks.md:99-102`.
4. **Roles and prompts** — run kinds `repo | standalone | pr-review | persistent-agent` — *inferred from code*
   `packages/shared/src/reconcile/types.ts:22`. Prompt templates by kind `prompt | review | job | task`, with
   repo → workspace → deployment → built-in precedence — *documented* `docs/tasks.md:151`.
5. **Handoff** — each PR a `task_prs` row; the primary PR drives watcher, review, resume and merge — *documented*
   `docs/tasks.md:115`. The agent resumes on the same task with feedback — *documented* README:25.
6. **Review** — review is a subtask with `blocksParent: true` and its own agent type and prompt template —
   *inferred from code* `apps/api/src/services/review-service.ts:125-131,136-139`. Launched on PR open or on CI
   pass — *inferred from code* `packages/shared/src/reconcile/reconcile-repo.ts:499-518`. Auto-merge when checks pass,
   not draft, no changes requested and `cautiousMode` off — *inferred from code* `reconcile-repo.ts:521-533`. Note:
   agent-factory never merges; Optio can.
7. **Plugins** — per-work connections, MCP servers, skills and setup commands — *documented* `docs/tasks.md:57`.
8. **Adapters** — agent adapters (8 CLIs) — *inferred from code* `packages/agent-adapters/src/index.ts:2-32`.
   Ticket providers GitHub, GitLab, Jira, Linear, Notion — *inferred from code* `packages/ticket-providers/src/*.ts`.
   Repo platforms GitHub, GitLab, AWS CodeCommit — *documented* README:34.
9. **Internals** — Kubernetes-style reconcile loop: observe, pure decision function, one typed action, applied by
   compare-and-swap — *documented* `docs/reconciliation.md:3`; *inferred from code* `reconcile-repo.ts:11-18`
   ("No I/O, no DB, no clock"). Closest analogue to agent-factory's fixed step table.
10. **Security** — pods share the host kernel; work in one pool is mutually trusted; worktrees are not isolation —
    *documented* `docs/security-review-2026-10.md:24,29`. Pods get owner/workspace-scoped git credentials through a
    helper — *documented* same file :12. So the run has git access, unlike agent-factory's no-login run (trait C).
11. **Docs** — product site docs, repo `docs/*.md`, `AGENTS.md` for contributors — *documented* README:111-126.
12. **Stack** — see the table above.

## 2. OpenAI Symphony — full profile

**What, who, licence.** A spec plus a reference implementation that turns tracker work into isolated, autonomous
implementation runs, "so teams manage work instead of supervising coding agents" — *documented*
([README](https://github.com/openai/symphony/blob/be10a1b79df723d6d7612b5651c8522704dafb2e/README.md), lines 3-4).
An "engineering preview for testing in trusted environments" — *documented* README. The Elixir build is "prototype
software intended for evaluation only" — *documented* `elixir/README.md:6-8`. Apache-2.0 — *documented* README;
GitHub API. Created 2026-02-26, ~28k stars. OpenAI's announcement page
(<https://openai.com/index/open-source-codex-orchestration-symphony/>) returned 403: unread.

**Stack.**

| part | value | evidence |
|---|---|---|
| language | Elixir/OTP (orchestrator is a GenServer) | *inferred from code* `elixir/lib/symphony_elixir/orchestrator.ex:6` |
| runtime | single service, self-contained Burrito binaries; optional Phoenix LiveView dashboard + JSON API | *documented* `elixir/README.md:77-80,119` |
| storage | none required; recovery from tracker + filesystem; in-memory scheduler state | *documented* `SPEC.md:57-58` |
| queue | in-memory poll tick + retry queue with backoff | *documented* `SPEC.md:640-676,790` |
| sandbox | Codex's own sandbox (`workspace-write` by default) inside a per-issue directory; optional SSH workers | *documented* `elixir/README.md:158-161`, `SPEC.md:2252-2286` |
| LLM providers | Codex app-server only (OpenAI models) | *documented* `SPEC.md:148`; *inferred from code* `elixir/lib/symphony_elixir/codex/app_server.ex:1-3` |

**Docs and code.** Spec: `SPEC.md` (2,312 lines). Implementation: `elixir/`. Agent skills: `.codex/skills/`
(commit, push, pull, land, linear, debug, release) — *inferred from code* (tree at pin).

**Topics 1–12.**

1. **User interaction** — none with an AI; the human works the tracker board (states such as `Todo`,
   `Human Review`, `Merging`, `Rework`) and reads the PR — *documented* `elixir/WORKFLOW.md:110-115`. Coordinator AI:
   none found in SPEC.md or the Elixir README.
2. **CLI** — `./bin/symphony ./WORKFLOW.md` with `--logs-root` and `--port` — *documented* `elixir/README.md:108-119`.
3. **Flow** — poll tracker → claim → per-issue workspace → Codex turns (up to `max_turns`) → PR → `Human Review`
   → human moves to `Merging` → agent runs the `land` skill; `Rework` loops back — *documented* `SPEC.md:16-20`,
   `elixir/WORKFLOW.md:105-129,244-253`.
4. **Roles and prompts** — one role, the implementer; prompt is the Markdown body of repo-owned `WORKFLOW.md`,
   rendered per issue — *documented* `SPEC.md:318-355,493`.
5. **Handoff** — handoff is a tracker state plus a "workpad" comment on the issue; continuation turns resend only
   guidance on the same thread — *documented* `SPEC.md:662-672`, `elixir/WORKFLOW.md:124`.
6. **Review** — no separate reviewer run; the implementer must clear every human or bot PR comment before
   `Human Review` and does a "principal-style self-review" of its plan — *documented* `elixir/WORKFLOW.md:162,173-180`.
7. **Plugins** — Codex skills in the repo (`.codex/skills/*`) and workspace hooks (arbitrary shell from
   `WORKFLOW.md`, fully trusted) — *documented* `elixir/README.md:45`, `SPEC.md:1760-1769`.
8. **Adapters** — tracker adapter contract; shipped: Linear, GitHub Issues, Jira Cloud, Asana, GitLab, each with a
   host-side agent tool — *documented* `SPEC.md:1179-1230`, `elixir/README.md:16-25`; *inferred from code*
   `elixir/lib/symphony_elixir/{linear,github,gitlab,jira,asana}/adapter.ex`.
9. **Internals** — the orchestrator is the only writer of scheduling state; claim states and 11 run-attempt phases
   with distinct terminal reasons — *documented* `SPEC.md:635-693`. Workflow reloads apply live — *documented*
   `SPEC.md:560-579`.
10. **Security** — the spec mandates no sandbox or approval posture; implementations must document theirs —
    *documented* `SPEC.md:30-34,1065-1072`. Tracker tokens are unset in the Codex child — *inferred from code*
    `elixir/lib/symphony_elixir/codex/app_server.ex:207,240-251`. Workspace path must stay under root — *documented*
    `SPEC.md:1734-1740`. The agent pushes and runs `gh` itself (git creds on the host are reachable) — *documented*
    `elixir/WORKFLOW.md:191-192`. Approval or user-input requests mark the issue blocked, never stall — *documented*
    `elixir/README.md:33-36`.
11. **Docs** — one normative spec ("implement Symphony in a language of your choice") plus an Elixir README — *documented*
    README.
12. **Stack** — see the table above.

## 3–5. One line each

- **Factory.ai (Droids)** — closed SaaS. Workstreams: "an orchestrator that splits [a project] across a team of
  agents", you talk to the orchestrator, agents report back, work returns as PRs
  ([docs](https://docs.factory.com/workstreams/overview.md)). Spec Mode blocks edits until you approve the plan
  ([docs](https://docs.factory.com/autonomy-and-safety/specification-mode.md)); Missions plan with you, then run
  after approval ([docs](https://docs.factory.com/missions/overview.md)). Automated PR review
  ([docs](https://docs.factory.com/automations/code-review-ci.md)); Linear, Jira and Slack delegations; OS sandbox;
  BYOK models ([index](https://docs.factory.com/llms.txt)). Stack internals: unknown (closed source).
- **GitHub Copilot coding agent** — closed. Assign an issue like a teammate, then it opens a draft PR
  ([troubleshoot](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/troubleshoot-coding-agent));
  runs on an Actions runner or a cloud sandbox, 59-minute cap, GitHub only, Copilot code review is separate
  ([about](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)); firewall on by
  default ([firewall](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-firewall));
  workflows on its PRs wait for "Approve and run workflows" (same troubleshoot page).
- **OpenHands** — MIT (GitHub API). Now "Agent Canvas", a self-hosted control center that runs OpenHands, Claude
  Code, Codex and other ACP agents on local, Docker or VM backends, with automations for Slack, GitHub, Linear
  ([README](https://github.com/OpenHands/OpenHands)). `@openhands` mention or `openhands` label starts a job;
  `@openhands /codereview` runs a review skill that can approve or request changes
  ([docs](https://docs.openhands.dev/enterprise/integrations/github)). Note: its review can approve — agent-factory
  forbids that.

## The rest — one line each

| candidate | what it is | why not top 5 | source |
|---|---|---|---|
| OpenAI Codex cloud | closed; per-task cloud workspace, network allowlist, you open the PR; `@codex review` posts GitHub reviews using `AGENTS.md` rules | no orchestrator or gated flow; Symphony is OpenAI's orchestration layer over it | [cloud](https://learn.chatgpt.com/docs/cloud), [review](https://developers.openai.com/codex/integrations/github) |
| Claude Code GitHub Actions / Agent SDK | MIT action on GitHub runners; `@claude` mention or a `prompt` on any event; review workflow posts inline comments; write-access and human-actor checks | a building block, not a flow; agent-factory already sits on Claude Code | [docs](https://code.claude.com/docs/en/github-actions) |
| Cursor cloud agents | closed; isolated cloud VMs; start from desktop, web, Slack, Linear, API or `@cursor`; GitHub, GitLab, Bitbucket, Azure DevOps; PRs with artifacts | single agent per task; Bugbot review not on that page | [docs](https://cursor.com/docs/background-agents) |
| Google Jules | closed; plan first, you approve, runs in a VM, reads `AGENTS.md`; CLI and API; `jules` label on an issue | single agent; PR behaviour only from launch coverage | [docs](https://jules.google/docs), [blog](https://developers.googleblog.com/meet-jules-tools-a-command-line-companion-for-googles-async-coding-agent/) |
| Amp | closed; coding agent with CLI, shared threads, per-thread machines ("Orbs") | no ticket→PR flow or review found on the manual page | [manual](https://ampcode.com/manual) |
| SWE-agent | MIT, Python; research agent that tries to fix one GitHub issue | no orchestration, no gates | [repo](https://github.com/SWE-agent/SWE-agent) |
| Sweep | repo now "AI coding assistant for JetBrains"; last push 2025-09 | pivoted away from issue→PR | [repo](https://github.com/sweepai/sweep) |

**2026 entrants seen, not read.** A curated list names many ticket-to-PR factories with gates, such as Gas Town,
Multica, DoorDash Agentic Orchestrator, vercel-labs eve Software Factory Template, LangChain Open SWE, Cyrus, Kiro
Crew and Squid ([awesome-software-factories](https://github.com/varun1505/awesome-software-factories)). Unknown:
each was found only through that list, not read at source. A later pass can scan DoorDash Agentic Orchestrator
(gated phases from research to PR) and eve (classifier, analyst, implementer, reviewer roles) if round 1 wants more
peers.

## Sources

- Optio repo at `8d116d8`: <https://github.com/jonwiggins/optio/tree/8d116d80c45d3ebc15776672e0028b80fb439ec9>
- Symphony repo at `be10a1b`: <https://github.com/openai/symphony/tree/be10a1b79df723d6d7612b5651c8522704dafb2e>
- Factory docs index: <https://docs.factory.com/llms.txt>
- GitHub Copilot coding agent docs: links above
- OpenHands: <https://github.com/OpenHands/OpenHands>, <https://docs.openhands.dev/enterprise/integrations/github>
- Codex: <https://learn.chatgpt.com/docs/cloud>, <https://developers.openai.com/codex/integrations/github>
- Claude Code GitHub Actions: <https://code.claude.com/docs/en/github-actions>
- Cursor: <https://cursor.com/docs/background-agents>
- Jules: <https://jules.google/docs>
- Amp: <https://ampcode.com/manual>
- awesome-software-factories: <https://github.com/varun1505/awesome-software-factories>
