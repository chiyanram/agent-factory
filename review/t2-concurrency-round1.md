# T2 concurrency.md — round 1 (find + verify)

File: skills `.claude/worktrees/feat+32-code-concurrency/plugins/rulebook/skills/code/references/concurrency.md` (215 lines, contents line present).
All 6 code blocks match the worktree's edited `research/68f-neutral-code.md` byte for byte. The 68f edits (CC3 Bad: executor added; CC4 Bad: `ofVirtual` → `ofPlatform`; CC9 Bad: `catch (Exception)` → `catch (IOException)`) each make a Bad break only its own rule. Plan ids CC1–CC10 present.
Sources re-read at the pinned commits: plinth 125 @a46375a :31-40, 126 :33-34, 142 :836-855, 123-cross-cutting :42-43, :92-95, :149-152; addy api @aeac41d :156-171, :213; addy perf :113-116, :181, :230-232; pstack `principle-separate-before-serializing-shared-state` @f713f14 :9-16. Every cell and edge cite holds.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Act on | :39 | "CPU-bound, short, side-effect-free work → ForkJoin or a parallel stream" conflicts with JV2 (`java.md`: "never `parallelStream()` or `.parallel()`" in request- or queue-serving code). The cited pl125 :37 itself adds "Do not rely on `parallelStream()` in request-scoped code paths". | :39 use cell → `ForkJoin or a parallel stream, outside request- or queue-serving code (CC2; JV2, java.md)` |
| 2 | Act on | :69, :83 (68f :224, :237) | Cross-rule audit: the CC3 Good's `@Bean` declares `PaymentGateway` but builds `HttpPaymentGateway`. SC6 (`spring.md`) requires the most specific type built. The Bad has the same declaration, so it also breaks SC6. | Fix at 68f :224 and :237: `public PaymentGateway paymentGateway(` → `public HttpPaymentGateway paymentGateway(`; re-copy :69, :83. |
| 3 | Consider | :206-207 vs :118-125 | The CC4 check says "for each pool built (`ThreadPoolExecutor`…) find a bounded queue and a stated rejection behaviour". The CC4 Good builds a `ScheduledThreadPoolExecutor` with neither (it bounds the stream queue instead). A reviewer who follows the check flags the Good. | Operator: either scope the check ("a pool that accepts submitted work"), or accept. No source states the narrower scope, so it is a flag. |
| 4 | Consider | :118-125 | The CC4 Good starts a periodic task inside a `@Bean` method (`scheduleAtFixedRate`). SC20 (`spring.md`) makes "a component that starts and stops background work" a `SmartLifecycle` bean, never started by hand. | Operator: accept (the executor is Spring-managed, stopped by `destroyMethod`), or move the start into a `SmartLifecycle` at 68f. |
| 5 | Consider | :11-12 | CC1: ledger :269 says "avoid blocking inside class initialisers"; the file says "never block". The wording is stronger than the source. It removes a "consider/avoid" word (checklist 2). | Operator: accept the strengthening, or note it. |
| 6 | Dismissed | — | Fidelity CC2–CC10: meaning and because kept (ledger :270-278). | — |
| 7 | Dismissed | — | Edges: JEP 491 is the ledger's source for CC1 (:269); the `orTimeout` edge follows from CC3's text; the key edge matches pl123cc :95 and addy :163; the lock edge matches ps separate :15-16; the `join()` edge matches pl142 :839. | — |
| 8 | Dismissed | — | Checks CC1–CC10 cover every item their rule names. | — |
| 9 | Dismissed | — | CC9 Good obeys ER4 (narrow catches), ER5 (interrupt restored), ER1/TY2 (sealed outcome), TY4. CC4 Good obeys SC6. Neutral: no project words. | — |
