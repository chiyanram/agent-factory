# T2 review round 1 — comments.md (#32)

File: skills worktree feat+32-code-comments, plugins/rulebook/skills/code/references/comments.md (190 lines, contents line present).
Verified: CM1-CM5, CM7 + CM6 (check only) = plan row 45; CM2 reason = research/31:34; every sicko/no-comments/simplification/
codebase-design cite reproduced (sicko :12,:16-20,:22,:24,:26; no-comments :23; simplification :144-145; codebase-design :16);
7 blocks byte-identical to this worktree's 68f; pointers TY10 (types.md), NGA2 (angular-ui.md) exist and say what is claimed.

## Act on
1. comments.md:100-106 (CM4 Good) — `SseHeaders` is static-only and `final` but has no private constructor: breaks SX18
   (spring.md). In 68f CM4 Good add `    private SseHeaders() {\n    }` inside the class; re-copy.
2. comments.md:53, :56-57 (CM3 Bad) — `if (meters != null)` breaks DS8 and `== null ? "UNKNOWN"` breaks TY1; the Bad should break
   CM3 only. In 68f drop the guard and the two ternaries (keep `method` a `String`, which the caption needs); re-copy.

## Consider
3. comments.md:16-17 (CM4) — rule drops ledger "before it lands" and the because loses "'keep in sync'" (19:234:
   "a 'keep in sync' note never fails"). Suggest: "Check each comment's claim; encode a 'do not remove' note as a type, test or lint,
   then delete it, because a false comment gets believed and a 'keep in sync' note never fails." ('talk to X first' stays in When-X :35.)
4. comments.md:165 — "ledger X1" is ambiguous: two X1 rows (19:378 comments, 19:536 java). Write "ledger X1, :378".
5. comments.md:125-136 (CM7 Bad) — `as Promise<boolean>` also breaks NGA3 (angular-ui.md). The caption uses the cast, so keep,
   or move the cast out of the Bad.
6. comments.md:59 (CM3 Bad) and :75 (CM3 Good) — `catch (RuntimeException …)` with no comment breaks ER4 as written. See cross-file 1.

## Operator flags
- comments.md:36 — When-X keeps a suppression when the rule is "faulty, pedantic or style-only" (sicko :18). Ledger CM7 (19:236)
  allows style-only only. The cell widens CM7; approve or cut to "style-only".

## Noted
- comments.md:42 cites research/31 approval per #31 decision 1 pattern.
- comments.md:170 TY10 exception to CM7 matches ledger CM7 source.

## Dismissed
- CM4 Good Spock name "should …": house style (00-reference-format rule 5), plain sentence, consistent with U2.
