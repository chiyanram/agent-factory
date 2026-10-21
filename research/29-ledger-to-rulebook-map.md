# 29 — Ledger → rulebook map (L1 input for map #1) (2026-10-21)

For chiyanram/agent-factory#1 box 5 (rulebook low-level design). Read-only. Source: `~/workspace/skills/research/19-approved-rules.md`
(read in full: 572 rows — 476 APPROVED · 53 DECIDED · 19 DEFERRED · 8 HOLD · 5 REJECTED · 5 MOVED · 3 SUPERSEDED · 2 MERGED · 1 DROPPED),
`00-decision-register.md`, agent-factory `docs/design.md` §3–§6, research/21, 22, 25. Only the 476 APPROVED rows are mapped;
DECIDED rows are noted where they become a reference's *Decided edges*.

```
 ledger row ──▶ new home
   reference body ........ skills/<domain>/references/*.md   SK = chiyanram/skills plugins/rulebook/  ·  AP = agent-platform .agents/skills/
   file-type MUST ........ root AGENTS.md «block» (≤3 MUSTs)  (secondary: the body stays in the reference)
   area MUST ............. <dir>/AGENTS.md                    (AP only)
   mechanical ............ checkstyle / eslint / scripts / CI (AP only)
   build instruction ..... FL* / G9c-MG-F* — not rule text; drives the build MRs
```

Method. Repo per row: SK unless the rule is meaningless outside Aruvii (AP). Rows in a SK file that name an Aruvii noun but
survive a neutral rewrite are marked *italic* ("neutralize"); rows that are Aruvii-only inside a mostly generic file are
**bold** and need an AP home (Q1). Heuristic + hand review; ±a few rows on the generic/Aruvii line.

## 1 · Map per target file

Paths are relative to the skills tree (`plugins/rulebook/skills/…` in SK, `.agents/skills/…` in AP; SK is installed into AP's
`.agents/skills/` via plugin / `npx skills add`).

| new target | repo | layer | rows | ledger ids (Aruvii-only ids in **bold**, generic-but-names-Aruvii *italic*) | also a MUST in | notes |
|---|---|---|---|---|---|---|
| `skills/testing/references/strategy.md` | SK | reference | 9 | S1, S2, *S3*, S4, S5, AT1, TM1, *TM2*, *TM3* | — | AT1 was "testing (tiers)" |
| `skills/testing/references/coverage-design.md` | SK | reference | 4 | C1, C2, C3, C4 | — |  |
| `skills/testing/references/boundaries.md` | SK | reference | 3 | B1, B2, B3 | — |  |
| `skills/testing/references/value-bar.md` | SK | reference | 5 | V1, V2, V3, V4, V5 | — |  |
| `skills/testing/references/unit-tests.md` | SK | reference | 3 | U1, U3, U2a | — |  |
| `skills/code/references/java.md` | SK (11) + AP (1) | reference | 12 | U4, JV1, JV2, JV3, JV4, JV5, JV6, JV7, JV8, JV9, **JV10**, JV12 | — | U4 was "code/references (home)" |
| `skills/testing/references/integration-tests.md` | SK (17) + AP (1) | reference | 18 | IT1, *IT2*, IT3, IT4, *TM4*, IT5, SP1, SP2, *SP3*, SP4, SP5, SP6, SP7, SP8, SP9, SP10, SP11, **CV5** | — | CV5 = IT2 decided edge |
| `skills/testing/references/spock.md` | SK | reference | 21 | K1, K2, K2b, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12, K13, *K14*, K15, K16, K17, K18, *K19*, K20 | — |  |
| `skills/planning/references/acceptance-criteria.md` | SK | reference | 11 | *GA1*, *GA2*, GA3, GA4, GA5, GA6, CV1, AC7, AC8, *AC9*, AC10 | — |  |
| `skills/testing/references/scenario-to-tests.md` | SK | reference | 7 | GT1, GT2, GT3, GT4, GT5, GT6, CV2 | — | old `testing/workflows/` — workflows stay flat (#643); Q4 |
| `skills/testing/references/mutation.md` | SK (9) + AP (1) | reference | 10 | M1, M2, M3, M4, M5, M6, **M7**, M8, M9, M10 | — |  |
| `skills/testing/references/property-based.md` | SK (8) + AP (2) | reference | 10 | **P5**, P1, P2, P3, P4, P6, *P7*, P8, P10, **CV4** | — |  |
| `skills/testing/references/smoke-specs.md` | SK (15) + AP (5) | reference | 20 | EA1, EA2, EA3, EA4, EA5, EA6, **EB1**, EB2, EB3, *EB4*, EC1, EC2, EC3, EC4, EC5, **EC6**, **ED2**, ED3, **ED4**, **ED5** | — |  |
| `(build instruction — deletion list)` | AP | fate | 1 | CUT-smoke | — | deletion list |
| `Makefile `make lint` + playwright configs` | AP | lint-CI-hook | 1 | WIRE-smoke | — | wiring work item |
| `skills/meta/references/writing-references.md` | SK | reference | 2 | *SRC1*, GB2 | — | old "every reference"; meta domain (ND-11); GB2 superseded (§2) |
| `skills/code/references/design.md` | SK | reference | 1 | *SEAM1* | — | SEAM1 cites ADR-0017 (Aruvii); Q3 |
| `skills/code/references/java.md §house style (+ Checkstyle/Prettier)` | SK | reference | 3 | ST1, ST2, *CV3* | — | old "code/ + testing (house style)" — no file; merge into java.md; mostly Checkstyle/Prettier-owned |
| `skills/planning/references/spec-review.md` | SK (6) + AP (1) | reference | 7 | SR1, *SR2*, *SR3*, *SR4*, *SR6*, SR7, **SR8** | — |  |
| `skills/planning/references/program-design.md` | SK | reference | 7 | PD1, PD2, PD3, PD4, PD5, *PD6*, PD7 | — |  |
| `skills/planning/references/diagrams.md` | SK | reference | 6 | DG1, DG2, DG3, DG4, DG5, *DG6* | — |  |
| `skills/planning/references/writing-docs.md` | SK (5) + AP (2) | reference | 7 | WD1, WD2, **WD3**, WD4, *WD5*, **WD6**, WD7 | — |  |
| `skills/code/references/types.md` | SK | reference | 14 | TY1, TY2, TY3, TY7, TY9, TY12, TY8, TY4, TY5, TY6, TY11, TY10, TY13, X2 / TY13a | — |  |
| `skills/code/references/errors.md` | SK (10) + AP (1) | reference | 11 | ER1, *ER2*, ER7, **ER9**, *ER10*, *ER11*, ER3, ER4, ER5, ER6, ER8 | — |  |
| `skills/code/references/comments.md` | SK | reference | 7 | CM1, CM2, CM3, CM4, CM5, CM7, CM6 | — |  |
| `skills/code/references/smells.md` | SK | reference | 23 | NM1, NM2, NM3, NM4, DS1, DS2, DS3, DS4, DS6, DS11, DS12, DS14, FW1, FW2, FW5, FW6, FW8, FW9, FW3, SM1, SM2, SM3, SM5 | — |  |
| `skills/deslop/SKILL.md (flat workflow)` | SK (5) + AP (1) | reference | 6 | DS13, DS5, DS7, DS8, DS9, **DS15** | — | flat workflow skill (FL26); DS15 is an edit instruction |
| `skills/code/references/services.md` | SK | reference | 3 | LY1, LY2, LY3 | — | LY6/LY7 moved to spring.md (OQ-SC2) |
| `skills/code/references/layering.md` | AP | reference | 2 | LY4, LY5 | root AGENTS.md «Java» block (ND-2) | ND-2; MUST also in root «Java» block |
| `skills/code/references/spring.md` | SK | reference | 31 | LY6, LY7, *SC1*, SC4, LY6, LY7, SC2, SC3, SC5, SC6, SC8, *SC10*, SC11, SC12, *SC13*, SC14, SC15, SC16, SC17, SC18, SC19, SC20, SC21, SC22, SC7, SC9, *X6 / SP23*, SX18, SX19, SX14, SX20 | — | LY6/LY7 appear twice (services.md row + sharpened spring.md row, OQ-SC2) — 29 unique ids |
| `skills/code/references/api.md` | AP | reference | 7 | AP1, AP2, AP3, AP4, AP5, AP3a, AP4a | aruvii-api/AGENTS.md | ND-3; whole file Aruvii → AP; MUSTs in `aruvii-api/AGENTS.md` |
| `skills/code/references/tool-types.md` | AP | reference | 2 | TT1, TT2 | aruvii-tools/AGENTS.md | ND-3; ledger column says aruvii-api/AGENTS.md, ND-3 says aruvii-tools/AGENTS.md |
| `skills/code/references/concurrency.md` | SK | reference | 10 | CC1, CC2, CC3, CC9, CC8, CC4, CC5, CC6, CC7, CC10 | — |  |
| `skills/code/references/security.md` | SK (32) + AP (4) | reference | 36 | *SE1*, SE2, SE3, SE4, SE5, SE6, SE10, *SE7*, SE8, *SS1*, SS2, SS3, SS4, SS5, SS6, SS7, SS8, SS9, SS10, SS11, *SS12*, **SS13**, **SS14**, **SS15**, SS16, SS17, **SS18**, SS19, SS20, SS21, *SS22*, SS23, SS24, *SS25*, *SE7a*, *SS26* | — |  |
| `skills/code/references/messaging.md` | SK (2) + AP (5) | reference | 7 | **MS1**, **MS2**, **MS3**, MS6, MS4, **MS5**, **MS7** | — |  |
| `skills/obs/references/logging.md` | SK | reference | 10 | *LG1*, LG2, LG3, *LG4*, LG5, LG6, LG7, LG8, LG9, LG10 | root AGENTS.md «observability» block (≤3 MUSTs) | + levels.md (OQ4 table); ≤3 of LG1–LG10 become root «observability» MUSTs |
| `skills/obs/references/metrics.md` | SK (7) + AP (2) | reference | 9 | MX7, MX1, MX2, MX3, MX4, MX5, MX6, **MX8**, **MX9** | — |  |
| `skills/obs/references/tracing.md` | SK (5) + AP (1) | reference | 6 | TR1, TR2, TR3, TR4, TR5, **TR4a** | — |  |
| `skills/code/references/angular-ui.md` | SK (16) + AP (7) | reference | 23 | NGA1, NGA2, NGA3, NGA4, NGA5, NGA6, NGA7, NGB1, NGB2, NGB3, NGB4, **NGB5**, NGC1, **NGC2**, NGC3, **NGC4**, NGD1, NGD2, NGD3, **NGE1**, **NGE2**, **NGE3**, **NGE4** | aruvii-ui/AGENTS.md | all 23 also listed for `aruvii-ui/AGENTS.md`; FL15 names NGB1, NGB2, NGD2, NGD3 as the MUSTs |
| `aruvii-ui/eslint.config.js` | AP | lint-CI-hook | 4 | NGF1, NGF2, NGF3, NGF4 | — |  |
| `(build instruction — no rule text)` | AP | fate | 32 | FL1, FL2, FL3, FL4, FL5, FL6, FL7, FL8, FL9, FL10, FL11, FL12, FL13, FL14, FL15, FL16, FL17, FL18, FL19, FL20, FL21, FL22, FL23, FL24, FL25, FL26, FL27, G9c-MG-F1, G9c-MG-F2, G9c-MG-F3, G9c-MG-F4, G9c-MG-F5 | — | FL1–FL27 + G9c-MG-F1..F5: file moves/splits/deletes for the build MRs, not rules; retargets in table 1b |
| `aruvii-infra/AGENTS.md` | AP | nested AGENTS.md | 4 | MG1, MG2, MG4, MG3 | — | only primary nested-AGENTS.md rows; design §3 example says `db/migration/` — Q2 |
| `skills/migrations/references/review.md` | SK | reference | 4 | MG17, MG18, MG21, MG20 | — |  |
| `skills/migrations/references/postgres-design.md` | SK | reference | 10 | MG30, MG31, MG32, MG33, MG34, MG35, MG36, MG37, MG38, MG42 | — |  |
| `skills/migrations/references/who-migrates.md` | AP | reference | 6 | MG50, MG51, MG53, MG54, MG55, MG56 | — | process facts of Aruvii (sole migrator, AruviiTestReset, shared volume) |
| `.agents/skills/flyway-migration/SKILL.md (flat, Aruvii-only)` | AP | reference | 3 | MG60, MG61, MG62 | — | flat workflow skill; MG61 cites deferred MG19, MG41–47 |
| `scripts/check-migrations.sh · CI job · .claude/hooks/check-migration-version.sh` | AP | lint-CI-hook | 3 | MG70, MG71, MG72 | — | hook is Claude-only → needs CI twin (design §6) |
| `config/checkstyle/checkstyle.xml (+ build-logic)` | AP | lint-CI-hook | 33 | SP22, G-SP22, G-SP22.2, G-DS9, G-JV9, G-OQ2, G-X6, G-SC1, G-UnusedImports, G-CK1, G-DS2, G-FW1, G-CK4, G-ER3, G-ER4, G-JV6, G-JV2, G-SP19, G-SP18, G-LG6, G-CK5, G-CK3, G-CK2, G-CK2.2, CK2, CK3, CK4, CK5, CK1, CK6, CK7, CK8, CK9 | — | G-* (20) + CK1–CK9 + SP22; CK7 = build-logic |
| `skills/code/references/design.md (seam rules S-1..S-7)` | SK | reference | 2 | FW7, SP13 | root AGENTS.md «Java» block (S-1..S-7 MUSTs?) | old "S-1 text on agent-platform #679"; S-1..S-7 were to land in `.claude/rules/java-standards.md` (deleted, G1b) |

DECIDED rows that become *Decided edges* (not counted above): types.md X4, OQ2, OQ-R27-6 · errors.md X5 · services.md X8, OQ5 ·
comments.md X1, X6, X7 · java.md X1(R36) · layering.md ND-2 · api.md ND-3, OQ-R27-4 · levels.md OQ4 · tracing.md X2 · smells.md X3,
X4/DS5a, X5(R36), R36-D1, R37-D8 · angular-ui.md OQ-NG1 · spring.md OQ-SC1, OQ-SC2, OQ-SC3, OQ-SC5 · security.md OQ-R27-3, OQ-SC4,
SE-verdict, OQ-R27-5, OQ-SS-1..4, ND-4 · checkstyle R37-D1..D7 · design.md X3(R36) · policy OQ1, OQ3.

### 1b · Old targets that no longer exist → re-target

| old target (ledger) | rows | why gone | new target |
|---|---|---|---|
| `.claude/rules/java.md` + `rules/testing.md` (FL13), `java-standards.md` | FL13, FL16 | G1b #72: `.claude/rules/` deleted | root AGENTS.md «Java» block + «tests» block (≤3 MUSTs each); body → code/java.md, testing refs |
| `.claude/rules/observability.md` (FL14) | FL14, FL21 (logging half) | G1b | root «observability» block (≤3 of LG1–LG10) + obs/levels.md |
| `.claude/rules/dependencies.md` (FL17) | FL17, LY5, FL18 | G1b | root «dependencies» block (build files) or nested — Q5; ungated list → `skills/meta/references/gates.md` (ND-11) |
| `rules/api.md` (FL20) | FL20, AP1–AP5, AP3a, AP4a | G1b · ND-3 | `aruvii-api/AGENTS.md` + AP `code/references/api.md` |
| `.claude/rules/migrations.md` (G9c-MG-F2) | MG1–MG4 | G1b | `aruvii-infra/AGENTS.md` (or `…/db/migration/AGENTS.md`, Q2) |
| `.claude/rules/angular-ui.md` (FL15, FL19) | NG* | G1b | `aruvii-ui/AGENTS.md` |
| `.claude/rules/smoke.md`, `it-testing.md` (not in ledger as targets; K1, K20 replace it-testing rules 1, 4) | K1, K20 | G1b | proposal: `aruvii-ui/playwright/AGENTS.md` (smoke) · root «tests» block (ITs live in every module's `src/integrationTest`) — Q5 |
| `testing/workflows/scenario-to-tests.md` | GT1–GT6, CV2 | #643: workflows stay flat | `testing/references/scenario-to-tests.md` (or fold into flat `gherkin-to-test`) — Q4 |
| "S-1 text (agent-platform #679)" | FW7, SP13 (+ X3, X5 decided) | was headed for `.claude/rules/java-standards.md §Seams` | `code/references/design.md` with SEAM1 (+ root «Java» MUST?) — Q3 |
| "code/ + testing (house style)" · "code/references (home)" · "testing (tiers)" · "every reference" | ST1, ST2, CV3 · U4 · AT1 · SRC1, GB2 | no file named | java.md · java.md · testing/strategy.md · `meta/references/writing-references.md` |
| `crq.md stage 8` (OQ-NG7) · "DoD" (FL19) | OQ-NG7, FL19 | ND-5 + design §6: `/dod` gone; crq = router (§4) | reviewer Spec verdict / angular-ui Review checks |
| `.claude/hooks/` (G9c-MG-F5, MG72) | MG70–72, G9c-MG-F5 | design §6: Claude extras are convenience; hard rules need lint/CI | keep hooks + add CI twins (MG71 covers duplicate version; MG1 edit-of-applied needs one) |
| `.agents/skills/standards-review` groups (FL27), `architecture-review` A–E (SR8) | FL27, SR8 | register G3: reviewer agents deleted | each reference's Review checks · `planning/references/spec-review.md` |

### 1c · AGENTS.md blocks the ledger feeds (secondary placements)

| AGENTS.md / block | candidate MUST rows | cap | note |
|---|---|---|---|
| root «Java» | LY4 (ND-2), FL13 MUSTs, S-1..S-7 (FW7, SP13, SEAM1)? | 3 | dependencies (Jakarta/Jackson 3/BOM) may need its own block |
| root «tests» | FL13 test MUSTs (from java-standards); IT placement, Spock-for-new-tests | 3 | not a ledger row today — FL13 only says "test MUSTs" |
| root «observability» | LG1–LG10 | 3 | 10 candidates → pick 3 |
| root «schema change» | one pointer line (G9c-MG-F4) | 1 line | flags list → docs/CONTEXT.md |
| root credentials | FL21 "one L2 MUST" (SE7) | 1 | which block not named |
| `aruvii-ui/AGENTS.md` | all 23 NG* rows; FL15 names NGB1, NGB2, NGD2, NGD3 | ≤3? | ≤3 is for root blocks; nested cap undecided |
| `aruvii-api/AGENTS.md` | AP1–AP5, AP3a, AP4a | — | |
| `aruvii-tools/AGENTS.md` | TT1, TT2 | — | ND-3 vs ledger column disagree |
| `aruvii-infra/AGENTS.md` | MG1–MG4 (primary, body lives here) | — | |

## 2 · Rows that conflict with later decisions

| ledger row | what it says | superseded / contradicted by | action for L1 |
|---|---|---|---|
| M10 | mutation-kill test is a "narrow exception to never skip Red" | G12 #68 (register; design §4): test-first for bugs only, features any order | reword: no global Red rule to except from; S4 governs bugs |
| M7 | run PIT on aruvii-guardrails; other modules "wire it in first" | G12 + #68 Q3–Q4 + design §4: PIT on touched classes with decisions, every survivor listed; AP #659 wires every module | rewrite to "touched classes"; drop guardrails-only |
| M1 | mutation is "a report, never a gate" | #68 Q3–Q4: report-only → baselines → operator thresholds → **blocking** | drop "never"; keep "until operator sets a threshold" |
| ED5 | `make smoke` while developing, `make smoke FULL=1` as the gate | design §6: gate = GitLab CI by kind; writers never deploy the shared stack; register: only the runner runs verify-full/smoke | rewrite to the gate; writer runs no shared-stack smoke |
| MX6 | force a failure and find it in logs/metrics/traces before done | design §6 isolation (Testcontainers only, no shared stack) | scope to an IT / Testcontainers check, or move to gate |
| MG53 | reset the shared dev volume on a higher version | design §6 isolation | who resets? writer cannot touch the stack |
| OQ-NG7 (DECIDED), FL19 | "wired to real API" → crq.md stage 8 / DoD | ND-5 + design §6: `/dod` gone, checks → gate or reviewer; §4 crq is a router, no stage numbers | retarget to reviewer Spec verdict |
| SR8, PD7 | "one stage-5 rubric", "during stage 6" | design §4 phases (no stage numbers) | reword to phase names (spec/design review · build) |
| GA1, GA2 | "the analyst writes / assigns" | design §1 seats: discovery owns intake → REQ; no analyst | persona → "discovery" or seat-free wording |
| GA3 | "the tier is the developer's call" | design §1: writer seat | wording |
| MG20 | "the lead never auto-dismisses a migration finding" | design §5: lead buckets every finding incl. Dismissed (why); "lead" is not a §1 seat | decide who "lead" is; keep as migration exception? |
| GB2 | Bad = our real code at path:line; Good = it rewritten | G23 #93 Q3 (2026-10-17, register "Writing standard" line 6): pairs are neutral-domain; Aruvii path = ledger evidence only | supersede GB2 (GB1/GB1a already superseded) |
| ER9, AP1, SS18, SS19, NGC2 (+ OQ-R27-4) | error = `ApiResponse` `success=false`; "delete the ProblemDetail claim" | register «API errors» #58 Q5 (AP #662): ProblemDetail {type, title, status, detail, instance, code, traceId}. Both dated 2026-10-03 | unresolved — Q6 |
| TR4 | Micrometer Tracing + Brave | TR4a (ledger): OpenTelemetry instead, wiring in #55 | write TR4a only |
| SC18 | `@PostConstruct` allowed for checks | X6/SP23 (ledger): no `@PostConstruct` in main code | write X6/SP23 only |
| TY13 | no builder classes | X2/TY13a: builder allowed for complex objects | write TY13a wording |
| LY6, LY7 (services.md rows) | constructor injection; `@ConfigurationProperties` | sharpened LY6/LY7 in spring.md (OQ-SC2) — same ids twice | write once, in spring.md |
| FW9 | smell baseline is "a 12-smell subset" | SM1 + R37-D8: Fowler's 24 + Kerievsky's 3 | drop the 12-subset note |
| SEAM1 | "S-rules win on disagreement" | OQ1: no precedence rule; one owner per fact | drop the precedence clause |
| DS15 | remove `shouldXxx`/AssertJ wording "that contradicts CV6 and U2" | CV6 merged into U2a, which *requires* "should…"; U2 superseded | instruction stale — re-check against U2a |
| K14, LY5 | "correction owed to CLAUDE.md" | G1b/#646: CLAUDE.md = `@AGENTS.md` | target AGENTS.md / root blocks |
| FL13, FL14, FL17, FL20, G9c-MG-F2 | write into `.claude/rules/*` | G1b #72: `.claude/rules/` deleted | table 1b |
| G9c-MG-F5, MG72 | migration guards as `.claude/hooks/` | design §6: every hard rule also in `make lint` or CI | add CI twins |
| MG61 | skill steps cite MG19 and MG41–47 | those rows are DEFERRED → #57 | drop or mark the steps deferred |
| EC1, WIRE-smoke | "the 147 existing networkidle uses", "10 data[0] sites" | WD2 / AGENTS.md: no counts that rot | move counts to the follow-up issue |
| 41 NO-REASON rows: S3, TM4, K20, GT6, M1, ED4, SEAM1, U2a, ST1, ST2, DG5, JV12, TY9, TY12, TY4, CM2, NM1, DS6, DS11, MX5, NGA1, NGA4, NGB2, NGB4, NGB5, NGC1, NGC4, NGD1, NGE1, NGE4, TR4a, SC10, SC14, SS20, MG31, MG36, MG37, G-CK5, G-CK2, CK2, CK5 | no failure found | G21 #91 + checklist #15: flagged for deletion | operator: delete or supply a reason |
| Empty reason, author rules: X6/SP23, X2/TY13a, SX14, SX18, SX19, SX20, G-SP22.2, G-CK2.2 | — | G21: every rule needs because + failure | draft reasons |

Checked and **not** in conflict: no ledger row assumes the reviewer reads rules from the MR head (design §5 = master, research/25);
SR1 (all findings in one round) fits §5's delta-only rounds 2–3; GT6 fits §5's Spec verdict; S4 is G12's bug rule; SR4/AC10
`/approved` match the §0 flow.

## 3 · Counts (476 APPROVED rows; 474 unique ids — LY6, LY7 twice)

| by kind | rows |  | by repo | rows |
|---|---|---|---|---|
| author rule | 393 |  | SK generic | 344 (of which 40 *neutralize*) |
| gate (Checkstyle 33 · eslint 4 · migration gates 3 · smoke wiring 1) | 41 |  | AP Aruvii | 132 |
| build instruction (FL1–27, G9c-MG-F1–5, CUT-smoke) | 33 |  | — AP author rules | 51 |
| edit instruction (LY5, ER9, MX9, MS7, DS15, SR8, MG56) | 7 |  | — AP gates / fates / edits | 41 / 33 / 7 |
| meta (SRC1, GB2) | 2 |  | | |

| by primary layer | rows | secondary MUST placements |
|---|---|---|
| reference (incl. 2 flat skills: deslop 6, flyway-migration 3) | 398 | root «observability» 10 candidates · root «Java» 3 · `aruvii-ui/AGENTS.md` 23 · `aruvii-api/AGENTS.md` 7 · `aruvii-tools/AGENTS.md` 2 |
| nested AGENTS.md (aruvii-infra) | 4 | |
| root AGENTS.md block | 0 primary | (all root MUSTs are secondary — body stays in a reference) |
| lint-CI-hook | 41 | |
| build instruction (no layer) | 33 | |

Lint-owned: **41** rows live in lint/CI/hooks; **+25** reference rows are twinned by a gate (per OQ3 they get no Review check):
JV2, JV6, JV9, TY4, ST1, ST2, CV3, ER3, ER8, ER4 (Throwable half), DS2, DS9, FW1, LG6 (single-line), SC1, X6/SP23, SX18, SX19,
and ArchUnit/ESLint-named TY11, AP2, SS12, SS14, SX14, LY4, EC4 → **~66** rows owned wholly or partly by a mechanical check.

Files with primary rows: SK 36 (testing 11 · code 13 + deslop · obs 3, plus levels.md from OQ4 · planning 5 · migrations 2 · meta 1).
AP 4 (api.md, tool-types.md, who-migrates.md, flyway-migration skill) + `aruvii-infra/AGENTS.md` + checkstyle, eslint, scripts/CI.

## 4 · Open questions for the operator

1. **Home for Aruvii-only rows inside generic files** (bold in table 1: e.g. CV5, M7, P5, CV4, EB1, ED2, ED4, ED5, EC6, JV10,
   SS13–15, MS1–3, MS5, NGE1–4, WD3, WD6): `docs/agents/<domain>.md` answers (G23 pattern) · an Aruvii-only skill's references ·
   the nearest nested AGENTS.md?
2. Migrations nested file: `aruvii-infra/AGENTS.md` (ledger, OQ-MG1) or `aruvii-infra/src/main/resources/db/migration/AGENTS.md`
   (design §3 example)? The second loads only when a migration is touched.
3. Seam rules S-1..S-7 (SEAM1, FW7, SP13, X3, X5): generic SK `code/references/design.md` (your global CLAUDE.md applies them to
   all code) or Aruvii repo standard (ADR-0017, #679)? And are any of them root «Java» MUSTs?
4. `scenario-to-tests` (GT1–6, CV2): a testing reference, or folded into the flat `gherkin-to-test` skill?
5. Blocks not named by the ledger: «tests» (FL13), «dependencies» (FL17), credentials (FL21), smoke (`aruvii-ui/playwright/AGENTS.md`?)
   — which root blocks exist, and which 3 MUSTs each holds (incl. 3 of LG1–LG10)? Does ≤3 apply to nested files (23 NG* candidates)?
6. **Error wire shape**: ER9/AP1/SS18 (`ApiResponse success=false`, delete ProblemDetail) vs register #58 (ProblemDetail + code +
   traceId, AP #662) — which one do the references state?
7. TT1/TT2 MUSTs: `aruvii-tools/AGENTS.md` (ND-3) or `aruvii-api/AGENTS.md` (ledger column)?
8. Persona words: who is "the lead" (MG20, design §5) and does "analyst/developer" become "discovery/writer" or seat-free text?
9. 41 NO-REASON + 8 empty-reason author rows: delete per G21, or supply reasons before L1 writing starts?
10. Neutralize vs keep: the 40 *italic* rows name Aruvii nouns (`make`, REQ, `@EnableAruviiIT`, `PUBLIC_PATHS`, `aruvii.` prefix,
    PiiRedactor…) — rewrite neutral in SK with the Aruvii answer in AP, or keep them AP?
11. Ledger id collisions: X1, X3, X5 (G9b vs R36), ND-4, OQ-R27-4/5 (MOVED vs DECIDED), LY6/LY7 — design §3 says "each rule cites
    its ledger row"; renumber or qualify (`R36-X3`)?
12. Design §3 "476 rules, one MR per target file": 41 gates + 33 build instructions + 7 edits + 2 meta are not rule text — count the
    writing work as 393 author rules over 41 files?
13. Hooks (MG72, G9c-MG-F5): keep as Claude convenience with CI twins, or move the checks to CI only?
