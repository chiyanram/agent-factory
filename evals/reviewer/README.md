# The automated review's golden set

The cases the automated review is measured on (ADR-0015 E5, #214). Each case is one PR: a commit of this repository,
a change on top of it, and the findings a good review must report. `agent-factory eval reviewer` (ADR-0015 E7,
#215) applies the change in a throwaway clone, runs the real review round with a fake git host, and matches its Act on
findings against `golden.json` (same file, line within 5, the judge says "same underlying issue"); see
[Run the eval](#run-the-eval).

[cases.md](cases.md) lists every case, its kind, what it seeds and its status.

## One case: `evals/reviewer/<case>/`

| file | holds |
|---|---|
| `base.sha` | one full 40-hex commit of this repository's history: the PR's base |
| `change.patch` | the PR's diff, as `git diff` writes it; it applies to `base.sha` |
| `golden.json` | the findings the review must report: `[{file, line, issue, severity, category}]`, `[]` for a clean case |
| `pr.md` | optional: the PR's title (the first line, after `# `) and body, which the fake git host serves |

Each finding:

- `file`: a path the patch changes, from the repository root.
- `line`: the line in that file after the patch is applied (for a deleted line, the line now in its place).
- `issue`: what is wrong and why, in a sentence or two. The judge compares a finding with this text.
- `severity`: `blocker`, `warning` or `nit`.
- `category`: `bug`, `security`, `concurrency`, `data`, `api`, `perf`, `test_gap`, `doc_defect`, `style` or
  `speculative` (ADR-0015 R2). A finding carries both a severity and a category (decided on #218, 2026-11-09).

`golden.json` lists only what the change must fix. It cannot say "do not report this": a clean case's `[]` is the only
precision check (the clean floor, E2). So the rulebook's "keep the old bug apart" grader has no equivalent here.

`make lint` runs `scripts/check-evals.ts`, which fails when a case is not well-formed: a missing or unknown file,
a `base.sha` that is not a commit in the history, a patch that `git apply --check` refuses, a `golden.json` that does
not match the shape above, a finding outside the files or lines the patch leaves, a clean case with findings, or a
case with no row in `cases.md`. It needs the whole history, so CI checks out with `fetch-depth: 0`.

## Add a case

1. Pick the base: a commit on `main`. For a clean case, a merged PR's parent; its patch is
   `git diff <parent> <merge commit>`.
2. Make the change on a scratch copy of the base and save `git diff` as `change.patch`. A seed should look like a
   PR someone would really open: a cover story in `pr.md`, the comments left as they were, the code type-checking.
3. Write `golden.json`, and add a row to `cases.md` with status `draft`.
4. Run `make lint`.

**The operator approves each case before it counts.** An agent drafts a seed; the operator reads it and sets its row to
`approved` in a commit of their own, or deletes it. Only approved cases go into a baseline (E3, E6).

## Run the eval

```bash
FACTORY_RULEBOOK=/abs/path/to/skills/plugins/rulebook agent-factory eval reviewer [<repo>] [--drafts]
```

It runs on the host, as the production review does, and refuses in CI (`CI` set) and in a dry run. `<repo>` is this
repository's checkout (default `.`): its golden set, and the history every `base.sha` is in.

- **Which cases.** Only rows the operator set to `approved` in [cases.md](cases.md) run; drafts are skipped and listed.
  `--drafts` runs them too, and the result then says `drafts_included` and is not proof. With no approved case the
  pass is refused.
- **Each case.** A clone in a private folder under `FACTORY_HOME` (never `/tmp`), `main` at `base.sha`, `change.patch`
  committed on `factory/<case>` and pushed to a bare origin beside it. The spec the review reads is made from `pr.md`:
  its title, its text as the intent, and its numbered `## Acceptance criteria` (or one plain criterion when it has
  none); the operator's approval of the case stands for the spec's approval, in the pass's own home only. Then 3 runs
  of the real `reviewRound`, each a fresh round 1 against its own fake git host: one find run and a verify run per kind.
- **Matching (E4).** Each Act on finding in the same file and within 5 lines of a seed is judged, nearest first and at
  most 3 per seed, by one model run with [prompts/eval-judge.md](../../prompts/eval-judge.md). A match needs "same
  underlying issue" with confidence 0.7 or more, and one finding matches one seed at most.
- **The cap (E11).** $100 a pass. Every review run is capped at `FACTORY_MAX_USD` (default 2 for the eval) and every
  judge run at `FACTORY_JUDGE_MAX_USD` (default 0.50), through the agent CLI's own budget flag. Before it starts, the
  pass prints its worst case (every run at its cap); a worst case over $100 is no reason to refuse, since the cap is
  kept while the pass runs: a round or judge run that might not fit under the cap never starts, the pass stops, and
  the result is partial. Under the cap is proof; stopped at the cap is partial, never proof.
- **Settings.** `FACTORY_CLAUDE` (the agent CLI), `FACTORY_FIND_MODEL`, `FACTORY_RULE_MODEL`, `FACTORY_LOGIC_MODEL`,
  `FACTORY_REVIEW_FIND` and `FACTORY_REVIEW_VERIFY` as for `agent-factory review`; `FACTORY_JUDGE_MODEL` (default
  `claude-sonnet-5-5`) and `FACTORY_EVAL_JUDGE` (the judge's instructions). Every model is a full id: a pass refuses
  an alias such as `sonnet`, since its results file could not say which model ran (ADR-0015 E9).

Exit 0 when the results file is written, 3 when it is written but partial, 1 when the pass is refused.

### The results file: `results/<date>-<sha>.json`

`<sha>` is the first 12 characters of the commit the pass ran at; a second pass on the same day and commit gets `-2`.

| field | holds |
|---|---|
| `head` | the commit of this repository the pass ran at |
| `partial`, `partial_why` | stopped at the cap, a case that could not be set up, or a run that failed |
| `drafts_included`, `proof` | `proof` is true only with no draft and not partial |
| `cap_usd`, `cost_usd` | the cap and what the pass spent, failed runs included |
| `aim` | what the change the pass proves aims at, `quality` or `cost` (`--aim`, [ADR-0021](../../docs/adr/0021-keep-a-change-only-by-experiment.md)); `null` for a baseline |
| `inputs` | the find, rule, logic and judge models; the git blob SHA of each prompt; the rulebook checkout's commit |
| `cases` | the cases run, and the ones skipped (draft, or not run because of the cap) |
| `recall_at_act_on` | seeds matched in Act on over seeds × runs: overall, `by_category` and `by_severity` |
| `clean_floor` | every Act on finding on a case whose `golden.json` is `[]`; the floor is 0 (E2) |
| `per_case` | each run: what the round did, its Act on findings, each seed's match and the judge's confidence, its cost |

## The proof check

CI checks the proof, not the model (ADR-0015 E10, #217). `make lint` runs `scripts/check-eval-proof.ts`, which diffs
the change against the default branch (`FACTORY_BASE_REF`, else `origin/$GITHUB_BASE_REF`, else `origin/main`) and
needs no model and no token.

**A change to a reviewer input** (`prompts/review-*.md` or `prompts/eval-judge.md`) must add a
`results/<date>-<sha>.json` that proves it:

- `"partial": false` and `"proof": true` (no draft case);
- no case and no run has an `error`, each one named: an errored run on a clean case reports no finding, and would read
  as a clean floor kept ([ADR-0021](../../docs/adr/0021-keep-a-change-only-by-experiment.md) N11);
- `inputs.prompts` holds the git blob SHA of each prompt as the change leaves it, `inputs.models` holds the full
  model ids `src/core/review/pinned.ts` pins (a pass run with another id is no proof), and `head` is a commit on the
  branch: run the pass at the change, then commit its results file;
- `clean_floor.hits` is 0;
- it holds the baseline and beats it on what it aims at, by more than the noise
  ([ADR-0021](../../docs/adr/0021-keep-a-change-only-by-experiment.md)).

**The bar** (`src/core/eval/bar.ts`). The noise is read from `baseline.json`'s own repeat runs (`per_case`): the most
seeds one run matched less the fewest, never under one seed; and for cost, the spread of one run's cost times the runs.
On today's baseline that is 1 of 24 seeds and $3.0222 a pass.

- **Hold**, for every change: `recall_at_act_on.overall` found/of is not below the baseline's less the noise (today at
  least 47 of 72).
- **Aim**, which the pass records from `agent-factory eval reviewer --aim quality` or `--aim cost`: quality is recall
  above the baseline's plus the noise (today at least 54 of 72); cost is a pass that costs less than the baseline's
  less the noise (today under $38.2159). A pass with no aim proves no change.

Recall is compared in counts and cost in whole hundredths of a cent, not as rounded floats, so a pass exactly on the
line does not beat it. Only a pass over the baseline's own cases can aim at cost: fewer cases cost less without being
better.

With no `baseline.json`, or one with fewer than two runs to measure the noise by, a reviewer-input change is refused.
**Today:** `src/core/review/pinned.ts` is not a reviewer input, so a change to the review's models needs no eval pass
(#611).

**Today:** `inputs.rulebook` of a reviewer-input pass is not checked (#611). The rulebook's pins are checked by their
own proof, below.

**A change to `baseline.json`** needs the operator's approval: the pull request label `eval-baseline-approved`, which
CI's `eval-approval` job reads from the pull request event (`check-eval-proof.ts --approval`). It runs when a label
changes, so adding the label re-runs that one job. Only the operator adds it; an agent never does. A local
`--approval` run has no event, so it refuses a baseline change; `make lint` checks the rest. The new baseline is a copy of a results file that is proof and has 0 clean-floor hits,
whose noise can be measured (two or more runs, each holding the same seeds), and that was run with no `--aim`, since a
baseline proves no change.

## A pin move's eval

A plugin pin moves only with an eval proof bound to the plugin's sha256, the tree hash the pin holds
([ADR-0020](../../docs/adr/0020-eval-gate-on-plugin-pins.md)). The eval is sized by what the move changes against the
old pin (`src/core/eval/pin-size.ts`); a `chiyanram` plugin's first pin is sized against the engine's commit:

| size | the move changes | what it needs |
|---|---|---|
| none | only `README*`, `CHANGELOG*`, `LICENSE*`, `docs/`, `evals/`, `tests/`, `.github/` | `config check`, as every move runs |
| review | a reference the review baseline points to, `review.json`, or the finder and verify-pass cards | a targeted review pass that holds |
| writer | the implementer card | the implementer eval |
| both | review and writer files, or any path the map does not name | both |

The test-first, cleanup, design-reviewer, onboarder and retro cards, the plugin's manifest and the process files
`config check` reads are tested by no eval: they add no size. A move that changes them, or the implementer card, moves
only with a reason the person types (`--reason`), which the pin keeps, and the pin then shows as unproven in
`config check` until a proof covers it. **Today:** there is no implementer eval yet (#824), so the implementer card always
needs a reason.

```bash
agent-factory eval pin <project> <name@marketplace> [<commit>] [--reason <why>] [--commit-proof]
agent-factory plugin update <project> <name@marketplace> [<commit>] [--reason <why>]
```

**The targeted pass** (`src/core/eval/slice.ts`) runs one run each of every approved case with no seed, then, in
`cases.md` order, each approved case with a seed of a category no earlier case in it has: 16 cases and about $7.85 on
today's baseline. It holds when the seeds found are not fewer than the baseline's lowest single run over the same cases
and the clean floor has 0 hits. It has no aim and reads no noise, so it is a weaker bar than a reviewer-input change
meets. `eval pin` prints the cases, the typical cost (the baseline's mean per case-run × runs) and the worst case
(every run at its cap), and asks before it spends; `plugin update` prints the same when it refuses for lack of a proof.
**Today:** no held-out slice runs with it (#599).

**Where a proof lives.** A project's proof goes to `<home>/evals/pins/<name@marketplace>/<sha256>.json`. The proof
for the engine's own pin (`.github/rules-pack.json`) is committed here in `evals/pins/` (`--commit-proof`), and
`check-eval-proof.ts` refuses a move of that pin with no proof for the new commit, from the old pin as its base, whose
size covers the review its changed paths touch, with a reason for the rest; with `FACTORY_RULES_PACK` set, as in CI,
it also checks the proof's sha256 against the pack. A proof of size none for that pin spends nothing.

