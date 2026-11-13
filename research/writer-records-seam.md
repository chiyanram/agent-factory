# Is one seam missing between the writer run and its records?

Research for #569 (map #567, garden health). Facts only; the design is a later ticket.
All line numbers are on `origin/main` at `60c0484`.

## Verdict

Yes, one seam is missing, but it is narrower than "the writer and its records".
The shape of the `writer-ended` record has no single owner. It is written out by hand in three types and one
parser, and step.ts builds it at three sites. Two of the six fixes (#408, #499) had to change the record, and each
spread across the same files for that reason. A third change, the trace (#536, a feature), did the same.

The other four fixes do not change the record. Three only change prompt text in step.ts. The fourth (#447) touches
records.ts and tick.ts for the ready check's record, not the writer's. A record seam would not have kept those to one
file. They point at a second, smaller split: the writer's prompt words live in step.ts beside the run logic.

## The six fixes on src/core/writer/step.ts (last 60 days)

`git log --since='60 days ago' -- src/core/writer/step.ts | grep ' fix'`

| Commit | PR | What changed in step.ts | Other src files | Record change? |
|---|---|---|---|---|
| `c7da990` | #499 (#483) | `spendField` added to the early-return record in `finished()`; `spentOn` keeps spend when a host step fails; return types become `Result<WriterOut> \| FailedSpent` | records.ts (torn line, unrelated), tick.ts (`Step<I,O,F>`, writer `FailedSpent`, `failedSpent(..., "writer")`), run.ts (`writerRun` returns `FailedSpent`), spend.ts (`FailedSpent` moved here), lane.ts, eval | yes: spend on two paths |
| `af55afc` | #447 (#444) | `evidenceRules` prompt text; `programs` on `WriterSetup` and `runPrompt` | records.ts (`programs` on `ready-ended`, `evidence`/`at` in summary), table.ts (re-check rule), tick.ts (`readyPrograms`), ready/*, setup.ts | no: ready record, not writer |
| `f6e7730` | #408 (#62) | `why` and `output` on `WriterOut`; `whyField`, `nextWhy`, `withOutput`, `toKeep`, `notKept`; `why` on the early-return record | records.ts (`why`/`output` on `writer-ended` + parser), tick.ts (same two fields on `Steps.writer`, `writerPing`, `writerSaid`, `Logged`), run.ts (`said`/`output` on `Ended`), why.ts (new), post.ts | yes: two new fields |
| `78561e6` | #458 (#62) | one line of prompt text (quote patterns with single quotes) | none | no |
| `bd4225c` | #210 (#192) | `FOREGROUND` prompt text | none | no |
| `f9a4500` | #207 (#110) | `PROJECT_INSTRUCTIONS` prompt text | protected.ts, agent-settings.ts, ci-files.ts, clone.ts, run.ts, finish.ts (settings safety) | no |

Not a fix, same pattern: `83a53a2` (#536, #487) added `trace` and touched step.ts, tick.ts, records.ts, run.ts,
spend.ts and trace.ts.

## Evidence: the record shape has four hand-written copies

One field of the `writer-ended` line (for example `why`) is declared in each of these:

| # | Where | What it is |
|---|---|---|
| 1 | `src/core/writer/run.ts:98-114` `Ended` | the raw ingredients (`spend`, `said`, `output`, `trace`) |
| 2 | `src/core/writer/step.ts:93-116` `WriterOut` | what the step returns |
| 3 | `src/core/dispatch/tick.ts:123-147` `Steps.writer` | an anonymous copy of `WriterOut`, field by field, with its own comments |
| 4 | `src/core/dispatch/records.ts:114-139` `Event` `writer-ended` | the line on disk |
| 4b | `src/core/dispatch/records.ts:480-551` `whyFields`, `outputAndTrace`, `notesFields`, `writerExtras`, `writerEndedOf` | the hand parser, one helper per field group |

The types are tied only by structure: `src/app.ts:896` (`writer: writerStep(writer)`) checks 2 against 3, and the
spread at `src/core/dispatch/tick.ts:937` (`{ kind: "writer-ended", mode, ...value }`) checks 3 against 4. So a new
field must be added in 2, 3, 4 and 4b, or it is dropped without a compile error at the place it is lost.
#408 added `why` and `output` to all four; #536 added `trace` to all four.

## Evidence: step.ts builds the record at three sites

| Site | Line | Sets spend? | Sets why? | Sets trace? |
|---|---|---|---|---|
| `outOf` (a run on an open change) | `step.ts:231-248` | yes (`spendField`) | asked, blocked | yes |
| `finished` early return (no change, no commit) | `step.ts:417-431` | yes, since #499 | yes | yes |
| `handOver` (the host starts no run) | `step.ts:694` | no run, none | no | no |

Then four wrappers add fields after the build: `withCard` (`:528`), `withStale` (`:547`), `withOutput` (`:647`),
and `spentOn` (`:219`) on the failure path, composed at `:613`.

The #499 bug is this split. The early-return site in `finished()` built the record without `spend`, while `outOf`
had it (commit message of `c7da990`, item 4, and the one-line `+ ...spendField(ended.spend),` in its step.ts diff).
Each rule of the form "every writer record carries X" lives at every build site, not in one place.

`handOver` (`step.ts:694`) records no `why`. The reason goes only into the post on the change, and
`writerPing` (`tick.ts:774`) falls back to "its note on the change says why". This is consistent today, because
`handOver` only runs with an open change, but it is a third place that decides the record's fields.

## Evidence: the failure path is threaded through five files

#499 made a failed writer step carry its spend. That needed a new third type parameter on `Step<I, O, F>`
(`tick.ts`), `FailedSpent` moved to `dispatch/spend.ts`, `writerRun` (`run.ts`) returning it, `spentOn` in step.ts,
and `failedSpent(..., "writer")` in tick.ts (`:1165`). The "what does a failed run record" rule has no owner either.

## The second split: prompt words in step.ts

Four of six fixes (`af55afc`, `78561e6`, `bd4225c`, `f9a4500`) changed step.ts only for prompt text:
`FOREGROUND` (`:120`), `PROJECT_INSTRUCTIONS` (`:123`), `FLOOR` (`:131`), `TASKS` (`:140`), `evidenceRules`
(`:157`), `runPrompt` (`:176`). Prompt text sits in the 884-line run module. This raises the file's fix count, but
those fixes were already one file. It is churn, not a missing seam.

## PR #564

PR #564 (#557, open) moves the step contract from tick.ts into `src/core/dispatch/steps.ts`. It moves copy 3 as it
is (its diff still lists `readonly trace?: string` inside `writer: Step<...>`); step.ts then imports `Steps` from
steps.ts. It does not remove a copy, so it does not change this verdict.

## Sources

- `git show --stat` and the diffs of `c7da990`, `af55afc`, `f6e7730`, `78561e6`, `bd4225c`, `f9a4500`, `83a53a2`.
- `origin/main` at `60c0484`: `src/core/writer/step.ts`, `src/core/writer/run.ts`, `src/core/dispatch/tick.ts`,
  `src/core/dispatch/records.ts`, `src/app.ts`.
- `gh pr diff 564`.
