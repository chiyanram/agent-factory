# T2 design.md — round 1 (find + verify)

File: skills `.claude/worktrees/feat+32-code-design/plugins/rulebook/skills/code/references/design.md` (50 lines, no contents line needed), plus its README row.
Read: ledger (worktree copy) :133, :200, :383, :568; agent-factory research/31:25, research/32:34, research/34:134, #21 Q3 (comment line 15) and Part A/B (line 57); sibling `types.md` (TY1, TY2, TY3), `smells.md` (baseline, DS3, DS11). 68f: no SEAM1 pair (confirmed). `check_skills/links/sizes/index` exit 0.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Consider (operator flag) | :8-9, :26-27 | SEAM1's because comes from research/32:34 (the root-MUST pick, accepted in #21 Part B "accept all"), not from the ledger (NO-REASON) or research/31. research/31:25 holds a different approved SEAM1 reason ("callers switch exhaustively over a sealed result, which makes a new case fail to compile…", partial: S-4). The chosen reason covers only the complexity clause of a seven-item rule. | Operator confirms the research/32 reason, or swap in research/31:25 and cite it |
| 2 | Consider | :39-41 | Edge 2 "Skip when a project states its own seam rules: point to them and do not copy them here" is an authoring instruction, not a review case; a reviewer cannot tell whether SEAM1 is skipped. | Reword: "**Skip when** a project's own seam rule covers the item: cite that rule instead of SEAM1 …" or drop the edge (OQ1 is policy, not an edge) |
| 3 | Consider | :20 | "a rule list, not an if-ladder" overlaps DS3 (`smells.md`: model the case as sealed type, enum switch, table or state machine). Pattern 4: point, do not restate. | Add "; the cure catalogue is DS3, `smells.md`" to the why cell |
| 4 | Noted | :39-41 vs smells.md :186 | design.md edge says "no file wins" (OQ1); smells.md DS11 edge says "the repo rule wins". Different scopes (rule vs heuristic) but opposite words. | Cross-file; see report |
| 5 | Dismissed | — | Rule 34 words. Items in the check match the rule one for one (one job, record in, sealed out, decision w/o I/O, I/O w/o choice, if-ladder, CC ≤5). | — |
| 6 | Dismissed | — | Cells :15-22 each traced: ledger :133 quotes present; #21 Q3 states "I/O decides nothing" and "no null"; :568 R37-D8. Edge 1 stated by OQ3 :200. | — |
| 7 | Dismissed | — | Plan research/34:134: SEAM1 only; precedence clause dropped; S-1..S-7 not here. Pointers TY1/TY2/TY3 (`types.md`) and baseline (`smells.md`) exist and say what is claimed. No Aruvii names. | — |
