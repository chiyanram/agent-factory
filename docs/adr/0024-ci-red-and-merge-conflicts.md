# 0024 · Red CI and a merge conflict: no re-run, no failure signatures, a merge and never a rebase

Status: accepted 2026-11-17 (operator, #740 answers 1A to 4A; #645). Amends ADR-0011 D14 and ADR-0012 S3.

## Context

Three lines in two ADRs say what the factory does on red CI and on a merge conflict, and the code does otherwise:

- ADR-0012 S3: "CI red → rerun once if the same failure on a job listed as flaky, else writer again", and "merge
  conflict → writer to rebase (1 failure → `needs-human`)".
- ADR-0011 D14: "CI failure signatures, so the same failure is not sent back again", and a "rebase 1" stop.

Each was replaced on purpose when it was built, and an accepted ADR's decision may not change in place, so the two
ADRs carried **Today:** notes instead. This record makes what the code does the decision.

A re-run turns a red check green by luck, so a bug that fails one time in three passes the gate. The retro behind the
change found 8 of 80 full gates with a flaky test, and real bugs called "flakes" by every role. An implementer that may
re-run learns to re-run; it does not find the root cause.

A rebase rewrites the commits a review and a person already saw, and needs a force-push that could overwrite a
person's push to the branch. A merge adds one commit on top, so the host's push stays a fast-forward with a lease.

## Decision

| # | decision | from |
|---|---|---|
| R1 | **A merge conflict is a merge run, never a rebase.** A change that does not merge into its target sends the implementer on a merge run: the host fetches the default branch into the run's clone, the implementer runs `git merge` and resolves the conflicts, and the host pushes the merge as a fast-forward with a lease. Nothing rebases, resets or force-pushes. A change that still conflicts after one merge run goes to `needs-human`. | #103 |
| R2 | **A fail is a fail.** The factory never re-runs a red check, and there is no flaky list. A red check goes back to the implementer with its log as a CI round, and 2 CI rounds end in `needs-human`. | #456 decision 3 |
| R3 | **Only a person quarantines.** A quarantine names one CI job with its owner, the day it was added, an expiry and the ticket that fixes it. It lives only in the project file, which no team file, user file, branch or rules pack can set. The expiry is at most `quarantine.maxDays` after it was added, 14 by default. | #456 decision 3 |
| R4 | **A quarantined job still runs and shows.** When every failed job at the head is quarantined and unexpired, the gate reads as passed. Each pass logs the quarantine, and the gate-green ping names each job and its expiry. An expired entry blocks again. | #456 decision 3 |
| R5 | **A CI run finds the root cause, or stops.** It reads the failed job's log first and fixes a cause in the code or a test. With no cause in the code, it changes nothing and stops as `blocked`, naming the job, quoting the log line and saying what it checked. It never re-runs a job, adds a sleep or a retry, or skips or deletes a test: a person re-runs a check once, quarantines a job, or fixes it. A CI run that changes nothing ends in `needs-human`. | #740 |
| R6 | **No CI failure signatures.** The factory records no hash of a failed job's log. A repeated red is caught by the 2-round cap and by the stop on a run that changes nothing. Signatures come back only if the measured cost of a second CI round shows they would pay. | #740 |

The rules are built in `src/core/process/quarantine.ts`, `src/core/dispatch/table.ts` and
`src/core/writer/prompt.ts`; the quarantine's keys are in `docs/reference/settings.md`.

**Today:** an entry names a CI job, as the git host reports its failed jobs. The engine reads no test report, so it
cannot quarantine one test inside a job, and a job-wide entry also hides a new real failure in that job until it
expires.

## Considered

| option | why not |
|---|---|
| re-run once on a listed flaky job (ADR-0012 S3) | a re-run passes a bug that fails some of the time, and the list only grows |
| the implementer marks a test flaky, or deletes it with a reason | the run being judged would change its own check; deleting or skipping a test is a person's call, through the quarantine |
| a quarantine with no expiry | a quarantine with no end becomes a skipped test that nobody owns |
| CI failure signatures now (ADR-0011 D14) | the 2-round cap already stops a repeat, so a signature saves at most one run, and that is not measured yet |
| rebase onto the default branch (ADR-0012 S3) | it rewrites reviewed commits and needs a force-push that can overwrite a person's push |

## Consequences

- ADR-0012 S3's rows for red CI and a merge conflict, and ADR-0011 D14's failure signatures and rebase stop, are read
  through this record; their **Today:** notes are removed.
- A project that wants a flaky test out of the gate quarantines its job in the project file, with an owner and an
  expiry, and fixes it within `quarantine.maxDays`.

## Sources

- The retro behind the change, its problem 3 and decision 3.
- Claude Code team, "How the Claude Code team thinks about verification" (2026-11-16): flaky tests get no retries;
  find the root cause, or delete the test and write down why.
