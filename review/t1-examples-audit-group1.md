# T1 examples audit — group 1 (Groovy/Java unit-level)

Part of chiyanram/agent-factory#31 — the testing rule files in chiyanram/skills. Read-only audit.

Tree: `/private/tmp/claude-501/audit/main/plugins/rulebook/skills/testing/references/`

Scope: `examples/spock.md` (K1–K20 + K2b), `unit-tests.md`, `value-bar.md`, `boundaries.md`, `coverage-design.md`,
`mutation.md`, `property-based.md`. The five pairs `spock.md` repeats (K1, K2, K11, K13, K19) are identical to
`examples/spock.md` and are audited once.

## Counts

| file | Good | Bad (n/a excluded) |
|---|---|---|
| examples/spock.md | 21 | 21 |
| unit-tests.md | 3 | 3 |
| value-bar.md | 5 | 4 (V5 n/a) |
| boundaries.md | 3 | 3 |
| coverage-design.md | 4 | 4 |
| mutation.md | 9 | 8 (M1 n/a) |
| property-based.md | 8 | 6 (P2, P7 n/a) |
| **total** | **53** | **49** |

Every Bad breaks its own rule. Findings below.

## Findings

| # | file · pair | G/B | breaks (id · file) | offending line(s) | bucket | smallest fix |
|---|---|---|---|---|---|---|
| 1 | examples/spock.md · K2b | Good | K4 · spock.md — counts a call the feature does not promise; the prose itself says the save "belongs to another feature". Same shape as K4 Bad | `1 * orderRepository.save(_) >> { Order o -> o }` | Act on | move it to `given:` as a stub: `orderRepository.save(_) >> { Order o -> o }` |
| 2 | examples/spock.md · K7 | Good | K9 · spock.md — `@Shared` only for an expensive resource; a UUID is cheap. Also random test data | `@Shared UUID invoiceId = UUID.randomUUID()` | Act on | `static final UUID INVOICE_ID = UUID.fromString("…")` (K7 allows static) |
| 3 | coverage-design.md · C2 | Good | U1 · unit-tests.md (Repeatable; review check greps `currentTimeMillis`) and C1 Performance row — "not a wall-clock threshold" | `def start = System.currentTimeMillis()` … `elapsedMs < 14_000L` | Act on | bound the hang with Spock `@Timeout(14)` on the feature and drop manual timing; or state the exception in C2 (see contradiction 3) |
| 4 | property-based.md · P8 | Good | P6 · property-based.md — the same home-grown `new Gen<>(){ generate(Random) }` harness the P6 Bad says "gives up edge-case injection"; `integers(0, 9999)` gets no 0/9999 by default | `final var numbers = Gen.integers(0, 9999);` | Act on | show the edge values composed in (e.g. `Gen.oneOf(0, 9999)` mixed in), or use a jqwik/fast-check-style generator with edges |
| 5 | value-bar.md · V2 | Good | U2 · unit-tests.md — pure expression in `when:`/`then:`; U2 Bad is faulted for exactly this | `when: "the problem types the error codes produce are collected"` | Act on | collapse to `expect:` `(PUBLISHED_PROBLEM_TYPES - ErrorCode.values()*.problemType()).isEmpty()` |
| 6 | property-based.md · P3 | Good | P3 review check — "a count for every branch"; only `Applied` is counted | `if (result instanceof Discount.Applied) { applied++` | Consider | count the non-applied branch too and assert both `> 0`, or narrow the review check to "every asserting branch" |
| 7 | property-based.md · P1, P3, P7 | Good | P6 / P4 — use the same home-grown `Property.forAll(Gen.…)` harness; edge injection and seed printing unshown | `Property.forAll(Gen.orders(), Gen.tiers())` | Consider | one line under the pairs naming the harness's edge/seed behaviour, or switch the Goods to jqwik |
| 8 | property-based.md · P1 | Good | U2 — pure law under `when:`/`then: noExceptionThrown()`; P7 Good uses `expect:` for the same shape | `then: "every second merge returned…"` `noExceptionThrown()` | Consider | use `expect:` as P7 Good does |
| 9 | coverage-design.md · C1 | Good | U2 — the act (persist) sits in `given:`, the assert in `expect:` on non-pure DB read | `given:` … `em.persistFlushFind(newOrder()).id` | Consider | `when:` persist + clear, `then:` read row |
| 10 | coverage-design.md · C1 / value-bar.md · V5 | Bad / Good | same feature is C1 Bad and V5 Good | `new OrderEntity().status == OrderStatus.DRAFT` | Consider | give C1 Bad a different subject, or note it fails C1 only for the missing header |
| 11 | coverage-design.md · C3 | Good | V3 junk 8 · value-bar.md — name promises storing, test only calls `normalise` | `"should store an email typed in mixed case in lower case"` | Consider | `"should normalise an email typed in mixed case to lower case"` |
| 12 | unit-tests.md · U1 | Good | V3 junk 8 — name promises a reminder, test checks a selection list | `"should remind an invoice one day past due…"` / `overdue*.id() ==` | Consider | `"should treat an invoice one day past due as overdue, and not one due today"` |
| 13 | examples/spock.md · K10 | Good | U1 table — "a fixed clock"; stubs `clock.instant()` (zone left to Stub default) | `clock.instant() >> Instant.parse("2026-11-01T09:00:00Z")` | Consider | `Clock.fixed(Instant.parse(…), ZoneOffset.UTC)` in the subject's constructor |
| 14 | boundaries.md · B3 | Good | B3 — "each edge"; only the upper edge 99/100 shown, lower edge 0/1 absent | `quantity of exactly 99` / `quantity of 100` | Consider | add a one-line note "lower edge 0/1 alike", or a 2-row table |
| 15 | value-bar.md · V1 | Bad | also V3 junk 3 (identical code is V3 Bad) — muddies V1's lesson | `["DRAFT", "PLACED", … ].every { OrderStatus.valueOf(it) != null }` | Consider | V1 Bad: a test with no Q2 answer that is not a junk pattern |
| 16 | value-bar.md · V2 | Bad | also V3 junk 3 (hand-copied enum list) | `ErrorCode.values()*.name() as Set == [ 'ORDER_NOT_FOUND',` | Consider | accept, or pick a V2 Bad that asserts a private call order |
| 17 | examples/spock.md · K18 | Bad | also K10 — interaction `>>` inside a helper | `customer.getId() >> UUID.randomUUID()` in `private Customer customer()` | Consider | inline the Spy in the feature `given:` |
| 18 | mutation.md · M4 | Bad | accuracy — `get*`/`is*` are method globs; `excludedClasses` cannot exclude `Invoice.isOverdue` | `excludedClasses.set(listOf(…, "get*", "is*"))` | Consider | move them to `excludedMethods.set(listOf("get*", "is*"))` |
| 19 | mutation.md · M5 | Bad | shows an over-matching glob (M4-ish), not a missing before/after comparison | `avoidCallsTo.set(listOf("org.slf4j", "org.springframework"))` | Consider | add "-- no per-class counts compared" text, or a report line "survivors 18 → 4" with no class table |
| 20 | mutation.md · M2 / M10 | Good | M2 — letter named looks wrong: "Cross-check" (needs an independent oracle) / "Reference" (a lookup) | `RIGHT-BICEP · Cross-check: the gateway stays unconsulted`; `CORRECT · Reference` | Consider | M2: `Right`; M10: `Right` or `Inverse` |

## Rules that seem to contradict each other

| # | rule A | rule B | conflict |
|---|---|---|---|
| 1 | K6 — "write a data-driven feature as a `where:` table" | Goods V4, B2, K7, K8, P2 use data pipes `x << [...]` | K6 reads as banning pipes. Fix: K6 allows `<<` for one column |
| 2 | U2 — `expect:` for a pure function | V2 Good, P1 Good use `when:`/`then:` on pure code | readers get two answers |
| 3 | C2 — "no hang" (needs a time bound) | U1 Repeatable (no wall clock) · C1 Performance "not a wall-clock threshold" | C2 cannot be met without a time bound. Fix: name `@Timeout` as the allowed form |
| 4 | V5 Decided edge — keep field-default test | C1 Bad and C1 Good prose ("instead of a field default") | same code is Good and Bad |
| 5 | P3 rule ("each branch") / review ("every branch") | P3 Good counts one branch | rule wording vs its Good |
| 6 | U2 — "not shouldXxx" | Aruvii `AGENTS.md` — "Given/When/Then + `shouldXxx`" | outside this rule set; only matters where both load |
