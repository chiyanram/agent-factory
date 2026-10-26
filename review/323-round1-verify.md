Verified 323 round 1 · head 262c60be · patch-id 5e91baf0

| # | bucket | one line why | fix (Act on only) |
|---|---|---|---|
| S1 — rules.md "never erases" | Act on | Reproduced (bare repo + 2 clones): reviewer pushes C, writer amends + `git fetch`, `--force-with-lease` → "forced update", C gone. Adding `--force-if-includes` → rejected. `git help push` names this case. | Fix 1 |
| S2 — no test proves 4 targets use heavy lock | Act on | Mutated scratch copy: removed `$(HEAVY_LOCK)` from it-module (:219), verify-module (:230), verify-full (:444) and status (:142). All 11 `scripts/*.test.sh` stay green (memory-limits 17/0, stack-lock 56/0). AC-1 says "a script test proves it". | Fix 2 |
| S2b — no heavy stale-reclaim case | Consider | Real. `reclaim` logic is #717 code, unchanged. Only the lock name in the message is new. Cheap to add, low value. | — |
| S3 — #738 dry-run check skips `verify` | Consider | Real but needs a future edit. The Makefile comment at :413-415 already guards it. The worst result is a short real lock during `make -n`. The sub-make still gets `-n`. | — |
| S4 — DEVELOPING.md split + verify-full overclaim | Consider | Real. ":762 holds both together" is true only in the smoke phase (Makefile:448-450). The split is co-location style (§4). | — |
| S5 — fleet guard clause / two rebase homes | Consider | The guard sentence copies #814's own "Why" text, so the `(#814)` cite is not wrong. `glab mr rebase` (SKILL.md:24, 96) vs local rebase is guidance, not a defect. | — |
| AC-1 — exit 2 vs 75 | Noted (exit code) · Act on via S2 (test) | Observed: script rc=75, `make verify-module` rc=2 with "Error 75". The AC asks "waits or exits 75 … like the stack lock". `make smoke` under #717 also exits 2. The MR description (line 25) already says so. The make-propagation gap belongs to both locks → follow-up: "make targets under stack-lock.sh exit 2, not 75; propagate or document for both locks (#717, #814)". The "script test proves it" half is S2. | Fix 2 |
| AC-2/3/4 | Dismissed (no finding) | `make status` showed "heavy lock held: …"; #717 cases pass. | — |

## Fix list for the writer

1. `.claude/skills/aruvii-git/references/rules.md:11-12`. Change the push command to
   `git push --force-with-lease --force-if-includes`. Replace "so a rebase never erases a reviewer's
   pushed commit" with "`--force-if-includes` also refuses when a fetch brought in a commit your
   branch has not integrated, so a reviewer's pushed commit is not erased".
2. `scripts/memory-limits.test.sh`, after line 106. Add three dry-run wiring checks, in the same form as line 105:
   ```bash
   expect_contains "it-module runs under the heavy lock (#814)" \
     "$(make -C "$REPO_ROOT" -n it-module MOD=aruvii-shared 2>&1)" 'stack-lock.sh --lock heavy run "make it-module MOD=aruvii-shared" -- '
   expect_contains "verify-module runs under the heavy lock (#814)" \
     "$(make -C "$REPO_ROOT" -n verify-module MOD=aruvii-shared 2>&1)" 'stack-lock.sh --lock heavy run "make verify-module MOD=aruvii-shared" -- '
   expect_contains "verify-full runs under the heavy lock (#814)" \
     "$(make -C "$REPO_ROOT" -n verify-full 2>&1)" 'stack-lock.sh --lock heavy run "make verify-full" -- '
   expect_contains "status shows the heavy lock (#814)" \
     "$(make -C "$REPO_ROOT" -n status 2>&1)" 'stack-lock.sh --lock heavy status'
   ```
   I checked these strings against `make -n` output at 262c60be.
