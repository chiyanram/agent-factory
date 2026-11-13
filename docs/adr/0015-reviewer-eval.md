# 0015 · Eval the reviewer first: seeded bugs, recall in Act on, and a baseline no change may lower

> Words: this record keeps the words it was written in. [GLOSSARY.md](../../GLOSSARY.md) maps each old word to today's ([ADR-0016](0016-adopt-the-software-factory-vocabulary.md)).

Status: accepted 2026-11-08 (operator, map #175: #180, #188, #197, #204, #205). The implementer's eval is not decided
here.

E3's bar is superseded by [ADR-0021](0021-keep-a-change-only-by-experiment.md): a change holds the baseline within the
noise, and beats it by more than the noise on what it aims at.

## Context

The factory has rules (`prompts/`, the rulebook, ADR-0009) and guardrails (ADR-0012), but no eval. Nothing shows that
a change to a prompt, the rulebook or the model makes the output better or worse (#187).
- Other factories define each role as a task with rules. Only OpenClaw has a persona file ("soul"), and the evidence
  says a persona changes tone, not quality (#176, #178).
- Public practice grades patches with tests (SWE-bench) and review bots with precision and recall on seeded bugs,
  matched by an LLM judge (Martian, MIT; Qodo) (#177, #186).
- We have no run history to replay. The dispatcher has written no records yet, and PRs 154–174 have no reviews
  (#179).
- The reviewer is cheaper to eval than the writer: one round costs about $0.84 and runs no branch code.

## Decision

```
 evals/reviewer/<case>/            agent-factory eval reviewer (host, like the production reviewer)
   base.sha                  ─┐     ┌───────────────────────────────────────────────────────────────┐
   change.patch (the seed)    ├────▶│ throwaway clone → apply patch → reviewRound with a fake Forge │
   golden.json [] = clean    ─┘     │ act_on findings → location gate (file, line ±5)               │
                                    │                 → Martian "SAME underlying issue" judge ≥ 0.7  │
                                    └───────────────────────────┬───────────────────────────────────┘
                                                                ▼
                         evals/reviewer/results/<date>-<sha>.json  ──CI compares──▶  baseline.json
                         recall@act_on (all, per category) · clean-floor hits · $ · model/prompt/judge/rulebook SHAs
```

| # | decision | from |
|---|---|---|
| E1 | **The reviewer first.** The first eval is for the reviewer's find → verify pipeline (`src/core/review/`). The writer waits. | #180 |
| E2 | **One metric.** Recall of seeded bugs in Act on, with a hard floor of 0 Act on findings on clean cases. Act on is the only bucket that drives the loop (`review/step.ts:20`). | #180 |
| E3 | **A relative gate.** The first pass records `baseline.json`. A change must not lower recall below it, and the clean floor is absolute. There is no fixed threshold: one case moves recall 2.5–5 points, and no one publishes one. | #180 |
| E4 | **Matching.** A finding matches a seed when it is in the same file, within 5 lines, and the Martian judge says "same underlying issue" with confidence ≥ 0.7. No embedding similarity: it cannot tell the same bug from a similar bug elsewhere. | #180 |
| E5 | **The golden set.** 20 seeded and 10 clean cases from our own merged PRs, plus the 3 rulebook review cases converted. Seeds: the code fixes in history, reverted, and one per MUST (Forge seam, `hgit`/`hostGit`, no token or skip-permissions in an LLM seat), plus a weakened test, a correctness slip and a spec mismatch. An LLM drafts each seed; the operator approves it. 3 runs per case, about $75 per pass. | #197 |
| E6 | **The judge is checked first.** Before the first baseline, the operator grades 20 judge decisions. Under 18 of 20 in agreement, the judge prompt is tuned before any baseline counts. | #197 |
| E7 | **Our own harness.** `agent-factory eval reviewer` runs the real `reviewRound` with a fake Forge, on the host, as production does. `claude plugin eval` grades one prompt, so it stays for the rulebook's own skill cases. | #204 |
| E8 | **When.** Required before merging a PR that changes a reviewer input (find or verify prompt, judge, model setting, rulebook pin). Also once a month and on a new model release. Not nightly. | #205 |
| E9 | **Pinned inputs.** The reviewer's defaults become full model IDs and a rulebook commit SHA, so drift arrives only through a PR. | #205 |
| E10 | **CI checks the proof, not the model.** A PR that touches a reviewer input must add a results file whose SHAs match its head, with recall not below `baseline.json` and 0 clean-floor hits. CI needs no model token. Only the operator may raise `baseline.json`. | #205 |
| E11 | **Cost cap.** $100 per pass. On the cap the harness stops and marks the result partial. A partial result is never proof. | #205 |

The rubric changes from #188:

| # | change | why |
|---|---|---|
| R1 | Keep the four buckets, the Standards and Spec axes, and the 3-round cap. | They match Google, Bugbot and Pocock. |
| R2 | Tag each finding with a Martian category (bug, security, concurrency, data, api, perf, test_gap, doc_defect, style, speculative), and keep its severity (amended on #218, 2026-11-09: the rubric rules, the 5-nit cap and the role cards rely on it). | The eval can then report recall per category. |
| R3 | A Spec finding quotes the criterion it fails. Since #224 the criterion comes from the approved spec, not the PR body; the finding names it as its rule, `AC<n>`, and the engine quotes the line (amended on #219, 2026-11-09). | As Pocock's code-review skill does. |
| R4 | Record the acted-on rate: a finding counts when a later commit fixes it. | It is the only metric that works on live PRs. |
| R5 | Each `AGENTS.md` MUST becomes a code check (oxlint or grep) where it can be. | A rule that code can check should not depend on an LLM. |

## Consequences

- A new top-level `evals/` folder. `AGENTS.md` "Where things go" gets a line for it.
- No soul or persona file is added. One comes in only if an A/B eval on the golden set shows that it helps.
- Not decided here: the writer's eval (SWE-bench style fail → pass, pass^k; #190 covers part), production run records
  that stamp prompt, rulebook and model, and the loop that turns eval results into rule changes. They stay on map #175.
- Build issues, in order:
  1. Pin the reviewer's models and the rulebook SHA (E9).
  2. The golden-set format and the first cases, with operator-approved seeds (E5).
  3. `agent-factory eval reviewer`: the harness, the judge, the results file and the $100 cap (E4, E7, E11).
  4. The judge hand check, then the first `baseline.json` (E6, E3).
  5. The CI proof check (E10).
  6. Rubric changes R2–R5, each one a PR that the eval must pass.
