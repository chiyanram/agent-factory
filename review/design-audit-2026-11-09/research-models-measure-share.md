# Research: model choice and cost, measurement, setup and sharing (capabilities 16, 17, 19)

Local only. Written 2026-11-10. Input for **R11** (measured) and **R13** (shareable), README §2 and §7.
Design checked: agent-factory `c9e71a6` (DESIGN §3 Limits, §5, §6, §8; GUIDE setup sections; `src/core/dispatch/caps.ts`,
`usage.ts`, `src/core/settings/`, `src/core/review/pinned.ts`) and skills `1e22921` (`plugins/rulebook/skills/agent/references/cost.md`, `evals.md`).
Primary sources only. **(nv)** = not checked against its primary source. **(code)** = a claim about our code, checked by
grep at `c9e71a6`. Extends `audit-control-flow.md` §3 (caps) and `research-improvement-loop.md` (evals).

## 1. Verdict table

| # | our design | verdict | why, in one line | sources |
|---|---|---|---|---|
| **16 · model choice and cost** |||||
| M1 | a model per role: implementer, finder, rule finder, logic finder, eval judge (`variables.ts:187-228`) | **keep** | every vendor picks the model by task; Uber pairs one model to write and another to grade | A1, A3, G4, U1 |
| M2 | model keys are class **preference**: the lowest layer wins (GUIDE "Settings layers"; `keys.ts:9`) | **change** | the vendors let the org lock the allowed set; a user picks inside it. DESIGN §5 Work setup already says "the allowed models", but the class lets a user or env var set any model | A4, A5, A6, G3 |
| M3 | review and judge models pinned by full id (`pinned.ts`); implementer unset = the CLI's default (`writer/settings.ts:8`) | **refine** | aliases move under you; pin the implementer too, and write the model id into each run record (grep found no model field in `records.ts`, `spend.ts`) **(code)** | A2, A4, O1 |
| M4 | a model change ships only if its evals do not drop (DESIGN §6) | **keep** | every source says: your own eval set first, acceptance criteria fixed before you compare | A1, A3, O1 |
| M5 | no router, no cascade: one fixed model per role | **keep** | RouteLLM and FrugalGPT win on query benchmarks; Anthropic's own agent-coding numbers show small or negative gains from pairings | P1, P2, A3 |
| M6 | no effort setting per role (grep: none in `src/core`) **(code)** | **refine** | add `effort` per role; vendors say tune effort before you switch or pair models | A1, A3, O1 |
| M7 | caps per run, ticket, project-day; window share; worst case checked before a review round (`caps.ts:1-25`) | **keep** | same shape as Code Review's "skip when less than one review's cost" and Copilot's hard-stop budgets | A7, A8, G2 |
| M8 | "a cap left unset is no cap" (`caps.ts:36`) | **refine** | ship default caps on; GitHub says always turn the stop on; Anthropic says set a limit for the pilot. A second person (R13) must not start uncapped | A7, A8, G2 |
| M9 | the runner uses the developer's own subscription token (`claude setup-token`, GUIDE "runner's model login") | **refine** | own credential per person is right. But subscription limits "assume ordinary, individual usage"; for colleagues (§8 step 6) use a Team/Enterprise seat or a Console API key with a workspace limit | A9, A10, A7 |
| **17 · measurement** |||||
| D1 | merge rate against a baseline | **keep** | agent PRs merge less often than human PRs; a rate means nothing without a baseline | R2, R3, G5 |
| D2 | human minutes to fix each PR | **refine** | measure it from the git host (human commits and review time on the agent's PR), never from a self-report; METR's developers felt 20 % faster when they were 19 % slower | M1, M2, O1, R3 |
| D3 | tokens and cost per merged PR | **keep** | stricter than the vendors (they report per user per day); `usage` already splits by ticket and run kind | A7, G2, A11 |
| D4 | rework rounds | **keep** | a stability measure, the side AI hurts (DORA); name it apart from DORA's "deployment rework rate", which means another thing | D1, D2, D3 |
| D5 | reverts within 30 days | **refine** | keep; add escaped defects: a bug ticket that names a factory PR's file within 30 days **(nv: no primary source uses this exact rule)** | D1, D2, D3, R3 |
| D6 | the numbers never rate a person | **keep** | DORA: targets get gamed, do not compete; GitHub: no single number is productivity. Stricter than Anthropic's leaderboard. Keep aggregates per project and lane only | D3, G6, S1, A11 |
| D7 | no "why" signal | **refine** | add one question to the operator per merged ticket (worth it? y/n + note); DORA 2025: delivery numbers "tell you what … not why" | D2, S1, G6, GO1 |
| D8 | acted-on rate of review findings (`usage`, #220) | **keep** | the industry's review metric: Uber addressed rate, Atlassian resolution rate, Anthropic auto-resolved count | U1, AT1, A12, GO1 |
| D9 | pilot target "7 of 10 merge, median fix < 15 min" | **refine** | report counts and say n; 10 tickets is a go/no-go check, not proof. METR's 246 tasks and Google's 96 engineers still gave wide intervals | M1, M2, GO2, A7 |
| **19 · setup and sharing** |||||
| S1 | settings in layers with a class per key; safety keys only stricter; lists merge (DESIGN §5) | **keep** | the same as Claude Code: managed > project > user, lists merge, a few security keys honor the stricter lower value, `maxEffortLevel` lowest cap wins | A4, A6, G3 |
| S2 | the team layer is a git clone pinned by commit, outside the repo | **keep** | vendors commit team settings into the repo; P9 forbids that at work, and a pinned clone gives the same review and pin | A4, A13 |
| S3 | plugins pinned by version + hash; update shows the diff, runs evals, moves the pin | **keep** | Anthropic: pin a `ref`/`sha`, bump `version` to release, seed images read-only with auto-update off | A13, A14, A15 |
| S4 | plugin pins live per machine, not in a settings layer (README §11 "plugins" row) | **change** | the team layer must hold the plugin list and pins as a locked key, as managed `enabledPlugins` does; else a team cannot pin one rulebook | A14, A13 |
| S5 | setup = identity, box login, box image, egress check, project file, plugin add, each by hand (GUIDE) | **change** | vendors give one decision map plus one check command (`/status`, `claude doctor`, "Confirm the rollout"); make one `setup` path that ends in `config check` + `setup status` | A6, A14, A4 |
| S6 | trust between people: a person approves; each person own login; team update shows the diff | **keep** | Claude Code applies repo-sent marketplaces and allow rules only after the person trusts the folder; each end user must use own credentials | A4, A14, A9 |
| S7 | rollout: personal → aruvii → laptop → 2–3 colleagues, each step after its exit check (§8) | **keep** | every vendor says: small pilot, baseline, then widen | A7, A8, D2 |
| S8 | one plugin version for everyone | **refine** | add a stable and an early channel: the operator on early, the friend and colleagues on stable | A13, A14 |

Summary: **keep 14 · refine 9 · change 3** (M2 allowed models, S4 plugin pins in the team layer, S5 one setup path).

## 2. Consensus (each from 3 or more sources)

1. **Pick the model per task.** Mid-tier for most coding, frontier for hard reasoning, small for simple or sub-tasks. — A1, A7, G4, U1.
2. **Change a model only through your own evals,** with the acceptance criteria fixed before you compare. — A1, A3, O1.
3. **Tune effort before you switch or pair models.** — A1 ("often a better lever"), O1 ("vary reasoning effort while keeping the model … fixed"), A3 ("compare subagents against lower effort first").
4. **Routing and cascades save money on query benchmarks; on agent coding the measured gain is small or negative.** — P1, P2, A3.
5. **The org locks the allowed models and the spend; a person picks inside.** — A5, A6, G2, G3.
6. **Hard spend limits, on from the first day; skip work that does not fit.** — A7, A8, G2.
7. **Pin versions; aliases and "latest" move.** — A2, A13, A14.
8. **No single number is productivity; combine throughput, stability and what people say.** — S1, D2, G6, GO1.
9. **AI use goes with higher throughput and lower stability; measure stability and rework.** — D1, D2, R2, R3.
10. **Self-reports overstate gains; measure from system data, and expect wide intervals.** — M1, M2, GO2.
11. **Do not use the numbers to rank people or teams.** — D3, G6, S1. Dissent: A11 ships a per-user leaderboard.
12. **Pilot small, record a baseline, then widen.** — A7, A8, D2 (DORA: AI "amplifies what's already there").
13. **Settings in layers: org over project over user; lists merge; safety keys only get stricter.** — A4, A6, G3.
14. **Shared rules ship as a pinned plugin from a team marketplace that an admin can require.** — A13, A14, A15.
15. **Each person uses their own model credential; nobody shares or resells one.** — A9, A10, A7.
16. **Config sent by a repo or another person is untrusted until the person accepts it.** — A4, A14, A13.

## 3. Notes per capability

### 16 · Model choice and cost

```text
role            our default (pinned.ts / settings)   vendor guidance
coordinator     not a setting (operator's session)   frontier for planning (A3 orchestrator, A16)
implementer     CLI default, UNPINNED  ◀── M3        frontier or mid-tier; long agentic coding → Opus-class (A1)
finder (rule)   claude-sonnet-5-5                    mid-tier for bulk work (A7, A3)
finder (logic)  claude-opus-5-5                      frontier for reasoning (A1)
verify pass     follows review settings              a different grader model works at Uber (U1)
eval judge      claude-sonnet-5-5                    —
```

- Our split (Sonnet for bulk finding, Opus for logic) matches A1, A7 and A3. No change.
- Do not add a router now. A3 measured Haiku subagents on coding: −32 % cost, −4 points pass rate. The advisor pattern gave
  +1.7 points for 2.1× cost. Static roles plus an effort key give most of the gain with no new moving part.
- **Subscription vs API key.** A9 allows a person to run the unmodified CLI on their own subscription. It also says plan
  limits "assume ordinary, individual usage of Claude Code and the Agent SDK". An unattended loop at night on a Max plan
  is not clearly "ordinary" **(nv: A9 does not define the term)**. For personal projects: keep the subscription, keep the
  window caps. For the friend: each person runs with their own token, never the operator's. For work: Team/Enterprise
  seat or Console key with a workspace spend limit (A6, A7).

### 17 · Measurement

```text
DESIGN §6 metric          SPACE / DORA side        industry analogue                       our gap
merge rate vs baseline    P (outcome)              G5 merged agent PRs; A11 "PRs with CC"   no code yet
human fix minutes         E (efficiency)           O1 "time spent … repairing"; R3 45.1 %   how to measure: not said ◀ D2
cost per merged PR        —                        A7 $/dev/day; G2 credits/user            built (usage per ticket)
rework rounds             DORA instability         Copilot review cycles (nv)               no code yet
reverts 30 days           DORA change fail rate    D1, D2 stability drop                    no code yet
(none)                    S (satisfaction)         G6 "combine with developer feedback"     add ◀ D7
acted-on rate             P (quality)              U1 65 %, AT1 38.7 %, A12                 built
```

- Measure fix minutes from the git host: commits by a human on the agent's branch, and the time from "ready" to merge.
  Do not ask the human to log minutes. M1 shows people misjudge their own speed by about 40 points.
- A baseline must be the same repo, same lane, human PRs, in the same period. G6: such comparisons "show associations,
  not proof".
- The run records name the human who started a ticket (DESIGN §5 Audit). Keep that for audit. Never group a metric by it.

### 19 · Setup and sharing

```text
Claude Code (A4/A6)               agent-factory (DESIGN §5)          gap
managed settings (org, locked)    team layer @commit (locked keys)   plugin pins not in it ◀ S4
shared project .claude/…json      project file (factory home)        —
local / user                      user.json, env (machine)           —
availableModels (lock)            models = preference                ◀ M2
strictKnownMarketplaces           plugins = locked key               —
/status, claude doctor            config show / check, setup status  spread over 6 GUIDE steps ◀ S5
release channels (2 marketplaces) one version                        ◀ S8
```

## 4. Sources

### Anthropic

- **A1 · Choosing a model.** <https://platform.claude.com/docs/en/about-claude/models/choosing-a-model>
  "Tuning effort is often a better lever than switching models." · "Create benchmark tests specific to your use case.
  Having a good evaluation set is the most important step in the process." · Matrix: Opus 5.5 for "Multihour autonomous
  coding agents"; Sonnet 5.5 for "everyday coding"; Haiku 5.5 for "subagent tasks".
- **A2 · Model configuration.** <https://code.claude.com/docs/en/model-config>
  "Aliases point to the recommended version for your provider and update over time. To pin to a specific version, use
  the full model name". · `opusplan`: "uses `opus` during plan mode, then switches to `sonnet` for execution".
- **A3 · Optimizing for cost and intelligence.** <https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence>
  Advisor: "scored 1.7 points higher than the executor alone … for about 2.1 times the cost." · Orchestrator: "delegation
  came out ahead in only two situations" · Haiku subagents "cut cost per attempt by 32% and the pass rate by about 4
  points" · "For coding tasks, compare subagents against lower effort first." · "Recheck at every model release."
- **A4 · Settings files and precedence.** <https://code.claude.com/docs/en/settings>
  "A managed `model` is a starting default, not a lock; the locks are `availableModels` and `deniedModels`." · "Commit
  `.claude/settings.json` so everyone who clones the repository gets the same permissions, hooks, and plugin settings." ·
  "`permissions.allow` rules … `extraKnownMarketplaces` … apply only after each teammate trusts the folder." ·
  `maxEffortLevel`: "the lowest cap applies".
- **A5 · Model restrictions** (in A2). "Administrators can use `availableModels` in managed or policy settings to
  restrict which models users can select."
- **A6 · Set up Claude Code for your organization.** <https://code.claude.com/docs/en/admin-setup>
  Decision map: provider · how settings reach devices · what to enforce · usage visibility · data handling. "Array
  settings such as `permissions.allow` … merge entries from all sources, so developers can extend managed lists but not
  remove from them." · Provider: Teams/Enterprise "is the default recommendation"; Console "pay-as-you-go". · "After
  configuring managed settings, have a developer run `/status`".
- **A7 · Manage costs.** <https://code.claude.com/docs/en/costs>
  "the average cost is around $13 per developer per active day and $150-250 per developer per month" · "start with a
  small pilot group and use the tracking tools below to establish a baseline before wider rollout." · "Sonnet handles
  most coding tasks well and costs less than Opus. Reserve Opus for complex architectural decisions" · "specify `model:
  haiku` in your subagent configuration" · Console: "set workspace spend limits".
- **A8 · Code Review costs.** <https://code.claude.com/docs/en/code-review-costs>
  "Before a wide rollout, run a small pilot … Set a monthly spend limit for the pilot." · "Code Review also skips reviews
  once what's left is less than the expected cost of one review."
- **A9 · Legal and compliance.** <https://code.claude.com/docs/en/legal-and-compliance>
  "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent
  SDK." · "Anthropic does not permit third-party developers … to route requests through Free, Pro, Max, or Ultra plan
  credentials on behalf of their users." · "Each end user must authenticate with their own Anthropic API key, Claude
  subscription plan credentials, or 3P inference provider credential".
- **A10 · Teams seats** (in A7). "each member's Claude Code usage draws from a per-seat allowance that resets on a rolling
  five-hour window and a weekly window."
- **A11 · Analytics.** <https://code.claude.com/docs/en/analytics>
  "PRs with CC: total count of merged pull requests that contain at least one line of code written with Claude Code" ·
  "Leaderboard: top contributors ranked by Claude Code usage" · "Use alongside DORA metrics".
- **A12 · Code Review analytics** (in A8). "Feedback: Count of review comments that were auto-resolved because a
  developer addressed the issue".
- **A13 · Host and maintain a marketplace.** <https://code.claude.com/docs/en/plugins/host-marketplace>
  "`ref` and `sha` on the plugin entry" · "If you set `\"version\": \"1.0.0\"` and push new commits without changing it,
  users don't receive them." · "To offer stable and early-access tracks, host two marketplaces whose entries point at
  different refs".
- **A14 · Manage plugins for your organization.** <https://code.claude.com/docs/en/plugins/org>
  "`extraKnownMarketplaces` registers a marketplace on each machine, and `enabledPlugins` names the plugins to install"
  · "disabling one at their own scope doesn't stop it from loading, because managed settings take precedence" · Seeds:
  "Claude Code never writes to the seed and forces `autoUpdate` off" · "Confirm the rollout … run `/plugin`".
- **A15 · Create a marketplace.** <https://code.claude.com/docs/en/plugin-marketplaces> "an administrator can require it on
  every machine."
- **A16 · Multi-agent research system.** <https://www.anthropic.com/engineering/multi-agent-research-system>
  "Claude Opus 4 as the lead agent and Claude Sonnet 4 subagents outperformed single-agent Claude Opus 4 by 90.2%" ·
  "multi-agent systems use about 15× more tokens than chats" · "token usage by itself explains 80% of the variance".
- **A17 · Monitoring (OpenTelemetry).** <https://code.claude.com/docs/en/monitoring-usage>
  Metrics: `claude_code.pull_request.count`, `claude_code.cost.usage`, `claude_code.token.usage`. Teams via
  `OTEL_RESOURCE_ATTRIBUTES`.

### OpenAI

- **O1 · Model selection.** <https://developers.openai.com/api/docs/guides/model-selection>
  "Choose acceptance criteria before comparing models" · "keep the lightest setting that meets your quality bar." ·
  "Then vary reasoning effort while keeping the model and inputs fixed." · "Measure completion time alongside quality,
  including time spent reviewing or repairing the result."
  Note: the older version of this page said "optimize for accuracy first" **(nv: that text is no longer on the page)**.

### GitHub Copilot

- **G1 · Requests (legacy billing).** <https://docs.github.com/en/copilot/concepts/billing/copilot-requests>
  "Copilot cloud agent uses one premium request per session, multiplied by the model's rate." · Code review "multiplier of
  13". Legacy only: GitHub moved to usage-based billing on 2026-06-01 (search result, docs.github.com) **(nv)**.
- **G2 · Budgets for usage-based billing.** <https://docs.github.com/copilot/concepts/billing/budgets-for-usage-based-billing>
  "ULBs always enforce a hard stop." · "When more than one type applies to a user, the most specific budget wins." ·
  "Always enable it when creating a budget."
- **G3 · Enterprise policies.** <https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise/manage-enterprise-policies>
  "the availability of features and models is controlled by policies" · enterprise owners "define a policy for the whole
  enterprise, or delegate the decision to individual organization owners."
- **G4 · AI model comparison.** <https://docs.github.com/en/copilot/reference/ai-models/model-comparison>
  Tiers by task: general-purpose; "optimized for speed" for simple tasks; deep reasoning for "multi-file understanding".
- **G5 · PR metrics changelog (2026-02-19).** <https://github.blog/changelog/2026-02-19-pull-request-throughput-and-time-to-merge-available-in-copilot-usage-metrics-api/>
  "pull requests created with Copilot coding agent that got merged," "pull request cycle time." Field
  `median_minutes_to_merge_copilot_authored` **(nv: from search summary)**.
- **G6 · About Copilot usage metrics.** <https://docs.github.com/en/copilot/concepts/copilot-usage-metrics/copilot-metrics>
  "Look for patterns across these signals rather than treating any single number as a measure of productivity." ·
  "These comparisons show associations, not proof that adoption caused a change in productivity." · "Combine trends with
  developer feedback".

### DORA and SPACE

- **D1 · DORA 2024 (Google Cloud announcement).** <https://cloud.google.com/blog/products/devops-sre/announcing-the-2024-dora-report>
  "As AI adoption increased, it was accompanied by an estimated decrease in delivery throughput by 1.5%, and an estimated
  reduction in delivery stability by 7.2%." · "… like small batch sizes and robust testing mechanisms."
  The "per 25 % adoption" framing is in the full report **(nv)**.
- **D2 · DORA 2025 (announcement).** <https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report>
  "we observe a positive relationship between AI adoption on both software delivery throughput and product performance."
  · "AI adoption does continue to have a negative relationship with software delivery stability." · "AI doesn't fix a
  team; it amplifies what's already there." · "Simple software delivery metrics alone aren't sufficient. They tell you
  what is happening but not why". The seven capabilities are in the report PDF only **(nv)**.
- **D3 · DORA four keys guide.** <https://dora.dev/guides/dora-metrics-four-keys/>
  Instability: change fail rate, "Deployment rework rate". Pitfalls: broad targets increase "the likelihood that teams
  will try to game the metrics" (Goodhart); the aim is to improve, "not to compete against other teams".
- **S1 · SPACE (Forsgren, Storey et al., 2021).** <https://www.microsoft.com/en-us/research/publication/the-space-of-developer-productivity-theres-more-to-it-than-you-think/>
  "it cannot be measured by a single metric or dimension." The five dimensions (Satisfaction, Performance, Activity,
  Communication, Efficiency) and "use at least three dimensions" are from secondary pages; ACM Queue blocked the fetch
  **(nv)**.

### Studies

- **M1 · METR 2025.** <https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/>
  "When developers are allowed to use AI tools, they take 19% longer"; they "expected AI to speed them up by 24%" and
  "still believed AI had sped them up by 20%". 16 developers, 246 issues.
- **M2 · METR 2026 update.** <https://metr.org/blog/2026-02-24-uplift-update/>
  Returning developers: "a speedup of -18% with a confidence interval between -38% and +9%" (negative = faster) · "Due
  to the severity of these selection effects, we are working on changes to the design of our study."
- **GO1 · Google, AI in software engineering.** <https://research.google/blog/ai-in-software-engineering-at-google-progress-and-the-path-ahead/>
  Acceptance rate 37 %; "online A/B experiments are key" because "offline metrics are often only rough proxies of user
  value"; "acceptance rate targets" balance "the cost of review and added value".
- **GO2 · Google RCT (Paradis et al.).** <https://arxiv.org/abs/2410.12944> "We found that AI significantly shortened the
  time developers spent on task." About 21 %, 96 engineers, wide interval (abstract, summarised).
- **R2 · AIDev dataset (Li et al.).** <https://arxiv.org/abs/2507.15003> 456,000 agent PRs; "their PRs are accepted less
  frequently" than human PRs.
- **R3 · Claude Code PRs on GitHub.** <https://arxiv.org/abs/2509.14745> 567 PRs; 83.8 % merged; of those, 54.9 % "without
  changes", 45.1 % needed more work.
- **P1 · RouteLLM.** <https://arxiv.org/abs/2406.18665> Routers cut cost "by over 2 times in certain cases" "without
  compromising the quality of responses" (QA benchmarks).
- **P2 · FrugalGPT.** <https://arxiv.org/abs/2305.05176> An "LLM cascade"; "up to 98% cost reduction" matching GPT-4 (QA
  benchmarks).

### Company reports

- **U1 · Uber uReview.** <https://www.uber.com/us/en/blog/ureview/> "on average 65% of comments being addressed in the same
  changeset" vs "only 51% of human-written comments"; "paired Anthropic Claude-4-Sonnet as the primary comment generator"
  with "OpenAI o4-mini-high as the review grader".
- **AT1 · Atlassian RovoDev (paper).** <https://arxiv.org/abs/2601.01129> "code resolution for 38.70%"; "decreasing the PR
  cycle time by 30.8%"; "reducing the number of human-written comments by 35.6%". Observational, one year.

Not used: Faros and Jellyfish (no primary data found); Atlassian blog "45 %" figure (no method given).
No primary source shows a cheap-model-first cascade for code review findings. The nearest is U1 (strong writer, cheaper
grader) and A3 (Haiku subagents lose 4 points).
