# T2 review round 1 — smells.md + examples/smells.md (#32)

Files: skills worktree feat+32-code-smells, references/smells.md (234 lines) and references/examples/smells.md (191 lines); both
have contents lines. Verified: 23 ids = plan row 46 (DS11 kept, FW9 "12-smell subset" note dropped, SM4 HOLD absent, CK2-CK5 gated
and absent); reasons NM1/DS6 = research/31:35/:36; mp :40,:41,:45-56 and r59 :425-442 reproduced; 24 Fowler + 3 Kerievsky + Dead Code
rows = 28, matching the DS11/SM1-3/FW9 check; edges cite X3 :393, research/54:71, LY2 :256, X5 :538, R36-D1 :545 correctly; every
block byte-identical to this worktree's 68f.

## Act on
1. examples/smells.md:156-190 (DS14) — both code blocks are the SS21 pair (68f "SS21" section: BCrypt / ApiKeyService), not DS14.
   The captions (:172-173, :190) are DS14's. Replace with the 68f DS14 blocks (`restClient(final String kind, …)` Bad;
   `TaxRateClient` / `PaymentGatewayClient` Good).
2. smells.md:84 (Loops) — JV3 says a stream only computes; it does not say "replace a loop with a stream". Edit cell to
   "possible **Loops**: replace it with a pipeline (F 13); the stream then only computes (JV3, `java.md`)".

## Consider
3. smells.md:87 (Insider Trading) — "the project's layering rules own the cure" names no rule id (pattern 4). Point at LY1/LY2
   (`services.md`) or state the F 19 cure.
4. smells.md:86 (Temporary Field) — "as a sealed variant (DS3)": r59:431 says "none"; the cure cell rests on F 16 only, which is a page,
   not a line. Verify against F 16 or trim to "move it to the case that needs it".
5. smells.md:94 (Indecent Exposure) — add "(SX14, `spring.md`)" for the package-private case.
6. smells.md:37 (DS12 because) — `smoke77-` is project test data; neutral wording: "cleanup missed numbered prefixes".
7. smells.md:145, :179; examples :48, :82, :121, :151, :191 — "Pair: 68f :N-M" line cites shift when the other worktrees' 68f
   edits merge (cross-file 3). Cite the 68f heading instead.
8. examples/smells.md:88-100 (DS4 Bad) — Javadoc restating the forward also breaks CM2/CM5; drop the Javadoc in 68f if the Bad
   should break DS4 only.

## Operator flags
- smells.md:14-15 — DS11 has no because (format checklist 2); operator kept it (34 plan :138, #21). Recorded at :10; no action.

## Noted
- smells.md:183-185 edge 1 implements SM1's "skip the ones a gate covers" (Long Parameter List, Large Class, Conditional Complexity
  are gated per r59 :445); the rows stay for FW9.
- DS1 Good elision comments (`// job: …`, `// compact ctor …`) are presentation, as in T1 models.
- Ledger targets for CK2-CK5 name smells.md; the plan gates them (Q12). Not an omission.

## Dismissed
- Global Data cure (:82): matches F 5 Encapsulate Variable in meaning.
