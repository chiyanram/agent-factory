# T1 scenario-to-tests.md — round 1 (find + verify)

File: skills `.claude/worktrees/feat+31-testing-scenario-to-tests/plugins/rulebook/skills/testing/references/scenario-to-tests.md` (262 lines, contents line present).
All 17 code blocks match `research/68c`. The ledger targets `testing/workflows/`. research/34:123 moved the file to `references/`.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Consider | :34-39 | Every cell cites "R21" = research/25, whose :4 says "Nothing below is approved." The lines do state the facts (:51, :52, :53, :54, :56), and the ledger rows 19:69-72 and :139 cite the same Spock and Playwright doc sections. Contract item 2 makes this Act on only for edges. | Re-cite to the ledger (`19:69`…`:72`, `:139`), or keep it and mark research/25 as doc-section pointers only |
| 2 | Consider | :26 | The GT6 because clause is not in the ledger. Ledger :74 says NO-REASON. The text comes from agent-factory research/31:22 ("implied"). | Operator: approve it or not |
| 3 | Consider | :19-20, :257-258 | GT4 says "not in its name", and the check makes an id in the name a finding. Ledger :72 allows the scenario id "in the name or annotation". The reword follows research/34:123 ("AC id goes in @Issue([...]) only") and CV1 (ledger :138: not in the title). | Operator: confirm that the research/34 reword is approved |
| 4 | Consider | :18 | The GT3 because clause ("fed counts, not the scenario's seconds") is ledger-verbatim. It describes the project's login-throttle case and does not match the neutral discount example. | Keep it (pattern 7), or ask for a neutral restatement |
| 5 | Noted | :11 | The pointer to `planning/references/acceptance-criteria.md` (GA2, GA3, GA6, CV1) matches the ledger targets (:64-68, :135, :138). The file is not written yet. | — |
| 6 | Dismissed | — | The edge :242-244 is stated by ledger :73 ("smoke only if the UI must show the refusal"). | — |
| 7 | Dismissed | — | Fidelity GT1–GT3, GT5 and CV2 is kept. The checks cover every item, including the e2e one-row rule and both GT4 carriers. | — |
