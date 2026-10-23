# 0004 · Review: one reviewer, find + verify, rules from master

Status: accepted 2026-10-20 (#18), detailed 2026-10-23 (#22)

## Context

Review was costly and noisy: the architecture review cost 130–180k tokens a run, about 6 a day; a docs-only change
cost 489k; one MR had 7 spec and 4 architecture rounds; the rubric was preloaded and re-read in 39 of 57 runs
(#18 Question; research/19).

## Decision

```
head ─▶ context pack (script; rules from master) ─▶ FIND (fresh) ─▶ VERIFY (fresh) ─▶ summary note + one thread per Act on/Consider
        same patch-id → reuse verdict · changed → interdiff only · 3 rounds → human
```

One fresh reviewer gives two separate verdicts, Standards and Spec. A correctness lens sits inside Standards. The find
pass posts findings only. The verify pass opens each `file:line` and sorts into Act on · Consider · Noted · Dismissed.
Rules come from master; an MR's own rule edits are reviewed as diff and flagged for the human. Rule findings run on
Sonnet; logic findings are verified on Opus.

## Why

- A verify step is in every product source (Anthropic Code Review, BitsAI-CR 75 % precision, CodeRabbit) (research/20 C).
- One reviewer cut tokens 37 % in superpowers; same-model copies add cost, not independence (#18 Q7 CORRECTED).
- Security-focused tools read rules from base, never from the PR (research/25).
- Verdict reuse by patch-id and a round cap (pstack, openclaw, addy) stop repeated work (#18 Q1).

## Alternatives rejected

| option | why rejected |
|---|---|
| two or three isolated reviewer agents (#18 Q7 first answer) | no measured gain; more tokens (#18 Q7 CORRECTED) |
| rules from the MR head (#18 Q6 first answer) | the MR could rewrite its own rules (#18 Q6 CORRECTED; research/25) |
| a MET row per criterion | output is most of the cost (62–66 % of dollars, research/19) |
| the writer or a "lead" judges the findings | the author never judges its own findings (#22 Q1; pstack) |

## Sources

#18 Q1, Q4, Q6 CORRECTED, Q7 CORRECTED, Q8, Q9 · #22 Q1–Q5 · research/19, 20, 25, 35
