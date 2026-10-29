Verified sk112 round 1 · head 6a3b45c · patch-id f3aa79ff

Real rule form (research/00-reference-format.md:65-69): `## Rules`, then `- **V1** — <rule>, because …`, wrapped. Real SKILL.md (18 in agent-platform): one-line `description:`, 0 with `>`.

| # | bucket | one line why | fix (Act on only) |
|---|---|---|---|
| 1a | Act on | NEW, found while reproducing 1. `**V1**` and `—` count as words. A 34-word rule in the template form reports 36 and fails. | check_sizes.py:39: strip the leading ID label before the count |
| 1b | Act on | Reproduced. `## Rules (ours)` (research/22:9), `## Rules ` with a trailing space, and no Rules section all exit 0. Any length passes silently. | check_sizes.py:37: loosen the heading match. long_rules() reports a missing section. |
| 1c | Dismissed | Tables, `1)` and nested bullets are not in the template (§4). | — |
| 2 | Dismissed | Reproduced. Each miss is a 1–2 character overcount or a loud failure, on forms that 0 of 18 real files use (§4). No YAML dependency is needed. | — |
| 3a | Consider | `a.md#nope` passes. Real skills hold 6 `file#anchor` links. "Resolves" can mean the file only. | — |
| 3b | Dismissed | Reference-style links: 0 uses. Case: Ubuntu CI catches it. Other false fails are exotic (§4). | — |
| 4 | Dismissed | A missing file is not a size violation. Deleting AGENTS.md shows in the diff (§4). | — |
| 5 | Consider | True, but the wiring is correct today. A cheap guard: a test that `lint:` names every `scripts/check_*.py`. | — |
| 6 | Noted | The installed plugin has no LICENSE. This matters only when the repo goes public. Follow-up: the go-public ticket. | — |
| 7 | Consider | `persist-credentials: false` is one line. Python ≥3.9 is enough, so no pin is needed. | — |
| 8 | Dismissed | The README follows #111 AC and ADR-0003. #90 (Codex probe) is CLOSED. | — |

Spec: skills check is **met**. Links are **met**. Sizes are **met with gaps (1a, 1b)**.

## Fix list for the writer

1. **1a: the rule ID inflates the word count.**
   - Red first: add `tests/fixtures/sizes/good-template/plugins/rulebook/skills/code/references/demo.md` with `- **V1** — <34 words>`, wrapped over 2 lines.
   - Add `good-template` to the good list for `sizes` (tests/test_fixture_checks.py:9). It fails today.
   - In `rules()`, remove `^\*\*[A-Z]+\d+\*\*\s*—\s*` from each item before `split()`.
2. **1b: a misnamed or missing Rules section passes silently.**
   - Red first: add the bad fixtures `sizes/rules-heading-variant` (`## Rules (ours)` + a 60-word item) and `sizes/no-rules-section`. Both exit 0 today.
   - In check_sizes.py:37, match with `re.match(r"Rules\s*(\(ours\))?\s*\n", s)`.
   - In `long_rules()`, report `{ref}: no ## Rules section` when nothing matches.
