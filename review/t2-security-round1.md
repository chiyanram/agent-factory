# T2 security.md — round 1 (find + verify)

Files: skills `.claude/worktrees/feat+32-code-security/plugins/rulebook/skills/code/references/security.md` (293 lines, contents line present) and `examples/security.md` (154 lines, contents line present).
All 12 code blocks match the worktree's edited `research/68f-neutral-code.md` byte for byte. The 68f edit (SE5 pair: `restClient` → `noRedirectRestClient`) makes the SE5 Good obey SE1. Plan: all 32 ids present; SS13–SS15, SS18 absent by plan (research/34:142). SE7 is written neutral ("the credential encryptor").
Sources re-read: addy `security-and-hardening/SKILL.md` @aeac41d :111, :117; `references/security-checklist.md` :55-67, :80-92, :192-201; agent-factory research/31:52 (SS20 reason, approved #21 Part A).
**Line budget:** the file is at 293 of 300. The Act on edits below are rewordings in place, not new lines.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Act on | :230-232 | The SE1 check flags a checked-fetch type that "checks IPs before DNS resolution". It does not flag one that never refuses private or reserved IPs, which SE1 names (pattern 1). | :232 `or checks IPs before DNS resolution` → `or does not refuse private and reserved IPs after DNS resolution` |
| 2 | Act on | :258-259 | The SS3 check covers only the `setEnabled(false)` half. SS3 also says "Register a custom security `Filter` in the chain" (pattern 1). | :258-259 → `A class extending OncePerRequestFilter or Filter that is not added to the chain, or is a @Component with no FilterRegistrationBean.setEnabled(false), is a finding.` |
| 3 | Consider | :208-210 | The SS2 edge restates the SS2 rule (:50-51) word for word: permit `ERROR`/`ASYNC` in one matcher with a comment; not `REQUEST`/`FORWARD`. Deleting it changes no behaviour (checklist 15). The ledger row says "(Decided edge.)", which is why it is here. | Delete :208-210, or keep it and drop the same text from the rule. |
| 4 | Consider | examples :127-134 (68f :1609-1616) | Cross-rule audit: the SS21 Bad also lets `null` decide a case (`found = null` … `.orElse(null)`), which TY1 (`types.md`) forbids. Same block at security.md :176-183. | Fix at 68f: `final Optional<ApiKeyEntity> found = … .findFirst();` with an `Optional.empty()` branch; re-copy both files. |
| 5 | Consider | examples :50-57 | Cross-rule audit: the SE4 Bad throws on a refused path; its Good returns a sealed `PathCheck`. The Bad also breaks ER1 (`errors.md`). | Operator: accept (the throw is part of the real case), or return `PathCheck.Outside` in the Bad at 68f. |
| 6 | Consider | examples :88-90 | Cross-rule audit: the SE5 Bad throws `IllegalStateException`, not the base exception with an `ErrorCode` (ER2). | Operator: accept, or 68f → `throw new OrderException(ErrorCode.GATEWAY_DISCOVERY_FAILED)` (the Good's own error). |
| 7 | Consider | :98-99, :292-293 | SS25's example "setup done → 400" is the project's setup endpoint (ledger :460, `SetupController`). A neutral reader has no setup flow. | `setup done → 400` → `a one-time action already done → 400`. |
| 8 | Noted | :34-40 | SE7, SS21 and SE7a all state password hashing. Ledger approves all three; SE7a already points to SS21. | — |
| 9 | Dismissed | — | Fidelity: every rule keeps its ledger meaning and because (ledger :279-287, :436-467). SS21's dropped "never the password encoder per request" is enforced by its check (:246). SS20's because is research/31:52. | — |
| 10 | Dismissed | — | Cells cite ledger rows that state them; addy cites hold. 68f :1478 and :1636 are approved captions. | — |
| 11 | Dismissed | — | Edges SS1 (ledger :436), SS7 (:442), SS8 (:470, OQ-SS-3) and SS16 (:451) are stated by their rows. | — |
| 12 | Dismissed | — | Pointer SS22 → IT3 (`integration-tests.md` on main: real server and filters). Goods SE1, SE4, SE5, SS21 obey the code rules. Neutral: no Aruvii names; `#21 Part A` follows the brief's citation form. | — |
