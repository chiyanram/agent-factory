# T1 integration-tests.md — round 1 (find + verify)

Files: skills `.claude/worktrees/feat+31-testing-integration-tests/plugins/rulebook/skills/testing/references/integration-tests.md` (275 lines, contents line present) and `references/examples/integration-tests.md` (493 lines).
Ledger rows read: 19:31-36, :40-41, :75-86, :142. 68b re-read at :150-153, :188-206, :210-240, :535-570, :585-600, :625-635.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Consider | :18-19 | TM4: reason not in ledger. Ledger 19:40 is NO-REASON; the reason is adapted from research/31:20 / C2's reason. | Operator approves the reason, or flags TM4 for deletion |
| 2 | Consider | :53-54 | Two When-X rows (SP10 → Spock `@Timeout`; SP11 → a separate `@Configuration`) cite only 68b :597 and :631, which are Good-example captions. The ledger rows (19:84, :85) state no alternative. Pattern 6 spirit: a Good-only convention becomes a decision row. | Operator: keep (68b is an approved log) or delete the two rows |
| 3 | Consider | :274-275 | SP11 check adds `@SpringBootConfiguration`; ledger 19:85 names only `@SpringBootApplication`. The widening comes from the SP11 Bad example. | Drop "or `@SpringBootConfiguration`", or have the operator widen SP11 |
| 4 | Consider | :50 | "68b :152" is the IT1 Bad caption, not a source; ledger :31, :37 already carry the cell. | Delete "· 68b :152" |
| 5 | Noted | — | CV5 (19:142, the setup-wizard IT exception to IT2) is omitted: project-specific, pattern 8 → T8. Record it in the MR's old-line map (checklist 16). | — |
| 6 | Noted | examples :362, :378, :391-392 | Project words inside code: `src/integrationTest` path, `SharedRedis`, `spring.data.redis.*` (byte copies of 68b). | — |
| 7 | Dismissed | :231-241 | Edges 1, 2, 4 have no "Skip when". The approved model boundaries.md :146 has the same shape. | — |
| 8 | Dismissed | — | Every other When-X cell and edge holds at its cited ledger line (:31-34, :36, :38, :40, :78-79, :81, :86, C2 at :16). | — |
| 9 | Dismissed | — | Pointers TM1, TM2 (`strategy.md`), C2 (`coverage-design.md`), K15 (`spock.md`) exist and match. | — |
| 10 | Dismissed | — | Examples: all 16 ids (IT1-IT5, TM4, SP1-SP11) present; TM4, SP1, SP2, SP6 Bad are n/a lines from the source. IT3 (68b:212-240) and SP9 (68b:535-570) code diff byte for byte. IT1, IT2, IT4, SP3, SP11 identical in both files. | — |
| 11 | Dismissed | — | Each review check covers every item its rule names. | — |
