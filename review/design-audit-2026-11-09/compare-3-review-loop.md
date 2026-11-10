# Compare 3 · the review and the improvement loop, against current code

Checked against:
- agent-factory `fa354ef` (main after #313). PR #336 (#335, the PR body) is open and not checked; it does not touch review.
- chiyanram/skills `3d63201`. The research read `44d4a13`; only two crq commits came after it (bd1622b questions, 3d63201 design-reviewer hand-off). Neither touches review or retro.

Scope: audit-review D1–D9, compendium consensus CR-C1–CR-C16 and its §3 gaps, the loop steps LOOP-1–7 and the
"never automate" rules NA-1–4 (research-improvement-loop §3), README R11, R12, R14, README-C2/C4/C5/C6 (principles),
G1–G6, crq retro RT1–RT7. CR-C# is the compendium numbering. README-C# is the principle list. They are different.

Paths: `AF/` = agent-factory, `crq/` = skills `plugins/rulebook/skills/crq/`, `SK/` = skills repo root.

Status words:
- **holds**: the research statement is still true (for a "keep" verdict: the design still does it).
- **gap**: the missing thing is still missing.
- **fixed / partly fixed (PR)**: a PR since the research closed it, or part of it.
- **changed**: the code or a decision moved in a way the research did not expect.
- **research wrong (partly)**: the research said "none" or "replaces", and the evidence shows otherwise.

## Table

| id | finding (≤12 words) | agent-factory evidence | skills evidence | status | note |
|---|---|---|---|---|---|
| REV-D1 | test k copies per lens with a vote, via eval | `AF/src/core/review/lenses.ts:10-13` one finder run per lens; `AF/docs/adr/0004…md:59-61` copies still rejected | `crq/process/roles/finder.md:8` "one lens per run" | gap | Not adopted. No eval run compares k=1 with k=2. |
| REV-D2 | lenses picked by blast radius per lane | `AF/src/core/review/lenses.ts:67-83`; `AF/src/core/lane.ts:49,58`; `AF/src/core/review/round.ts:587` (one-way door on logic model) | `crq/process/lanes.json:14,23,32,41` | holds | Built by #310 and #332. "~3" is parsed as 3. |
| REV-D3 | merge by exact file:line+rule misses same issue | `AF/src/core/review/lenses.ts:98-130` exact key, before verify (`round.ts:565`); verify prompt has no dedupe (`AF/prompts/review-verify.md:1-20`) | `crq/process/roles/verify-pass.md:23-24` same exact key | gap | Proposal part 3 (lens list on kept finding) is built: `lenses.ts:94`, #310. |
| REV-D4 | one shared verify pass | `AF/src/core/review/round.ts:12-13,72-73,437-455`: one verify pass **per kind** (rule, logic), up to 2 | `crq/process/roles/verify-pass.md:4` "the findings of every lens" | changed | Docs say "one shared" (`AF/docs/adr/0004…md:49-51`, `AF/docs/DESIGN.md:246`). GUIDE.md:829 says per kind. Per-kind split predates #332. |
| REV-D5 | drop finder severity; one scale set by verify | `AF/docs/adr/0015-reviewer-eval.md:51` R2 amended: keep severity; `AF/src/core/review/verdicts.ts:33`; `AF/docs/DESIGN.md:162` | `crq/process/roles/finder.md:6,36-37` severity kept | changed | #304 (#218) reversed ADR-0015's "drop severity". Two scales are now the decision. |
| REV-D6 | grade floor per bucket; verify sets grade; `ran` needs box | grade field built `verdicts.ts:20,34`; no floor in `sortFindings` `verdicts.ts:206-214`; `VERIFY_SCHEMA` has no grade `verdicts.ts:80-97`; tools Read/Grep/Glob only `AF/src/core/review/model.ts:3-5,29` | floor in prose: `crq/references/review-process.md:21-22` (RV7), `verify-pass.md:26-27` | partly fixed (#321) | Floor is prose only. Verify cannot lower a grade. `ran` cannot happen; no **Today:** mark at DESIGN.md:162. |
| REV-D7 | 3 rounds max; stop early when same finding repeats | `round.ts:71,842` cap; `round.ts:297-313` same patch-id with Act on → no-progress | `crq/references/review-process.md:25-26` (RV9) | holds | The refine (stop on a repeated finding in a new patch) is not built in either repo. |
| REV-D8 | zero findings is not a pass; AI never approves | `AF/src/core/review/never.ts:14`; `round.ts:19,747` | `review-process.md:19-20` (RV6) | holds | |
| REV-D9 | retire lens by acted-on + precision, not silence | rule unchanged `AF/docs/DESIGN.md:223`, `0004…md:52-53`; `uniqueByLens` counts any non-dismissed `lenses.ts:132-139`; per-round only `AF/src/core/dispatch/records.ts:157`; no 20-PR roll-up (grep `retire` in `src/`: comments only) | `review-process.md:46,79-80` (RV5): never retire a quiet check while what it guards exists | gap | Acted-on rows key on rule/logic, not on the #237 lens (`acted-on.ts:8,46`), so (a) cannot be computed. |
| CR-C1 | generate, then filter in a separate step | `round.ts:10-13,560-575` | `review-process.md:9-10` (RV1) | holds | |
| CR-C2 | precision first: "if not certain, do not report" | `AF/prompts/review-find.md:34` bans "differently"; grep `certain\|unsure` in `prompts/`: judge only | `review-process.md:11-12` (RV2) reaches every pass via pack §4 (`AF/src/core/review/rules.ts:13-18`, `pack.ts:550`) | research wrong (partly) | RV2 is in the pack since before the research. The literal "not certain" line is still absent. |
| CR-C3 | suppress low-value classes, lint/CI checks | no generated/lock skip in `AF/src/core/review/pack.ts` (grep `lock\|generated\|linguist`: none) | `review-process.md:41` "CI catches it → Dismissed" (in pack, added 369f28f); RV4 nits ≤5 `:15-16`; `finder.md:42-43` (card not used) | research wrong (partly) | The lint/CI list exists and reaches the reviewer. Generated/lock skip is still a gap. |
| CR-C4 | threshold per class, tuned from feedback | none: `acted-on.ts:157-169` rates only; grep `threshold\|suppress` in `src/core/review`: none | `review-process.md:17-18,43` (RV5) prose: rewrite a noisy check | gap | No rule id in tracked rows (`acted-on.ts:27-34`). |
| CR-C5 | rules are repo files, scoped, from default branch | `pack.ts:2-3`; lens rubric file at default branch `AF/src/core/review/finders.ts:124-137` | n/a: engine behaviour | holds | |
| CR-C6 | project rules add to a default, never replace | today a project prompt file replaces the default text (`AF/src/core/review/settings.ts:106-110`); floor kept `never.ts:1-4`; cards not used `lenses.ts:17-18`, `0004…md:74-76` | cards would replace it: `0004…md:56-58` (target) | research wrong (partly) | Research called cards "today". Pack §4 checks stay whatever the prompt. Target concern still open. |
| CR-C7 | posted comment names its rule | `round.ts:671` thread title shows rule; rule source per plugin only "Proposed" `DESIGN.md:139-140` | `finder.md:30-31` | holds | Rule source per plugin not shown. |
| CR-C8 | intent in context | `pack.ts:551-552` approved spec and design | `finder.md:4,21-22` (CR1, RV3) | holds | |
| CR-C9 | dedupe by meaning, after the filter | see REV-D3 | see REV-D3 | gap | |
| CR-C10 | re-review incremental, reads its own threads and replies | interdiff `pack.ts:4-5`; reads own notes only `AF/src/core/review/history.ts:31-36`; grep `repl\|resolve` in `src/core/review`: none | none (grep `repl(y\|ies)` in `crq/`) | gap | Same as G1. |
| CR-C11 | depth is a setting per change | `lenses.ts:67-83`; `round.ts:587,616-618` | `lanes.json:14,23,32,41` | fixed (#310, #332) | |
| CR-C12 | skip big or generated input; say so | none in `pack.ts` (no size cap, no skip, no "skipped" note) | CR2 counts size as a finding, not a skip: `crq/references/code-review.md:11-12,30,103-104` | gap | |
| CR-C13 | main metric: acted-on rate | `AF/src/core/review/acted-on.ts:1-10,116-125`; `AF/src/core/dispatch/usage.ts:184`; GUIDE.md:841 | RT1 "findings per bucket and check" `crq/references/retro.md:9-10` | partly fixed (#312) | Rated only when a next full round runs (only caller `round.ts:781`). Last round never rated. |
| CR-C14 | thumbs/useful votes as a second signal | none (grep `emoji\|award\|thumb\|reaction` in `src/`: only plugin kit text) | none (same grep in `crq/`) | gap | |
| CR-C15 | human acted-on rate as the bar | none (grep in `src`, `docs`) | none | gap | |
| CR-C16 | AI does not approve or block; human merges | `never.ts:14`; `round.ts:19` | RV6 `review-process.md:19-20` | holds | Act on still loops to the implementer, as the audit noted. |
| G1 | later rounds ignore human replies; may repeat dismissed findings | `history.ts:1-2,31-36` | none | gap | |
| G2 | live acted-on rate | `acted-on.ts`; `records.ts:153-155`; `usage.ts:184`; e364c34 | n/a | partly fixed (#312) | Per kind (rule/logic), category, bucket. Not per rule id or #237 lens. Upper bound. |
| G3 | no threshold per rule; no suppression from feedback | see CR-C4 | RV5 prose | gap | §7b "rule ID as key" is not kept in the rows. |
| G4 | a role card replaces the default review text | see CR-C6 | `0004…md:56-58` target | research wrong (partly) | Today: project prompt file replaces it; cards wait for the eval baseline (#216). |
| G5 | no lint/CI skip, no generated/lock skip, no size cap | `AF/prompts/review-find.md` none; `pack.ts` none | `review-process.md:41` in pack; `finder.md:42-43` unused card | research wrong (partly) | Lint/CI part exists as prose in pack. Generated/lock/size part is a gap. |
| G6 | near-duplicates not merged by meaning | `lenses.ts:98-113` | `verify-pass.md:23-24` | gap | |
| LOOP-1 | engine records acted-on rate per rule | `acted-on.ts:27-34` no `rule` field; lens = kind `:8,46` | RT1 `retro.md:9-10` | partly fixed (#312) | Not per rule. Final round's findings never rated. |
| LOOP-2 | human starts retro on ~10 merged tickets, reads traces | GUIDE.md:679-681 prose "one merge in ten"; no retro run: `AF/src/core/writer/step.ts:48-55` has no retro role; grep `retro` in `src/*.ts`: none | retro card `crq/process/roles/retro.md:1-11`; RT5 `retro.md:17-18` | gap | Pass answers are kept (`round.ts:350-354`), so traces exist. No sample rule. |
| LOOP-3 | lesson PR = rule + new golden case + review-by date | none (grep `review-by\|expir\|lesson` in `src`, DESIGN) | RT4 action {type, owner, due, ticket} `retro.md:15-16`; no golden case (grep `golden\|regression case` in `crq/`: test-integrity only) | gap | Due date is for the action, not the rule. |
| LOOP-4 | a human accepts each lesson | `DESIGN.md:175` | `crq/process/roles/retro.md:8,10`; `retro.md:32` operator's yes | holds | Prose; no retro run exists to accept from. |
| LOOP-5 | eval gate: reviewer eval + role evals + held-out slice | harness `AF/src/core/eval/harness.ts` (#251); proof check `AF/scripts/check-eval-proof.ts:9`; no `baseline.json` (find: none); 0 of 33 cases approved (`AF/evals/reviewer/cases.md:20-52` all draft); held-out: none | role evals 9×3 `SK/plugins/rulebook/evals/`; manual, no baseline, results git-ignored `SK/CONTRIBUTING.md:175-187` | gap | Gate cannot pass yet: every reviewer-input change is refused until a baseline. |
| LOOP-6 | a human moves the pin after evals | `agent-factory plugin update` moves it, runs no evals: GUIDE.md:432-433, vs `DESIGN.md:136` "runs the eval set" | n/a | gap | Rulebook pin is not a checked reviewer input: `check-eval-proof.ts:15-17`. |
| LOOP-7 | after 20 PRs, no acted-on hit → human retires rule | see REV-D9 | RV5 `review-process.md:46,79-80` keeps a quiet check | gap | Step 7 conflicts with RV5 unless it only proposes. |
| NA-1 | never automate the accept | no retro run exists | `crq/process/roles/retro.md:8` "no ticket, rule or check is changed by the run" | holds | |
| NA-2 | never automate the pin move | human command; `plugin update` not in `HUMAN_ONLY` `AF/src/core/coordinator.ts:50-56`; pin file edit denied `coordinator.ts:173,181-182` | n/a | holds | Weak: only the permission prompt stops the coordinator running it. |
| NA-3 | never automate a baseline raise | `check-eval-proof.ts:10-12` label `eval-baseline-approved` | n/a | holds | |
| NA-4 | never change judge or cases in a lesson PR | none: judge is just another input `check-eval-proof.ts:51`; golden cases not an input | none | gap | |
| R11 | measured: merge rate, fix minutes, cost per merged PR | spend per run/ticket only `AF/src/core/dispatch/usage.ts:1-4`; grep `merge rate\|fix minutes\|per merged`: none | n/a | gap | |
| R12 | change ships only if evals do not drop | prompts and model pins only `check-eval-proof.ts:2-8`; models pinned #303; plugin/card not gated (GUIDE.md:432-433) | role evals manual `SK/CONTRIBUTING.md:184-185` | holds | Still "partly", as the research said. |
| R14 | improves under control: the chain | parts: #312 rate, #251 harness, #293 plugin update | retro card + RT1–RT7 | partly fixed (#312) | The chain between parts is still missing. |
| README-C2 | prompt-only guardrail is advice | review rules in pack as prose: grade floor, nit cap, CI-dismiss (`verdicts.ts:206-214` checks none) | RV4, RV7 prose | holds | Candidate not adopted. |
| README-C4 | put less in the prompt | every pass gets 4 whole references in §4 (`rules.ts:13-18`, `pack.ts:550`) plus lens rubric §8 (`finders.ts:161-165`) | `crq/process/review.json:2-7` | holds | Candidate not adopted. |
| README-C5 | nothing changes unless its eval does not drop | see R12, LOOP-5, LOOP-6 | see LOOP-5 | gap | Enforced for prompts only, and blocked by no baseline. |
| README-C6 | human time to decisions, not lines | not checked as one rule | not checked | not verified | A principle; no single place to check. |
| RT1 | engine writes a timeline record per merge, no model | none: grep `timeline` in `src/`: none; per-round `review-ended` only `records.ts:146-158` | `crq/references/retro.md:9-10`; `lanes.json:5` | gap | No merge-time record, no per-check counts, no rescues. |
| RT2 | trace past "the agent got it wrong" | no retro run | `retro.md:11-12` | holds | Covers loop ③ in prose. |
| RT3 | tune or add the check, ticket as origin | no retro run | `retro.md:13-14` | holds | Loop ④ gap: no golden case per lesson. |
| RT4 | action with type, owner, due, ticket | no retro run | `retro.md:15-16` | holds | No expiry of the rule. |
| RT5 | mine transcripts; cite numbers; keep recurring lessons | pass answers kept `round.ts:350-354`, `model.ts:33` | `retro.md:17-18` | holds | No sample size rule. |
| RT6 | fix at the strongest level | GUIDE.md:679-680 same order | `retro.md:19-20` | holds | |
| RT7 | full retro only when a human starts it | `DESIGN.md:57,77-78`; no retro command exists | `retro.md:21-22`; `lanes.json:5` | holds | |

Counts: holds 21 · gap 21 · partly fixed 5 · fixed 1 · changed 2 · research wrong (partly) 5 · not verified 1 (56 rows).

## Things the research missed (in this scope)

1. **Verify runs per kind, not once.** `round.ts:72-73,437-455` runs up to two verify passes: rule findings on one
   model, logic on another. ADR-0004:49-51 and DESIGN.md:246 say "one shared verify pass". GUIDE.md:829 is right.
2. **The acted-on rate never rates the last round.** It is computed only when the next full round runs
   (`round.ts:776-783`, the only caller). The round-3 findings, a round with 0 Act on that goes to the gate, and a fix
   the human makes before merge are never counted. Reused rounds count nothing. The rate is biased to mid-loop fixes.
3. **The acted-on "lens" is rule/logic, not the #237 lens.** `acted-on.ts:8,46` sets lens = `Finding.kind`. Rows have
   no rule id (`acted-on.ts:27-34`). So per-rule thresholds (G3), per-rule retirement (LOOP-7) and acted-on lens
   retirement (D9) have no data yet.
4. **The crq review text already reaches every pass.** Pack §4 carries the whole `review-process`, `code-review`,
   `verify-done` and `smells` references (`rules.ts:13-18`, `pack.ts:550`). So RV2, RV4, RV7 and "CI catches it →
   Dismissed" are in the reviewer's input, as prose. Some "none" gaps in the compendium are really "prose, not code".
5. **The finder and verify-pass cards are not used by the code review.** `lenses.ts:17-18`, ADR-0004:74-76 (#333).
   They wait for the eval baseline (#216). Their extra rules (dedupe, act_on floor, skip generated/lock) do not run.
6. **The eval gate is blocked by data, not code.** No `baseline.json`. All 33 golden cases are `draft`
   (`cases.md:20-52`). `check-eval-proof.ts:9` refuses every reviewer-input change until a baseline exists.
7. **A rulebook pin update changes reviewer input with no eval.** `plugin update` runs no evals (GUIDE.md:432-433),
   against DESIGN.md:136. `check-eval-proof.ts:15-17` does not check the rulebook pin. Lens rubrics, the baseline
   references and the test-integrity lens all come from that plugin.
8. **RV5 conflicts with loop step 7 and DESIGN §6.** `review-process.md:46,79-80` says never retire a quiet check while
   what it guards exists. DESIGN.md:223 retires a lens on silence. LOOP-7 retires on no acted-on hit.
9. **The engine has no retro run and no timeline record.** No retro role in `writer/step.ts:48-55`. No `timeline` in
   `src/`. README §7b says crq retro covers loop ② ③ ⑤; that is the card only.
10. **`uniqueByLens` counts Noted and Consider as verified.** `lenses.ts:137` drops only Dismissed. A lens can avoid
    retirement on Noted findings alone.
11. **Role evals have no stored baseline.** Results are git-ignored and run by hand (`SK/CONTRIBUTING.md:175-187`).
    "Do not get worse" has nothing to compare to.
12. **`ran` is impossible and unmarked.** The reviewer has Read, Grep, Glob only (`model.ts:3-5`). DESIGN.md:162 offers
    `ran` with no **Today:** mark.
