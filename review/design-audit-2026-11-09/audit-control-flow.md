# Audit 1 · control flow (#263, map #262)

Audits the target design (`docs/DESIGN.md` §2 P1, P2, P7, P8; §3; ADR-0001, 0011, 0012) at `main` `c59ed93`.
Baseline: chiyanram/skills#210. This file extends it and does not repeat it. Sources read 2026-11-09.

## Verdicts

| # | decision | verdict | one-line reason | differs from skills#210 |
|---|---|---|---|---|
| 1 | P1 · the engine decides every routine step (ADR-0011 D13, ADR-0012 S3) | **keep** | Every vendor checked puts code around the agent: Actions jobs, sessions, caps. The model decides only inside a run. | no |
| 2 | P2 · every run is fresh, never resumed (ADR-0001) | **refine** | Keep fresh. Industry is split on resume, but Anthropic's own SDK says a fresh session with handed-over state "is often more robust". Name the hand-off. | no (adds a refine) |
| 3 | P7 · every loop has a cap and a stop (S3 table; caps per run, ticket, project-day) | **keep** | Every system has hard caps (59 min, 20/60 min, 500 turns, $3). Our per-ticket round caps are stricter than most. | no |
| 4 | P8 · START: nothing starts unless a human starts it | **keep** | Copilot and gh-aw start only on a human with write access. gh-aw says trigger permission "is neither human approval", which is our START ≠ approval split. | no (#210 had no START; new rule, same direction) |
| 5 | §3 · approval by lane, bound to spec and design hashes, stale on edit | **keep** | Plan-then-approve is the norm (Factory Spec Mode, Copilot plan review). Stale-on-edit is GitHub's "dismiss stale approvals". | no |
| 6 | §3 · lane checked by code from planned files and the diff, raise only | **keep** | Path rules set by code are how GitHub and gh-aw escalate review. No vendor lets the agent lower its own review level. | **yes**: #210 LN1 let the human change the lane either way; here code may only raise |
| 7 | §3 · stall: 5 min with no streamed output stops the run | **change** | The runner itself allows a silent Bash call of up to 10 min, and stream-json is silent while a tool runs. A long test run is stopped as stalled. The setting can only lower 5 min. | **yes**: #210 has no stall rule; this is a new finding |
| 8 | §3 · backoff: 10 s doubling to 5 min, next try in the run record | **refine** | Shape matches AWS and SWE-agent. Add jitter, and keep the agent CLI's own API retries as the only API-retry layer. | no (#210 silent) |

## 1 · P1 the engine decides every routine step — keep

**What we decide.** A code dispatcher runs one decision table (S3). The coordinator AI keeps only talk, questions and exceptions.

**What industry does.**
- Anthropic separates "workflows" (code paths) from "agents" (the model directs itself). It recommends workflows for well-defined tasks.
- gh-aw wraps the agent in fixed Actions jobs: activation, agent, threat detection, safe outputs. The agent cannot change them.
- Copilot coding agent: GitHub's platform starts, times out and ends the session. One branch and one PR per task.
- HumanLayer 12-factor agents, factor 8: own the control flow, break the loop for approval.
- Counter-case: Copilot decides by itself whether a PR comment is meant for it. We do not let a model make that call. That is stricter, not weaker.

**Sources.**
- Anthropic, Building effective agents: "Workflows are systems where LLMs and tools are orchestrated through predefined code paths." · "workflows offer predictability and consistency for well-defined tasks." <https://www.anthropic.com/engineering/building-effective-agents>
- HumanLayer 12-factor agents, factor 8: "Build your own control structures that make sense for your specific use case." · "break the loop and wait for human approval". <https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-08-own-your-control-flow.md>
- GitHub Copilot coding agent: "Copilot can only work on one branch at a time and can open one pull request per task." <https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent>

**Differs from #210:** no. #210 R11 already recommended a deterministic dispatch script.

## 2 · P2 every run is fresh, never resumed — refine

**What we decide.** Each run starts with an empty context. Nothing is resumed. The tracker and git are the memory (P3).

**What industry does.** It is split.
- Resume is common: Copilot "remembers context from previous sessions on the same pull request". Factory `droid exec --session-id` continues a session. Devin sleeps and is woken in the same session. The Claude Agent SDK lists "recover from a limit" as a reason to resume.
- Fresh with a hand-off is also common: Anthropic's long-running harness starts each session with no memory and hands over a progress file plus git. The Claude Agent SDK, for runs across hosts, says not to rely on resume.
- Note on Copilot: each `@copilot` comment starts a **new session**. It carries remembered context, not the live transcript. That is close to our model.

**Why keep fresh.** Our runs cross machines (DESIGN §3: a phase may run on one machine and the build on another). Resume needs the transcript file on the same machine. Fresh plus a hand-off works on any machine, and it avoids drift (ADR-0001).

**Refine.** Name the hand-off that a fresh run gets, as one record, not ad hoc. Today it is implicit in "act_on? back to the implementer". Proposed contents: the approved spec and design, the previous `report.json`, the open findings, the CI failure signature, and the work-in-progress branch. This is what Copilot's "remembers context" and Anthropic's progress file give.

**Sources.**
- Claude Agent SDK, sessions: "Don't rely on session resume. Capture the results you need (analysis output, decisions, file diffs) as application state and pass them into a fresh session's prompt. This is often more robust than shipping transcript files around." · "Same machine only: the session file still needs to exist on the current machine." <https://code.claude.com/docs/en/agent-sdk/sessions>
- Anthropic, Effective harnesses for long-running agents: "each new session begins with no memory of what came before." · progress is "accomplished with the claude-progress.txt file alongside the git history." · "compaction isn't sufficient." <https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>
- GitHub, make changes to an existing PR: "When Copilot starts a new session in response to your comment…" · "Copilot remembers context from previous sessions on the same pull request." <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/make-changes-to-an-existing-pr>
- Factory droid exec: `-s, --session-id <id>` "Continue an existing session." <https://docs.factory.com/cli/droid-exec/overview>

**Differs from #210:** no. #210 also rejected feeding the same live session (Composio). The refine is new.

## 3 · P7 every loop has a cap and a stop — keep

**What we decide.** S3 gives every failure path a stop: ready check 3, review rounds 3, CI rounds 2, rebase 1, same or empty patch → `needs-human`. Caps per run, per ticket and per project-day. A day cap starts no new run and kills nothing mid-run.

**What industry does.**
- Copilot: 59 min per session, "cannot be extended or bypassed".
- gh-aw: agent step 20 min, agent job 60 min, `max-turns` 500 per run, `stop-after` deadline.
- SWE-agent: `per_instance_cost_limit` $3.00 per task, plus total and call limits.
- Claude Agent SDK: `max_turns` and `max_budget_usd`; "Setting a budget is a good default for production agents."
- OpenHands SDK: a stuck detector for repeated action-observation, action-error, monologue and alternating patterns (`stuck_detector.py`). This is the same idea as our same-patch breaker, at the turn level inside a run.
- MAST: "unaware of termination conditions" is 12.4% of multi-agent failures, step repetition 15.7%.

**Note.** Claude's budget cap can overshoot by one response ("Leave headroom"). Our day cap that "kills nothing mid-run" overshoots by up to one run per slot. Both are accepted trade-offs; say so in the usage notice.

**Sources.**
- Copilot: "Each Copilot session that runs on GitHub Actions has a maximum execution time of 59 minutes." <https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent>
- gh-aw frontmatter: `max-turns` "Caps the number of chat iterations … Defaults to `500`"; `timeout-minutes` "… before a 20-minute fallback." <https://github.github.com/gh-aw/reference/frontmatter/>
- SWE-agent `sweagent/agent/models.py`: `per_instance_cost_limit: float = Field(default=3.0, description="Cost limit for every instance (task).")` <https://github.com/SWE-agent/SWE-agent/blob/main/sweagent/agent/models.py>
- Claude Agent SDK, agent loop: "Without limits, the loop runs until Claude finishes on its own … Setting a budget is a good default for production agents." <https://code.claude.com/docs/en/agent-sdk/agent-loop>
- OpenHands SDK `stuck_detector.py` @ `be42ad4`: "1. Repeating action-observation cycles 2. Repeating action-error cycles 3. Agent monologue …" <https://github.com/OpenHands/software-agent-sdk/blob/be42ad4846ec2d30781200d949ad54e733835885/openhands-sdk/openhands/sdk/conversation/stuck_detector.py>
- MAST (arXiv 2503.13657): FM-1.5 "Lack of recognition or understanding of the criteria that should trigger the termination of the agents' interaction". <https://arxiv.org/abs/2503.13657>

**Differs from #210:** no.

## 4 · P8 START: nothing starts unless a human starts it — keep

**What we decide.** A human START opens a ticket. Extra tasks are off until a human starts one; a schedule can be switched on per task later. The AI cannot START (deny list).

**What industry does.**
- Copilot responds only to people with write access. Copilot also has "Automations" (schedule or repository events), which a human sets up once. That matches our "schedule per task, switched on later".
- gh-aw: `roles` default `[admin, maintainer, write]`. It also says trigger permission is not approval, and that labels and titles are filters, not authorization. Our START (opens) and approval (releases the build) is the same split.

**Sources.**
- gh-aw triggers: "Controls who can trigger agentic workflows … Defaults to `[admin, maintainer, write]`." · "Permission to trigger a workflow is neither human approval through a protected environment …" <https://github.github.com/gh-aw/reference/triggers/>
- gh-aw safe outputs: "Labels, titles, and branch names are filters, not human authorization." <https://github.github.com/gh-aw/reference/safe-outputs-pull-requests/>
- GitHub: "Copilot only responds to comments from people who have write access to the repository." <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/make-changes-to-an-existing-pr>
- Copilot: "Automations let you define a task once and have Copilot run it on a schedule or in response to repository events." <https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent>

**Differs from #210:** no. #210 had no START rule; Matt's "a run never waits for a human" fits it.

## 5 · Approval by lane, bound to hashes, stale on edit — keep

**What we decide.** Bug, feature and one-way door need a human approval before the build. Tiny needs START only. The approval binds the spec and design hashes; an edit makes it stale. Any human, never a bot.

**What industry does.**
- Factory Spec Mode: "No code changes until you approve" (from #210 R2).
- Copilot: you can review the proposed changes before a PR is created. A human's approval of a Copilot PR does not count when that human asked for it; another reviewer must approve.
- gh-aw `on.manual-approval` uses protected environments; an environment with no rules "does not require human review".
- GitHub branch protection dismisses stale approvals when new commits change the diff. That is our hash binding.

**Sources.**
- GitHub protected branches: "dismiss stale pull request approvals when commits are pushed that affect the diff in the pull request". <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>
- GitHub, review Copilot PRs: "your approval of a Copilot pull request won't count" · "Another reviewer must approve the pull request before it can be merged." <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/review-copilot-prs>
- gh-aw triggers: "Require manual approval before workflow execution using GitHub environment protection rules". <https://github.github.com/gh-aw/reference/triggers/>
- Factory Spec Mode (#210 R2, `specification-mode.mdx:17`).

**Differs from #210:** no.

## 6 · Lane by code, raise only — keep

**What we decide.** The coordinator proposes the lane. The engine checks the planned files before the build and the real diff in the ready check, and can only raise. A raise that needs a missing approval stops and asks. One-way-door paths are a project setting.

**What industry does.**
- Nobody computes a "lane" by name. All of them escalate by path, in code, and the agent cannot override it.
- GitHub CODEOWNERS with required review: a change that touches an owned path needs that owner.
- gh-aw protected files: manifests, CODEOWNERS, `.github/`, agent files → `request-review` by default, or `blocked`, or `fallback-to-issue`. `draft` "is a policy … the agent cannot override it at runtime".
- Kiro quick vs spec (from #210) lets the human pick the size. #210 LN1 let the human change the lane both ways.

**Why keep.** A lane is a review level. Letting a model lower its own review level is what every source above forbids. A human may still raise it.

**Sources.**
- GitHub protected branches: "any pull request that affects code with a code owner must be approved by that code owner". <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>
- gh-aw safe outputs: `request-review` (default) "Create the pull request and submit a `REQUEST_CHANGES` review listing the protected files." · "`draft` is a policy, not a default, so the agent cannot override it at runtime." <https://github.github.com/gh-aw/reference/safe-outputs-pull-requests/>

**Differs from #210:** **yes.** #210 LN1: "Tell the human, who may change it." The target design lets code raise only, and does not say a human may lower. Ask: may a human lower a code-raised lane? Recommendation: no for a code raise from one-way-door paths; yes for a coordinator proposal before the code check.

## 7 · Stall: 5 min of no output stops the run — change

**What we decide.** The writer streams `stream-json`. 5 minutes with no output stops it as `blocked`. Time asleep does not count. The setting is a cap-class key: a lower layer can only lower it (`src/core/writer/settings.ts:37-47`, checked).

**The problem.**
```text
writer ── Bash("mvn verify")  ──────── 7 min, no bytes ────────▶ result
stream-json:  tool_use ▸ ............ silence ............ ▸ tool_result
host stall timer:                 5:00 ✗ STOP (as "stalled")
Claude Code allows:  default 2 min, max 10 min per foreground Bash call
```
- In the agent loop, a tool call yields one message before and one after. Nothing streams while the tool runs.
- Claude Code lets the model set a foreground Bash call up to 10 minutes by default. Background commands can run longer.
- ADR-0012 S8 makes the writer run its own ITs (Testcontainers) in the box. Those runs often take more than 5 minutes.
- So the rule stops honest runs, and a project cannot raise the stall time.
- The agent CLIs already have their own 5-minute idle watchdog on the **model stream** (Codex `stream_idle_timeout_ms` 300000; Claude Code body idle timeout 5 min). The host stall timer is therefore only useful for **tool-level** hangs, which is exactly where silence is normal.

**Change (proposal).**
1. Set the stall time above the runner's longest silent tool call. Pin `BASH_MAX_TIMEOUT_MS` in the box (not set today; grep of `src`, `images` finds none) and make stall = that + a margin.
2. Or count activity, not stdout: CPU or file writes of the box's process tree, as the liveness signal.
3. Let a project raise the stall time up to the run cap, because the run cap already bounds the cost.

Recommendation: 1, since it is one number and needs no new probe.

**Sources.**
- Claude Code env vars: `BASH_MAX_TIMEOUT_MS` "Maximum timeout the model can set for a foreground Bash or PowerShell tool command … (default: 600000, or 10 minutes)". · `API_FORCE_IDLE_TIMEOUT` "Override the 5-minute body idle timeout that aborts a streaming model response when no bytes arrive." <https://code.claude.com/docs/en/env-vars>
- Claude Agent SDK, agent loop: "`UserMessage`: emitted after each tool execution with the tool result content sent back to Claude." <https://code.claude.com/docs/en/agent-sdk/agent-loop>
- Codex config reference: `stream_idle_timeout_ms` "Idle timeout for SSE streams in milliseconds (default: 300000)." <https://learn.chatgpt.com/docs/config-file/config-reference>
- Sandcastle ADR-0019 (cited in ADR-0012 Why): an idle timeout failed runs and lost committed work.

**Differs from #210:** **yes.** #210 had no stall rule. This is a new conflict inside the target design (S8 vs the stall rule).

## 8 · Backoff: 10 s doubling to 5 min — refine

**What we decide.** A failed step waits `min(10 s × 2^(n−1), 5 min)`. The next-try time is in the run record. The round caps still apply.

**What industry does.**
- AWS: exponential backoff, capped, with jitter, a limited count, and retry at one layer only.
- SWE-agent: random exponential wait, min 10 s, max 120 s, 20 tries (for the model API).
- The agent CLIs already retry the model API themselves: Claude Code `CLAUDE_CODE_MAX_RETRIES` default 10; Codex `request_max_retries` 4, `stream_max_retries` 5.

**Refine.**
1. Add jitter. It is one line. Several factories may share one project (DESIGN §3), and their passes run every few minutes, so their retries can line up.
2. Say in the design that the dispatcher's backoff is for **steps** (a ready check, a rebase, a forge call), never for the model API. The agent CLI owns that layer. This follows AWS "retry at a single point".

**Sources.**
- AWS Builders' Library, Timeouts, retries and backoff with jitter: "implementations typically cap their backoff to a maximum value." · "If all the failed calls back off to the same time, they cause contention or overload again when they are retried." · "our best practice is to retry at a single point in the stack." <https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter>
- SWE-agent `models.py`: `min_wait: float = 10` "Minimum wait time between retries (random exponential wait)"; `max_wait: float = 120`. <https://github.com/SWE-agent/SWE-agent/blob/main/sweagent/agent/models.py>
- Claude Code env vars: `CLAUDE_CODE_MAX_RETRIES` "Override the number of times to retry failed API requests (default: 10)." <https://code.claude.com/docs/en/env-vars>

**Differs from #210:** no. #210 did not cover backoff.

## Not opened or not found

- Devin: no official page found for a per-session ACU cap or sleep rule; only a Cognition knowledge-base article. Not used as proof.
- OpenHands: the current docs page has no `max_iterations` entry; the stuck detector source was used instead.
- Copilot: no source states a cap on review-comment rounds per PR.
