# 19 — Review redesign: how others review, what ours repeats, the decision guide vs our rubrics (2026-10-19)

For chiyanram/agent-factory#18. Describes and compares only; nothing here is a decision.
Sources were read in full unless a line says otherwise. Ref clones (`git show origin/main:`) at:
pstack `cursor-plugins@d1715e03` · mattpocock `49dd158d` · openclaw `b94e5177` · firstmate `8ba34f1d` · addy `aeac41d4`.
Claude Code plugins: local cache `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/` (no git sha).
agent-platform: `origin/master@2e8b59ca`. Short names: R4 = `skills/research/04-reviewer-cost-baseline.md`,
P1 = `skills/p1/*`, 60c = `skills/research/60c-g9c-review-packet.md`, F10/F12/F14 = `agent-factory/research/10|12|14`.

## 1 · How references and products review

| ref | reads | when · how often | how many | verdict reaches MR | rounds end | avoids re-doing |
|---|---|---|---|---|---|---|
| **pstack interrogate** | the diff (`git diff main...HEAD`) plus context files the lead packs in; rubric + code-quality lens **pasted** into one template (`interrogate/SKILL.md:16,19,38`; `reviewer-prompt.md:17-27`) | on demand (`disable-model-invocation: true`, `:4`) | one per configured model, default 2: Opus + Grok, read-only (`:27-34`) | lead sorts into Act on / Consider / Noted / Dismissed with an agreement map (`:44-74`) | not in the skill; in autopilot: "full swarm once", again only for new behaviour or a redesign; a rebase or minor fix gets **one verifier** (`poteto-mode/playbooks/autopilot-full.md:5,14`) | **patch-id rule**: compare `git patch-id` at the verdict SHA with current head before trusting an old verdict; tests/docs/lint-only differences can carry a lane's result (`playbooks/shipping.md:7`); ledger "keyed by PR number plus head SHA … A new head SHA voids the row" (`playbooks/orchestrate.md:90`) |
| **mattpocock code-review** | `git diff <fixed-point>...HEAD` captured **once**, commit list, standards files found by search, the spec (`code-review/SKILL.md:21,27-36`) | on request, any fixed point | 2 parallel sub-agents: Standards (with 12-smell Fowler baseline pasted in, `:38-56,65`) and Spec (`:68-72`) | two sections side by side, never merged or reranked (`:76-80`) | not defined | fail early on bad ref or empty diff "not inside two parallel sub-agents" (`:23`); each report "Under 400 words" (`:66,72`) |
| **openclaw autoreview** | an explicit Git target (local / branch / commit, `autoreview/SKILL.md:31-36`); reviewer sandbox **cannot read unchanged repo files** — caller supplies context (`:89-91`) | when a workflow asks; before landing nontrivial code (`openclaw-pr-maintainer/SKILL.md:89-93`) | 1 (Codex first, Claude fallback, `:105-121`); big diffs partitioned into independent passes (`:223-230`) | exit code + status JSON: `scoped-clean`/`findings`/`filtered`/`incomplete` (`:244-260`) | "No extra review rounds for a nicer verdict" (`:253`) | "Reopen review for substantive changes … not a patch-identical rebase or a mechanical head change" (`pr-maintainer/SKILL.md:93`); default threshold **P0 only** (`:95-97`) |
| **openclaw ClawSweeper** | the PR at its current head SHA (`clawsweeper/SKILL.md:224`) | once per PR; again on `@clawsweeper re-review` (`:186-188`) | 1 bot | short `Review findings:` list; full detail in a collapsed block (`:67-71`); marker `sha=<reviewed>` in the comment, gate warns when it ≠ head (`scripts/pr-lib/clawsweeper-review-gate.mjs:29,100-103`) | caps `MAX_REPAIRS_PER_PR=10`, `MAX_REPAIRS_PER_HEAD=1` (`:254-257`); merge only when "passed the exact current head" (`:228`) | review keyed to head SHA |
| **openclaw test-audit** | complete test + owner + callers + history (`test-audit/SKILL.md:75-79`) | authoring gate on every new test; audits on request (`:8-14`) | parallel discovery lanes (`:83-89`) | handoff report (`:159-169`) | one coherent PR at a time (`:152-157`) | after edits, runs autoreview once (`:150`) |
| **firstmate → no-mistakes** | the branch vs fresh PR head, refetched "so review stays current after no-mistakes fix rounds" (`bin/fm-review-diff.sh:12-15`); per-path instructions (`review.path_instructions`, via 60c `nm`) | once per pipeline run: review → test → document → lint → push → PR → CI (`docs/gerrit-forge-integration.md:262`) | 1; "no-mistakes alone owns review … Never … stack serial manual reviews" (`AGENTS.md:229-230`) | pipeline step result; attestation "must bind to the current PR head commit" (`CONTRIBUTING.md:13`) | `auto_fix.review: 0` (R9 `11-popular-review-workflows.md:92`) | no second reviewer; WHY: "the command layer, not the workshop" (64b D6). Measured: 26.5% of an account's spend was cold pipeline agents (64b:104) |
| **addy code-review-and-quality** | the change + spec; tests first; one mutation experiment (`SKILL.md:142-164`) | before every merge (`:14-20`) | 1 (multi-model pattern optional, `:207-224`) | severity prefixes Critical / required / Nit / Optional / FYI (`:181-191`) | not defined | "If you have one structural problem and ten nits, the structural problem *is* the review" (`:193`) |
| **addy doubt-driven** | ARTIFACT + CONTRACT only, never the CLAIM or the reasoning (`doubt-driven-development/SKILL.md:75-83,106`) | in-flight, non-trivial decisions only (`:16-40`) | 1 fresh context (+ cross-model if the user picks it, `:112-166`) | orchestrator reconciles: contract misread / actionable / trade-off / noise (`:168-179`) | **3 cycles, then escalate**; "do not lift the bound" (`:181-191`) | red flag: "Re-spawning fresh-context on an unchanged artifact" (`:214`) |
| **Claude Code /code-review** | PR via `gh`; Haiku lists **paths** of CLAUDE.md in modified dirs (`code-review/commands/code-review.md:12`); Haiku summary (`:13`) | per PR; skips if "already has a code review from you" (`:11`), re-checks eligibility before posting (`:27`) | 5 parallel Sonnet (CLAUDE.md, shallow bugs, blame, prior PRs, code comments, `:14-19`) + one Haiku scorer **per issue** (`:20`) | ONE `gh pr comment`, issues ≥80 confidence only, links with full SHA (`:26,28,52-92`) | n/a (one shot) | drops pre-existing issues, linter/compiler catches, unmodified lines (`:33-42`); "Do not check build signal" (`:46`) |
| **Claude Code security** | `/security-review` is a built-in command, **not in the local plugin cache** (searched). Cached `claude-security` plugin: "A scan of changes … reports only flaws the change takes part in" (`claude-security/README.md:51`) | on request | researcher agents + independent **disproving** verifiers (`:70-72`) | report files + `REVISION-<sha12>.json` "tied to the code it describes" (`:60`) | — | finding id "designed to stay the same from scan to scan" (`:58`); refuses to patch from a stale report (`:80`) |
| **Copilot code review** (docs.github.com/en/copilot/concepts/agents/code-review, fetched 2026-10-19) | the PR's changes + "full project context gathering"; `.github/copilot-instructions.md` + `.github/instructions/**/*.instructions.md` "when the changed files match the instruction scope"; AGENTS.md, from the **head** branch | on open / ready, optionally each push; by default "will only review a pull request once" | "posts only one review" | overview comment with approval assessment; does not count toward required approvals unless enabled (preview); approval dismissed on new commits | manual re-request | path-scoped instructions; one review per PR. Doc does not say whether a re-review covers only new commits. F02 adds little (`02-…:90`) |

THEIR WHY, one line each: pstack — "adversarial signal comes from model diversity, not assigned personas" (`interrogate/SKILL.md:9`), "A verdict covers one patch" (`autopilot-full.md:5`) · mattpocock — separating axes "stops one axis from masking the other" (`:89`) · openclaw — findings "are advice to verify, not instructions" (`autoreview/SKILL.md:11`) · firstmate — one owner of rigor per path (`AGENTS.md:228-231`) · addy — "If you hand over conclusions, you'll get back validation" (`doubt…:83`) · Claude Code — false positives are the cost to filter (`code-review.md:33-42`).

## 2 · Ours today, measured (agent-platform `origin/master@2e8b59ca`)

| reviewer | stage | def | rubric preloaded (`skills:`) | rubric size · criteria | also told to read |
|---|---|---|---|---|---|
| `spec-design-reviewer` (Opus) | 5 (agent desc still also says stage 3, `:3`; F12 #18) | 94 l · 6.0 KB | `spec-review/SKILL.md` 367 l · 23.9 KB · **24** (A4 B1 C10 D3 T6) + `MEMORY.md` 16 l | re-read rubric + MEMORY at start (`:31,59`); issue + stage-2 comment; every Authority source **in full** bar rule-5 gate (`:42-46`; table `spec-review/SKILL.md:75-86`: ADRs, ARCHITECTURE, CONTEXT, PRODUCT-DESIGN, ROADMAP, CLAUDE.md, aruvii-standards, UX-CHARTER, sibling REQs, issue) |
| `architecture-reviewer` (Opus) | 5 (all but F-01) and 7 (A + F-01, rule 5 `architecture-review/SKILL.md:80-98`) | 104 l · 7.2 KB | `architecture-review/SKILL.md` 411 l · 33.1 KB · **30** (A9 B5 C6 D8 E1 F1) | re-read at start (`:38,66`); issue + stage-2 comment; Authority table (`:105-112`) by change class (rule 4, `:49-78`); discovery beyond baseline (`:53-54`) |
| `code-standards-reviewer` (Opus) | 7 | 75 l · 4.8 KB | `standards-review/SKILL.md` 790 l · 46.2 KB · **86** in 14 groups | re-read at start (`:31,45`); every changed file **in full** (`:48`); each rule file by glob (`standards-review:78-86`); every `references/*.md` a finding touches (`:41`); group gating (`:55-63`); smells capped at 3 (`:613`) |
| `smoke-spec-reviewer` (Opus) | after editing a smoke spec | 97 l · 6.1 KB | `smoke-spec/SKILL.md` 423 l · 29.7 KB · K-00..K-17 | re-read rubric + `rules/smoke.md` (`:32,61`); scanner; each spec, fixtures, config in full; a reference sibling spec (`:43-47,69-70`) |

Verdict format for all four: `MET/UNMET/N/A` per criterion, fixed BLOCKER/GAP/NIT, receipts, closing tally (e.g. `spec-review:319-367`).
How it reaches the MR: laptop = subagent of the authoring session; fleet = Spec Reviewer agent posts per-commit notes, QA agent posts "QA review · round N" (F12:19,22); all under one account with `/approved` (F12 #35).

Token evidence:

| measure | value | source |
|---|---|---|
| 57 reviewer runs | 101.2M input (deduped); median 1.3M spec · 1.5M arch · 1.7M standards; 16–19 calls | R4 §0 |
| token mix | 92.2% cache read · 7.8% cache write (5 m) · ~0% fresh | R4 §0 |
| per run | standards $1.95 · arch $1.92 (Opus 5.5) · spec $2.85 (Opus 5) | R4 §1 |
| dollar drivers | model output/thinking **62–66%** · fixed preload 15–19% · diff + changed files 11–12% · authority docs 6–10% · rubric re-read 0–4% · verification greps 2–3% | R4 §3, §5 |
| architecture-reviewer | ~130–180k peak ctx/run, 6 runs/day | F10 Q6 |
| #540 docs-only | 489,534 subagent tokens, two stage-5 passes, 14/21 and 13/23 N/A | `architecture-review:72-78`, `spec-review:60-66` |
| stage 7 without narrowing | 128k for one false claim | F12 #11 |
| P1 (one scoped reviewer pair, packets pushed in, !230 round 1) | 245,910 vs real round 1 ≈ 302k; found real F1–F5 + 1 new, missed F6 `final`, F7 boundaries | `p1/lead-judgment.md:7-32` |
| fleet QA | ~$4–5 per round, ~$12–15 over !230's 3 rounds | R4 §6 |

## 3 · Repeated work (each: evidence · rough cost)

| # | repeat | evidence | rough cost |
|---|---|---|---|
| R1 | rubric preloaded **and** re-read by tool | agent defs say "preloaded via `skills:`, but re-read it" (spec `:31`, arch `:38`, std `:31`, smoke `:32`); 39/57 runs did; re-read hit the **main checkout** path → possible rubric skew | 8% tokens, ≤4% $ (~$0.10/run) (R4 §4) |
| R2 | fixed preload re-sent on every call | system + CLAUDE.md + agent def + rubric ≈ 30–38k × 16–24 calls | 33–41% tokens, 15–19% $ (R4 §3) — mostly cache reads |
| R3 | whole REQ re-read to place a one-line delta | REQ-666 1,121 l / 89 KB (≈22–25k tok), REQ-660 708 l / 64 KB on master; branch REQs 565–1,115 l (F12 #8) | ~20k tok per read, carried through every later call |
| R4 | full review re-posted after a small revision; one note per commit | !267 7 spec + 4 arch rounds; !258 18 spec notes; !261 9; !267 8 notes in 12 min (F12 #14); spec reviewer names it the one thing to remove (F10 Q7) | 11 rounds × ~$2–3 ≈ $25–30 on !267 |
| R5 | verdict voided by every head move, no patch comparison | !253 "supersedes my 'aligned' at `4eea0bbc`", again `7d39757b`, `83d6b075` (F12 #15); REQ-531 re-approved 3× for owed lines (F12 #4, F10 Q1) | one full run per push |
| R6 | reading authority docs to prove `N/A` | #540: 489,534 tokens, both passes re-derived "Authority skipped, with why" (`spec-review:60-66`) | the gate (rule 4/5) was added after; ~250k/pass on docs-only |
| R7 | two-to-four reviewers read the same inputs | stage 5: spec + arch both read issue, stage-2 comment, REQ, ADRs, ARCHITECTURE, CONTEXT, ROADMAP (both Authority tables); stage 7: standards + arch both run merge-base diff and read changed files | diff bucket 22–24% tokens per reviewer (R4 §3), paid twice |
| R8 | stage-7 architecture re-reads stage-5 authority for group A | rule 5 keeps A firing at 7 (`architecture-review:86`) over the same ADRs/CONTEXT already read at 5 on the same MR | authority bucket 6–10% $ again |
| R9 | same command twice inside one run | identical `git diff` twice, +6.3k (R4 §2) | small, avoidable |
| R10 | criteria walked that cannot fire | output/thinking 62–66% $ scales with criteria walked: 86 / 30 / 24 (F12 #12); group gating exists for standards only | biggest lever (R4 §5 #1) |
| R11 | rounds with no cap and no delta rule | F14 §7 "unlimited"; nothing in the agent defs bounds rounds | open-ended |

## 4 · Mechanisms that avoid repeats

| mechanism | who does it, cited | what it removes here |
|---|---|---|
| delta review since last verdict | superpowers re-review: rounds 2–3 verdict each prior finding ADDRESSED / NOT ADDRESSED, inspect only the fix diff (60c RV6, RV48: `re-review-prompt.md:33-35,57-61`); claude-security "only flaws the change takes part in" (`README.md:51`); carried rows (60c RV37: bmad `step-04-review.md:55`) | R3, R4 |
| verdict keyed to head SHA, reused when patch unchanged | pstack patch-id (`shipping.md:7`), ledger keyed PR+SHA (`orchestrate.md:90`); openclaw "not a patch-identical rebase" (`pr-maintainer/SKILL.md:93`) and patch-identical green run (`references/landing.md:136-138`); ClawSweeper `sha=` marker (`review-gate.mjs:29,100`); firstmate head-bound attestation (`CONTRIBUTING.md:13`); Copilot dismisses approval on new commits | R5 |
| criteria / rules picked by changed paths | no-mistakes `path_instructions` (60c RV39–RV41); Copilot path-scoped instruction files; Claude Code CLAUDE.md of modified dirs (`code-review.md:12`); ours already: standards glob table + group gating (`standards-review:55-86`), arch change-class tier (`:49-78`); P1 measured 246k vs ~302k | R6, R10 |
| one context pack per MR, built once, pushed in | pstack "Package the diff …" + one template for all reviewers (`interrogate/SKILL.md:19,38`); mattpocock capture the diff once, paste the baseline (`:21,65`); autoreview reviewer gets a bundle, cannot read unchanged files (`:89-91`); addy ARTIFACT + CONTRACT only (`doubt…:75-83`); P1 packets 19.6k / 14.6k words (60c Q4) | R1, R7, R9 |
| prompt caching of stable prefixes | Anthropic docs (platform.claude.com/docs/en/build-with-claude/prompt-caching, fetched 2026-10-19): read 0.1× base (0.05× Opus 5.5), write 1.25× (5 m) / 2× (1 h); default TTL 5 m, refreshed on hit; prefix order tools → system → messages; hit needs a 100% identical prefix; min 512 tok on Opus 5.5. Ours already 92% cache read (R4 §0), so caching is in use; what breaks it is a changed prefix (rubric re-read lands mid-conversation, not in the prefix) | R2 (already mostly cached) |
| subagent returns a summary, not a transcript | Claude Code docs (code.claude.com/docs/en/sub-agents): own context window, "returns only the summary"; `skills:` "full skill content is injected"; mattpocock ≤400 words/axis (`:66,72`); ClawSweeper short list + collapsed detail (`:67-71`) | R4 (thread size: !253 35 notes, !258 40, F12 #30) |
| round caps | addy 3 cycles then human (`doubt…:181-191`); ClawSweeper 10/PR, 1/head (`:254-257`); superpowers 5, no-mistakes `auto_fix.review: 0` (R9:92); autoreview no rounds "for a nicer verdict" (`:253`); pstack one full swarm, then single verifier (`autopilot-full.md:14`) | R11 |
| cheap models for cheap steps + confidence filter | Claude Code: Haiku for eligibility, path listing, summary, scoring; drop <80 (`code-review.md:11-13,20-26`) | R10 (fewer findings to write up) |

## 5 · The decision guide (issue #18) vs today's rubrics

Docs it loads, on master `2e8b59ca`:

| doc | exists | size | note |
|---|---|---|---|
| `docs/design/PRODUCT-DESIGN.md` §1, §10 | yes | 287 l · 17.6 KB (§1 = l 9–36, §10 = l 249–268) | **§10.8 text differs from the guide:** master says "not a data-pipeline / workflow tool"; the guide's "AI workload stream … not endpoints/DLP" is not in the file (grep `DLP` = 0). §1 says "shipped as Docker images", self-hosted/airgap; guide says "on-prem or cloud, mostly k8s" — not in the file |
| `docs/design/AGENT-PRINCIPLES.md` | yes | 210 l · 15.4 KB, **15** principles + "Where 12-factor does not fit" (l 192–199) | guide's "L194 the model may add asks, never remove a gate" is at **l 196–197** on master (drift of 2–3 lines) |
| `docs/research/agent-principles-sdk-reference.md` | yes | 1,705 l · **219.6 KB** (≈55k tok whole), §P1–§P14 (no §P15), "Corrections" l 18 | guide loads "the § matching the topic" → ~10–17 KB per § |

Guide part → existing criteria (spec = `spec-review`, arch = `architecture-review`):

| guide line | overlap | missing | conflicting |
|---|---|---|---|
| A · §10.1 governance > autonomy | spec B-01 names "bounded/auditable/reversible" (`spec-review:151`) | — | — |
| A · §10.2 generated but proven | — | no criterion | — |
| A · §10.8 our lane | spec B-01 (PRODUCT-DESIGN, generic) | lane wording | guide text ≠ master §10.8 |
| A · ADOPT where SDKs converge | arch B-01 standard mechanism (`:192-197`), B-03 repo precedent (`:206-211`) | no rubric reads `sdk-reference` | — |
| A · PRINCIPLE 12-factor F6/F7/F8 | arch B-05 via AGENT-PRINCIPLES §1, §5 (`:220-225`) | — | — |
| A · OUR LAYER §6 / L194 / §4 / §7 / §11 | arch B-05 (any principle touched); spec C-07 security surface (§7 partly); arch D-03 states (§4 partly) | stage 7: "nothing … checks a diff against a principle the design didn't mention" (`AGENT-PRINCIPLES.md:205-209`) | §6 "no off switch" vs spec T-05 / arch C-03 "specify the flag-off path" — compatible for feature flags, unstated for a governance setting |
| A · deny by default (H7) · unreviewed starts strict · wider = explicit human | spec rule 1 / arch rule 3 (surface open questions); arch D-07 "403 or 404 is itself a decision" | no criterion asks "is the default the narrowest"; H7 not found in rubrics or the three docs (UNVERIFIED source) | — |
| A · one seam per concern · no null decides a case | standards T-01, T-03 (stage 7 only); arch A-06, C-02 | no stage-5 null/seam check; S-1..S-7 (#679) not on master rubric | — |
| B1 OUR RULES: 📌 / REQ / ADR / charter by number | spec A-03, arch A-07 (ADRs); arch B-05 EDGE names "📌 on #563" | 📌 notes, parent map "Decisions so far", charter not in either Authority table | — |
| B1 every code fact VERIFIED / WRONG / UNVERIFIED at file:line | spec rules 3–4, C-09 (grep every reader) | the three-way marking | — |
| B2 OTHERS: SDKs + 12-factor, re-check at primary source or mark "inference" | arch B-01 (names a standard + switching cost) | primary-source re-check; "hole they leave" | — |
| B3 ARUVII CONTEXT: one scenario; create · edit · import/resync · crash/replay · each role · platform vs workspace | arch D-01..D-07, spec C-03, C-05, C-08 | import/resync, crash/replay, platform-vs-workspace scope, "can anything run no human saw" | — |
| B4 OPTION: narrowest default · deny incl. later fields · state as data, evidence per action · one seam / no null | arch C-02 (next variant is an addition), D-03; B-05 via §4, §11 | narrowest-default, deny-for-later-fields | — |
| verdict ALIGNED / CONFLICT / OPEN | — | — | rubrics return `MET/UNMET/N/A` per criterion; guide returns one verdict per **decision** |
| findings BLOCKER / GAP / NIT + receipts | same tiers, receipts in both rubrics | — | rubrics fix severity per criterion; guide assigns per finding |
| "an open question is a finding, never answered by you" | spec rule 1 (`:39-41`), arch rule 3 (`:45-47`) | — | — |
| input = ticket #NNN (+ MR/REQ), `glab issue view --comments` | rubrics take a REQ / MR / diff (`spec-design-reviewer:52-55`, `architecture-reviewer:58-62`) | ticket-level input | — |

Load cost of the guide's verifier, rough: PRODUCT-DESIGN §1+§10 ≈ 1.5k tok · AGENT-PRINCIPLES ≈ 4.4k · one sdk-reference § ≈ 3–4k · issue + comments (varies; !253-style threads ≈1,900 lines, F12 #30) — against today's arch preload alone 33 KB (≈9k tok).

Not established: Copilot re-review scope; Claude Code built-in `/security-review` text (not cached locally); pstack round cap; meaning of guide "H7"; per-run token cost of the guide's verifier (never run).
