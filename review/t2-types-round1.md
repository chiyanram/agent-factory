# T2 types.md — round 1 (find + verify)

File: skills `.claude/worktrees/feat+32-code-types/plugins/rulebook/skills/code/references/types.md` (246 lines, contents line present), plus the worktree's edits to `research/68f` (TY1 Bad, TY8 Bad: `final` added).
Read: ledger (worktree copy) :207-219, :236, :237, :283, :379, :408; research/31:31-33; research/34:135; pstack `principle-type-system-discipline/SKILL.md` :15-31; plinth pinned copy pl122 :669-673, pl121m :230-234, pl128 :1503-1507, pl123 :109-113; sibling rule lists and checks of all 12 code worktrees. Byte-check: all 8 blocks match 68f. `check_*` exit 0.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Act on | :122-123 (68f :128-129) | TY3 Good binds a request with `@JsonTypeInfo(use = DEDUCTION)` + `@JsonSubTypes`. security.md SE5 check (:237-238) makes any `@JsonTypeInfo` on untrusted JSON a finding, so the Good fails another rule. | Drop the two annotation lines at 68f and re-copy (the sealed shape is the point). If the operator prefers to keep them, SE5 needs an edge for DEDUCTION over a closed sealed set — operator call |
| 2 | Act on | :175, :198-200 (68f TY9 Good) | TY9 Good breaks NM1 (`smells.md`: no abbreviation beyond id/url/api): `quotedCol`, `lowParam`, `highParam`, `FILTER_PARAM_PREFIX`. | At 68f: `quotedColumn`, `lowPlaceholder`, `highPlaceholder`, `FILTER_PLACEHOLDER_PREFIX`; re-copy |
| 3 | Act on | :44 | TY1 row says "`Optional`" for absence; JV6 (`java.md`) allows `Optional` only as a return type. Read with TY1's "nullable fields" reason, the row invites an `Optional` field. Pattern 4. | Use cell → "`Optional` as a return type (JV6, `java.md`), a sealed interface with records, or an enum (TY1)" |
| 4 | Consider (operator flag) | :234-235 | TY8 check extends "primitive" to "`String`, `UUID`"; ledger :213 says primitive. Matches the Bad's intent but no source states it. | Operator approves the extension, or drop "(or `String`, `UUID`)" |
| 5 | Consider (operator flag) | :246 vs :124-133, :153-156 | TY13 check: "a nested-class hierarchy is a finding". TY3 and TY8 Goods nest records inside a sealed interface; a reviewer may flag the Goods. | Operator: state that records nested in a sealed interface are not a nested-class hierarchy (edge), or un-nest the Goods |
| 6 | Consider | :68-79 | TY1 Bad also breaks LY6/SC1 (`spring.md`: `@Autowired(required=false)`) and FW2 (`smells.md`: boolean selects the path). Inherent to a null-collaborator case. | Operator: keep both (as C1/V5), or make the null a record field instead |
| 7 | Consider | :108-115 | TY3 Bad also breaks LY1 (branch choosing an outcome in a controller), ER6 (hand validation at the boundary) and NM1 (`req`). | Trim at 68f to the null-pair checks, or accept as inherent |
| 8 | Consider | :157-162 | TY8 Good: a public five-parameter method; SEAM1 (`design.md`, "a record in") and Long Parameter List (FW9) may flag it if it is a seam. | Accept (not a seam) or caption it as one |
| 9 | Consider | :236-237 | TY4 check covers new locals, which OQ2 (:379) gates with Checkstyle `FinalLocalVariable`; OQ3 says a gated rule gets no review check. | Keep fields and parameters in the check; note locals are gate-owned where the gate exists |
| 10 | Consider | :171-185 | TY9 Bad also breaks NM1 (`lo`, `hi`, `paramOrder`). | Rename at 68f, or accept |
| 11 | Noted | :54 | pl123 :110-112 recommends a builder for complex construction; the cell quotes only its cost clause. Ledger :219 accepted it with ✓. | — |
| 12 | Dismissed | — | All 13 plan ids present in plan order; TY13 unamended; X2/TY13a absent. Rules keep ledger meaning; reasons TY9/TY12/TY4 match research/31:31-33; all ≤35 words; #622 dropped (neutral). | — |
| 13 | Dismissed | — | pstack :15, :17, :18, :20, :22, :26-29, :31 and the plinth cells hold. Edges stated by OQ2 :379, TY12 :212, pstack :31. CM7 pointer exists in `comments.md` (:20, :170). Each check covers every item its rule names. | — |
