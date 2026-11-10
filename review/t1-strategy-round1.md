# T1 strategy.md — round 1 (find + verify)

Files: skills `.claude/worktrees/feat+31-testing-strategy/plugins/rulebook/skills/testing/references/strategy.md` (290 lines, contents line present) and `references/examples/strategy.md` (315 lines).
Ledger rows read: 19:9-13 (S1-S5), :35 (AT1), :37-39 (TM1-TM3). Plinth cells re-read in `refs/plinth-pinned/` (058:36, 321:47, 322:57-58).

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Consider | :22-23 | S3: reason not in ledger. Ledger 19:11 is NO-REASON; the reason is agent-factory research/31:19 (confidence "implied"). | Operator approves the reason, or flag S3 for deletion (checklist 2) |
| 2 | Consider | :10-11 | S1 drops the ledger clause "Never start a Spring context to test plain service logic", yet its because is about a Spring context. The review check (:271-272) still enforces the dropped clause. | Rewrite: "Test pure logic in a unit spec with no Spring context, a real boundary … in an IT, and a user journey in a smoke spec, because a Spring context makes plain service tests slow." |
| 3 | Consider | :32 | Why "the flow needs real collaborators" is stated at plinth 322:58, not :57 (:57 is the title). | `plinth 322:57` → `plinth 322:57-58` |
| 4 | Consider | :33 | The why column holds only "S1 · ledger :9"; no reason (pattern 3). Ledger :9 gives none for the smoke tier. | Add a sourced why, or leave the cell and accept a rule-id-only why |
| 5 | Consider | :197-216 | The S3 pair kept in the main file shows `make test MOD=… TEST=…`, and its caption says "It goes through `make`". This is the project's build convention (68a header lists it as a stand-in). Code is byte-for-byte by decision, but the choice of pair is not. | Keep S3 in examples only; put S4 in the main file instead |
| 6 | Noted | examples :159 | TM3 Bad code comment "so it runs inside make verify" — project make target inside code (byte copy of 68a:256). | — |
| 7 | Noted | :18-19, :262-264 | TM3's "must pass before a release and when prompt or provider code changes" moved from the rule to a Decided edge and a review check. Meaning kept. | — |
| 8 | Dismissed | — | Every When-X cell and both edges cite lines that state them: ledger :9, :13, :35, :37, :38, :39; plinth 058:36 ("do not infer @integration-test from … error behavior"), 321:47. | — |
| 9 | Dismissed | — | Pointers V3 (`value-bar.md` junk pattern 3 = hand-copied enum list, :43), V4 (`value-bar.md`), GT5 tier choice (`scenario-to-tests.md`) exist and say what is claimed. | — |
| 10 | Dismissed | — | Examples: every id S1-S5, TM1-TM3, AT1 has a pair; S4 Bad is the n/a line from 68a:111. S1 Bad (68a:9-24), TM3 pair (68a:253-288) and S4 Good (68a:113-129) diff byte for byte. Captions in the two files match. AT1 caption drops "REQ-123-" from 68a:396 (neutral). | — |
| 11 | Dismissed | — | Review checks cover every item each rule names; none demands a Good-only convention. | — |
