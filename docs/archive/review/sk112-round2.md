Reviewed 6a3b45c..ce23e14 · round 2 · patch-id 9d5c4a81 (was f3aa79ff) · merge-base 1092b85

Interdiff: scripts/check_sizes.py (RULE_ID, RULES_HEADING, reference_problems), 3 fixtures, tests/test_fixture_checks.py.
Scratch: /private/tmp/claude-501/r2/ (worktrees sk-old, sk-new; sk-cases/*).

## Round-1 Act on

| # | fixed? | evidence |
|---|---|---|
| 1a ID inflates count | yes | `- **V1** — <34 words>`: old rc=1 "36 words", new rc=0. 36-word body: new reports 36 (was 38). Drop RULE_ID.sub → sizes/good-template FAIL. |
| 1b heading variant / missing section silent | yes (behaviour) | `## Rules (ours)`+60w, `## Rules `+60w: old rc=0, new rc=1 "60 words". No section: old rc=0, new "no ## Rules section". Drop no-section report → sizes/no-rules-section FAIL. |

## New findings (interdiff only)

| # | bucket | finding | evidence |
|---|---|---|---|
| N1 | Consider | rules-heading-variant fixture goes red for the wrong reason | revert RULES_HEADING to round-1 `startswith("Rules\n")` → suite OK. Fixture now fails with "no ## Rules section", and the test asserts only rc=1 + non-empty stdout. Regression would be loud (false "no section"), not silent. Fix: add a good fixture `## Rules (ours)` + short rule. |
| N2 | Noted | every `skills/*/references/*.md` must now carry `## Rules` | matches ADR-0003:20 "Each reference has Rules · …". No real references in repo yet. agent-platform has 28/28 references without `## Rules`; any moved here (e.g. code/references/smells.md) fails lint until it gains one. |
| D1 | Dismissed | `## Rules` at EOF, no newline | rc=1 "no ## Rules section". Section is empty, so no rule escapes; message slightly off. Not a realistic file. |
| D2 | Dismissed | `**V1** -` / `**V1** –` not stripped | +2 overcount, loud fail at 34-35 words. Template uses `—`; same class as round-1 #2 (Dismissed). |
| D3 | Dismissed | RULE_ID strips only leading label | `… see **V2** — x` mid-rule kept. `**CODE12** —` stripped. Correct. |
| D4 | Dismissed | five-section reference, CRLF, `### Seams` under Rules | all handled: only Rules counted; CRLF matched; sub-heading items counted. |

Verify pass: mutations re-run from clean ce23e14; `unittest` 7 OK, `check_sizes.py .` rc=0 at head.

Verdict: ready to merge (Consider N1 optional).
