# T2 review round 1 — errors.md (#32)

File: skills worktree feat+32-code-errors, plugins/rulebook/skills/code/references/errors.md (229 lines, contents line present).
Verified: 10 rules = plan row 44 (ER9 is an edit, absent as planned); each rule keeps ledger meaning + because (19:220-230), ≤35 words;
every When-X cite reproduced (types :9, api :61-86, exc :23/:26/:27/:28/:32/:2184/:2374, obs :75, boundary :14-15/:24);
8 code blocks byte-identical to this worktree's 68f; no Aruvii names; pointers DS8 (deslop) exists.

## Act on
1. errors.md:56, :73 (ER1 Bad + Good) — `IssueCommand cmd` breaks NM1 (no abbreviation beyond id/url/api, smells.md). Rename to `command`
   in 68f ER1 section (Bad and Good) and re-copy both blocks.
2. errors.md:57, :65 (ER1 Bad) — Bad also breaks JV1/U4 (`System.currentTimeMillis()`), CK5 (`start` unused) and TY1
   (`new Invoice(null, …, null)`). In 68f delete line `final long start = …` and build with `Invoice.open(orderId, command.total(),
   command.dueDate())`; keep the throw-from-lambda, which is the ER1 fault.
3. errors.md:134-141 (ER8 Bad) — Bad also breaks TY1 (`null` args) and U4 (`Instant.now()`). In 68f replace the constructor call with
   `OrderAuditEntry.of(change, clock.instant())`-shaped args or a neutral `entry` variable; keep the silent catch.

## Consider
4. errors.md:197-200 (edge 1) — "a broad catch that continues is allowed there" drops ER4's "with a comment". No source waives
   the comment. Blocked on the ER4 vs CM3 conflict (cross-file); once resolved, add the comment clause (or its replacement) to Do not skip.
5. errors.md:113-127 (ER4 Good) — try → for → if is three levels (DS9, deslop) and a loop computing a boolean is "possible Loops"
   (smells.md:84). A `StreamSupport`/`values()` stream `anyMatch` would satisfy both.
6. errors.md:94-108 (ER4 Bad) — also breaks DS9 (4 levels) and NM1 (`c`). Inherent to the story; fix only if cheap.
7. errors.md:42 — WARN content is deferred to LG3 ("class and message", ledger 19:297), but ER4/ER8/ER10 Goods log the class only.
   See cross-file 2.

## Operator flags
- None new. (ER4 check "or Error" is from exc :2374, sourced.)

## Noted
- errors.md:42 points at `obs/references/logging.md`, which T4 (#34) has not built yet; LG3 is planned there (34 plan).
- errors.md:221 ER3 check cites R37-D7 (DECIDED, 19:567) — approved source.

## Dismissed
- ER2 neutral "project's base exception" vs ledger `AruviiException`: neutralisation, meaning kept.
