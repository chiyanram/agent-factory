# T1 property-based.md — round 1 (find + verify)

File: skills `.claude/worktrees/feat+31-testing-property-based/plugins/rulebook/skills/testing/references/property-based.md` (296 lines, contents line present).
All 16 code blocks match `research/68c` byte for byte. P5 and CV4 are absent by plan (research/34:125).
research/27:4 and research/21:4 both say "Nothing here is approved."

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Act on | :267-269 | The P1 edge rests only on `27:81`, which is not approved (research/27:4). | Delete :267-269. At :281-282, delete ", unless a P1 Decided edge applies" |
| 2 | Act on | :12-13, :76 | P2 drifted. The ledger (:99) says "A property complements the example tests". The operator softened the rule from "never replaces". The rule says "a property does not replace them", and the heading says "A property never replaces examples". | :12-13 → "**P2** — Keep the CORRECT and just-inside/just-outside cases (B1–B3, `boundaries.md`) as example tests beside the property, which complements them, because its generators may never produce the named edge, such as null." · :76 heading → "P2 — A property complements its examples; boundary cases stay beside it" |
| 3 | Act on | :32 | The cell cites `21:26`, which is the table's `|---|` separator line, in a source that is not approved. | Delete `· \`21:26\`` (`19:99` states the cell) |
| 4 | Act on | :193 | The heading "runs in make test" names a project make target (check 5). Rule P7 at :20 already says "the main unit-test target". | :193 → "P7 — A JVM property is a unit test: runs in the main unit-test target, counts toward coverage" |
| 5 | Consider | :31, :33-35, :274 | The cells and the P8 edge cite research/27 or 21 next to the ledger. Those sources are not approved, and the ledger cite alone states each one. | Drop the `27:` and `21:` cites. Drop the `21`/`27` key at :37-38 |
| 6 | Consider | :199 | The P7 Good holds `make test` (byte copy of 68c). Pattern 7 and pattern 8 conflict. | Operator decides, together with mutation #5 and coverage-design #2 |
| 7 | Noted | :44 etc. | The headings carry a `(68c:N)` cite. The model boundaries.md has none. | Optional: move the cite to the line under the heading |
| 8 | Dismissed | — | The P2 rule states the boundaries.md → P2 contract ("CORRECT examples stay beside it"). | — |
| 9 | Dismissed | — | Fidelity P1, P3, P4, P6, P7, P8, P10: kept. The checks cover every item (P10: four items; P6: five edge values). | — |
