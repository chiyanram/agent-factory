# 21 — Audit of every decision on map #1 against CP4 (2026-10-20)

For chiyanram/agent-factory#1. Read-only. Every decision on #4, #16, #18, #19 and #1 checked against: an issue we hit,
or ≥2 independent references, with cited file:line opened. Verdicts: SUPPORTED · THIN · CONFLICTS · WRONG-CITE.

Counts: SUPPORTED 30 · THIN 5 · CONFLICTS 8 · WRONG-CITE 1 · n/a 2.

## CONFLICTS

| decision | conflict | evidence |
|---|---|---|
| #4 channel — Discord stays the human channel | the MR is the one record (#4 Q1); decisions in Discord never reached the MR | research/12 #7, #33; research/02 point 5 (products use a status board) |
| #4 Q3a — VM coordinator started by create-agent.sh | create-agent.sh runs with permissions bypassed (O8); Discord bridge failed silently; VM only | research/11 #72, #53, #57 |
| #16 P5 — mattpocock tdd + G12 | tdd = test-first every slice; G12 = features in any order | same decision |
| #16 P8 — /dod stays deleted | #1 reversal lists /dod as open; #642 design line 286 keeps it | agent-platform 37772656 |
| #18 Q2 amended — area files with paths: | breaks G1b baseline (nested AGENTS.md, .claude/rules deleted, #16 Q1); Codex has no paths: (O9); cited refs use nested files; addy constraint:192 does not say reviewer skips | research/16:104 |
| #18 Q6 — rules from the MR head | reverses old G3 default 3 (rules from master, flag MRs editing them) without naming it; an MR could weaken its own rule | skills issues/07:39-40 |
| #18 Q7 original — 2 sub-agents | contradicted old G3 amendment; corrected | skills issues/07:82-88 |
| #1 reversal — #642 implements everything now | "plan, don't do"; frozen work; design says build all in this repo (breaks #16 Q2); nested AGENTS.md (breaks #18 Q2); AC-30 sonnet from no map decision | 37772656:8, :282 |

## THIN

#4 Q5c unix-zone walls (old G13 only; research/05: heavier than every reference) · #16 P1 grilling answers to the MR thread (no MR exists at grilling; !244 D11 uses the issue) · #16 P9 untouched-and-risk (only in the operator's ~/.claude) · #18 Q2 original (no reference) · #19 Q2 daily Discord digest (one source; needs the VM coordinator; none on laptop-only).

## WRONG-CITE

#18 Q3 six-field rule: no id prefix in any cursor .mdc at d1715e0; relation to G5 five sections and G21 ≤35 words not stated.

## Partial cites inside SUPPORTED rows

#4 Q3a pstack orchestrate.md:96 says "never resume to check; probe read-only", not "never probe" · #16 Q2 humanlayer and forge keep copies, not plugins · #18 Q1 ClawSweeper 1-per-head is a repair cap · #18 Q7 corrected: CodeRabbit never opened; Osmani recommends 2 different reviewers for high stakes; !230 revert check never run · #4 Q5a ≤25 min needs faster cores than this VM · #1 measurement narrower than old G11 (no cycle/gate time, no O1/O2).

## No decision covers yet

Rulebook loading in Codex and other tools (plugins and paths: are Claude-only) · who writes the generic plugin content (476 rules) · frozen agent-fleet / VM work and retiring the old Discord fleet · stuck coordinator or writer liveness · laptop-only setup for other developers (no coordinator, digest or bot) · office / other projects · size budgets.
