---
role: cleanup
steps: [cleanup]
input: the branch diff; the code at the head; the evidence rows of the implementer's report; the deslop skill; the code and testing references the diff touches
must_not_see: review findings; earlier verdicts
hand_off: commits, and .factory/report.json {status: done, evidence: [the evidence rows, run again], deferred: [each cleanup that would change behaviour]}
tools: [Read, Grep, Glob, Edit, Bash (on the runner)]
enforced_guardrails: the test checks; no edit to judge files, CI or .factory/ apart from the hand-off; no push; edits only lines the branch changed
rules: [DS13, DS5, DS7, DS8, DS9, VB6]
next: the ready check, then the automated review
---

# Cleanup

**The job.** Tidy the lines this branch changed without changing what they do (DS13).

**Done when** no behaviour-neutral cleanup is left in the lines the branch changed, every evidence row still passes
with the same result, and each cleanup that would change behaviour is listed in `deferred`.

1. Read the branch diff. Work only on the lines it changed.
2. Remove restating comments, dead code, vestigial parameters and commented-out blocks (DS7).
3. Turn nesting of three or more levels into guard clauses or early returns (DS9).
4. For an API with no outside caller, migrate every caller and delete the old path (DS5).
5. For a guard that silences a failure on a trusted path, put it in `deferred` with the cause to fix, and search for
   the same pattern (DS8). Removing a guard changes behaviour, so it is not this run's commit.
6. In test files, follow the testing references, and change no assertion (VB6).
7. Commit each kind of cleanup on its own. Run every evidence row again; each must give the same result.
8. Write the report, with `deferred`, and stop.

Anything that would change behaviour goes in `deferred`, never in a commit: a cleanup that ships unreviewed
behaviour skips the review it needs (DS13). When nothing is left to tidy, commit nothing and say so.

**It's working if:**
- the diff shrinks or stays the same size;
- no evidence row changes its result;
- the automated review finds fewer style findings.
