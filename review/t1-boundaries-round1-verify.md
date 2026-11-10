# T1 boundaries.md — round 1 verify

Find-pass line numbers are stale (about 11 lines off). Lines below are the current file.

| # | bucket | why | fix (Act on) |
|---|---|---|---|
| 1 | Act on | B1 = all 7 letters per input (ledger :19). Check :154 opens only the row; :19 "the letter it always hits" is unsourced | :154 → "B1 — For each such input, find a case or a `skip:` line for each of the seven letters. The input's table row gives the minimum cases. A letter with neither is a finding." · :19 "always hits" → "triggers" |
| 2 | Consider | Reader can map a case to a letter via the "cases to write" column (checklist 2 allows a reader). Header is example-only, no rule; adding one = invented rule | — |
| 3 | Act on | Verified against plinth: Range :94, Conformance :42, Existence :149 ("distinct domain meanings"), Cardinality :176, Time :211, Reference :119 hold. Ordering cell does not: :67 says exact order for sorted, order-insensitive for unordered. "dependency unavailable" is owned by C2. :31 cites no line | :25 Ordering → "sorted: assert exact order; unordered: assert without order (:67)" · :29 → "the record is missing; for an unavailable dependency, see C2 (`coverage-design.md`)" · :31 → per-row cites `plinth 130-correct:42/67/94/119/149/176/211` |
| 4 | Act on | Edge :146 has no Skip/Do-not-skip shape (checklist 8) and restates P2 (WD7). The file name matches 34-l1-file-plan:57, so the pointer is not dangling once that file lands | :146-148 → "- **Do not skip when** a property test covers the same input: the CORRECT examples stay beside it (P2, `property-based.md`). — **Confidence** high" |
| 5 | Consider | "Real evidence: ledger row" is the skeleton's own text (00-reference-format:91), so Dismissed. Confidence is a required field, not a sourced fact, so Dismissed. The "plinth" name stays as a source label; fix 3 sets its form | — |
| 6 | Consider | Format :34 allows "the reverse". "Skip when" makes "applicable" observable (checklist 9). "Do not skip" repeats B2's reason clause | — |
| 7 | Consider | :3-4 second sentence ~32 words (Register ≤25). Pure style | — |
| 8 | Consider | Fixture proves only that the heading is recognised. A `(ours)` too-long bad fixture would prove the measurement | — |

Extra (Consider): the table header `the logic takes | letter | cases to write` has no "why" column (00-reference-format:32, :73).

## Fix list

1. :154 B1 check covers all seven letters per input. :19 drop "always hits".
2. :25 Ordering cell rewritten from plinth :67.
3. :29 Reference unavailable → pointer to C2.
4. :31 per-row plinth line cites.
5. :146-148 edge 2 → Do-not-skip pointer to P2.

## Patterns for the other 10 files

- A review check covers every item its rule names (every letter, every dimension), not a subset from a table.
- Each table cell cites `source:line`. A cell no cited line states is cut.
- A fact owned by another rule is a pointer (`id`, `file.md`), never restated. Check the ledger's whole target list (e.g. C2 vs B1-Reference).
- Every Decided edge uses the Skip when / Do not skip when / Confidence shape. A bare statement is not an edge.
- A Good example's convention (e.g. a `CORRECT for` header) is not a rule. A check must not demand it.
- Verify the When-X columns against format :32 (situation · use · why).
- For any new heading variant, add a pair of fixtures: good, plus a bad that proves the section is measured.
