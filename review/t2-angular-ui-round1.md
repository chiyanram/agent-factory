# T2 angular-ui.md — round 1 (find + verify)

File: skills `.claude/worktrees/feat+32-code-angular-ui/plugins/rulebook/skills/code/references/angular-ui.md` (148 lines, contents line present), plus its README row. No 68f edit in this worktree.
Read: ledger (worktree copy) :319-338, :377, :396; research/31:39, :41, :44, :46; research/34:98, :144; sibling `comments.md` (CM7 :20, :170-172) and rule lists of all 12 code worktrees. Byte-check: both NGB3 blocks match 68f :1289, :1309. `check_*` exit 0.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Act on | :143-144 | NGD1 names `@switch`, but the check's grep has no `ngSwitch`; a `[ngSwitch]` passes. Pattern 1: the check covers every item the rule names. | `grep -nE "\*ngIf\|\*ngFor\|ngSwitch\|ngClass\|ngStyle\|CommonModule"` |
| 2 | Consider (operator flag) | :49, :138-139 | Ledger :328 forbids `effect()` "to copy state". The cell "`effect()`, which writes no state" and the check "an `effect()` that writes a signal, is a finding" go further; no cited line states it. | Cell → "`effect()`, never to copy state"; check → "an `effect()` that sets a signal to a value derived from other signals" — or operator approves the stricter form |
| 3 | Consider | :48, :49, :51 | Cells cite "angular.dev effect guide" / "rxjs-interop" with no line (pattern 2). Each also cites a ledger line, which holds; the :51 why "it unsubscribes when the component is destroyed" rests only on the unlined angular.dev cite. | Pin a URL anchor, or keep only the ledger reason "an unbound subscription leaks memory" (19:333) |
| 4 | Consider | :95 | NGB3 Good carries a narrating comment (`// on load: … — nothing to re-filter`), which CM2/CM3 (`comments.md`) would flag in a diff. | Move the sentence into the caption at 68f; re-copy |
| 5 | Consider | :71, :74-80 | NGB3 Bad also breaks NM1 (`cId`, `p`). | Rename at 68f (`customerId`, `payment`), or accept |
| 6 | Dismissed | — | All 14 plan ids present; NGA4, NGB4 dropped; NGB5, NGC2, NGC4, NGE1-4 absent (go to aruvii-ui/AGENTS.md). Rules keep ledger meaning; reasons NGA1, NGB2, NGC1, NGD1 match research/31:39, :41, :44, :46; all ≤35 words. NGA3's "leave existing `!`" moved to edge 1 (19:321). | — |
| 7 | Dismissed | — | Edges: 19:321, CM7 + X6 19:377, 19:333, OQ-NG1 19:396 each state their edge. Other cells hold against their ledger lines. No Aruvii names (`app-icon`, `LUCIDE`, `core/` absent). NGB3 Good obeys every code rule checked. | — |
