# T1 smoke-specs.md — round 1 (find + verify)

Files: skills `.claude/worktrees/feat+31-testing-smoke-specs/plugins/rulebook/skills/testing/references/smoke-specs.md` (299 lines, contents line present) and `references/examples/smoke-specs.md` (484 lines).
Ledger rows read: 19:106-127. Sources re-read: research/22 (R18) :3, :44, :62-63; research/28 (R24) :3, :34, :60-87, :134, :230-238, :325; 68d :1-5, :264-299, :370-403.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Act on | :45-56, :58-60 | Every When-X cell cites R18 or R24. Both mark themselves not approved: research/22:3 "Nothing here is approved", research/28:3 "Nothing in this file is approved". This is the basis on which the operator dropped the EC2 edge. | Re-cite each cell to its ledger row and drop R18/R24: :45 → ledger :117 · :46 → :116 · :47 → :107 · :48 → :118 · :50 → :114 (why = EB3's reason) · :51 → :113 · :52 → :115 · :53 → :115 · :54 → :111 · :55 → :111 (why = EA6's reason, not the Google blog) · :56 → :120. Delete row :49 (see #2). Replace :58-60 with "The ledger is `research/19-approved-rules.md`; `:N` is its line." |
| 2 | Act on | :49 | "setup that a test mutates → a per-test fixture with its own teardown" has no ledger row; its only source is R18 :44 (not approved). EB3 (19:114) says only that `beforeAll` is for read-only setup. | Delete the row |
| 3 | Act on | :259-261, :265-266 | Edges 1 and 3 also cite R24 (:230, :231, :72). The ledger lines beside them (:116, :118, :124) state the edges. | Delete "; R24 :230, :231" and "; R24 :72" |
| 4 | Act on | :8-39 | EC6 (19:121, APPROVED) is missing, with no record why. It is generic apart from "check-flaky output", and 68d :495 has its neutral pair. | Add **EC6** — "Treat a pass on retry as a flake and fix its cause; never add retries, serial or a longer timeout to make it green, because retries and longer timeouts hide the real cause of a flake." Add its check: "A change that adds `retries`, `describe.serial` or a raised timeout to pass a flaky test is a finding." To stay ≤300 lines, move one pair (for example EA5) to examples only |
| 5 | Consider | :8-39 | EB1, ED2, ED4 (19:112, :123, :125, APPROVED) are missing, with no record. Each has a neutral pair in 68d (:199, :530, :601). ED4 is NO-REASON. | Operator: add neutral forms, or record them as moved to T8 (agent-platform `docs/agents/testing.md`) in the MR's old-line map |
| 6 | Noted | — | ED5 (`make smoke`, 19:126) is project-specific: pattern 8 → T8. Record it in the old-line map. | — |
| 7 | Consider | :262-264 | Edge 2 (a catch in fixture teardown is allowed) rests on EA3's wording (19:108) and a Good example (68d :290). No source states it as an exception (patterns 6, 9). | Operator keeps or vetoes |
| 8 | Noted | :252, examples :188, :434 | "this Docker environment" inside code (byte copy). | — |
| 9 | Dismissed | :16-17 | EA4 says "dependency" and "record" where the ledger says "tool" and "frame". 68d's approved heading (:105) uses the same neutral words. | — |
| 10 | Dismissed | — | Pointers GT1, GT2, GT4 (`scenario-to-tests.md`), S1, TM2 (`strategy.md`), GA5 (`planning/references/acceptance-criteria.md`, ledger GA5) exist and match. | — |
| 11 | Dismissed | — | Examples: all 15 ids present in the rule file have a pair; EB3 (68d:264-299) and EC2 (68d:370-403) code diff byte for byte; EA1-EA6 identical in both files apart from line wrap. | — |
| 12 | Dismissed | — | Each review check covers every item its rule names (EA3 all five nets, EB3 all three conditions, EC5 both halves). | — |
