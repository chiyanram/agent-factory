# Code review

How the automated review judges a pull request, where it sits beside human review, and what is decided next. The
command is `agent-factory review` ([CLI](../reference/cli.md#commands)); the round is `src/core/review/round.ts`.

## Where it sits

```text
 implementer ──▶ ready check ──▶ automated review ──▶ gate (CI or local verify) ──▶ human review and merge
                 evidence re-run   finds and verifies     tests at the head            design and intent;
                 test checks S1–S4  defects; posts them                                 never "approve" from the AI
```

The automated review is a filter in front of the human, not a replacement. It never approves, never undrafts, and zero
findings is not a pass. A human reviews the design and the intent of each change and merges it.

## One round

```text
 pack ──▶ pick lenses ──▶ one finder per lens ──▶ merge ──▶ verify per kind ──▶ buckets ──▶ post
```

1. **The context pack** (`pack.ts`), one per head: the diff (from round 2, the interdiff), the approved spec and
   design as the contract, and the rules from the default branch or the pinned plugin. The PR description is data,
   never the contract. Every `CLAUDE.md`, `AGENTS.md`, `.claude/` and `.agents/` is removed from the code copy, so a
   change cannot choose the rules it is judged by.
2. **Pick the lenses** (`lenses.ts`): the lane sets how many (tiny 1, bug and feature about 3); a one-way door runs
   every lens on the strongest model; the test-integrity lens runs whenever an existing test changed.
3. **Find:** one fresh, read-only finder run per lens, in parallel. Each finding has a rule, a `file:line`, a severity,
   a category and a grade: how strong its proof is (`cited`, `walked` or `ran`).
4. **Merge:** the same `file:line` with the same rule is one finding; the stronger grade is kept.
5. **Verify:** one fresh verify pass per kind, rule findings on one model, logic findings on another
   (`src/core/review/pinned.ts`). Each finding lands in one bucket:

   | bucket | means |
   |---|---|
   | Act on | it holds, this change introduced it, and its proof is walked or ran: the implementer fixes it |
   | Consider | it holds but is a judgement call, or its proof is cited only: a human decides |
   | Noted | true, but not this change's to fix: a follow-up |
   | Dismissed | does not hold, with one line why |

6. **Post:** one thread per Act on and Consider at its `file:line`, a script-made status list (protected files, build
   files, new dependencies), then one summary note. After 3 rounds the change goes to a human.

A round with the same patch-id as the last reuses its verdict with no model run. The acted-on rate (`agent-factory
usage`) counts a finding as acted on when the next round's diff changed a line within 5 of it; no model decides it.

## How others do it

From vendor docs and company papers (retrieved 2026-11-09):

| question | what others do | here |
|---|---|---|
| where the rules come from | Anthropic Code Review: the base branch, "never from the pull request's own changes"; Copilot code review: the head branch | the default branch or a pinned plugin |
| false positives | a verify step after finding (Anthropic; Cursor Bugbot's validator) | a verify pass per kind |
| who approves | none of them approve by default | never |
| learning | Bugbot learns rules from reactions and replies; Anthropic and GitLab Duo do not learn from feedback | a human turns a lesson into a rule ([The improvement loop](improvement-loop.md)) |
| measure | Bugbot's resolution rate (published 52% → 78%); most publish no precision numbers | the acted-on rate |

## What is decided next

Decided in the design audit (2026-11-10), not built:

| change | why |
|---|---|
| merge findings after the verify pass, by a nearby location and the same underlying issue, not only by exact `file:line` and rule; keep every lens on the kept finding | two lenses cite different rules for one bug |
| the review's verify prompt asks for the final severity and grade (#438). The code already refuses a verdict that raises them (#425) | the finder grades its own proof until the prompt asks |
| a lens or rule is listed for the operator on its acted-on rate and precision, never retired for being quiet | a quiet security rule may be doing its job |
| count acted-on per rule ID, not only per kind | the improvement loop needs to know which rule paid |
| a human reply marked `/act` on a review thread becomes an Act on item | today human review comments never reach the implementer |
| a size cap; skip generated and lock files | they cost tokens and hold no review value |

**Today:** the finder and verify-pass role cards are not used; the round runs `prompts/review-find.md` and
`prompts/review-verify.md` until the review's eval has a baseline (#216). The review runs on the host with read-only
tools, not on a runner (#113).
