# 35 — Which model runs which step of an agent coding pipeline

Question: how do references and products assign models per step (review find vs verify, plan/spec,
implement, cheap helpers), and why? Read-only research, 2026-10-23.

Local refs root: `.scratch/one-rulebook/refs/` (abbrev `refs/`).
Quotes ≤15 words. "NOT OPENED" = cited from a search summary only.

## 1. Table

| source | step | model | why (quoted) | evidence |
|---|---|---|---|---|
| Anthropic `/code-review` plugin | eligibility gate; list CLAUDE.md paths | haiku | (none stated; mechanical lookups) "Launch a haiku agent to check if any…" | github.com/anthropics/claude-code `plugins/code-review/commands/code-review.md` |
| same | PR summary | sonnet | "Launch a sonnet agent to view the pull request" | same |
| same | FIND — CLAUDE.md compliance ×2 | sonnet | "CLAUDE.md compliance sonnet agents" | same |
| same | FIND — bugs ×2 | opus | "Opus bug agent (parallel subagent with agent 4)" | same |
| same | VERIFY — per finding | opus for bugs, sonnet for rules | "Use Opus subagents for bugs and logic issues, and sonnet agents for CLAUDE.md violations." | same |
| same | filter / post | parent (none named) | "Filter out any issues that were not validated in step 5." | same |
| Claude Code Review (managed) | find → verify → rank → post | vendor-chosen, hidden | "Code Review chooses the Claude models that reviews run on" | code.claude.com/docs/en/code-review |
| same | verify | (hidden) | "checks the candidate findings against the code and filters out false positives" | same |
| Claude Code local `/code-review` | whole review | session model + effort | "Depending on your model and effort level, the review also covers…" | code.claude.com/docs/en/code-review-local |
| Claude Code `opusplan` alias | plan / execute | opus / sonnet | "pairs Opus's reasoning for planning with Sonnet's efficiency for execution" | code.claude.com/docs/en/model-config |
| Claude Code aliases | daily coding / complex / simple | sonnet / opus / haiku | "Uses the fast and efficient Haiku model for simple tasks" | same |
| Claude Code subagents | default for any subagent | inherit main model | "The main conversation's model" (last in resolution order) | code.claude.com/docs/en/sub-agents |
| same | cost lever | haiku when set | routing to cheaper models to "control costs" | same |
| Factory custom droids | default | inherit | `inherit` "uses the parent session's model" | docs.factory.com/cli/configuration/custom-droids |
| same | example code reviewer | inherit | (example only) `model: inherit` | same |
| same | read-only explorer | haiku | "Fast explorer with a smaller model" | same |
| same | built-in explorer / worker | complexity tier light / medium | built-in `explorer` defaults to `light`, `worker` to `medium` | same |
| Devin CLI | Fusion pairing | frontier lead + cheap sidekick | "a frontier lead model with a cost-efficient sidekick" | docs.devin.ai/cli/models.md |
| same | quick edits | `swe` | "both fast and cheap at a reasonable level of intelligence" | same |
| same | default | Adaptive router | (no per-step rationale published) | same |
| CodeRabbit (current) | context / reasoning / verification | per-stage, undisclosed | "assigns the best model for each task — context gathering, reasoning, verification" | coderabbit.ai/blog/why-users-shouldnt-choose-their-own-llm-models-choice-is-not-always-good |
| same | why | benchmarked | "continuous benchmarking across real PRs" | same |
| CodeRabbit (older blog) | summarise diff + triage trivial | gpt-3.5-turbo | "simpler models can accurately identify trivial changes" | coderabbit.ai/blog/how-we-built-cost-effective-generative-ai-application |
| same | per-file review | gpt-4 | "High-quality review comments necessitate state-of-the-art language models" | same |
| CodeRabbit via OpenAI case study | hard bugs / summaries | o3, o4-mini / GPT-4.1 | NOT OPENED (403) — search summary only | openai.com/index/coderabbit |
| GitHub Copilot code review | whole review | vendor "mix", no switching | NOT OPENED — summary: switching "likely to compromise reliability" | docs.github.com/en/copilot/concepts/agents/code-review |
| Cursor Bugbot | whole review | not published | NOT OPENED — third-party only; effort levels Default/High | learncursor.dev/guides/cursor-bugbot-review |
| Addy Osmani, O'Reilly "Agentic Code Review" (2026-06-26) | reviewers | heterogeneous models | "Heterogeneity is the whole point." | oreilly.com/radar/agentic-code-review/ |
| same | why | correlated blind spots | four copies of one model = "a single reviewer with a larger invoice" | same |
| addyosmani/agent-skills | author vs reviewer | Model A writes, Model B reviews | "different models have different blind spots" | refs/addyosmani-agent-skills/skills/code-review-and-quality/SKILL.md:222 |
| pstack (Cursor plugin) | implement (feature/bug/perf) | grok (fast) | "splits work by model strength: code delegates … go to grok" | refs/cursor-plugins/pstack/README.md:30 |
| same | hardest change, prose, judgment, synthesis | opus 5.5 max | "hardest changes, prose, and judgment go to opus 5.5" | same :30; skills/setup-pstack/SKILL.md:53-58 |
| same | review panel `/interrogate` | opus + gpt-sol + grok, one each | "The adversarial signal comes from model diversity, not assigned personas." | skills/interrogate/SKILL.md:9,40-42 |
| same | why panel | agreement = confidence | "a finding two models raise independently is high-confidence signal" | docs/guide/04-design.md:65 |
| same | overnight audit | different model family | "spawns a reviewer on a different model family" | docs/guide/07-overnight.md:55 |
| HumanLayer `.claude/` | research, create/iterate plan | opus | (none stated) `model: opus` | refs/humanlayer-humanlayer/.claude/commands/create_plan.md:3, research_codebase.md:3 |
| same | implement (ralph_impl) | sonnet | (none stated) `model: sonnet` | refs/humanlayer-humanlayer/.claude/commands/ralph_impl.md:3 |
| same | locator / analyzer / pattern-finder helpers | sonnet | (none stated) | refs/humanlayer-humanlayer/.claude/agents/codebase-locator.md:5 |
| same | implement_plan, local_review, validate_plan | inherit (no field) | — | refs/humanlayer-humanlayer/.claude/commands/ |
| OpenClaw tech-docs skill | inventory / governance / synthesis | haiku / sonnet / opus | haiku for "file/config discovery", opus to "merge sub-agent outputs" | refs/openclaw-openclaw/.agents/skills/technical-documentation/SKILL.md:49-52 |
| OpenClaw `autoreview` | review | Codex gpt-6-sol high, before Claude | "try OpenAI models through Codex before Claude" | refs/openclaw-openclaw/.agents/skills/autoreview/SKILL.md:107 |
| jvm-skills scout | judge then re-judge | fast model → stronger model | "A stronger model then re-checks every proposed acceptance adversarially" | refs/jvm-skills-jvm-skills/blog/2026-07-07-biggest-jvm-skills-update-yet.md:43 |
| jvm-skills learn | second-opinion review | Claude + Codex | "Different tools, different blind spots." | refs/jvm-skills-jvm-skills/site/learn.md:781 |
| firstmate | supervision branch | cheaper model, shallower effort | "pins a cheaper model and a shallower reasoning effort" | refs/kunchenguid-firstmate/README.md:126 |
| plinth `.cursor/agents` | all roles (architect, coder, BA) | inherit | — | refs/jabrena-plinth/.cursor/agents/plinth-architect.md:8 |
| mattpocock-skills, rameezk-forge, Jeffallan | — | no per-step model set | grep found none | refs/ (grep) |

## 2. Patterns shared by ≥2 independent sources

| # | pattern | sources |
|---|---|---|
| P1 | **Strongest model plans / judges / synthesises; mid model implements.** | opusplan (Anthropic), HumanLayer (opus plan, sonnet impl), pstack (opus judgment, grok code), OpenClaw (opus synthesis) |
| P2 | **Cheapest model does mechanical lookups and triage**, never the judgment. | `/code-review` plugin (haiku gate + path list), CodeRabbit old blog (3.5 triage), Factory (haiku explorer), OpenClaw (haiku inventory), Devin (`swe` sidekick), firstmate (cheaper supervision) |
| P3 | **Verify is a separate step, at least as strong as find for the hard class.** Bugs: opus finds AND opus verifies. Rule checks: sonnet finds AND sonnet verifies. | `/code-review` plugin, Claude Code Review (find→verify), jvm-skills (fast judge → *stronger* re-judge), CodeRabbit ("verification" stage) |
| P4 | **Model tier follows the finding class, not the stage.** Rule compliance = mid; logic bugs = top. | `/code-review` plugin; CodeRabbit (reasoning models for multi-file bugs, NOT OPENED) |
| P5 | **Reviewer diversity across families beats N copies of one model.** | Osmani O'Reilly, addyosmani skill, pstack `/interrogate`, jvm-skills learn, OpenClaw autoreview (Codex first) |
| P6 | **Default is inherit; pinning is the exception for cost.** | Claude Code subagents, Factory droids, plinth, HumanLayer (impl/review commands) |
| P7 | **Products hide the model and expose effort/level instead.** | Claude Code Review, Copilot (NOT OPENED), Bugbot (NOT OPENED), CodeRabbit |

## 3. What this says about our choice

Ours: stage 5 (design review) Opus · stage 7 Find Sonnet · stage 7 Verify Sonnet.

| our step | matches | gap |
|---|---|---|
| stage 5 Opus | P1 — design/judgment on top model (opusplan, HumanLayer, pstack) | none |
| stage 7 Find Sonnet — standards axis | P4 — plugin uses sonnet for CLAUDE.md-compliance find | none |
| stage 7 Find Sonnet — architecture F-01 / logic | — | P4: plugin puts **bug/logic find on Opus** |
| stage 7 Verify Sonnet | P3 ok for rule findings | P3: plugin verifies **bugs on Opus**; jvm-skills verifies with a *stronger* model than the finder. Verify ≤ Find is the opposite of both. |
| all Claude | — | P5: no cross-family reviewer. 5 sources say same-family copies share blind spots. |
| no cheap tier | — | P2: no haiku for mechanical steps (diff listing, file inventory, eligibility). Small cost gain only. |

Reading: stage 5 is in line. Stage 7 Sonnet/Sonnet is right for the **standards** axis and
matches the Anthropic plugin exactly. For the **architecture/logic** axis, the closest reference
(Anthropic's own plugin) uses Opus for both find and verify. Strongest single change: Verify on
Opus for logic findings. Cross-family second reviewer (P5) is the biggest independent signal but
needs a non-Claude model in the loop.
