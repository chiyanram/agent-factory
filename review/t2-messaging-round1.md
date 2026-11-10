# T2 messaging.md — round 1 (find + verify)

File: skills `.claude/worktrees/feat+32-code-messaging/plugins/rulebook/skills/code/references/messaging.md` (90 lines, contents line present).
Both code blocks match the worktree's `research/68f-neutral-code.md` byte for byte (MS6 pair, 68f :897-936). Plan ids MS6, MS4 present; MS1–MS3, MS5 absent by plan (research/34:143 → agent-platform `aruvii-worker/AGENTS.md`).
Sources re-read at the pinned commits: plinth `123-kafka…` @a46375a :42, :45; addy `api-and-interface-design/SKILL.md` @aeac41d :173-184, :335, :347; pstack `principle-make-operations-idempotent` @f713f14 :9-22.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Act on | :77-79 | The edge says "Skip when every write of the operation commits in one transaction". It does not say what is skipped. The MS6 Bad (:38-52) is one `@Transactional` method, and it still races (two cancels both pass the check). A reviewer who applies the edge skips the Bad. The source (ps idempotent :22) only drops the reconcile step, not the "runs twice" question. | :77 `**Skip when** every write…` → `**Skip** the reconcile step **when** every write of the operation commits in one transaction: a crash leaves nothing to reconcile; the "runs twice" question still applies (ps idempotent :22).` |
| 2 | Act on | :38-52 (68f :903-916) | Cross-rule audit: the MS6 Bad also breaks ER1 (`errors.md`; an already-cancelled order is a foreseeable non-success, thrown at :44), ER4 (`catch (Exception ex)` with no must-not-fail comment, :47) and TY6 (`types.md`; status as the string literal `"FAILED"`, :49). A Bad breaks only its own rule. | Fix at 68f, then re-copy: :907 → `return new CancelOutcome.AlreadyCancelled(existing);` inside an `if (… .isPresent())` check-then-act (keep the race); :910 `Exception` → `RuntimeException`; :912 `"FAILED"` → `CancellationStatus.FAILED`. |
| 3 | Consider (operator flag) | :22, :86 | "a unique constraint **or a row lock** picks the winner". addy :182 states only the unique constraint; no ledger source for MS6 (ledger :291) names a row lock. It is an inferred permitted alternative. The approved MS6 Good (68f :931) does use `FOR UPDATE`. | Operator: approve "row lock" as an alternative (cite the MS6 Good), or drop "or a row lock" at :22 and :86. |
| 4 | Noted | :8 | Contents line on a 90-line file: not required (checklist 1), harmless. | — |
| 5 | Dismissed | — | Fidelity: MS6 and MS4 keep ledger meaning and because (ledger :291, :292). | — |
| 6 | Dismissed | — | Cells :21, :23, :24 match pl123k :42, :45, addy :335, ps idempotent :15. Cell :22 "check followed by act is a race" matches addy :173, :347. | — |
| 7 | Dismissed | — | Pointers CC3, CC8, CC9 (:5-6) exist in `concurrency.md` and are the timeout, retry and idempotency-key rules. | — |
| 8 | Dismissed | — | Checks: MS6 check covers both questions and the stale leftover; MS4 check covers parse failure, not ours, partition+offset, never our own failure. No Good-only convention demanded. Neutral: no project words. | — |
| 9 | Dismissed | — | MS6 Good obeys the code rules: sealed outcome (ER1, TY2), `final` params (TY4), bound SQL parameter (SE3), modifier returning its own outcome (FW3). | — |
