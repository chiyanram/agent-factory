# 13 — Old map carry-over index (chiyanram/skills map #9 → agent-factory #1)

Ticket: agent-factory #11. Built 2026-10-18 from chiyanram/skills `main` @ `1092b85`. Files stay in chiyanram/skills — linked, not copied.
Status words: **yes** still valid · **partly** valid with a named gap · **superseded** (by what) · **parked** (2026-10-18, runtime decision).
Judged against the 2026-10-18 findings in this folder: 01 refs refresh · 02 agent products · 03/04/05 audits · 06 inventory · 09 landscape · 10 interviews.
Map [sk#9](https://github.com/chiyanram/skills/issues/9) closed 2026-10-18 for agent-factory #1; G1–G23 + research are input 2; G24–G32 parked; built work 10-17/18 frozen as evidence.
Feeds: **#4** agent setup · **#7** dev today · **#8** landscape · **#9** hosting · **#10** /crq · **fog** = rulebook fog · none.

## Research findings (research/00–68; R-ticket shown beside its file)

| item | what it learned or decided (≤20 words) | still valid? | feeds |
|---|---|---|---|
| [00-fleet-self-reports](https://github.com/chiyanram/skills/blob/main/research/00-fleet-self-reports.md) | 4 agents load ~50 KB at start; nobody runs /crq end to end; developer skips /dod, stage 7, deslop | partly — 10 interviews refresh it | #7 |
| [00-operator-inputs](https://github.com/chiyanram/skills/blob/main/research/00-operator-inputs.md) | index of every operator link/idea (pstack, firstmate, forge…) and where it landed | yes | #8 |
| [00-reference-format](https://github.com/chiyanram/skills/blob/main/research/00-reference-format.md) | reference template: Rules (reason) · When X use Y · Good/Bad · Decided edges · Review checks | yes (amended G21, G23) | fog |
| [01](https://github.com/chiyanram/skills/blob/main/research/01-rule-inventory.md) · R1 [sk#10](https://github.com/chiyanram/skills/issues/10) | Java rules stated 4–5×, AssertJ ×12, 5 contradictions; CLAUDE.md = 60% of startup load | yes | fog · #7 |
| [02](https://github.com/chiyanram/skills/blob/main/research/02-skill-pickup.md) · R2 [sk#11](https://github.com/chiyanram/skills/issues/11) | slash ≈630 vs model ≈100 invocations; "Run X" in stage text fires 5/5; 8 skills never fired | yes | #10 · fog |
| [03](https://github.com/chiyanram/skills/blob/main/research/03-how-others-do-it.md) · R3 [sk#12](https://github.com/chiyanram/skills/issues/12) | pstack/firstmate/matt/addy/Anthropic: router skill + leaves, one AGENTS.md, CLAUDE.md=@AGENTS.md | partly — refs moved (01) | #8 · fog |
| [04](https://github.com/chiyanram/skills/blob/main/research/04-reviewer-cost-baseline.md) · R4 [sk#13](https://github.com/chiyanram/skills/issues/13) | one review ≈ $2–2.8; 62–66% of output is thinking; reviewer read main checkout, not worktree | yes | #7 · #10 |
| [05](https://github.com/chiyanram/skills/blob/main/research/05-humanlayer-cc-agui.md) · R5 [sk#19](https://github.com/chiyanram/skills/issues/19) / R6 [sk#20](https://github.com/chiyanram/skills/issues/20) | 12-factor, CC headless (`--bare` breaks rule parity), AG-UI as human channel; no retry ceiling | partly — AG-UI dropped (G16) | #8 · #4 |
| [07](https://github.com/chiyanram/skills/blob/main/research/07-role-box-design.md) · D1 [sk#7](https://github.com/chiyanram/skills/issues/7) [sk#21](https://github.com/chiyanram/skills/issues/21) | paper design: Agent SDK box per role + AG-UI, one compose laptop+VM (B + D) | superseded by G6 then parked (G24–G32); [sk#21](https://github.com/chiyanram/skills/issues/21) open | #9 |
| [08](https://github.com/chiyanram/skills/blob/main/research/08-standards-inventory.md) · R7 [sk#23](https://github.com/chiyanram/skills/issues/23) | every standards file, reader and target; standards-review 86 criteria, arch-review 29 | partly (pre-G9) | fog |
| [09](https://github.com/chiyanram/skills/blob/main/research/09-wiki-reference-anatomy.md) | guide+rubric pattern already exists split in two; testing ladder 0–4 | yes | fog |
| [10](https://github.com/chiyanram/skills/blob/main/research/10-roles-souls-sdlc.md) · R8 [sk#24](https://github.com/chiyanram/skills/issues/24) | how refs do role, soul, SDLC; openclaw uses AGENTS.md for agent's own file (name clash) | partly — refs moved (01) | #4 |
| [11](https://github.com/chiyanram/skills/blob/main/research/11-popular-review-workflows.md) · R9 [sk#27](https://github.com/chiyanram/skills/issues/27) | >10k★ reviewers: diff pushed in, path-scoped criteria, two verdicts (superpowers), validator per finding | yes | #10 |
| [12](https://github.com/chiyanram/skills/blob/main/research/12-claude-cloud-backend.md) · R10 [sk#28](https://github.com/chiyanram/skills/issues/28) | cloud sessions not viable on GitLab (no push-back); Managed Agents partly | partly — 02 adds `--bg`/agent view | #9 · #8 |
| [13](https://github.com/chiyanram/skills/blob/main/research/13-humanlayer-suite.md) · R11 [sk#29](https://github.com/chiyanram/skills/issues/29) | fold compaction format; implementation-reviewer 4 buckets; pushed diff, maxSteps cap | yes | #8 |
| [14](https://github.com/chiyanram/skills/blob/main/research/14-disposition-table.md) · R12 [sk#31](https://github.com/chiyanram/skills/issues/31) | every existing file's fate, sources, learnings; superseded in part 10-17 (banner) | partly | fog |
| [15](https://github.com/chiyanram/skills/blob/main/research/15-testing-content-audit.md) · R13 [sk#36](https://github.com/chiyanram/skills/issues/36) | no testing file SOUND: 3 rewrite, 9 need fixes, tdd → plugin | yes (unbuilt, AP #644) | fog |
| [16](https://github.com/chiyanram/skills/blob/main/research/16-skill-writing-standards.md) · R14 [sk#38](https://github.com/chiyanram/skills/issues/38) | descriptions = triggers only; size by load frequency; one excellent example | yes | fog |
| [17](https://github.com/chiyanram/skills/blob/main/research/17-testing-sources.md) | verified source list per testing reference | yes | fog |
| [18](https://github.com/chiyanram/skills/blob/main/research/18-plinth-testing-mapping.md) · R15 [sk#39](https://github.com/chiyanram/skills/issues/39) | plinth testing rules mapped onto our references | yes | fog |
| [20](https://github.com/chiyanram/skills/blob/main/research/20-spock-verification.md) · R16 [sk#40](https://github.com/chiyanram/skills/issues/40) | operator's Spock skill checked vs Spock 2.4 docs; `@Unroll` claims OUTDATED | yes | fog |
| [21](https://github.com/chiyanram/skills/blob/main/research/21-mutation-and-property.md) · R17 [sk#41](https://github.com/chiyanram/skills/issues/41) | PIT as report, not gate; `withHistory` unproven; property-test candidates | yes | fog |
| [22](https://github.com/chiyanram/skills/blob/main/research/22-playwright-frontend-testing.md) · R18 [sk#42](https://github.com/chiyanram/skills/issues/42) | Playwright docs confirm K-rules; smoke scanner runs nowhere automatically; missing web-first matchers | yes | fog |
| [23](https://github.com/chiyanram/skills/blob/main/research/23-agent-sdk-test-mix.md) · R19 [sk#43](https://github.com/chiyanram/skills/issues/43) | our 31% IT share already above every Python/TS agent SDK (3–18%) | yes | fog |
| [24](https://github.com/chiyanram/skills/blob/main/research/24-fakes-vs-mocks.md) · R20 [sk#44](https://github.com/chiyanram/skills/issues/44) | "fake port, never @MockitoBean" — partly backed by industry | yes | fog |
| [25](https://github.com/chiyanram/skills/blob/main/research/25-gherkin-to-every-tier.md) · R21 [sk#45](https://github.com/chiyanram/skills/issues/45) | analyst Gherkin → unit/IT/e2e reading the same, no Cucumber runtime | yes | fog · #10 |
| [26](https://github.com/chiyanram/skills/blob/main/research/26-spring-testing-docs.md) · R22 [sk#8](https://github.com/chiyanram/skills/issues/8) | Spring 7 / Boot 4.1 testing docs vs approved rules, verdict per rule | yes | fog |
| [27](https://github.com/chiyanram/skills/blob/main/research/27-jqwik.md) · R23 [sk#46](https://github.com/chiyanram/skills/issues/46) | keep our property harness; port edge-case injection; jqwik 1.9.3 pin is a dead end | yes | fog |
| [28](https://github.com/chiyanram/skills/blob/main/research/28-smoke-e2e-disposition.md) · R24 [sk#47](https://github.com/chiyanram/skills/issues/47) | baseline holds; 34 of rubric's rows are noise; smallest smoke rule set | yes | fog |
| [29](https://github.com/chiyanram/skills/blob/main/research/29-java-standards.md) · R25 [sk#48](https://github.com/chiyanram/skills/issues/48) | ProblemDetail claimed but used nowhere; 4 conflicting precedence answers | yes | fog |
| [30](https://github.com/chiyanram/skills/blob/main/research/30-ts-angular-standards.md) · R26 [sk#49](https://github.com/chiyanram/skills/issues/49) | TS/Angular candidates; OnPush 32/68; replace custom lint by tsRecommended | yes | fog |
| [31-good-bad-BRIEF](https://github.com/chiyanram/skills/blob/main/research/31-good-bad-BRIEF.md) · [31-good-bad-v2-BRIEF](https://github.com/chiyanram/skills/blob/main/research/31-good-bad-v2-BRIEF.md) | briefs for parallel Good/Bad passes (v1 real code, v2 obey every rule) | superseded by [55-good-bad-v3-BRIEF](https://github.com/chiyanram/skills/blob/main/research/55-good-bad-v3-BRIEF.md) | none |
| [31a](https://github.com/chiyanram/skills/blob/main/research/31a-good-bad-strategy-to-value-bar.md) · [31a-v2](https://github.com/chiyanram/skills/blob/main/research/31a-v2.md) | testing pairs S/TM/AT/C/B/V; v2 fixed house style | superseded by [68a](https://github.com/chiyanram/skills/blob/main/research/68a-neutral-testing-strategy.md) | fog |
| [31b](https://github.com/chiyanram/skills/blob/main/research/31b-good-bad-unit-it-spock.md) · [31b-v2](https://github.com/chiyanram/skills/blob/main/research/31b-v2.md) | unit/IT/Spock pairs U/IT/SP/K | superseded by 68b | fog |
| [31c](https://github.com/chiyanram/skills/blob/main/research/31c-good-bad-mutation-property-scenarios.md) · [31c-v2](https://github.com/chiyanram/skills/blob/main/research/31c-v2.md) | mutation/property/Gherkin AC/scenario pairs | superseded by 68c | fog |
| [31d](https://github.com/chiyanram/skills/blob/main/research/31d-good-bad-smoke.md) · [31d-v2](https://github.com/chiyanram/skills/blob/main/research/31d-v2.md) | smoke pairs EA–ED | superseded by 68d | fog |
| [31e](https://github.com/chiyanram/skills/blob/main/research/31e-conventions.md) | conventions raised by v2 (CV1–CV6) | yes (as ledger rows) | fog |
| [32](https://github.com/chiyanram/skills/blob/main/research/32-java-standards-sources.md) · R27 [sk#59](https://github.com/chiyanram/skills/issues/59) | plinth / jvm-skills / Jeffallan mapped onto R25; ours is the baseline | yes | fog |
| [33](https://github.com/chiyanram/skills/blob/main/research/33-good-bad-approvals.md) | operator approvals of pair batches, 2026-10-02 | superseded (Goods from our code redone, 47/68) | none |
| [34](https://github.com/chiyanram/skills/blob/main/research/34-agents-md-survey.md) | AGENTS.md 32,775 B already truncated in Codex (32 KiB); what stays in root | yes (AP #646 unbuilt) | fog · #7 |
| [35](https://github.com/chiyanram/skills/blob/main/research/35-retro-session-2026-10-02.md) | 35-h session, 966K ctx, 35% on one-line approvals; briefs lack completion criterion; `cd` drift | yes | #7 · #4 |
| [36](https://github.com/chiyanram/skills/blob/main/research/36-agent-side-content.md) | words for coordinator, souls, brief, handoff, retro (from refs) | partly — souls built, 2nd copy (06) | #4 |
| [37](https://github.com/chiyanram/skills/blob/main/research/37-verification-runner.md) · R28 [sk#60](https://github.com/chiyanram/skills/issues/60) | every ref gates at the SHA on the forge; ours pasted result.md; option B project runner | partly — two gates now (05) | #9 |
| [38](https://github.com/chiyanram/skills/blob/main/research/38-vm-gate-runner.md) · R29 [sk#62](https://github.com/chiyanram/skills/issues/62) | 61-min gate: smoke full 40% (CPU LLM), serial IT 18m50, deploy 10 m | yes — interviews repeat it | #9 · #7 |
| [39](https://github.com/chiyanram/skills/blob/main/research/39-verification-history.md) · R30 [sk#63](https://github.com/chiyanram/skills/issues/63) | keep: one serial gate at SHA, agents off full stacks, evidence on forge, no hand relay | yes | #9 |
| [40](https://github.com/chiyanram/skills/blob/main/research/40-forge.md) · R31 [sk#64](https://github.com/chiyanram/skills/issues/64) | adopted: review covers head; refuse spawn on missing skill; "no checks" ≠ green | yes | #8 · #10 |
| [41](https://github.com/chiyanram/skills/blob/main/research/41-planning-candidate-rules.md) | planning candidate rules SR/AC/PD/DG/WD | yes (decided → ledger) | fog |
| [42](https://github.com/chiyanram/skills/blob/main/research/42-planning-good-bad.md) | 20 planning pairs | superseded by 68e | fog |
| [43](https://github.com/chiyanram/skills/blob/main/research/43-tdd-in-references.md) | refs stopped test-first; recommend B: test-first for bugs, PIT on touched code | yes (G12) | #10 |
| [44](https://github.com/chiyanram/skills/blob/main/research/44-api-errors-inventory.md) · [45](https://github.com/chiyanram/skills/blob/main/research/45-error-catalogue.md) · [sk#58](https://github.com/chiyanram/skills/issues/58) | 104 ErrorCodes approved; typed outcomes + one mapper + ProblemDetail{code,traceId} | yes (AP #662 unbuilt) | fog |
| [46](https://github.com/chiyanram/skills/blob/main/research/46-fleet-security-inventory.md) | credentials, reach, threats per worker; per-role bots option | parked with G13 build (05 heavier) | #9 |
| [47](https://github.com/chiyanram/skills/blob/main/research/47-good-rewrites.md) | every Good taken from our code rewritten from its real Bad | superseded by 68a–f (neutral) | fog |
| [48](https://github.com/chiyanram/skills/blob/main/research/48-rule-source-audit.md) | 161 testing+planning rules classed REF / REF-FOUND / OURS-ONLY / CONFLICT | yes | fog |
| [49](https://github.com/chiyanram/skills/blob/main/research/49-g9b-candidates.md) · R44 | one merged code+obs candidate list (R25+R26+R27+R43) | yes (decided → ledger) | fog |
| [50](https://github.com/chiyanram/skills/blob/main/research/50-spring-ai-sources.md) · R32 [sk#73](https://github.com/chiyanram/skills/issues/73) | source ranking for Spring core/Security/AI/agent engineering | yes | fog |
| [51](https://github.com/chiyanram/skills/blob/main/research/51-spring-core-rules.md) · R33 [sk#77](https://github.com/chiyanram/skills/issues/77) | Spring core rules from Boot 4.1 / Framework 7 reference | yes | fog |
| [52](https://github.com/chiyanram/skills/blob/main/research/52-spring-security-rules.md) · R34 [sk#78](https://github.com/chiyanram/skills/issues/78) | Security 7.1 rules: authn, authz, method security, testing | yes | fog |
| [53](https://github.com/chiyanram/skills/blob/main/research/53-code-obs-reference-check.md) · R43 | code+obs candidates vs reference repos (pstack, matt, addy, hl, Jeffallan) | yes | fog |
| [54](https://github.com/chiyanram/skills/blob/main/research/54-g9b-good-bad-selection.md) | 44 G9b rules picked for a pair | yes | fog |
| [55-good-bad-v3-BRIEF](https://github.com/chiyanram/skills/blob/main/research/55-good-bad-v3-BRIEF.md) | our code is never a Good nor a rule's source (SRC1, GB2, SEAM1) | partly — neutral domain (G23) on top | fog |
| [56a](https://github.com/chiyanram/skills/blob/main/research/56a-g9b-good-bad-java-errors.md) · 56b · 56c | G9b pairs: Java, errors, layers, shape, Spring, API, security | superseded by 68f | fog |
| [57](https://github.com/chiyanram/skills/blob/main/research/57-resourcing-ours-only-rules.md) | 11 ours-only rules re-sourced; MS2 conflicts with plinth | yes | fog |
| [58](https://github.com/chiyanram/skills/blob/main/research/58-fowler-spring-codebase.md) · R36 [sk#83](https://github.com/chiyanram/skills/issues/83) | Fowler smells + Spring codebase → seam rules S-1..S-7 (AP #679) | yes | fog |
| [59](https://github.com/chiyanram/skills/blob/main/research/59-checkstyle-and-smell-lists.md) · R37 [sk#84](https://github.com/chiyanram/skills/issues/84) | 23 Checkstyle modules gate approved rules; Checkstyle not on every module | yes | fog |
| [60-g9c-BRIEF](https://github.com/chiyanram/skills/blob/main/research/60-g9c-BRIEF.md) · [60a](https://github.com/chiyanram/skills/blob/main/research/60a-g9c-migrations.md) | migrations candidates; tier A decided (MG rows) | yes | fog |
| [60b](https://github.com/chiyanram/skills/blob/main/research/60b-g9c-delivery.md) · [60c](https://github.com/chiyanram/skills/blob/main/research/60c-g9c-review-packet.md) | delivery + review-packet candidates, DRAFT, never decided ([sk#34](https://github.com/chiyanram/skills/issues/34) open) | partly — open | fog · #10 |
| [63](https://github.com/chiyanram/skills/blob/main/research/63-agent-engineering-sources.md) · R35 [sk#79](https://github.com/chiyanram/skills/issues/79) | library-free agent practice: adapter, loop, context/cache, guardrails, OTel GenAI; candidates only | partly — open | none (product) |
| [64](https://github.com/chiyanram/skills/blob/main/research/64-core-design.md) · R38 [sk#86](https://github.com/chiyanram/skills/issues/86) | CP1–CP12: take a ref's reason, never its rule; principle needs ≥2 independent sources | yes — 01/02 reinforce | #4 · fog |
| [64a](https://github.com/chiyanram/skills/blob/main/research/64a-why-pstack.md) | pstack changes on evals: reasons beat bans (#633), cuts A/B tested, Act-on cap deleted | partly — 30 newer commits (01) | #8 |
| [64b](https://github.com/chiyanram/skills/blob/main/research/64b-why-firstmate.md) | firstmate: VISION-gated PRs, stuck-worker incidents, layered enforcement | partly — 23 newer commits (01) | #8 |
| [64c](https://github.com/chiyanram/skills/blob/main/research/64c-why-mattpocock-humanlayer.md) | matt .out-of-scope rejections, retro ordering; humanlayer RPI files between sessions | yes (0 new commits) | #8 |
| [64d](https://github.com/chiyanram/skills/blob/main/research/64d-why-openclaw-forge-addy.md) | openclaw nested AGENTS.md, CI reversal on 1,892 lanes; forge ADRs; addy evals ledger | partly — forge +27 commits | #8 |
| [64e](https://github.com/chiyanram/skills/blob/main/research/64e-industry.md) | Cognition one writer, MARS 15× tokens, DORA small batches, Copilot cannot merge | yes — 02 extends | #8 · #4 |
| [65](https://github.com/chiyanram/skills/blob/main/research/65-ticket-comment-drafts.md) · T [sk#100](https://github.com/chiyanram/skills/issues/100) | AC lines added to build tickets from 10-16/17 decisions | partly — targets frozen | none |
| [66](https://github.com/chiyanram/skills/blob/main/research/66-gate-scope.md) | rerun failed job alone, scoped tests, flake policy; done = all jobs passed at head SHA | parked (G29) | #9 |
| [67](https://github.com/chiyanram/skills/blob/main/research/67-host-config.md) | type only what operator knows; derive the rest; mise as one toolchain source | parked (G32) | #9 |
| [68a](https://github.com/chiyanram/skills/blob/main/research/68a-neutral-testing-strategy.md) · 68b · 68c · 68d · [sk#99](https://github.com/chiyanram/skills/issues/99) | all testing pairs rewritten into ordering+billing domain | yes | fog |
| [68e](https://github.com/chiyanram/skills/blob/main/research/68e-neutral-planning.md) · [68f](https://github.com/chiyanram/skills/blob/main/research/68f-neutral-code.md) | planning + code pairs in neutral domain; Aruvii path:line moved to ledger evidence | yes | fog |
| R39 [sk#96](https://github.com/chiyanram/skills/issues/96) (no file) | 15 new ref ideas triaged vs 5 mistake kinds; most already adopted or routed as content | yes | fog |
| [sk#110](https://github.com/chiyanram/skills/issues/110) inventory | every non-script file of 10-17/18 → moved here as 06 | superseded by 06 | #9 |
| P1 [sk#18](https://github.com/chiyanram/skills/issues/18) · `p1/` | scoped reviewer replayed on !230: lead judgment vs real QA rounds | yes (A-1 rerun owed) | #10 |
| [sk#67](https://github.com/chiyanram/skills/issues/67) pilot (open) · [sk#81](https://github.com/chiyanram/skills/issues/81) [sk#65](https://github.com/chiyanram/skills/issues/65) [sk#80](https://github.com/chiyanram/skills/issues/80) [sk#71](https://github.com/chiyanram/skills/issues/71) [sk#74](https://github.com/chiyanram/skills/issues/74) [sk#75](https://github.com/chiyanram/skills/issues/75) [sk#51](https://github.com/chiyanram/skills/issues/51)–[sk#57](https://github.com/chiyanram/skills/issues/57) [sk#85](https://github.com/chiyanram/skills/issues/85) (after-v1) | pilot never run; later topics parked as after-v1 | parked | #9 / fog |

## Decisions G1–G23

| item | what it decided (≤20 words) | still valid? | feeds |
|---|---|---|---|
| G1 [sk#14](https://github.com/chiyanram/skills/issues/14) | 4 layers: AGENTS.md index, path MUSTs, skills+references one tree, hooks; upstream skills as plugins; one fleet repo | partly — 3-repo part superseded by G23 | fog |
| G1b [sk#72](https://github.com/chiyanram/skills/issues/72) | dir MUSTs → nested AGENTS.md + CLAUDE.md shim; file-type MUSTs → root blocks; delete .claude/rules | yes (AP #646 unbuilt) | fog |
| G2 [sk#15](https://github.com/chiyanram/skills/issues/15) | one crq.md owns stages, each tagged by role label; qa always fresh, read-only | yes | #10 · #4 |
| G3 [sk#16](https://github.com/chiyanram/skills/issues/16) | one reviewer, two verdicts (Standards ‖ Spec), lead buckets, ≤3 rounds; arch-reviewer removed | yes — not landed: interviews show arch-reviewer still runs (10) | #10 |
| G4 [sk#17](https://github.com/chiyanram/skills/issues/17) | laptop and VM load identical files; coordinator = contract with adapters; agent side as plugins | partly — 06: souls 2nd copy | #4 · #9 |
| G5 [sk#22](https://github.com/chiyanram/skills/issues/22) | one reference serves author and reviewer; five sections | yes ("pinned from this repo" superseded by G23) | fog |
| G6 [sk#25](https://github.com/chiyanram/skills/issues/25) | one always-on coordinator + fresh worker per (item, role); coordinator never codes/approves/merges | partly — hard rules yes; daemon shape questioned (05, 02) | #4 |
| G7 [sk#26](https://github.com/chiyanram/skills/issues/26) | agents propose rulebook MRs, operator merges; retro worker + /lesson; ≤2 MRs per item | yes (ordered by G18) | #4 · fog |
| G8 [sk#30](https://github.com/chiyanram/skills/issues/30) | one crq.md; stage mask from type × size; floor for migration/security/API/dependency | yes | #10 |
| G9a [sk#32](https://github.com/chiyanram/skills/issues/32) [sk#2](https://github.com/chiyanram/skills/issues/2) | testing domain: router + references + workflows; 110 testing rules approved | yes (pairs → 68a–d) | fog |
| G9b [sk#33](https://github.com/chiyanram/skills/issues/33) [sk#3](https://github.com/chiyanram/skills/issues/3) | code+obs: 178 approved + Spring core/Security/Fowler/Checkstyle; S-1..S-7 seams | yes | fog |
| G9c [sk#34](https://github.com/chiyanram/skills/issues/34) [sk#4](https://github.com/chiyanram/skills/issues/4) | migrations tier A decided; delivery + review packet still open | partly — open | fog · #10 |
| G9d [sk#35](https://github.com/chiyanram/skills/issues/35) [sk#5](https://github.com/chiyanram/skills/issues/5) | planning rules, crq stage text (review/crq-stages.html), reply card, module CLAUDE→AGENTS | yes | #10 · fog |
| G9e [sk#50](https://github.com/chiyanram/skills/issues/50) | coordinator soul, 4 role souls, 9-field brief + HUMAN'S WORDS, status words, retro | partly — content yes; watchdog/post-status wiring parked | #4 |
| G10 [sk#37](https://github.com/chiyanram/skills/issues/37) [sk#6](https://github.com/chiyanram/skills/issues/6) | how a domain is decided (candidates → page → ledger → pairs); Bad = real, Good = rewrite | partly — Good/Bad location superseded by G23 Q3 | fog |
| G11 [sk#66](https://github.com/chiyanram/skills/issues/66) | 5 numbers per item: touches, fix rounds, findings, tokens/stage, cycle+gate time; fingerprint | yes (never measured; pilot open) | #7 · #4 |
| G12 [sk#68](https://github.com/chiyanram/skills/issues/68) | TDD for bugs only; PIT on touched classes, survivors listed; report-only first | yes (AP #659 unbuilt) | #10 |
| G13 [sk#69](https://github.com/chiyanram/skills/issues/69) | per-role bots, container secrets, egress allow-list, 3 unix zones; RO GitHub token | partly — principle CP7 yes; 3-layer build heavier than every ref (05) | #9 |
| G14 [sk#70](https://github.com/chiyanram/skills/issues/70) | tokens + wall time per stage; caps p90×1.5 after ≥5 items; pause spawns at 70% window | partly — 70% pause off unless typed (03) | #9 · #4 |
| G15 [sk#76](https://github.com/chiyanram/skills/issues/76) | no Spring AI rules; drop 3 unused starters (AP #663) | yes | none |
| G16 [sk#82](https://github.com/chiyanram/skills/issues/82) | forge thread = conversation + record; Discord only link-only push | partly — not built; old agents still Discord-only (03) | #4 · #9 |
| G17 [sk#87](https://github.com/chiyanram/skills/issues/87) | drop Act-on ≤5 cap (pstack A/B); four buckets stay | yes | #10 |
| G18 [sk#88](https://github.com/chiyanram/skills/issues/88) | lessons strongest-first: check → reference → soul → machine file → dropped with reason | yes | #4 · fog |
| G19 [sk#89](https://github.com/chiyanram/skills/issues/89) | forge thread is the record; worker scratch uncommitted; forge-neutral words, one adapter | yes | #10 · #4 |
| G20 [sk#90](https://github.com/chiyanram/skills/issues/90) | static AGENTS.md checks in make lint + sentinel delivery probe per harness | yes — 01 "rules not reaching agent" in 4 refs | fog |
| G21 [sk#91](https://github.com/chiyanram/skills/issues/91) | Rule line = imperative + because + failure, ≤35 words; reason column; no reason → delete | yes | fog |
| G22 [sk#92](https://github.com/chiyanram/skills/issues/92) | a rule that can be a check becomes one; list is build work (AP #696) | yes | fog |
| G23 [sk#93](https://github.com/chiyanram/skills/issues/93) | 3 layers: generic (skills plugin) · project (agent-platform) · fleet; pairs neutral | partly — plugin empty (04) | fog · #4 |

## Decisions G24–G32 (parked 2026-10-18; built code frozen)

| item | what it decided before parking (≤20 words) | still valid? | feeds |
|---|---|---|---|
| G24 [sk#94](https://github.com/chiyanram/skills/issues/94) | build order: fleet first, generic skills in parallel, project layer after | parked — map restarted as agent-factory #1 | #4 · #9 |
| G25 [sk#95](https://github.com/chiyanram/skills/issues/95) | improve agent-fleet in place, install fresh into zones, pilot, retire old agents | parked — 09 suggests reuse (workmux) | #9 |
| G26 [sk#101](https://github.com/chiyanram/skills/issues/101) | caps by resource: ≤2 building/host, reviewers uncapped, ≤3 waiting, over cap = queued | parked (built, matches) | #9 |
| G27 [sk#102](https://github.com/chiyanram/skills/issues/102) | fresh worktree per builder; crash → 1 retry; stuck box detected on screen; ask-tool off | parked — screen-scraping questioned (05, 01) | #9 · #4 |
| G28 [sk#103](https://github.com/chiyanram/skills/issues/103) | keep our pipeline, start minimal: one writer, one reviewer, switch trigger per difference | yes in spirit (CP4) — only non-runtime one | #10 · #4 |
| G29 [sk#105](https://github.com/chiyanram/skills/issues/105) | gate = GitLab jobs with needs:, rerun failed job, floor every push, full at MR head | parked (!263 open) | #9 |
| G30 [sk#106](https://github.com/chiyanram/skills/issues/106) | coordinator = own Reporter bot, tmux as fleet-coord under systemd/launchd, own transcripts | parked | #9 |
| G31 [sk#108](https://github.com/chiyanram/skills/issues/108) | coordinator `--settings` root-owned, dontAsk, narrow allow-list, posts to forge | parked | #9 |
| G32 [sk#109](https://github.com/chiyanram/skills/issues/109) | 4 typed host keys, rest derived; mise.toml one toolchain source | parked — main deviates (03) | #9 |

## Rulebook content (ledger, pairs, reasons, format)

| item | what it holds | still valid? | feeds |
|---|---|---|---|
| [19](https://github.com/chiyanram/skills/blob/main/research/19-approved-rules.md) rows by status | 572 rows: APPROVED 476 · DECIDED 53 · DEFERRED 19 · HOLD 8 · REJECTED 5 · MOVED 5 · SUPERSEDED 3 · MERGED 2 · DROPPED 1 | yes | fog |
| 19 rows by section | testing 135 · planning 35 · code+obs 12 · G9b round 1 195 · Spring core+Security 121 · Fowler+Spring 74 | yes | fog |
| 19 APPROVED by target | `.agents/…` 116 · testing 109 · code 86 · planning 38 · aruvii-ui 27 · file fates 32 · checkstyle 31 · migrations 20 · other 17 | yes | fog |
| 19 reason column ([sk#98](https://github.com/chiyanram/skills/issues/98)) | 465 author rules: 263 reason from source · 160 from evidence · 42 NO-REASON (await delete/keep) · 136 >35 words | partly — 178 owe operator action | fog |
| 19 evidence column ([sk#99](https://github.com/chiyanram/skills/issues/99)) | Aruvii path:line @sha behind each pair; ledger-only, never in references | yes | fog |
| neutral pairs [68a](https://github.com/chiyanram/skills/blob/main/research/68a-neutral-testing-strategy.md)–68f | every approved pair in one ordering+billing domain | yes (not yet in plugin, 04) | fog |
| format [00-reference-format](https://github.com/chiyanram/skills/blob/main/research/00-reference-format.md) | 5 sections; Rule ≤35 words with because; Good/Bad neutral; checks last | yes | fog |
| [00-decision-register](https://github.com/chiyanram/skills/blob/main/research/00-decision-register.md) | every non-rule decision → repo, file, work item | partly — no G29/G32 rows; G9b listed open (04) | all |

## Review pages (`review/`)

| item | what it showed / decided | still valid? | feeds |
|---|---|---|---|
| [rule-review.html](https://github.com/chiyanram/skills/blob/main/review/rule-review.html) · [template.html](https://github.com/chiyanram/skills/blob/main/review/template.html) | operator approval page for testing rules (ledger source) | yes (record) | fog |
| [planning-rules.html](https://github.com/chiyanram/skills/blob/main/review/planning-rules.html) · [planning-good-bad.html](https://github.com/chiyanram/skills/blob/main/review/planning-good-bad.html) | planning rules + pairs approval | yes; pairs → 68e | fog |
| [g9b-rules.html](https://github.com/chiyanram/skills/blob/main/review/g9b-rules.html) · [spring-rules.html](https://github.com/chiyanram/skills/blob/main/review/spring-rules.html) | G9b + Spring core/Security approval pages (g9b-decisions-1.txt) | yes | fog |
| [g9c-migration-rules.html](https://github.com/chiyanram/skills/blob/main/review/g9c-migration-rules.html) | migrations tier A approval | yes | fog |
| [good-rewrites.html](https://github.com/chiyanram/skills/blob/main/review/good-rewrites.html) | Goods rewritten from real Bads | superseded by neutral-pairs | none |
| [neutral-pairs.html](https://github.com/chiyanram/skills/blob/main/review/neutral-pairs.html) · [template-neutral.html](https://github.com/chiyanram/skills/blob/main/review/template-neutral.html) | neutral-domain pairs for review ([sk#99](https://github.com/chiyanram/skills/issues/99)) | yes | fog |
| [rule-reasons.html](https://github.com/chiyanram/skills/blob/main/review/rule-reasons.html) · [template-reasons.html](https://github.com/chiyanram/skills/blob/main/review/template-reasons.html) | drafted reason per rule ([sk#98](https://github.com/chiyanram/skills/issues/98)) | yes — 42 NO-REASON open | fog |
| [error-catalogue.html](https://github.com/chiyanram/skills/blob/main/review/error-catalogue.html) | 104 error codes ([sk#58](https://github.com/chiyanram/skills/issues/58)) | yes | fog |
| [crq-stages.html](https://github.com/chiyanram/skills/blob/main/review/crq-stages.html) | approved crq stage text, per role (G9d) | yes — unbuilt (AP #645) | #10 |
| [fleet-design.html](https://github.com/chiyanram/skills/blob/main/review/fleet-design.html) | fleet design picture (G6/G13/G25-era) | parked | #9 · #4 |
| [pipeline-comparison.html](https://github.com/chiyanram/skills/blob/main/review/pipeline-comparison.html) | our pipeline vs "factory" picture → keep ours, start minimal (G28) | yes | #10 · #8 |
| `review/build*.py` · `*.json` | generators + machine copies (r33/34/36/37, groups, reasons, neutral-pairs) | yes (tooling) | none |

## Requirements ([requirements.md](https://github.com/chiyanram/skills/blob/main/requirements.md))

| item | what it requires | still valid? | feeds |
|---|---|---|---|
| Q-1 · Q-3 · Q-4 | one rule one file · AGENTS.md <200 lines · skill fires by "Run X" | yes | fog · #10 |
| Q-2 · S-8 | agent-agnostic; link ≠ delivery, sentinel probe per harness | yes | fog |
| Q-5 · Q-6 · S-1 · S-6 · S-9 | upstream skills as plugins; talking set from session start, survives /compact | yes | fog · #4 |
| Q-7 · Q-11 · S-3 · S-10 | laptop and fleet load identical files; agent side travels, project side stays | yes — violated by 2nd soul copy (06) | #4 |
| Q-8 · S-2 · Q-9 · S-5 | /crq stages owned by role; review diff-scoped, findings only | yes — unbuilt (10: arch-reviewer still runs) | #10 |
| Q-10 · F-1 · A-1 · A-2 | output = a REQ; role boxes final step; replay P1 on !230; audit hit rate | partly — F-1 superseded by G6, parked | #9 · #10 |

## Learnings we must not lose

1. **Stage text fires skills; descriptions don't.** "Run X" 5/5, mention 0/1, 8 skills never fired — [02](https://github.com/chiyanram/skills/blob/main/research/02-skill-pickup.md), Q-4.
2. **One rule, one file.** Java rules 4–5×, AssertJ ×12, 5 contradictions came from copies — [01](https://github.com/chiyanram/skills/blob/main/research/01-rule-inventory.md).
3. **Size is a hard budget.** AGENTS.md already past Codex's 32 KiB; CLAUDE.md 60% of startup — [34](https://github.com/chiyanram/skills/blob/main/research/34-agents-md-survey.md), CP2.
4. **A rule counts only if it reaches the agent; test it.** Codex drops symlinks; nested-on-create misses (#500 V99) — G20 [sk#90](https://github.com/chiyanram/skills/issues/90); 01 sees it in 4 refs.
5. **A rule carries its reason.** pstack #633: bare ban 0/6, with reason 6/6 — G21 [sk#91](https://github.com/chiyanram/skills/issues/91), CP3.
6. **Check beats prose.** Semgrep deletion left rules review-only; forge/addy leaked rules in docs — G22 [sk#92](https://github.com/chiyanram/skills/issues/92), CP1.
7. **Our code is never a Good; examples teach.** Pairs live in a neutral domain; evidence in the ledger — G23 [sk#93](https://github.com/chiyanram/skills/issues/93); 01: pstack #700 "agents copy the example".
8. **Done is read from the forge at the head SHA, never claimed.** [39](https://github.com/chiyanram/skills/blob/main/research/39-verification-history.md), CP6; forge #518 (01) confirms.
9. **One writer per change; reviewers read.** Cognition, MARS 15× tokens — CP5, [64e](https://github.com/chiyanram/skills/blob/main/research/64e-industry.md).
10. **Review is expensive and noisy unless scoped.** ~$2–2.8/review, 62–66% thinking; push the diff, path-scoped criteria — [04](https://github.com/chiyanram/skills/blob/main/research/04-reviewer-cost-baseline.md), [11](https://github.com/chiyanram/skills/blob/main/research/11-popular-review-workflows.md), G3.
11. **Tests are the oracle; TDD for bugs, mutation for features.** [43](https://github.com/chiyanram/skills/blob/main/research/43-tdd-in-references.md), G12 [sk#68](https://github.com/chiyanram/skills/issues/68), CP12.
12. **The gate is the bottleneck.** 61 min: smoke full 40% on CPU LLM, one serial IT task 18m50 — [38](https://github.com/chiyanram/skills/blob/main/research/38-vm-gate-runner.md); interviews repeat it (10).
13. **Learn the reason, not the rule; add a piece only on a real failure.** References reverse on evidence — [64](https://github.com/chiyanram/skills/blob/main/research/64-core-design.md), G28 [sk#103](https://github.com/chiyanram/skills/issues/103).
14. **Lessons land strongest-first** (check → reference → soul → machine → written rejection) — G18 [sk#88](https://github.com/chiyanram/skills/issues/88).
15. **Long sessions burn the human.** 35-h session, 35% on one-line approvals; briefs need a completion criterion — [35](https://github.com/chiyanram/skills/blob/main/research/35-retro-session-2026-10-02.md).

## Contradictions between old decisions and the 2026-10-18 findings

| old decision | 2026-10-18 finding | effect |
|---|---|---|
| G6/G25 always-on coordinator daemon + fleet built in agent-fleet | 05: pstack coordinator = one 111-line md; ours 8.3k lines code. 02: `claude --bg` + agent view ship it. 09: adopt workmux, build only GitLab glue | re-decide in #4 / #9 |
| G13 per-role bots + container + firewall + 3 unix zones | 05: every ref picks one isolation layer; forge ADR-0017 one token on purpose | CP7 stays; mechanism → #9 |
| G9e/G27 watchdog reads tmux screens + transcripts | 05: pstack never probes the agent; 01: "stuck looks healthy" is a top failure in 3 refs | liveness design → #4 / #9 |
| G16 forge thread replaces Discord | 03: notifier unbuilt, old agents Discord-only; 10: interviews held on Discord; 02: products use a status board, not a chat log | channel → #4 |
| R28 / #35 Q26 wrap the Verifier as runner job body | 03/05: two gate systems kept side by side (Verifier + !263 runner) | #9 |
| G32 derive JAVA_HOME; mise one toolchain source | 03: main requires JAVA_HOME and bakes JDK into image | #9 |
| G3 / Q-9 one diff-scoped reviewer, arch-reviewer removed | 10: arch-reviewer 130–180k tokens, 6 runs/day still; 04: AP #645 nothing built | #10 / #7 |
| Q-1 / Q-7 one copy of souls | 06: souls shipped in agent-fleet plugin beside AP `docs/agents/personas/` | #4 |
| G24 fleet first; CP4/G28 add a piece only on real failure | 05: ~4.5k lines built before pilot [sk#67](https://github.com/chiyanram/skills/issues/67) ran (still open) | method for agent-factory #1 |
| G23 generic skills/references in chiyanram/skills plugin | 04: plugin has only `.gitkeep`; neutral pairs still in research/ | fog |
| G14 pause spawns at 70% window | 03: off unless `FLEET_WINDOW_TOKENS` typed | #9 |
| none (gap) | 10: biggest blocker = stacked unmerged specs re-approved 3×/day (REQ-531); no old decision covers it | #10 |
