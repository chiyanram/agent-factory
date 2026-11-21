# #835 — Profile: Optio

Map: #826. Starts from #832's Optio profile (`832-alternatives.md` §1). Read on 2026-11-20.

Sources:
- Repo `jonwiggins/optio` at HEAD **`8d116d80c45d3ebc15776672e0028b80fb439ec9`** (2026-11-19, "fix(scripts): no
  coverage thresholds on check:push's narrowed unit run"). Same sha #832 read. 1418 commits. Blobless clone, read
  only, no code or build tool run.
- Docs site https://optio.host/docs/ (not fetched; the repo `docs/` is read instead).

Marks: **D** = *documented* (link or repo doc `file:line`); **C** = *inferred from code* (`file:line` at `8d116d8`);
**unknown** = not found, with the reason. Repo paths are relative to the repo root.

## What it is

| fact | mark |
|---|---|
| "Self-hosted orchestration for coding agents, automated workflows, and interactive sessions", on your Kubernetes cluster or your own machines | D: `README.md:5` (https://github.com/jonwiggins/optio) |
| One "Work" feed for repo tasks, jobs, schedules, events, local sessions and persistent agents | D: `README.md:17,23-32`; `docs/tasks.md:3` |
| For teams that self-host: workspaces, admin/member/viewer roles, OAuth/OIDC, PATs | D: `README.md:91` |
| Author: Jon Wiggins (1259 of 1418 commits); first commit 2026-03-19 | C: `git log` at pin |
| Open source, MIT | D: `LICENSE:1-3`, `README.md:128` |
| Correction to #832: it **has** a conversational front end, "Optio Agent". It drafts a work item through the controller MCP; a human approves a review card; it writes no spec | D: `docs/optio-assistant.md:3-12` |

## Stack

| part | what | mark |
|---|---|---|
| Language | TypeScript (pnpm/turbo monorepo); Swift iOS and Kotlin Android clients | D: `README.md:126`; C: `pnpm-workspace.yaml`, `apps/{ios,android}` |
| Runtime | Next.js web + Fastify API (one combined replica set), Kubernetes worker pods; "Optio Local" daemon on paired machines | D: `README.md:86,90,126` |
| Storage | PostgreSQL (Drizzle schema) | D: `README.md:126`; C: `apps/api/src/db/schema.ts` |
| Queue | Redis / BullMQ (`taskQueue`, `workflowRunQueue`) | D: `README.md:126`; C: `apps/api/src/services/reconcile-executor.ts:383,436` |
| Sandbox | Pod per repo with a git worktree per run; seam `packages/container-runtime` (docker, kubernetes, process, fake). Agents run with permission checks off: "The pod is the sandbox" | C: `apps/api/src/workers/task-worker.ts:1651-1652,1669-1672`; D: `docs/tasks.md:94-95` |
| LLM providers | None called directly for work; via the chosen agent CLI: Claude Code, Codex, Copilot, Gemini, Cursor, OpenCode, Pi, OpenClaw; optional LiteLLM proxy | D: `README.md:19,120`; C: `packages/agent-adapters/src/index.ts:2-16` |

## Where docs and code live

- Docs: https://optio.host/docs/ ; repo `docs/*.md` (38 guides: `tasks.md`, `reconciliation.md`, `pull-requests.md`,
  `optio-assistant.md`, `persistent-agents.md`, `usage.md`, `security-review-2026-10.md`,
  `security-audit-2026-10-26.md`, …) — C: tree at pin.
- Code: `apps/{api,web,cli,ios,android,site}`, `packages/{shared,agent-adapters,container-runtime,ticket-providers,mcp-bridge}`,
  `helm/optio` — C: tree at pin.

## Topics 1–14

Focus topics (#833) are 3, 4, 5, 10.

1. **User interaction** — web Work feed with a `needs_you` status sorted first, iOS/Android apps, Slack trigger
   (D: `docs/tasks.md:63-76`, `README.md:66`); "Optio Agent" chat drafts work and asks before each write
   (D: `docs/optio-assistant.md:3-12`). No spec or grilling step: unknown elsewhere, not found in `docs/`.
2. **CLI** — `apps/cli` commands `login`, `apply`, `export`, `task {new,list,show,logs,message,retry,review,cancel}`,
   `local`, `repo`, `secret`, `session`, `workspace` (C: `apps/cli/src/commands/`, `commands/task/`); `task review`
   posts to `/api/tasks/:id/review` (C: `apps/cli/src/commands/task/review.ts:7-14`).
3. **Flow + state machine** — trigger → pod + worktree → agent opens PR and stops → PR watcher (CI, review, merge)
   → review agent → auto-resume on CI fail / conflict / changes requested (cap `OPTIO_MAX_AUTO_RESUMES`, default 10)
   → done on merge (D: `docs/tasks.md:94-102`; C: `apps/api/src/db/schema.ts:451`). States
   `pending → queued → provisioning → running → pr_opened → completed`, plus `waiting_on_deps`, `needs_attention`,
   `failed`, `cancelled` (C: `packages/shared/src/utils/state-machine.ts:3-26`). Optional planning mode: first run
   only plans, then `needs_attention`/`plan_review` waits for a human (C: `apps/api/src/workers/task-worker.ts:440-441,1249-1256`;
   `packages/shared/src/prompt-template.ts:7-20`).
4. **Roles + prompts** — built-in roles: implementer, PR reviewer (posts its verdict), PR-review assistant (writes
   `.optio/review-draft.json` only) (C: `packages/shared/src/prompt-template.ts:7,169,229`). Implementer prompt
   says write tests first, open the PR itself with `gh`/`glab`/`aws`, stay in scope (C: same file `:33-44,99-127,146-157`).
   Templates in `prompt_templates` by kind `prompt|review|job|task`; precedence repo → workspace → deployment →
   hardcoded (D: `docs/tasks.md:151`). Multi-role teams only as a demo of persistent agents (architect, implementer,
   reviewer, scribe) (D: `examples/persistent-agents/forge/README.md:6-13`).
5. **Handoff** — task body goes in `.optio/task.md` (C: `prompt-template.ts:167`); PRs tracked in `task_prs`, the
   primary PR drives watcher/review/resume/merge (D: `docs/tasks.md:108-115`). Resume reuses the agent's native
   session id unless a fresh session is needed, with a prompt built from review comments and failed-job logs
   (C: `apps/api/src/services/reconcile-executor.ts:392-441`).
6. **Review** — review is a subtask with `blocksParent: true` and its own agent type and template
   (C: `apps/api/src/services/review-service.ts:125-139`); launched on PR open or CI pass
   (C: `packages/shared/src/reconcile/reconcile-repo.ts:498-518`). Reviewer runs `gh pr review --approve` itself
   (C: `prompt-template.ts:208-209`). Auto-merge when checks pass or none, not draft, no changes requested, blocking
   subtasks done, `cautiousMode` off (C: `reconcile-repo.ts:521-533`). So a model approval can lead to a merge with no human.
7. **Plugins** — no plugin system found; per-work connections (encrypted credentials, MCP servers, env), skills
   and setup commands (D: `docs/tasks.md:57`, `docs/connections.md`). A code plugin seam: unknown, not found in tree.
8. **Adapters** — agent adapters for 8 CLIs (C: `packages/agent-adapters/src/index.ts:2-16`); ticket providers
   GitHub, GitLab, Jira, Linear, Notion (C: `packages/ticket-providers/src/`); repo platforms GitHub, GitLab,
   CodeCommit (D: `README.md:34`); 15 trigger types (D: `docs/tasks.md:139`).
9. **Internals** — K8s-style reconcile: observe a `WorldSnapshot`, pure decision ("No I/O, no DB, no clock"), one
   typed action, applied with compare-and-swap (D: `docs/reconciliation.md:3`; C: `reconcile-repo.ts:11-18`,
   `reconcile-executor.ts:405-406`). Decisions split per kind: repo, standalone, pr-review, persistent-agent
   (C: `packages/shared/src/reconcile/`).
10. **Security** — agents run with `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox` /
    `--yolo` (C: `task-worker.ts:1652,1672,1680`). Pods get a git credential helper scoped to owner, workspace and
    one repo; the signing key stays in the API (C: `apps/api/src/services/git-credential-scope.ts:6-32`; D:
    `docs/security-review-2026-10.md:12`). So the run holds a git-host token. Separate agent service account, no
    automounted K8s token (D: same file `:14`). Pods share the host kernel; work in one pool is mutually trusted
    (D: same file `:21-32`). Default-deny NetworkPolicy exists but is off by default; when on, egress 80/443 to any
    public host (C: `helm/optio/values.yaml:290-291`, `helm/optio/templates/network-policy.yaml:1-11`).
11. **Docs** — product site, 38 repo guides, `AGENTS.md`/`CLAUDE.md` for contributors, dated security review and
    audit docs (D: `README.md:111-126`; C: `docs/` tree).
12. **Stack** — see the Stack table.
13. **Cost and limits** — `usage_ledger` with tokens and cost per run kind; monthly budgets per org/person/work,
    token or dollar, "Pause new work" holds queued runs (admission control, not a billing ceiling) (D:
    `docs/usage.md:22-62`). `--max-turns` per run (C: `task-worker.ts:1657`); concurrency defaults 2 per repo
    (C: `schema.ts:431`); auto-resume cap 10 (C: `schema.ts:451`).
14. **Evals and learning** — unknown: no eval set, golden review set or lessons loop found in `docs/` or the tree
    (only a UI golden fixture, `apps/android/.../work-feed-web-golden.txt`). The one memory found is a persistent
    agent's own `MEMORY.md` and journals (D: `docs/persistent-agents.md:3,126`).

## Unknowns

- Docs site https://optio.host/docs/ not fetched; claims use repo `docs/` at the pin.
- Spec gate or grilling: not found in `docs/` or prompts.
- Plugin seam for third-party code: not found.
- Evals of the reviewer or the implementer: not found.
