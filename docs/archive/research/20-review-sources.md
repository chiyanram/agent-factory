# 20 — How reviews pick rules, how many reviewers, and what the old map decided (2026-10-20)

Ticket: chiyanram/agent-factory#18 (review redesign), questions Q2, Q3 and Q7. Three read-only sub-agent passes.
Paths in part A are relative to `agent-platform/.claude/worktrees/crq-597-b837e3/.scratch/one-rulebook/refs/`.
pstack lives at `cursor-plugins/pstack/`.

## A · References: which rules apply to a diff, and who loads them

| ref | rules for a diff | writer and reviewer | one criterion looks like | evidence |
|---|---|---|---|---|
| mattpocock | all, always + 12-smell baseline | separate on purpose; mechanical → lint/hooks | `**Name**: what. → fix`, no id | `skills/engineering/code-review/SKILL.md:36-45`; `retro/SKILL.md:19,35,42` |
| forge | all (matt copy) + ADRs in the touched area | separate; writer runs lint/format/types | as matt | `.agents/skills/code-review/SKILL.md:38-40`; `work-on/SKILL.md:35,39` |
| addyosmani | 5 axes, all; CONSTRAINTS.md by phase | one file at build, verify, review | Dimension · Rule · Checked by · Runs at; Critical/Nit/Optional/FYI | `code-review-and-quality/SKILL.md:24-32`; `constraint-driven-development/SKILL.md:112-118,190-198` |
| openclaw | nested AGENTS.md per dir + router | scoped AGENTS.md read by all | prose; P0–P3, default P0 only | `AGENTS.md:6-7,97,128-135`; `autoreview/SKILL.md:9-10,95` |
| humanlayer | nested CLAUDE.md per package; plan criteria | one plan: implement + validate | checkbox + command | `create_plan.md:225-237`; `validate_plan.md:7` |
| Jeffallan | router: Topic · Reference · Load When | separate | Category · Key Questions, BAD/GOOD, Critical/Major/Minor | `skills/code-reviewer/SKILL.md:45-64` |
| plinth | agent rule list + skill preconditions | one file, read before editing | Example N: Title, Description, Good, Bad; impact tag | `plinth-java-coder.md:26-54`; `131…md:61-99` |
| pstack | reviewer picks lenses | principles serve writer and reviewer | patterns + "The tests:"; critical/warning/nit | `interrogate/references/rubric.md:3`; `principle-type-system-discipline/SKILL.md:3,13,24-30` |
| cursor-plugins | `.mdc`, all `alwaysApply: true`, no globs | — | description + prose, optional id prefix | `cursor-team-kit/rules/no-inline-imports.mdc:3` |
| firstmate | NOT FOUND (external pipeline) | NOT FOUND | NOT FOUND | `AGENTS.md:222,382` |

Shared by ≥2: no reference scopes per criterion by path glob; scope is by area (nested files) or a router. Mechanical
rules go to tooling and the reviewer skips them. One file for writer and reviewer (plinth, pstack, humanlayer, addy);
mattpocock and forge separate them on purpose. Three-tier severity (addy, Jeffallan, pstack). No reference has id,
why, example, check, severity and scope together.

## B · Old map (chiyanram/skills) on code review

| decision | what it decided | where | vs #18 |
|---|---|---|---|
| G3 Q1 | 2 axes Standards ‖ Spec, fresh, read-only, never reranked; Spec absorbs F-01 + AC citing | `issues/07-grill-review-shape.md:22-24` | original Q7 |
| G3 Q2 | Standards = references by changed path + smells; 86-criteria rubric deleted; rules from master | `07:28-31,39` | Q2; Q6 says MR head |
| G3 Q3 | round 1 full; 2–3 fix diff only; cap 3 then human | `07:32-35` | Q1 |
| G3 Q4 | correctness = a lens inside Standards | `07:41-44` | not yet in #18 |
| G3 resolution | Spec at stage 7, ≤400 words; stage-8 AC pass removed | `07:47-55` | stage decision |
| G3 amendment | ONE reviewer, two verdicts, one packet (superpowers −37% tokens); lead validates; revert only if the !230 re-run misses P1's finds | `07:82-88`; `research/00-decision-register.md:52` | Q7 corrected to this |
| P1 | 2 sub-agents on !230: 5/7 real + 5 new; 246k vs ~302k tokens | `issues/09-prototype-scoped-reviewer.md:22-31` | — |
| G17 | lead judgement Act on · Consider · Noted · Dismissed | skills#87 | not yet in #18 |
| G28 | one writer, one reviewer, add a piece only on a real failure | skills#103 | agrees with corrected Q7 |
| SR8 / ND-7 | architecture A–E merge into spec-review, stage 5 only | `research/19-approved-rules.md:156`; register `:56` | deferred |
| ND-5 | `/dod` deleted | skills#35 | deferred |
| R37-D8 | own smells.md: Fowler & Beck 2e 24 + Kerievsky 3 | `research/19-approved-rules.md:568` | smell baseline |

## C · Public sources on AI code review

| source | says | numbers |
|---|---|---|
| Anthropic, Bringing Code Review to Claude Code, 2026-03-09, claude.com/blog/code-review | parallel agents, a verify step drops false positives, rank by severity; never approves | substantive comments 16% → 54% of PRs; <1% marked incorrect; $15–25, ~20 min |
| Anthropic Code Review docs, code.claude.com/docs/en/code-review | find → verify → dedupe/rank → post; re-review only changes since last; skips if one runs on the latest commit | Important / Nit / Pre-existing |
| anthropics/claude-code plugins/code-review README | 4 agents + per-issue confidence scorer; drops lint-caught and pre-existing | threshold ≥80 |
| Claude Code best practices, code.claude.com/docs/en/best-practices | writer/reviewer sessions; adversarial reviewer sees diff + criteria only; gap-hunters over-report | — |
| Addy Osmani, Agentic Code Review, O'Reilly Radar, 2026-06-26 | high-stakes: 2 reviewers built differently; same-model copies share blind spots | 146 PRs / 679 findings: 93.4% caught by one tool only |
| ByteDance BitsAI-CR, FSE 2025, arXiv 2501.15134 | RuleChecker then ReviewFilter | 75.0% precision |
| GitHub Copilot code review docs | reviews once; re-review on push opt-in; reads AGENTS.md | — |
| mattpocock code-review SKILL.md | 2 isolated axes, no merged verdict, skips tooling-enforced | <400 words per axis |
| NOT OPENED | CodeRabbit agentic validation (2025-11-25); HumanLayer on code review; Building effective agents (2024-12) | — |

Shared by ≥2: find then verify before posting; reviewer isolated from the writer; findings, not approval. No source
states a 3-round cap. Not yet in #18: a correctness/bug lens (Anthropic, old G3 Q4).

## Decisions this research fed (on #18)

Q2 amended to area files with `paths:`; Q3 six-field rule shape; Q7 corrected to one reviewer, two verdicts, lead
verifies; Spec verdict at stage 7. Applied first in agent-platform #642 interim, draft !281 (commit 19b4fe1d).
