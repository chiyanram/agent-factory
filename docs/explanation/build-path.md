# The build path

How an approved ticket becomes a pull request ready for a human to merge, which steps code checks and which the model
only claims, and what is decided next. The full decision table is code: `src/core/dispatch/table.ts`; the
coordinator's view of it is in [the coordinator's instructions](../../prompts/coordinator.md#triggers).

## The path

```text
 START (+ approval) ──▶ orchestrator loop ──▶ test-first (bug lane*) ──▶ implementer ──▶ cleanup
                        a human's command starts it;                     │ first push: the host opens the draft PR
                        it ends when nothing is in flight                ▼
                                            ready check ──▶ automated review ──▶ gate ──▶ ping ──▶ human merges
                                            fails, or Act on, or red gate: a rework run, at most 3 rounds, then a human
```

\* By default only the bug lane starts with a failing test (ADR-0007). A process plugin's lanes file sets it per lane
with `test_first`; the engine reads that property, never the lane's name (#417).

| step | what it does | checked by code |
|---|---|---|
| orchestrator loop | one pass of the decision table every `FACTORY_POLL_MINUTES`; no cron; caps hold before each run | yes |
| lane | tiny, bug, feature or one-way door; checked on the spec's planned files before the build and on the real diff after; only ever raised | yes (`src/core/ready/lane.ts`) |
| test-first | in a lane whose `test_first` is set (bug by default), one commit with a failing test before the fix | the commit exists; **Today:** not that the test fails on the base and passes after |
| implementer | builds on a fresh runner; ends with `done` and evidence rows, `asked`, or `blocked`. It never edits the design: each change of a type, signature or file placement is a `deviations` entry, which the host posts as one `[writer] DEVIATION:` note (ADR-0018) | the report's shape (`src/core/report.ts`). **Today:** a deviation that changes what an AC observes must be an `asked`, but only the role card says so |
| cleanup | tidies the branch's own lines, re-runs the evidence, lists what would change behaviour as `deferred` | **Today:** not that it stayed inside the branch's lines |
| PR body | the engine's lines, the deferred list, then the implementer's `.factory/pr.md`, cleaned | yes (`src/core/pr-body.ts`) |
| ready check | re-runs every evidence row at the head, needs a row per `AC-n`, runs the test checks S1–S4; posts each row's re-run (exit code and last line) beside the result the implementer claimed | yes (`src/core/ready/rerun-note.ts`) |
| automated review | the pack's section 6 holds the design and the factory's own deviation notes; a stranger's note with the same words is ignored | yes (`src/core/review/deviations.ts`) |
| rework | a fresh run with the failure as its task: a failed ready check, an Act on finding, red CI, a failed verifier | yes |

## Limits

- **Caps:** per run, per ticket, per project per day, and a share of a subscription window. A ticket at its cap goes to
  a human with what it spent; nothing is killed mid-run.
- **Stall:** a run that prints nothing for 5 minutes is stopped and goes to a human (`src/core/writer/run.ts`). A
  setting can only lower this time.
- **Backoff:** a failed step waits 10 s, doubling, at most 5 minutes.
- **Rounds:** 3 rework rounds, then a human.

## What is decided next

Decided in the design audit (2026-11-10), not built:

| change | why |
|---|---|
| a team may raise the stall time, up to 20 minutes | a long, quiet build (such as Maven) is killed as a stall |
| jitter on the retry backoff | many tickets retrying at the same moment |
| a human may lower a raised lane only through `agent-factory waive`, with the reason on the ticket | today no way is defined |
| the engine checks that the new test fails on the base and passes on the branch; a revert check; tests are read-only while fixing; a new test passes k times in a row | today these are rules in the role cards only |
| the engine checks that cleanup stays inside the branch's own lines, and runs the tests that cover them | today this is a rule in the cleanup card only |
| a human's review comment marked `/act` becomes an Act on item for the next rework run | today human comments never reach the implementer |
