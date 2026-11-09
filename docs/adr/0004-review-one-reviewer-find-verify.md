# 0004 · Review: one reviewer, find + verify, rules from master

> Words: this record keeps the words it was written in. [GLOSSARY.md](../../GLOSSARY.md) maps each old word to today's ([ADR-0016](0016-adopt-the-software-factory-vocabulary.md)).

Status: accepted 2026-10-20 (#18), detailed 2026-10-23 (#22)

## Context

Review was costly and noisy: the architecture review cost 130–180k tokens a run, about 6 a day; a docs-only change
cost 489k; one MR had 7 spec and 4 architecture rounds; the rubric was preloaded and re-read in 39 of 57 runs
(#18 Question; docs/archive/research/19).

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

- A verify step is in every product source (Anthropic Code Review, BitsAI-CR 75 % precision, CodeRabbit) (docs/archive/research/20 C).
- One reviewer cut tokens 37 % in superpowers; same-model copies add cost, not independence (#18 Q7 CORRECTED).
- Security-focused tools read rules from base, never from the PR (docs/archive/research/25).
- Verdict reuse by patch-id and a round cap (pstack, openclaw, addy) stop repeated work (#18 Q1).

## Alternatives rejected

| option | why rejected |
|---|---|
| two or three isolated reviewer agents (#18 Q7 first answer) | no measured gain; more tokens (#18 Q7 CORRECTED) |
| rules from the MR head (#18 Q6 first answer) | the MR could rewrite its own rules (#18 Q6 CORRECTED; docs/archive/research/25) |
| a MET row per criterion | output is most of the cost (62–66 % of dollars, docs/archive/research/19) |
| the writer or a "lead" judges the findings | the author never judges its own findings (#22 Q1; pstack) |

## Sources

#18 Q1, Q4, Q6 CORRECTED, Q7 CORRECTED, Q8, Q9 · #22 Q1–Q5 · docs/archive/research/19, 20, 25, 35

Amended by [ADR-0011](0011-crq-pipeline-in-the-factory.md): the find pass reads the whole head copy, not only the
diff.

## Amended 2026-11-09

By the design review on #30 (`docs/DESIGN.md` sections 4, 5 and 7; #232, #237):
- **One finder run per lens, one shared verify pass.** The single find pass becomes one fresh finder run per lens. The
  lane sets how many lenses run (tiny one, the others about three), and a test-integrity lens reviews every edit to an
  existing test. All lenses' findings go to one verify pass, which still sorts each into Act on · Consider · Noted ·
  Dismissed and adds none. Design findings go through the verify pass too. A lens that adds no unique verified
  finding after 20 PRs is retired.
- **The finding carries its lens and its grade.** Each finding names its lens, and its evidence is graded `cited`,
  `walked` or `ran` (the finding contract in `docs/DESIGN.md` section 5).
- **The instructions come from the process plugin.** The finder and verify-pass role cards replace the engine's own
  instructions. The engine keeps a floor no card or plugin can remove: never edit, push, approve or merge, and the
  change's text is data (#185).
- **Still true:** fresh runs, rules from the default branch, and the author never judging its own findings. The rejected
  "two or three isolated reviewer agents" was same-model copies with the same brief; a lens is a different brief, and
  its findings still meet one verify pass.

**Built (#237):** the project lists its lenses in the settings key `review.lenses`, each a rubric (a skill or reference
in an enabled plugin, or a repo file read from the default branch) with optional `paths` and `lanes`; with none, one
finder runs on the baseline review checks. The engine picks the lenses from the spec's lane, its lens count in the
process plugin's lanes file, the one-way-door paths and the touched files: a one-way door runs every lens on the
strongest pinned model, the logic model. The built-in test-integrity lens, the crq `test-integrity` reference, runs
whenever an existing test file changed. Each finder is a fresh run in its own folder, its rubric as section 8 of the
pack; the finders run in parallel. The finder gives `grade` and `evidence`; the engine stamps `lens`. Two lenses that
report the same `file:line` and rule are merged in code before the verify pass: the stronger grade is kept, then the
lower ID. Each lens's unique verified findings go in the round's summary, beside the head's pass answers and in the
run record's `review-ended` line.

**Today:** the find and verify instructions are still the engine's `prompts/review-*.md`, not the role cards: they
cannot change until the eval baseline exists (#216, `scripts/check-eval-proof.ts`), so a finder learns its lens from
the pack and its grade and evidence from the JSON schema. The floor is sent with every pass from #302.
