# T1 unit-tests.md — round 1 (find + verify)

File: skills `.claude/worktrees/feat+31-testing-unit-tests/plugins/rulebook/skills/testing/references/unit-tests.md` (159 lines, contents line present; no examples file).
Ledger rows read: 19:27-30 (U1-U4), :134 (U2a), :143 (CV6 merged into U2a). Sources re-read: spock-best-practices SKILL.md :50-57, :78-83; mattpocock `tdd/mocking.md` :1-14; addyosmani `test-driven-development/SKILL.md` :238-243.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Act on | :14-16 | U2 keeps the naming clause "named as a plain behaviour sentence, not shouldXxx". Ledger 19:28 marks that clause SUPERSEDED by U2a (19:134, APPROVED): every name starts with "should"; JUnit legacy keeps shouldXxx(). U2a is absent from the file. | U2 → "Write every Spock feature in labelled blocks (`given:`/`when:`/`then:`; `expect:` for a pure function; `where:` for a table), because the labels tell Spock which lines are assertions." Add **U2a** — "Start every test name with "should": Spock `def "should …"()`, legacy JUnit `shouldXxx()`, because …" (reason: see #2) |
| 2 | Consider | new U2a | U2a is NO-REASON in the ledger. research/31:26 drafts one ("a 'should' name states the expected behaviour, which makes a failed test report say what broke"), confidence "implied", listed among the weakest. | Operator approves a reason, or flags U2a for deletion |
| 3 | Act on | :152-154 | The U2 check enforces the superseded clause and not U2a. | Add: "A Spock feature name that does not start with "should" is a finding (U2a)." Keep the camelCase finding |
| 4 | Consider | :28 | Pointer "U4 (`code/references/java.md`)": no such file exists yet. Ledger 19:30 names the home only as "code/references". | Point to "U4 (`code` references)" until the file lands, or confirm java.md as U4's home |
| 5 | Consider | :134 | "U2's reason comes from Spock BP :52, :55, approved by the operator; the ledger row 19:28 has none." is narration (checklist 13). | Fold into the source line under the When-X table: "U2's because: Spock BP :52, :55." |
| 6 | Consider | :140-142 | Edge 2 restates K9 and K9's reason (pattern 4: point, never restate). | Shorten to "**Skip when** a `@Shared` field holds an expensive read-only resource (K9, `spock.md`). — **Do not skip when** it holds a mock or mutable state (K9). — **Confidence** high" |
| 7 | Noted | :12-13 | U3 drops "asserting only that interaction" (owned by K4, pointed to at :25, :158). | — |
| 8 | Dismissed | — | Every When-X cell holds at its cited line: Spock BP :56, :79, :80, :81, :82; mocking :3, :7, :10-14; ladder :240-243. | — |
| 9 | Dismissed | — | Pointers K3, K4, K9, K17, K20 (`spock.md`), GT1 (`scenario-to-tests.md`), C1 (`coverage-design.md`), B1 (`boundaries.md`) exist and match. | — |
| 10 | Dismissed | — | U1 check covers all five A-TRIP letters; U3 check covers boundary, Stub, Mock, fake. No project names. | — |
