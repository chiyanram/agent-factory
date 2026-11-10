# T2 services.md — round 1 (find + verify)

File: skills `.claude/worktrees/feat+32-code-services/plugins/rulebook/skills/code/references/services.md` (134 lines, contents line present).
All 4 code blocks match the worktree's `research/68f-neutral-code.md` byte for byte (LY1 68f :586-626, LY2 :628-670). Plan ids LY1, LY2, LY3 present; LY6/LY7 pointed to `spring.md` per plan note (research/34:139).
Sources re-read: pstack `principle-boundary-discipline` @f713f14 :9, :27; `interrogate/references/code-quality-review.md` :33-35; mattpocock `tdd/mocking.md` @49dd158 :3-14; `codebase-design/SKILL.md` :65.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Act on | :130-131 | "find a fake of it in the tests or a caller in another module. Neither is a finding." reads as "neither of these counts as a finding". The intent is the opposite. | :131 `Neither is a finding.` → `An interface with neither is a finding.` |
| 2 | Act on | :131-132 | "An implementation not named `Default<Name>`…is a finding" drops LY2's "single". An interface with several real implementations (e.g. `PaymentGateway`) would have every implementation flagged. | :131 `An implementation not named` → `A single implementation not named` |
| 3 | Act on | :58-60 (68f :612-613) | Cross-rule audit: the LY1 Good names parameters `req` and `auth`. NM1 (`smells.md`) allows no abbreviation beyond `id`, `url`, `api`. | Fix at 68f :612-613: `req` → `request`, `auth` → `authentication` (and the use at :61 `callerOf(authentication)`, `…, request)`); re-copy. |
| 4 | Act on | :87-90 (68f :642-643) | Cross-rule audit: the LY2 Bad also breaks JV9 (`java.md`; brace-less `if … return g;`, the exact "copy this" case JV9's reason names) and NM1 (`g`). A Bad breaks only its own rule. | Fix at 68f :642-643: `for (PaymentGateway gateway : gateways) {` / `if (gateway.supports(method)) {` `return gateway;` `}`; re-copy. |
| 5 | Consider | :112 | The LY2 Good throws `UnsupportedPaymentMethodException`, not the project's base exception with an `ErrorCode` (ER2, `errors.md`); an unsupported method from a caller may also be a foreseeable non-success (ER1). | Operator: accept (exception assumed to extend the base), or 68f :665 → `new OrderException(ErrorCode.PAYMENT_METHOD_UNSUPPORTED, method)`. |
| 6 | Consider | :132 | The `*Impl` grep enforces TY13 (`types.md`: "no `Impl` suffix"), a fact another rule owns (pattern 4). | `and so is *Impl (grep …)` → `(a `*Impl` name is also TY13, `types.md`)`. |
| 7 | Consider | :24 | Second why "tests build the class with fakes of its own boundary (68f :668)" cites a Good caption, not a source line (pattern 6). The first why (mattpocock :65 via ledger :256) carries the cell alone. | Drop `· tests build the class … (68f :668)`. |
| 8 | Dismissed | — | Fidelity LY1–LY3: meaning and because kept (ledger :255-257). | — |
| 9 | Dismissed | — | Edge :120-122 cites 68f :604 and :624, the approved pair's captions (research/33). The rule (LY1, "a branch that chooses an outcome") already implies that an exhaustive switch over a returned outcome is shaping. | — |
| 10 | Dismissed | — | `ApiResponse` (:57, :63) is a generic envelope name in the approved 68f Good; not an Aruvii module or path. | — |
| 11 | Dismissed | — | Checks LY1, LY3 cover every item their rule names. ≤300 lines. | — |
