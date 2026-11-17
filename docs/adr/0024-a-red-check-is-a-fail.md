# 0024 · A red check is a fail: no rerun, and only a person quarantines a job

Status: accepted 2026-11-10 (operator, #456 decision 3), built by #485. Supersedes the flaky-job rerun in ADR-0012
S3.

## Context

ADR-0012 S3 says: "CI red → rerun once if the same failure on a job listed as flaky, else writer again". A rerun
turns a red check green by luck, so a real bug that fails one time in three passes the gate. The retro on #456 found
this in practice: 8 of 80 full gates had a flaky test, and real bugs were called "flakes". Each of the 5 roles
reported it.

An implementer that may rerun learns to rerun. It does not fix the code or find the root cause.

## Decision

| # | decision | from |
|---|---|---|
| F1 | **A fail is a fail.** The factory never reruns a red check. A red check goes back to the implementer with its log as a CI round, and 2 CI rounds end in `needs-human`, as S3 has it. | #456 decision 3 |
| F2 | **Only a person quarantines.** A quarantine names one CI job with its owner, the day it was added, an expiry and the ticket that fixes it. It lives only in the project file, which no team file, user file, branch or rules pack can set. The expiry is at most `quarantine.maxDays` after it was added, 14 by default. | #456 decision 3 |
| F3 | **A quarantined job still runs and shows.** When every failed job at the head is quarantined and unexpired, the gate reads as passed. Each pass logs the quarantine, and the gate-green ping names each job and its expiry. An expired entry blocks again. | #456 decision 3 |
| F4 | **A run that changes nothing is not a pass.** An implementer that calls a failure "flaky" and changes nothing ends in `needs-human`, as S3's "same patch twice or empty" row has it. | ADR-0012 S3 |

The rule is built in `src/core/process/quarantine.ts` and `src/core/dispatch/tick.ts`, and its keys are in
`docs/reference/settings.md`.

**Today:** an entry names a CI job, as the git host reports its failed jobs. The engine reads no test report, so it
cannot quarantine one test inside a job, and a job-wide entry also hides a new real failure in that job until it
expires.

## Considered

| option | why not |
|---|---|
| Rerun once on a listed flaky job (ADR-0012 S3) | A rerun passes a bug that fails some of the time, and the list only grows. |
| The implementer marks a test flaky | The run being judged would then change its own check. |
| Quarantine with no expiry | A quarantine with no end becomes a skipped test that nobody owns. |

## Sources

- The #456 retro, problem 3 and decision 3.
- Claude Code team, "How the Claude Code team thinks about verification" (2026-11-16): flaky tests get no
  retries; find the root cause, or delete the test and write down why.
