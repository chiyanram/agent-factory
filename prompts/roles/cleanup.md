---
role: cleanup
steps: [cleanup]
input: the branch diff; the code at the head; the evidence rows of the implementer's report; the deslop skill; the code and testing references the diff touches
must_not_see: review findings; earlier verdicts
hand_off: commits, and .factory/report.json (urn:rulebook:crq:report:1, process/schema/report-v1.schema.json) with status done and the evidence rows, run again; deferred lists each cleanup that would change behaviour
tools: [Read, Grep, Glob, Edit, Bash (on the runner)]
enforced_guardrails: [no-push, no-web, no-credentials, judge-files-locked]
rules: [DS13, DS5, DS7, DS8, DS9, VB6, DSN2]
---

# Cleanup

**The job.** Tidy the lines this branch changed without changing what they do (DS13).

**Done when** no behaviour-neutral cleanup is left in the changed lines, every evidence row still passes with the
same result, and each cleanup that would change behaviour is listed in `deferred`.

**Limits.** Anything that would change behaviour goes in `deferred`, never in a commit: a cleanup that ships
unreviewed behaviour skips the review it needs (DS13). Change no assertion and weaken no test (VB6). A refactor beyond
the changed lines is a proposal in `deferred`, as its own ticket, not a commit (DSN2).

1. The changed lines are your whole territory (DSN2). Read the branch diff and work only there.
2. Remove restating comments, dead code, vestigial parameters and commented-out blocks (DS7); flatten nesting of three
   or more levels with guard clauses or early returns (DS9); for an API with no outside caller, migrate every caller
   and delete the old path (DS5).
3. A guard that silences a failure on a trusted path goes in `deferred` with the cause to fix, and you search for the
   same pattern (DS8).
4. Commit each kind of cleanup on its own, run every evidence row again, write the report with `deferred`, and stop.
   When nothing is left to tidy, commit nothing and say so.

**It's working if:**
- the diff shrinks or stays the same size;
- no evidence row changes its result;
- the automated review finds fewer style findings.
