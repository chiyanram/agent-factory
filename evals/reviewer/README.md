# The automated review's golden set

The cases the automated review is measured on (ADR-0015 E5, #214). Each case is one PR: a commit of this repository,
a change on top of it, and the findings a good review must report. `agent-factory eval reviewer` (ADR-0015 build
issue 3, not built yet) applies the change in a throwaway clone, runs the real review round with a fake git host, and
matches its Act on findings against `golden.json` (same file, line within 5, the judge says "same underlying issue").

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
