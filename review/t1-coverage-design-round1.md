# T1 coverage-design.md — round 1 (find + verify)

File: skills `.claude/worktrees/feat+31-testing-coverage-design/plugins/rulebook/skills/testing/references/coverage-design.md` (182 lines, contents line present).
All 8 code blocks match `research/68a`. Every plinth cell was re-read: 130-right-bicep :41, :79, :102-103, :134-135, :167-168, :193, :227, and 131 :550. All of them hold.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Consider | :31 | The pointer names LG3 in `obs/references/logging.md`. LG3 exists in the ledger (:297, WARN versus ERROR), but no rulebook branch has that file yet. | Keep. Confirm when the obs file lands |
| 2 | Consider | :140, :151 | The C4 Bad and Good hold `make verify` (byte copy of 68a). Pattern 7 and pattern 8 conflict. | Operator decides (same as mutation #5) |
| 3 | Consider | :44-46 | The C1 Bad asserts `new OrderEntity().status == OrderStatus.DRAFT`. value-bar.md V5 shows the same assertion as a **Good**. A reader gets two opposite signals. | Cross-file. See the value-bar review, item 4 |
| 4 | Dismissed | — | The C2 rule states the boundaries.md → C2 contract (the unavailable dependency). | — |
| 5 | Dismissed | — | Fidelity C1–C4: meaning and because clause kept. The C1 check names all six dimensions, and the C4 check names all three columns. | — |
| 6 | Dismissed | — | The edge cites plinth :103 and :193, and both lines state it. It has the Skip / Do-not-skip / Confidence shape. | — |
