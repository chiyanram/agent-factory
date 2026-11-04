# Lead + workers in shipping coding-agent products — product mechanics

Researched 2026-10-18. Primary sources only (vendor docs / vendor eng blogs). Docs pages have no date → "f" = fetched 2026-10-18.
Companion to `64e-industry.md` (principles); this file = how each product actually wires it. Quotes ≤15 words.

## Sources

| key | URL | date |
|---|---|---|
| CC-TEAM | code.claude.com/docs/en/agent-teams | f |
| CC-SUB | code.claude.com/docs/en/sub-agents | f |
| CC-AV | code.claude.com/docs/en/agent-view | f |
| CC-WT | code.claude.com/docs/en/worktrees | f |
| CC-PAR | code.claude.com/docs/en/agents (compare parallel approaches) | f |
| CC-HL | code.claude.com/docs/en/headless | f |
| CC-WEB | code.claude.com/docs/en/claude-code-on-the-web | f |
| CC-ENV | code.claude.com/docs/en/cloud-environments | f |
| CC-SH | code.claude.com/docs/en/self-hosted-environments | f |
| CC-PROJ | code.claude.com/docs/en/claude-projects | f |
| CC-RT | code.claude.com/docs/en/routines | f |
| CC-GL | code.claude.com/docs/en/gitlab-ci-cd | f |
| CC-HK | code.claude.com/docs/en/hooks | f |
| CC-MS | code.claude.com/docs/en/managed-settings | f |
| CC-SDK | code.claude.com/docs/en/agent-sdk/overview | f |
| CDX-CL | learn.chatgpt.com/docs/cloud ; /docs/environments/cloud-environment | f |
| CDX-SEC | learn.chatgpt.com/docs/agent-approvals-security | f |
| CDX-SUB | learn.chatgpt.com/docs/agent-configuration/subagents.md | f |
| CDX-GL | learn.chatgpt.com/docs/third-party/gitlab (changelog: launched 2026-08-19) | f (search summary) |
| GH-ABT | docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent | f |
| GH-ENV | docs.github.com/.../coding-agent/customize-the-agent-environment | f |
| GH-FW | docs.github.com/.../coding-agent/customize-the-agent-firewall | f |
| GH-RISK | docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations | f |
| GH-PR | docs.github.com/.../coding-agent/create-a-pr | f |
| CUR | cursor.com/docs/cloud-agent ; /cloud-agent/capabilities ; /cloud-agent/setup | f |
| DEV-ENV | docs.devin.ai/onboard-devin/environment ; /environment-yaml | f |
| DEV-ADV | docs.devin.ai/work-with-devin/advanced-capabilities | f |
| DEV-USE | docs.devin.ai/essential-guidelines/when-to-use-devin ; /admin/billing/usage | search summary |
| FAC-MA | factory.com/news/missions-architecture | 2026-04-10 |
| FAC-EX | docs.factory.ai/droid-exec/overview ; /reference/cli-reference ; /missions/planning | search summary |
| AMP-ORB | ampcode.com/notes/putting-an-agent-in-an-orb (Thorsten Ball) | 2026-07-02 |
| AMP-SP | ampcode.com/docs/cli/spawning-orbs ; ampcode.com/manual | f |
| JUL | jules.google/docs/environment ; /docs/review-plan ; developers.google.com/jules/api | search summary |
| GL-DUO | docs.gitlab.com/user/project/merge_requests/developer/ (Developer Flow, GA 18.8) | search summary |

---

## Claude Code (Anthropic) — five ways, three placements

| | Local: subagents / agent teams | Local: agent view (`claude --bg`) | Cloud: sessions, Projects, routines, GitLab CI |
|---|---|---|---|
| Assign | Lead calls Agent tool; teams share a task list (pending/in-progress/done, deps), lead assigns or teammates "self-claim" via file lock (CC-TEAM) | You dispatch prompts from `claude agents`; no lead (CC-AV) | `claude --cloud "<task>"`, web, mobile; Projects = coordinator conversation that "decides what becomes a thread" (CC-PROJ); routines fire on schedule/API/GitHub PR event (CC-RT); GitLab: `@claude` note → pipeline (CC-GL) |
| Isolate | Subagent: own context; `isolation: worktree` optional (CC-SUB). Teammates: **no worktree** — "partition the work" by files (CC-PAR) | Each bg session "moves into its own git worktree" before editing (CC-AV); worktree session blocks edits/git into main checkout (CC-WT) | Anthropic VM per session, 4 vCPU/16 GB/30 GB (CC-ENV); self-hosted runner on your host, outbound-poll only (CC-SH); GitLab = your runner container (CC-GL) |
| Setup / toolchain | Fresh worktree needs deps; `.worktreeinclude` copies gitignored `.env` etc. (CC-WT) | same | Setup script → filesystem snapshot if it finishes in ~5 min, cache ~7 days; SessionStart hook for per-session `npm install`/services; preinstalled JDK 21, Maven, Gradle, Docker, Postgres 16, Redis 7 (CC-ENV) |
| Rules load | Teammates load CLAUDE.md, MCP, skills; get spawn prompt, **not** lead's history (CC-TEAM). Subagent in worktree takes instruction files from main conversation, not the worktree (CC-WT) | same as interactive | Repo CLAUDE.md, `.claude/rules`, skills, agents, settings hooks come with clone; user `~/.claude/*` and repo-enabled plugins do **not** (CC-ENV) |
| Status / ask human | Idle notification carries final answer; teammate permission prompts bubble to lead (CC-TEAM) | Rows: Needs input / Working / Completed / Ready for review; hooks `agent_needs_input`, `agent_completed` (CC-AV) | Overview pane: ready for review / waiting on you / working (CC-PROJ); `claude -p "msg" --cloud <id>` queues a follow-up from any machine (CC-WEB) |
| Verify | Hooks: `TaskCompleted`/`TeammateIdle`/`SubagentStop`/`Stop` exit 2 = refuse completion (CC-HK) | your hooks | Auto-fix watches PR: "pushes a fix if one is clear" on CI fail/review comment (CC-WEB) |
| Merge | You | You | You; thread offers a "Merge it" button that sends you-authored instruction (CC-PROJ) |
| Limits documented | Teams experimental, env flag; no resume of in-process teammates; "Task status can lag"; one team/session; no nested teams; lead "starts implementing tasks itself"; lead stops early; ~linear token cost; `-p`/SDK never spawns teammates (CC-TEAM) | Research preview; local only, stops on shutdown; idle unattached sessions stopped ~1 h (CC-AV) | Clone/PR **require GitHub**; GitLab only as bundle that "can't push results back" (CC-WEB); Projects Pro/Max only, not CLI (CC-PROJ); sandbox resume can lose uncommitted work (CC-PROJ); green routine run ≠ task succeeded (CC-RT); GitLab CI integration beta, maintained by GitLab (CC-GL) |

Plumbing that makes this scriptable:
- `claude -p` exits non-zero on failure; `--output-format json|stream-json`, `--json-schema`; `--bare` skips CLAUDE.md/hooks/plugins discovery for reproducible CI; `--permission-prompts none` denies anything that would prompt (CC-HL).
- Gotcha: without `--bare`, `-p` "runs the hooks in a project's `.claude/settings.json`" even untrusted, no trust dialog (CC-HL).
- `-p` worktrees are not auto-cleaned; lock stays until a later sweep (CC-WT).
- Managed policy = `/etc/claude-code/managed-settings.json` (+ `managed-settings.d/`), above every other level; locks like `allowManagedHooksOnly`, `disableBypassPermissionsMode` (CC-MS). Works on a single box you own.
- Agent SDK = same loop as a library; third parties may not use claude.ai login for SDK products (CC-SDK).
- `/batch` = 5–30 worktree-isolated subagents for one large change (CC-PAR).

## OpenAI Codex

| | CLI (local) | Codex cloud |
|---|---|---|
| Assign | Prompt; subagents when asked or when AGENTS.md/skill "request delegation" (CDX-SUB) | Web/app/CLI task; `@codex` comment on GitHub PR/GitLab MR starts a task (CDX-GL) |
| Isolate | OS sandbox: Seatbelt (macOS), bwrap+seccomp (Linux); modes read-only / workspace-write / danger-full-access (CDX-SEC). Subagents share workspace; docs warn of write conflicts, worktree not stated (CDX-SUB) | "isolated OpenAI-managed containers" (CDX-SEC) |
| Setup | Your machine | `universal` image; setup script with internet; maintenance script on cache resume; cache "up to 12 hours" (CDX-CL) |
| Rules | AGENTS.md (see 64e D1); custom agents in `.codex/agents/*.toml` | same; review rules from closest AGENTS.md `## Code Review Rules` (CDX-GL) |
| Status / ask | Approvals from inactive agent threads labelled by source; non-interactive → needs-approval actions fail back to parent (CDX-SUB) | Inspect diff, follow-up, then "open a pull request when you're ready" (CDX-CL) |
| Verify | `approvals_reviewer = "auto_review"` reviewer agent, "fail closed" (CDX-SEC) | `@codex review`; GitHub posts only P0/P1 findings (CDX-GL) |
| Merge | You | You |
| Limits | Subagents: more tokens, write conflicts, custom agents can't override sandbox (CDX-SUB) | Agent-phase internet off by default; secrets "only available to setup scripts" (CDX-CL); GitLab beta lacks create-PR controls (CDX-GL) |

## GitHub Copilot coding agent ("cloud agent")

| | |
|---|---|
| Assign | Issues, agents tab, chat, failing Actions run, CLI, REST API, MCP, Jira/Slack/Teams/Linear/Azure Boards; schedule/event automations (GH-PR) |
| Isolate | "ephemeral cloud development environment" (GH-ABT) on an Actions runner: default Ubuntu, larger runners, or self-hosted ARC (GH-ENV) |
| Setup | `.github/workflows/copilot-setup-steps.yml`, one job named `copilot-setup-steps`, max 59 min; failed step → skips rest and starts anyway (GH-ENV) |
| Rules | Custom instructions, custom agents, skills, hooks, MCP (GH-ABT) |
| Status / ask | Session logs; one PR per task; you can review before PR exists (GH-ABT) |
| Verify | Actions don't run until a write-user clicks "Approve and run workflows" (GH-RISK); Copilot code review optional |
| Merge | Human only: agent can't mark Ready, approve, or merge; pushes only to a `copilot/` branch (GH-RISK) |
| Limits | One repo per task; GitHub-hosted repos only; session cap "cannot be extended or bypassed" (GH-ABT); firewall doesn't cover MCP or setup steps; "Sophisticated attacks may bypass the firewall" (GH-FW); firewall "not compatible with self-hosted runners" (GH-ENV) |

## Cursor Cloud Agents (ex-background agents)

| | |
|---|---|
| Assign | Desktop, cursor.com/agents, mobile, Slack, Linear, `@cursor` on GitHub/Bitbucket PR/issue, API; no GitLab trigger listed (CUR) |
| Isolate | "isolated VMs in the cloud", full desktop; optional self-hosted worker (CUR) |
| Setup | `.cursor/environment.json`: snapshot or Dockerfile + `install`; a Build bakes a bootable snapshot; until first good Build agents use default image; secrets injected at agent start, not in Build (CUR) |
| Rules | Not stated on page; hooks from `.cursor/hooks.json` (CUR) |
| Status / ask | Remote-desktop takeover; screenshots/video attached to PR (CUR) |
| Verify | Agent runs app + clicks UI before PR; auto CI-fix GitHub Actions only, stops after 10 follow-ups (CUR) |
| Merge | Not stated; agent opens PR (CUR) |
| Limits | API-priced, spend limit required; PR artifact URLs "public and unauthenticated" when embedded (CUR) |

## Devin (Cognition)

| | |
|---|---|
| Assign | Web, Slack/Teams tag, API; lead Devin "delegates to managed Devins when it makes sense" (DEV-ADV) |
| Isolate | Every session and every child: "its own isolated VM" (DEV-ADV) |
| Setup | Blueprint YAML (`initialize` / `maintenance` / `knowledge`) → build → snapshot; one active snapshot per org; pin a prior build on regression (DEV-ENV) |
| Rules | Knowledge (org-wide notes), per-repo `knowledge` commands, Playbooks (DEV-ENV, DEV-ADV) |
| Status / ask | Coordinator woken when a child finishes or needs input, "even if it is asleep"; can pause/kill children, track ACUs (DEV-ADV) |
| Verify | Devin Review + auto-fix on CI/comments; enterprise docs still advise human review + branch protection (DEV-USE) |
| Merge | Human |
| Limits | Child sessions auto-approved by default (toggle off to review) (DEV-ADV); split big work, short sessions; older note: performance degrades in long sessions (DEV-USE) |

## Factory (Droids, Missions)

| | |
|---|---|
| Assign | `droid exec` one-shot; Missions = orchestrator → features/milestones → workers; asks clarifying Qs before execution (FAC-MA) |
| Isolate | Not stated; workers spawned per feature "in order" (serial), fresh context each (FAC-MA) |
| Setup | `services.yaml` + scripts to stand up/mock deps for QA validators (FAC-MA, FAC-EX) |
| Rules | AGENTS.md + `validation-contract.md`, `features.json`, knowledge base (FAC-MA) |
| Status / ask | Blocked → "halts the mission and hands control back to the user" (FAC-MA) |
| Verify | Validation contract written before features; fresh scrutiny + user-testing validators per milestone; validators report, orchestrator makes fix features (FAC-MA) |
| Merge | Human (not stated otherwise) |
| Limits | Context dilution; self-evaluation bias; Slack-clone run: 21 fix features = 34.4% of work, 2–4 validation rounds/milestone; `exec` default read-only, `--auto low/medium/high` (FAC-MA, FAC-EX) |

## Sourcegraph Amp

| | |
|---|---|
| Assign | Thread prompt; `amp -x` execute mode; `amp -ox` runs agent in an orb "on Amp's servers" and returns thread URL (AMP-SP) |
| Isolate | Orb: Debian 12 remote machine, sleeps/wakes, snapshotted after setup (AMP-ORB) |
| Setup | `.agents/setup` (Amp's own: 428 lines) + `.agents/resume` on every wake (AMP-ORB) |
| Rules | AGENTS.md ancestors always, subtree on read; CLAUDE.md fallback (AMP-SP manual); Amp repo has 41 AGENTS.md (AMP-ORB) |
| Status / ask | Thread URL from any device; `amp sync` pulls orb changes local (AMP-SP) |
| Verify | Dev-server skill, `/__dev/preflight`, single grep-able `server.log` (AMP-ORB) |
| Limits | Auth (OAuth/2FA/passkeys) was "a major blocker" → dev-only magic-login routes (AMP-ORB) |

## Google Jules

| | |
|---|---|
| Assign / isolate | Task → "short-lived virtual machine" (JUL) |
| Setup | Repo "Initial Setup" script → snapshot reused; long-running processes not supported in setup (JUL) |
| Rules | Reads root AGENTS.md automatically (JUL) |
| Ask / verify | Plan before code; web UI auto-approves plan on a timer if you leave; API `requirePlanApproval`, PR only with `AUTO_CREATE_PR` (JUL) |

## GitLab Duo Developer Flow (GitLab-native, for comparison)

Assign Duo Developer service account to an issue or click Implement → runs async on **your runner** → draft MR, iterates on review feedback; needs push rule allowing the service account; GA in GitLab 18.8 (GL-DUO).

---

## What every product does the same way

1. **Work unit = one issue/prompt → one branch → one PR/MR.** Copilot one PR/task (GH-ABT); Cursor separate branch (CUR); routines `claude/` branch (CC-RT); Duo draft MR (GL-DUO).
2. **Worker = fresh disposable machine booted from a cached snapshot**, built by a setup script run *before* the agent: Claude ~5 min script → snapshot (CC-ENV), Codex 12 h cache (CDX-CL), Cursor Build (CUR), Devin blueprint (DEV-ENV), Jules (JUL), Amp `.agents/setup` (AMP-ORB). Locally the equivalent is a git worktree (CC-WT, CC-AV).
3. **Setup and agent phases have different powers.** Secrets/internet in setup, restricted in agent phase (CDX-CL, CUR); firewall allowlist by default (GH-FW, CC-ENV).
4. **Rules come from the repo, not the user's machine.** Cloud workers drop `~/.claude` (CC-ENV); AGENTS.md read by Codex, Amp, Jules, Factory.
5. **Worker reports to a status board, not a chat log**: needs-input / working / ready-for-review (CC-AV, CC-PROJ); coordinator woken on child done/blocked (DEV-ADV, CC-TEAM).
6. **Verification = CI on the PR + a separate reviewer, then auto-fix loop** (CC-WEB auto-fix, Devin Review, Cursor CI-fix, `@codex review`). Factory adds a pre-written validation contract judged by fresh agents (FAC-MA).
7. **Human merges. Always.** Hard-enforced only by Copilot (GH-RISK); others by convention + branch protection.
8. **Same documented failures**: lead does work itself / stops early, stale task status (CC-TEAM); parallel writers conflict (CDX-SUB, CC-PAR); long sessions degrade (DEV-USE); self-evaluation bias (FAC-MA); env setup is the #1 friction (GH-ENV, AMP-ORB, CUR).

## What a one-person team on one VM + a laptop could reuse instead of building

Context: GitLab remote, Java/Gradle + Docker. Cloud Projects/routines/`--cloud` push need GitHub (CC-WEB, CC-PROJ) → **not usable as-is**.

| need | reuse | why / caveat |
|---|---|---|
| Queue + N parallel workers on the VM | `claude --bg` + `claude agents` (agent view) on the VM, reached from laptop via SSH/tmux | worktree per session automatic; Needs-input board; hooks `agent_needs_input`/`agent_completed` for notifications (CC-AV). Research preview, local-only |
| Lead that splits + supervises | Agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) for research/review; **subagents with `isolation: worktree`** or `/batch` for parallel edits | teammates share one checkout (CC-PAR); don't use teams for parallel writes |
| Gate "done" | `TaskCompleted` / `SubagentStop` / `Stop` hooks exit 2 running `make verify-module` (CC-HK) | deterministic; no orchestrator code |
| Per-worker env | `.worktreeinclude` for `.env`; SessionStart hook for deps (CC-WT, CC-ENV) | shared Compose stack still a single-tenant resource |
| Issue → MR, headless | GitLab CI job running `claude -p --bare --output-format json` on the VM as a GitLab runner (CC-GL, CC-HL) or GitLab Duo Developer Flow on same runner (GL-DUO) | both GitLab-native, MR + approvals stay GitLab's; CC-GL beta |
| AI review on MR | `@codex review` GitLab beta (CDX-GL) or a `claude -p` review job | advisory only |
| Policy on the VM | `/etc/claude-code/managed-settings.json` with `disableBypassPermissionsMode`, `allowManagedHooksOnly` (CC-MS) | stops a worker editing its own guard hooks |
| Steer from phone | Remote Control on the VM session (CC-SH points single-box users there) | VM must stay up |

Build only what none ships: GitLab-issue → `claude --bg` dispatcher glue, and the "one MR per worktree, human merges" rule (Copilot is the only product that enforces it).

## Not reached / weak

- Codex cloud/GitLab, Devin task-size, Factory exec, Jules, GitLab Duo: from vendor-domain search summaries, not full-page reads.
- Cursor docs page does not say how rules load or who merges. Factory does not state worker isolation.
- Copilot draft-PR/branch details come from GH-RISK; GH-PR page omits them.
