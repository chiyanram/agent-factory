# T1 mutation.md — round 1 (find + verify)

File: skills `.claude/worktrees/feat+31-testing-mutation/plugins/rulebook/skills/testing/references/mutation.md` (267 lines, contents line present).
All 17 code blocks match `research/68c` byte for byte. M7 is absent by plan (research/34:103, moved to the project).

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Act on | :239 | Edge 1 "Do not skip when a getter or `is*` decides" cites research/21 :65. research/21:4 says "Nothing here is approved." The other cite, 68c :82, is a Good-example comment (pattern 6). The edge follows from M4 itself (ledger :90). | :239 `(research/21 :65, 68c :82)` → `(M4; ledger :90)` |
| 2 | Consider | :11 | M1 because clause is not in the ledger. Ledger :87 says NO-REASON. The text comes from agent-factory research/31:23 ("stated"). | Operator: approve the reason, or mark it as pending |
| 3 | Consider | :35 | The cell cites only research/21 :35, which is not approved. Ledger :88 (M2 source) states "pitest Conditionals Boundary ↔ B3". | `research/21 :35` → `ledger :88`; then drop the research/21 key at :41 |
| 4 | Consider | :243 | Edge 2 cites "ADR-0007" with no path. That ADR is in agent-factory, not in this repo, so a skills reader cannot open it. Ledger :96 already states the edge. | Drop "; ADR-0007", or write `agent-factory docs/adr/0007-…` |
| 5 | Consider | :99 | The M3 Good holds `make mutation · billing`, a project make target (check 5). It is a byte-for-byte copy of 68c:62, so pattern 7 and pattern 8 conflict. | Operator: amend 68c, or accept it |
| 6 | Noted | :71, :219 | The M2 and M10 Goods name the letter in a javadoc. The M2 check (:252) asks for "the letter named", not for a javadoc. No Good-only convention is demanded. | — |
| 7 | Dismissed | — | Fidelity M2–M6, M8–M10: meaning and because clause kept. M10 keeps the S4 exception as an edge (checklist 9). | — |
| 8 | Dismissed | — | Pointers: B1, B3 (`boundaries.md`), C1, C4 (`coverage-design.md`) and S4 (`strategy.md`) exist and say what the pointers claim. | — |
| 9 | Dismissed | — | Cells :33, :34, :37, :38 match 68c :64, :65, :170-171 and :228. Cell :36 matches ledger :88. | — |
