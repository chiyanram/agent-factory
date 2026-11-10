# T1 spock.md — round 1 (find + verify)

Files: skills `.claude/worktrees/feat+31-testing-spock/plugins/rulebook/skills/testing/references/spock.md` (290 lines, contents line present), `references/examples/spock.md` (647 lines), and the one-line change to `research/00-reference-format.md` checklist item 1.
Ledger rows read: 19:43-63. Spock docs fetched at tag `spock-2.4` (and 2.3/2.5 to rule out version drift): interaction_based_testing, data_driven_testing, spock_primer, release_notes, parallel_execution, `Isolated.java`.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Consider | :50-51 | K20: reason not in ledger. Ledger 19:63 is NO-REASON; the reason is research/31:21 (confidence "implied"). | Operator approves the reason, or flags K20 for deletion |
| 2 | Consider | :57 | `ibt :245` is the "Wildcard Constraint" heading (2.3 and 2.4). "every line is treated as an implicit assertion" is at ibt :253. The cell still holds through notes :946. The wrong line is inherited from ledger 19:43. | `ibt :245` → `ibt :253` |
| 3 | Consider | :58 | `notes :55-58` is about GroovyMock and parallel execution in 2.4 (2.5: new features). The `with()` statement is at notes :62-64 (2.4). The cell still holds through primer :606-691. Inherited from ledger 19:55. | `notes :55-58` → `notes :62-64` |
| 4 | Consider | :277 | K12 grep `"\.with {"` misses `obj.with{}` with no space, the form the rule names. | `grep -nE "\.with ?\{"` |
| 5 | Consider | :270 | K8 check adds `?:` on a `where:` column; ledger 19:51 names only `if`. | Drop "or `?:`", or accept it as an `if` form |
| 6 | Consider | 00-reference-format.md :105 | The amendment holds the operator's decision word for word. Three gaps: the "Where a reference sits" tree (:12-13) does not show `references/examples/`; the "Amended" header (:4) does not list this change; the line is not wrapped at the file's ~118 columns. | Add `│   ├── references/examples/<topic>.md   every approved pair, when the reference cannot hold them` to the tree; add "2026-10-29: examples files (#31 B)" to :4; wrap the line |
| 7 | Noted | examples :488, :494 | Caption "the shared FakePortsConfig" names a class; the same class is in the code (:494) and in examples/integration-tests.md :235. Consistent with code; not a leftover project word. | — |
| 8 | Noted | :48-49 | K19 drops "never a `then:` without a condition" from the rule text; the check (:288-289) still enforces it (ledger 19:62). | — |
| 9 | Dismissed | — | Cells re-read and holding: ibt :734-746, :788-797, :290-306, :402-425, :513-536; ddt :100, :118, :166; primer :340-380, :581-591, :606-691, :791-830; par :23-25; `Isolated.java:27` (`@Target(TYPE)`). | — |
| 10 | Dismissed | — | Edges: K2b, K4/K5, K15, K17 each stated by its ledger row (19:45, :47-48, :58, :60). | — |
| 11 | Dismissed | — | Pointers U3 (`unit-tests.md`), IT4 (`integration-tests.md`), GT2 (`scenario-to-tests.md`) exist and match. | — |
| 12 | Dismissed | — | Examples: K1-K20 and K2b all present. K9 (68b:929-965) and K15 (68b:1127-1155) code diff byte for byte; K1, K2, K11, K13, K19 identical in both files. No project words in captions. | — |
