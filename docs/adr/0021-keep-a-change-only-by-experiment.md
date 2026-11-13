# 0021 · Keep a change only by experiment: hold the baseline, beat the noise on what it aims at

Status: accepted 2026-11-13 (operator, #488 Q1–Q6). Supersedes ADR-0015 E3's bar.

## Context

P11 says a change to a prompt, card, rule, model or cap is kept only if it is no worse than the baseline on what it
must hold, and better by more than the noise on what it aims at (quality or cost), on cases it was not tuned on.
ADR-0015 E3 set a simpler bar: recall not below the baseline, and no clean-floor hit. That bar has two faults.

- **It ignores the noise.** The same reviewer, run three times on the recorded baseline, matched 17, 16 and 17 of its
  24 seeds (`evals/reviewer/baseline.json` `per_case`). A change that alters nothing can still fail "not below the
  baseline" by luck.
- **It does not say what "better" means.** A change that only makes a pass cheaper has no way to be kept, and a
  change that claims more recall needs no more than the baseline's recall.

"Better than the noise" needs a number, or experiments turn into arguments (#488).

## Decision

| # | decision | from |
|---|---|---|
| N1 | **Repeats.** Each case runs 3 times in a pass, as ADR-0015 E5 has it. On the recorded baseline a pass costs $41.24. A bootstrap over its runs gives an sd of 0.020 for a 3-run mean recall; 5 runs would give 0.015 for about $69. | #488 Q2 |
| N2 | **The noise is the spread of the baseline's own repeats**, read from its `per_case` when the check runs and never stored as a separate number. Recall noise is the most seeds one run matched less the fewest, never under one seed, as a share of one run's seeds. Cost noise is the spread of one run's cost, times the runs. On the recorded baseline: 1 of 24 seeds (0.042), and $3.0222 a pass. | #488 Q1 |
| N3 | **Hold.** Every change must keep recall@act_on no lower than the baseline's less the noise, and the clean floor at 0 hits. On the recorded baseline: at least 47 of 72. | #488 Q3 |
| N4 | **Aim.** A change says what it aims at, and the eval pass records it: `agent-factory eval reviewer --aim quality` or `--aim cost`, in the results file's `aim`. A pass with no aim proves no change; a baseline is recorded with none. | #488 Q4 |
| N5 | **Quality** means recall above the baseline's plus the noise: on the recorded baseline, more than 53 of 72, so at least 54. | #488 Q1 |
| N6 | **Cost** means the pass costs less than the baseline's cost less the cost noise: on the recorded baseline, under $38.2159. Only a pass over the baseline's own cases can aim at cost: a pass over fewer cases is cheaper without being better. | #488 Q5 |
| N7 | **Counts, not floats.** Recall is compared in whole numbers by cross-multiplying found, of and the noise. A pass exactly on the line does not beat it, and a pass over more cases (a lesson adds one) is compared by its own counts. Cost is compared in whole hundredths of a cent, the results file's own rounding, for the same reason. | #488 |
| N8 | **Cases it was not tuned on** are the held-out slice of [ADR-0020](0020-eval-gate-on-plugin-pins.md) item 4: cases the author of a change never sees, run only at the gate. **Today:** that slice is not built, so the check runs every approved case, and a person reviews whether the change was tuned on them (#599). | #488 Q6 |
| N9 | **No eval yet.** A change no eval covers says "untested by an eval" in its PR, and is measured on the next pilot tickets. A person reviews that; no code checks it. | P11 |
| N10 | **The baseline stays fixed**, as ADR-0015 E3 and E10 have it: only the operator raises it, with the `eval-baseline-approved` label, and the noise is then read from the new baseline. A new baseline is refused unless its noise can be measured (two or more runs, each holding the same seeds) and it was run with no aim, since it proves no change. | ADR-0015 |
| N11 | **An errored run proves nothing.** A results file in which any case or any run has an error is refused, each one named: a run that errored on a clean case reports no finding, and would read as a clean floor kept by a reviewer that never ran. The harness already marks such a pass partial; N11 also refuses a file whose flags say otherwise. | #488 (operator, 2026-11-13) |

`scripts/check-eval-proof.ts` checks N2–N7 and N11 on every PR that changes a reviewer input, and N10 on every PR that
changes the baseline. The bar itself is `src/core/eval/bar.ts`, which the script loads. **Today:** the pass records its
aim, but the check still applies ADR-0015 E3's bar; N2–N7, N10 and N11 are checked from #488's next slice.

## Considered

| option | why not |
|---|---|
| twice the bootstrap sd of a 3-run mean (about 0.039 today) | it needs a random seed and a stored number; the spread is plain and read from the baseline itself |
| a seed-level rule: N seeds missed in every baseline run now matched in every run | it ignores a change that lifts flaky seeds, and needs its own N |
| hold at "not below the baseline" (ADR-0015 E3) | an unchanged reviewer fails it by chance about as often as not |
| a fixed 10% cost cut | it is not tied to how much a pass's cost moves on its own |
| 5 runs per case | a smaller sd (0.015) for about $28 more a pass; 3 runs keep the cost where ADR-0015 put it |

## Consequences

- A PR that changes a reviewer input must run its eval pass with `--aim`.
- A cost-only change can be kept: it holds recall within the noise and beats the cost noise.
- A new baseline brings its own noise; the bar moves with it, and only the operator moves the baseline.
- See [The improvement loop](../explanation/improvement-loop.md) and
  [evals/reviewer/README.md](../../evals/reviewer/README.md).
