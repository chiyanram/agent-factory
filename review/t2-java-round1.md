# T2 java.md — round 1 (find + verify)

File: skills `.claude/worktrees/feat+32-code-java/plugins/rulebook/skills/code/references/java.md` (180 lines, contents line present), plus the worktree's edits to `research/68b` (U4 Good: `final LocalDate cutoff`) and `research/68f` (JV1 Bad: `clock.millis()`).
Read: ledger (worktree copy) :27, :30, :136-140, :189-200, :206, :536; research/34:133; plinth pinned copy (`.scratch/one-rulebook/refs/plinth-java-skills`, `plinth-pinned/321`) for every cell; sibling rule lists of all 12 code worktrees and testing `unit-tests.md`. Byte-check: all 7 blocks match their 68b/68f/68c source. `check_*` exit 0.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Act on | :57-59 (68b :113-118) | U4 Bad also breaks ER1 (`errors.md`): "already paid" is a foreseeable non-success, thrown. A Bad breaks only its own rule. | Delete the `if (invoice.status() == InvoiceStatus.PAID) { throw … }` three lines at 68b, re-copy |
| 2 | Act on | :84-95 (68f :11-24) | JV1 Bad also breaks ER4 (`catch (Exception e)`), TY1 (`null` argument to `ChargeRequest`), TY4 (non-final new locals) and NM1 (`t0`, `resp`, `ms`). | At 68f replace with: `final long chargeStartMillis = clock.millis();` · `final ChargeReply reply = paymentGateway.charge(chargeRequest(invoice, customerId));` · `final long elapsedMillis = clock.millis() - chargeStartMillis;` · the Good's `log.info(` block with `elapsedMillis`; re-copy |
| 3 | Act on | :118, :119 (68f :47-48) | JV5 Bad also breaks TY1 (`principal != null ? … : null`) and NM1 (`result`). | :118 → `final var customerId = UUID.fromString(principal.getName());`; `result` → `placed` (only the hidden `var` type stays wrong) |
| 4 | Act on | :120, :130, :134 (68f :49, :59, :63) | JV5 Good breaks LY3 (`services.md`: an answer and its audit behind one method; here the controller makes two calls) and NM1 (`servletReq`). | Drop the `audit.logOrderPlaced(…)` line and the `servletReq` parameter from Good and Bad at 68f; re-copy |
| 5 | Consider | :132 | JV5 Good passes two `UUID`s (`id`, `customerId`) to `orderService.place` — TY8 (`types.md`) would flag it. | Operator: accept at a wire boundary, or wrap (`OrderId`, `CustomerId`) at 68f |
| 6 | Consider (operator flag) | :32-33, :154 | CV3's because is reworded (ledger :140 names dropped ST2); in neither ledger nor research/31. The file says so. Note sits under Good / Bad, unlike T1 files (footnote under When X). | Operator approves the reason; move :154 below the :48-49 footnote |
| 7 | Consider | :164-165 | "the project's Checkstyle config fails the build on them" asserts one project's gate (pattern 8). A project without it gets no JV2/JV6/JV9 check. design.md handles the same case as a conditional edge. | Reword: "JV2, JV6 and JV9 have no check here: a Checkstyle gate owns them (OQ3) — `RegexpSinglelineJava`, `IllegalType`, `NeedBraces`." Operator: add an edge for projects with no gate? |
| 8 | Consider | :39 | `plinth 321 :135` is the Title line; "static calls on final value types" is :136 (pinned copy). | `:135` → `:136` |
| 9 | Consider | :158-160 | X1 edge "Skip when a framework's style guide bans `var`" does not say what is skipped. | "**Skip when** a framework's style guide bans `var`: do not apply that ban; JV5 still governs (ledger X1 :536)." |
| 10 | Consider | :43 | JV6 row restates absence handling that TY1 (`types.md`) owns. | Add "absence itself is TY1, `types.md`" to the why cell |
| 11 | Noted | :158 | Spring CONTRIBUTING.md:596 has no local copy; accepted via ledger X1. | — |
| 12 | Dismissed | — | All 11 plan ids present (U4, JV1-JV9, CV3); JV10, JV12 absent as planned; JV2/JV6/JV9 without checks per plan. Each rule keeps ledger meaning and because; all ≤35 words. | — |
| 13 | Dismissed | — | Cells pl141 :294, :507-508, :914; pl142 :740, :772; pl121m :354-365; pl126 :195 hold. U1 pointer (`unit-tests.md` :10, :28) says fixed clock and points back to U4. Checks cover each item named. | — |
