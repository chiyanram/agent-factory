# T1 examples audit — group 2 (strategy / integration-tests / scenario-to-tests)

Part of chiyanram/agent-factory#31 — testing rule files in chiyanram/skills. Read-only audit.

Tree: `/private/tmp/claude-501/audit/main/plugins/rulebook/skills/testing/references/`
Rule set read: `## Rules` + Review checks of all 11 files (B, C, V, U, K, M, P, S/TM/AT, IT/SP/TM4, GT/CV2, EA–ED).
Main-file pairs (`strategy.md`, `integration-tests.md`) are byte-identical subsets of their `examples/` files; audited once.

## Counts

| file | rule ids | blocks | Bad n/a | Good findings | Bad findings |
|---|---|---|---|---|---|
| examples/strategy.md | 9 (S1 S2 TM1 TM2 TM3 AT1 S3 S4 S5) | 17 | 1 (S4) | 4 | 1 |
| examples/integration-tests.md | 17 (IT1–IT5, TM4, SP1–SP11) | 30 | 4 (TM4 SP1 SP2 SP6) | 4 | 4 |
| scenario-to-tests.md | 7 (GT1–GT6, CV2) | 14 | 0 | 1 | 2 |
| **total** | 33 | 61 | 5 | 9 | 7 |

No Good does a hard-forbidden thing (no `@MockitoBean`, H2, `@Container`, MockMvc, unlabelled Spock block, field-default assert). Every Bad breaks its own rule.

## Findings

| file · pair | G/B | rule broken (id · file) | offending line | bucket | smallest fix |
|---|---|---|---|---|---|
| strategy · S1 | Good | U3 · unit-tests (fake over double where one exists) | `PaymentGateway paymentGateway = Stub()` — `FakePaymentGateway` exists (IT5/SP1/SP2 examples) | Consider | `new FakePaymentGateway()` |
| strategy · S5 | Good | K3 · spock (risk) — needs `Mock()`; S1 Good declares `orderRepository = Stub()` | `0 * orderRepository._` | Consider | show `OrderRepository orderRepository = Mock()` |
| strategy · TM1 | Good | U2 · unit-tests (`expect:` is for a pure function) | `expect: "a filter that ignored the status…"` over 3 DB queries | Consider | `when:`/`then:` |
| strategy · AT1 | Good | none by id — correctness: no token (all others use `login("CLERK")`), and asserts PAID on an order seeded PLACED | `client.post().uri("/api/orders/{id}/cancel", orderId).exchange()` · `status() == OrderStatus.PAID` | Consider | add `.header(AUTHORIZATION, login("CUSTOMER"))`; assert `!= CANCELLED` |
| strategy · TM3 | pair | TM3 · strategy — the rule is a real **model** tier; both blocks use a payment sandbox | `"an open invoice on the gateway sandbox"` | Consider | recast on a real-LLM call, assert structure |
| strategy · S5 | Bad | also K19 · spock (unbound `thrown`) — Good differs on two axes | `thrown(IllegalArgumentException)` | Consider | `def e = thrown(...)` in Bad too |
| IT · IT4 | Good | IT4 · integration-tests (says "fake port **bean**") + IT1 (wiring): subject built with `new`, fake is a field, no bean | `def reminder = new OverdueReminder(invoiceRepository, emailSender, clock)` | Fix | autowire `OverdueReminder`; fake from shared fakes config |
| IT · SP1 | Good | IT4 decided edge + K15 · shared fake set holds the port (SP2 Good) yet class overrides it | `@TestBean PaymentGateway paymentGateway` | Consider | pick a port not in `OutboundFakesConfig` |
| IT · TM4 | Good | TM4 · integration-tests (latency, timeout **and** cut) — shows cut only | `bandwidth("cut", ToxicDirection.DOWNSTREAM, 0)` | Consider | add latency/timeout rows or note "one of three" |
| IT · SP10 | Good | U2 · unit-tests (`expect:` on a repo query) | `expect: "an invoice due today is not overdue yet…"` | Consider | `when:`/`then:` |
| IT · IT4 | Bad | also U2 (camelCase shouldXxx) | `def "shouldSendTheOverdueNoticeWhenTheReminderRuns"()` | Consider | sentence name |
| IT · SP4 | Bad | also K19 (bound exception, no condition) | `def e = thrown(ConstraintViolationException)` | Consider | the "never thrown" label is the point; drop `def e =` |
| IT · SP3 | Bad | also V3 junk 1 (no assertion) | `…header(AUTHORIZATION, clerkAuth).exchange();` | Consider | add `.expectStatus().isCreated()` |
| IT · SP10 | Bad | own rule not shown: body only reads, so no write commits | `() -> repo.findOverdue(today)` | Consider | timed body that persists |
| scenario · GT4 | Good | EA5 · smoke-specs (fails a dependency on purpose, asserts only the reply half) | `await expect(page.getByRole('alert')).toContainText('Payment declined')` | Fix | add "no successful payment record" step |
| scenario · GT2 | Bad | also GT1 + GT4 (name not the title, no `@Issue`) | `def "D4 — an invoice past its due date can never stay open"()` | Consider | keep Good's name and `@Issue` in Bad |
| scenario · GT5 | Bad | also GT1 + GT4 | `def "D1 — no discount makes an invoice total negative"()` | Consider | add `@Issue`, scenario title |

## Rule tensions

| rules | tension |
|---|---|
| TM2 (strategy) vs IT5, IT2, TM4 (integration-tests) | TM2: in ITs, third-party HTTP is WireMock at the wire. IT5 runs a contract spec against the real adapter on Testcontainers; IT2/TM4 Goods use a gateway sandbox container ("the real gateway sits behind a proxy"). TM2 needs a carve-out for the adapter's own IT and fault-injection ITs. |
| U2 (unit-tests) vs IT Goods | U2 restricts `expect:` to pure functions; read-only repo/HTTP queries in ITs (TM1, SP10 Goods) use it. Say whether "side-effect-free read" counts. |
| IT4 wording vs TM2 | IT4 permits faking any "outbound port"; S1 Good calls a repository an outbound port; TM2 forbids faking repositories in ITs. IT4's table defers to TM2, but the rule sentence does not. |
