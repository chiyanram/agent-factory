# T2 spring.md — round 1 (find + verify)

Files: skills `.claude/worktrees/feat+32-code-spring/plugins/rulebook/skills/code/references/spring.md` (278 lines, contents line present) and `examples/spring.md` (294 lines, contents line present).
All 23 code blocks match the worktree's edited `research/68f-neutral-code.md` byte for byte. The 68f edits (LY6 Bad: `@Lazy` removed; LY7 Bad: `long timeoutMs` → `Duration`; SC7 Bad: `@Value` → `TaxProperties`; SC19 Bad: `@Primary` removed; SC21 Bad: `System.getenv` → `environment.getProperty`) each make a Bad break only its own rule. Plan: all 27 ids present; SC18 and SX20 absent (dropped, research/34:168, :170).
Reasons for SC10, SC14, X6, SX14, SX18, SX19 match agent-factory research/31 :50, :51, :60, :62, :63, :64.

| # | bucket | line | finding (verified) | fix |
|---|---|---|---|---|
| 1 | Act on | :86 | The cell cites "research/51 :282" for the list of proxied annotations. research/51:4 says "**Nothing here is approved.**" (T1 lesson a). | :86 drop `· the proxied annotations: research/51 :282`; situation → `a proxied method (such as @Transactional) called from its own class`. |
| 2 | Act on | :172, :182; examples :258, :268 (68f :1246, :1256) | Cross-rule audit: the SC21 Bad also breaks JV9 (`java.md`; two brace-less `if … return`). JV9's reason is that agents copy brace-less `if`s from examples. A Bad breaks only its own rule. | Fix at 68f :1246 and :1256 with braces; re-copy both files. |
| 3 | Act on | :136, :141; examples same (68f :1034, :1039) | Cross-rule audit: the LY7 Bad gives a required endpoint a default (`base-url:http://localhost:8089`). SC16 forbids that. | Fix at 68f :1034, :1039: `${example.fraud-check.base-url}` (no default); re-copy. |
| 4 | Act on | examples :81, :91 (68f :1069, :1078) | Cross-rule audit: the SC6 Good (and Bad) names the parameter `repo`. NM1 (`smells.md`) allows no abbreviation beyond `id`, `url`, `api`. | Fix at 68f :1069, :1078: `repo` → `jpaRepository` (both uses); re-copy. |
| 5 | Consider (operator flag) | :52-53 | SC17 adds "and read it through the `Environment` (SC13)". Ledger :422 says only "never make a secret a component of a record"; no SC17 source names the alternative. It is inferred from SC13. | Operator: approve the alternative, or drop `and read it through the Environment (SC13)`. |
| 6 | Consider | :178, :180-183; examples :264-269 | Cross-rule audit: the SC21 Bad also breaks NM3 (`getOrGenerate…`, `getEffective…` write state; the Good renames to `loadOrCreate…`) and CM5 (Javadoc on an implementation). | 68f: drop the Javadoc line; operator decides on the getter names. |
| 7 | Consider | examples :109-110 | Cross-rule audit: the SC7 Bad catches `Exception` with no must-not-fail comment (ER4). Its caption ("any failure falls back silently") is part of the SC7 lesson, so the overlap may be wanted. | Operator: accept, or `catch (IOException e)` at 68f. |
| 8 | Consider | :217-221 | The profile edge carries a prohibition ("no `@Profile` and no `application-<profile>.yml`") that no rule and no review check owns (checklist 9: exceptions only, never a rule inside an edge). Source ledger :435 is a DECIDED row. | Operator: add a check line under SC7 (`@Profile` or `application-<profile>.yml` is a finding), or leave it as an edge. |
| 9 | Dismissed | — | Fidelity of the other 25 rules: meaning and because kept (ledger :406-427, :532, :550-552). SC3's "let wiring fail at startup" is the ledger's own text. | — |
| 10 | Dismissed | — | Cells cite ledger rows that state them (:408-:435, :532); 68f :1009 and :1235 are approved captions. | — |
| 11 | Dismissed | — | Edges SC1 (:406), SC16 (:433), SX18 (:586), SX19 (:551) are stated by their rows. | — |
| 12 | Dismissed | — | `CredentialEncryptor` in examples is a declared neutral stand-in (68f :5, "Added terms"). Checks cover every item each rule names. LY6, LY7, SC7, SC15, SC16, SC19, SC21 Goods obey the code rules. | — |
