# #836 — Profile: OpenAI Symphony

Map: #826. Prior scan: #832 (`832-alternatives.md`, section 2). Read on 2026-11-20.

Sources:
- Repo `openai/symphony` at HEAD **`be10a1b79df723d6d7612b5651c8522704dafb2e`** (2026-09-15, "ci: publish nightly
  binaries on main pushes"; 47 commits, 132 files). This is the same sha #832 pinned: no new commits since.
  Blobless clone, read only, no code or build tool run.
- The OpenAI announcement page <https://openai.com/index/open-source-codex-orchestration-symphony/> returned 403 to
  #832 and was not read here. Its facts below come from search snippets and one press report, marked **S**
  (secondary), and are not checked against the page itself.

Marks: **D** = *documented* (link or repo doc `file:line` at the sha); **C** = *inferred from code* (`file:line` at
the sha); **S** = secondary report only; **unknown** = not found, with the reason. `SPEC.md` is the repo root spec;
`elixir/…` is the reference build. Link base:
`https://github.com/openai/symphony/blob/be10a1b79df723d6d7612b5651c8522704dafb2e/`.

## What it is

| fact | mark |
|---|---|
| A long-running service: it reads work from an issue tracker, makes a workspace per issue, and runs a coding-agent session in it | D: `SPEC.md:18-20` |
| Goal: "teams manage work instead of supervising coding agents" | D: `README.md:3-4` |
| Two forms: a language-agnostic spec ("Draft v1") that you ask your own agent to implement, plus an "experimental" Elixir reference build | D: `SPEC.md:3`, `README.md:21-35` |
| "Low-key engineering preview for testing in trusted environments"; the Elixir build is "prototype software intended for evaluation only… implement your own hardened version" | D: `README.md:10-11`, `elixir/README.md:6-8` |
| For teams whose codebase has adopted "harness engineering" (tests, agent-friendly structure) | D: `README.md:17-19` |
| Open source, Apache-2.0, "Copyright 2025 OpenAI" | D: `README.md:39-41`, `LICENSE`, `NOTICE` |
| Announced 2026-04-27 by Alex Kotliarskyi, Victor Zhu and Zach Brock; OpenAI teams saw landed PRs rise 500% in three weeks (company figure); OpenAI does not plan to maintain it as a product | S: web search snippets of the announcement; [Help Net Security, 2026-04-28](https://www.helpnetsecurity.com/2026/04/28/openai-symphony-codex-orchestration-linear/) |

## Stack

| part | value | mark |
|---|---|---|
| Language | Elixir/OTP; the orchestrator is one GenServer | C: `elixir/lib/symphony_elixir/orchestrator.ex:1-6` |
| Runtime | One service (`./bin/symphony`), or Burrito single binaries for macOS/Linux arm64/x86_64; needs `codex`, `git` and tracker credentials on the machine | D: `elixir/README.md:65-104` |
| Storage | None. Scheduler state is in memory; restart recovery comes from the tracker and the filesystem | D: `SPEC.md:57-58`, `SPEC.md:725-731` |
| Queue | None outside the process. A poll tick (`polling.interval_ms`, 5 s in the sample) plus an in-memory retry map with timers | D: `SPEC.md:735-752,790-817`; C: `orchestrator.ex:13-14,1233-1242` |
| Sandbox | Codex's own sandbox: `thread_sandbox` default `workspace-write`, turn policy rooted at the issue workspace. No container or VM. Optional SSH workers on other hosts | D: `elixir/README.md:158-171`, `SPEC.md:2252-2312` |
| LLM providers | Codex app-server only (JSON-RPC over stdio); the model is a Codex config value (sample: `gpt-5.5`, `xhigh` effort) | D: `SPEC.md:148,463-491`; C: `codex/app_server.ex:1-3`, `elixir/WORKFLOW.md:34` |
| UI | Optional Phoenix LiveView dashboard and JSON API (`/api/v1/state`, `/api/v1/<id>`, `/api/v1/refresh`) behind `--port` | D: `elixir/README.md:206-207,296-304` |

## Where docs and code live

| what | where | mark |
|---|---|---|
| Normative spec (2,312 lines, 18 sections + SSH appendix) | `SPEC.md` | C |
| Reference build docs | `elixir/README.md`, `elixir/docs/{logging,token_accounting}.md`, `elixir/AGENTS.md` | C |
| Sample policy + prompt | `elixir/WORKFLOW.md` (YAML front matter + Liquid prompt body) | C |
| Orchestrator, runner, Codex client | `elixir/lib/symphony_elixir/{orchestrator,agent_runner,codex/app_server}.ex` | C |
| Tracker adapters | `elixir/lib/symphony_elixir/{linear,github,gitlab,jira,asana}/{adapter,client,agent_tool}.ex`; contract `tracker.ex:22-27` | C |
| Agent skills (Codex) | `.codex/skills/{commit,push,pull,land,linear,debug,release}/SKILL.md` | C |
| Tests | 43 files under `elixir/test/` (ExUnit; live e2e opt-in) | C; D: `elixir/README.md:313-388` |

## Topics 1–14

1. **User interaction** — No AI talks with the human. The human works the tracker board (moves `Backlog`→`Todo`,
   reviews the PR, moves `Human Review`→`Merging` or `Rework`) and reads one "Codex Workpad" comment. D:
   `elixir/WORKFLOW.md:107-130,244-252`. Coordinator AI or spec gate: none found in `SPEC.md` or the READMEs.
2. **CLI** — `symphony [--logs-root <path>] [--port <port>] [path-to-WORKFLOW.md]`; it refuses to start without
   `--i-understand-that-this-will-be-running-without-the-usual-guardrails`. C: `elixir/lib/symphony_elixir/cli.ex:8-9,81,111-126`.
   No sub-commands (no board, handoff, reconcile).
3. **Flow + state machine** — Tick: reconcile → validate → fetch candidates → sort (priority, age, id) → dispatch to
   free slots. D: `SPEC.md:735-775`. Claim states `Unclaimed/Claimed/Running/RetryQueued/Released`; 11 run-attempt
   phases with distinct terminal reasons. D: `SPEC.md:640-692`. A worker runs up to `max_turns` (20) turns on one
   Codex thread, re-checking the tracker state after each; normal exit → 1 s continuation check; failure →
   `min(10 s·2^(n-1), 5 min)` backoff. D: `SPEC.md:660-674,794-800`; C: `agent_runner.ex:89-130`. The ticket's
   workflow states (`Todo`, `In Progress`, `Human Review`, `Merging`, `Rework`, `Done`) are policy in the prompt, not
   code; code knows only `active_states`/`terminal_states`. `Human Review` is left out of `active_states`, so no run
   is dispatched while the human reviews. D: `elixir/WORKFLOW.md:7-17`.
4. **Roles + prompts** — One role: the implementer (Codex). Its prompt is the Markdown body of repo-owned
   `WORKFLOW.md`, rendered strictly (unknown variable or filter fails) with `issue` and `attempt`. D: `SPEC.md:493-516`.
   Continuation turns get a short fixed text, not the full prompt. C: `agent_runner.ex:142-154`. The sample prompt
   (329 lines) routes by ticket state, demands reproduce-first, a plan with acceptance criteria, a "principal-style
   self-review" of the plan, and "do not ask a human to perform follow-up actions". D: `elixir/WORKFLOW.md:42-293`.
5. **Handoff** — Between runs: tracker state + one persistent `## Codex Workpad` comment (plan, acceptance criteria,
   validation, notes, confusions) edited in place; the workspace directory is kept across runs. D:
   `elixir/WORKFLOW.md:86-87,142-169,295-329`, `SPEC.md:52`. Between turns: the same Codex thread. D: `SPEC.md:664-671`.
   `Rework` is a full reset: close the PR, delete the workpad, fresh branch. D: `elixir/WORKFLOW.md:253-263`.
6. **Review** — No separate reviewer run. The implementer sweeps every human or bot PR comment and treats each as
   blocking until fixed or answered with pushback, and needs green checks before `Human Review`. D:
   `elixir/WORKFLOW.md:171-186,230-237`. The human approves by moving the ticket; the agent then merges with the
   `land` skill (squash-merge when green). D: `elixir/WORKFLOW.md:249-251`, `.codex/skills/land/SKILL.md:9-35`.
7. **Plugins** — No plugin system. Extension points: in-repo Codex skills (`.codex/skills/*`), workspace hooks
   (`after_create`, `before_run`, `after_run`, `before_remove`: arbitrary shell, "fully trusted"), and adapter-owned
   agent tools. D: `elixir/README.md:45`, `SPEC.md:420-442,1760-1769`.
8. **Adapters** — Tracker port: `fetch_issues_by_states`, `fetch_issues_by_ids`, `agent_tool_specs`,
   `execute_agent_tool`, `secret_environment_names`, `validate_config`. C: `elixir/lib/symphony_elixir/tracker.ex:22-27`.
   Shipped: Linear, GitHub Issues, Jira Cloud, Asana, GitLab, each with one raw API tool (`linear_graphql`,
   `github_api`, `jira_rest`, `asana_api`, `gitlab_api`). D: `elixir/README.md:16-28`. Agent adapter: Codex only; no
   agent port. D: `SPEC.md:148,950-1177`. Git host for PRs: none in code; the agent calls `gh` itself. D:
   `elixir/WORKFLOW.md:177-179`.
9. **Internals** — The orchestrator is the only writer of scheduling state; every worker outcome comes back to it as
   a transition. D: `SPEC.md:637-638,725-731`. Reconcile each tick: stall kill (`stall_timeout_ms`, 5 min), stop runs
   whose ticket left active states (cleanup only on terminal). D: `SPEC.md:819-839`. `WORKFLOW.md` reloads live; a bad
   reload keeps the last good one. D: `elixir/README.md:203-205`, `SPEC.md:560-579`. Blocked runs (approval or input
   asked) are an in-memory map, lost on restart. D: `elixir/README.md:33-36`; C: `orchestrator.ex:40,335-352`.
10. **Security** — The spec mandates no sandbox or approval posture; each build must document its own. D:
    `SPEC.md:31-34,1065-1076,1721-1732`. Tracker tokens are executed host-side and unset in the Codex child (`unset`
    in the launch command plus a cleared port env). C: `codex/app_server.ex:207,223,233,240-251`. Workspace must stay
    under root, symlink escape refused. D: `SPEC.md:1734-1746`; C: `workspace.ex:501-504`. Weak points: with
    `approval_policy: never` (the sample) every command and file-change approval is answered `acceptForSession`. C:
    `codex/app_server.ex:55,565-583`. The sample passes `shell_environment_policy.inherit=all` and
    `networkAccess: true`. D: `elixir/WORKFLOW.md:34-39`. The agent pushes and merges with the host's own `gh`/git
    credentials (not stripped). D: `elixir/WORKFLOW.md:191-192`, `land/SKILL.md:23-24`. The raw tracker tools are not
    scoped to the project. D: `elixir/README.md:232-233,285-286`. Hardening is left to the deployer. D: `SPEC.md:1771-1797`.
11. **Docs** — One normative RFC-2119 spec with reference algorithms (`SPEC.md:1799-2047`), a test matrix
    (`SPEC.md:2049-2202`) and a conformance checklist (`SPEC.md:2204-2250`), plus the Elixir README. No ADRs and no
    docs site found. C: tree at sha.
12. **Stack** — See the table above.
13. **Cost and limits** — Limits: `max_concurrent_agents` (10), per-state caps, `max_turns` (20), turn silence timeout
    (1 h), stall timeout (5 min), retry backoff cap (5 min), hook timeout (60 s). D: `SPEC.md:436-491`. Token totals
    and the latest rate-limit payload are tracked for the dashboard. D: `SPEC.md:1419-1448`,
    `elixir/docs/token_accounting.md`. No money budget or token cap stops a run: no match for budget/cost/usd in
    `elixir/lib` or `SPEC.md`. C: grep at sha.
14. **Evals and learning** — Unknown: no eval set, golden set or learning loop found in the tree. The only feedback
    channel is the prompt's `### Confusions` section in the workpad and filing out-of-scope follow-up issues. D:
    `elixir/WORKFLOW.md:89-94,228`. Tests are conformance and live e2e tests, not model evals. D: `elixir/README.md:313-388`.

## Unknowns

- The announcement page text: 403. Date, authors and the 500% figure are secondary (S) only.
- Real-world posture inside OpenAI (devboxes, credentials): only a secondary report ("runs on devboxes around the
  clock", Help Net Security); not in the repo.
- Roadmap or maintenance: no commits after 2026-09-15; the press report says OpenAI does not plan to maintain it as a
  product (S).
- Evals: none found (topic 14).
