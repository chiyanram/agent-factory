# 34 — L1 rulebook file plan (final) (2026-10-23)

For chiyanram/agent-factory#21 (L1). Read-only plan; writes nothing else. Applies every decision; invents no rule.
Sources: ledger `~/workspace/skills/research/19-approved-rules.md` (476 APPROVED rows, 474 unique ids) · research/29 (map, retargets) ·
research/31 (reasons, drops) · research/32 (MUST picks) · research/33 (fit fixes) · #21 comments (Q1–Q13 decisions, 2026-10-22/23) · `docs/design.md` §3.
Machine-readable twin: `research/34-l1-file-plan.json`.

```
placement rules applied
  generic rule ............ chiyanram/skills plugins/rulebook/skills/<domain>/references/*.md, written neutral (Q1+Q10)
  its Aruvii values ....... agent-platform docs/agents/<domain>.md (secondary; ids counted once, in the SK file)
  Aruvii-only rule ........ nearest nested <dir>/AGENTS.md (Q1); files already decided as AP references keep them (ND-2, ND-3, MG)
  file-type MUST .......... root AGENTS.md block, <=3 per block; nested AGENTS.md <=3 on top, then pointers (Q5)
  gate / build step ....... not L1 -> L5/L7 (Q12)    edit instruction ... applied in its target file's L1 MR, not rule text
```

## 1 · Tree

```
chiyanram/skills  (plugins/rulebook/skills/)
├─ code/
│   ├─ references/angular-ui.md                14
│   ├─ references/comments.md                   7
│   ├─ references/concurrency.md               10
│   ├─ references/design.md                     1
│   ├─ references/errors.md                    10
│   ├─ references/java.md                      11
│   ├─ references/messaging.md                  2
│   ├─ references/security.md                  32
│   ├─ references/services.md                   3
│   ├─ references/smells.md                    23
│   ├─ references/spring.md                    27
│   ├─ references/types.md                     13
├─ deslop/
│   ├─ SKILL.md                                 5
├─ meta/
│   ├─ references/writing-references.md         1
├─ migrations/
│   ├─ references/postgres-design.md           10
│   ├─ references/review.md                     4
├─ obs/
│   ├─ references/levels.md                     0
│   ├─ references/logging.md                   10
│   ├─ references/metrics.md                    7
│   ├─ references/tracing.md                    5
├─ planning/
│   ├─ references/acceptance-criteria.md       11
│   ├─ references/diagrams.md                   6
│   ├─ references/program-design.md             7
│   ├─ references/spec-review.md                6
│   ├─ references/writing-docs.md               5
├─ testing/
│   ├─ references/boundaries.md                 3
│   ├─ references/coverage-design.md            4
│   ├─ references/integration-tests.md         17
│   ├─ references/mutation.md                   9
│   ├─ references/property-based.md             8
│   ├─ references/scenario-to-tests.md          7
│   ├─ references/smoke-specs.md               15
│   ├─ references/spock.md                     21
│   ├─ references/strategy.md                   9
│   ├─ references/unit-tests.md                 3
│   ├─ references/value-bar.md                  5

agent-platform
├─ AGENTS.md                                   6 blocks, 14 MUSTs (all secondary)
├─ aruvii-ui/AGENTS.md                                          7  MUSTs 3
├─ aruvii-ui/playwright/AGENTS.md                               5  MUSTs 0
├─ aruvii-api/AGENTS.md                                         6  MUSTs 3
├─ aruvii-tools/AGENTS.md                                       0  MUSTs 2
├─ aruvii-worker/AGENTS.md                                      4  MUSTs 0
├─ aruvii-guardrails/AGENTS.md                                  3  MUSTs 0
├─ aruvii-infra/src/main/resources/db/migration/AGENTS.md       4  MUSTs 3
├─ docs/AGENTS.md                                               2  MUSTs 0
├─ .agents/skills/code/references/api.md                        7
├─ .agents/skills/code/references/tool-types.md                 2
├─ .agents/skills/code/references/layering.md                   2
├─ .agents/skills/migrations/references/who-migrates.md         5
├─ .agents/skills/flyway-migration/SKILL.md                     3
├─ docs/agents/testing.md                                     (10 values)
├─ docs/agents/planning.md                                    (10 values)
├─ docs/agents/code.md                                        (17 values)
├─ docs/agents/obs.md                                         (2 values)
├─ docs/agents/meta.md                                        (1 values)
```
Numbers = primary rules in the file. NEW = nested files no decision named yet (Q1 "nearest their code"): `aruvii-ui/playwright/`, `aruvii-worker/`, `aruvii-guardrails/`, `docs/`.

## 2 · Files

| path | repo | layer | rule ids | count | the ≤3 MUSTs | notes |
|---|---|---|---|---|---|---|
| `AGENTS.md «Java»` | AP | root block | — | 0 | **TY2** — Return a sealed result and switch over it exhaustively with no `default` arm, because a `default` arm lets a new case compile and be silently mishandled.<br>**TY1** — Never let `null` decide a case; use `Optional`, a sealed result or an enum, because a nullable field lets contradictory combinations compile and a caller forget the check.<br>**SEAM1** — Keep each method at cyclomatic complexity 5 or less, using a rule list instead of an if-ladder, because a branching method hides paths no test reaches. | Q3+Q5. Bodies: SK code/references/types.md (TY1, TY2), design.md (SEAM1). Cyclomatic <=5 unmeasured until a gate lands (L5/L7). LY4 (ND-2) not picked: ArchUnit blocks it. |
| `AGENTS.md «tests»` | AP | root block | — | 0 | **S2+V3** — Assert observable behaviour, never a field default, a hand-copied enum list or the input you passed in, because such a test cannot fail for a real defect.<br>**IT-placement** — Put every IT under `src/integrationTest`, never `src/test`, because a misplaced IT compiles, runs class-parallel without the Testcontainers tuning, and still reports green.<br>**K1** — In a Spock argument closure, write each check as its own top-level line, never inside `every{}`, because nested checks are never asserted and the test passes anyway. | Q5 picks. IT-placement has no ledger row (AGENTS.md / ADR-0009). Bodies: SK testing/references/strategy.md (S2), value-bar.md (V3), spock.md (K1). |
| `AGENTS.md «dependencies»` | AP | root block | — | 0 | **DEP-1** — Never override a version the Spring Boot BOM manages; read the BOM first, because all three past overrides were wrong, two pinned backwards.<br>**DEP-2** — Read a library's BOM before importing it, because an imported BOM wins over Boot's and can silently downgrade a shared library.<br>**DEP-3** — Check a new test dependency's stdout before adopting it, because agents read build logs, and jqwik prints an instruction telling agents to ignore its results. | Q5 picks. DEP-1..3 are research/32 ids, not ledger rows (FL17 is a file fate); text from origin/master .claude/rules/dependencies.md. No reference body exists. |
| `AGENTS.md «observability»` | AP | root block | — | 0 | **LG4** — Never log PII, prompts, tool arguments, secrets or tokens at INFO or above, because logs are a common data-leak path on a customer's system.<br>**LG2** — Log a failure once, where it is handled; do not log before rethrowing with the cause, because each layer then writes the same failure twice.<br>**LG3** — Log WARN with class and message only, and ERROR with the throwable last, because a placeholder throwable prints no stack for the operator. | Q5 picks. Bodies: SK obs/references/logging.md. |
| `AGENTS.md «credentials»` | AP | root block | — | 0 | **SE7** — Encrypt every credential with `CredentialEncryptor` before storing it and mask it in every response, because a plain credential leaks to every database reader and API caller. | Q5: one MUST. Body: SK code/references/security.md (SE7 written neutral; CredentialEncryptor value in docs/agents/code.md). |
| `AGENTS.md «schema change»` | AP | root block | — | 0 | **G9c-MG-F4** — Before creating a `V*.sql`, read `aruvii-infra/src/main/resources/db/migration/AGENTS.md` and use the `flyway-migration` skill. | Q5: one pointer line. G9c-MG-F4 is a build instruction row; its pointer text is the block. Also fix the API line "errors are ProblemDetail" elsewhere in AGENTS.md (Q6, ER9). |
| `aruvii-ui/AGENTS.md` | AP | nested AGENTS.md | NGB5, NGC2, NGC4, NGE1, NGE2, NGE3, NGE4 | 7 | **NGD2** — Make anything clickable a `<button type="button">` or an `<a>`, never a clickable `div`, `span` or `tr`, because keyboard and screen-reader users cannot reach it.<br>**NGC4** — In every error branch call `toast.error(...)` or set an error state, never `error: () => {}`, because a swallowed error shows the user nothing.<br>**NGA3** — Do not silence the compiler with `!` or `as`; add a check or fix the type, because each one hides a runtime crash the compiler could catch. | Q1: Aruvii-only NG rows (bold in research/29). Then pointer to SK code/references/angular-ui.md. NGD2/NGA3 bodies stay in SK angular-ui.md. |
| `aruvii-ui/playwright/AGENTS.md` | AP | nested AGENTS.md | EB1, EC6, ED2, ED4, ED5 | 5 | none picked | NEW file. Q1: Aruvii-only smoke rows nearest their code (fixtures.ts, check-flaky.mjs, playwright.core.config.ts); path is research/29 Q5 proposal. ED5 reworded (research/33): writer runs Testcontainers targets, smoke only in the gate. No MUSTs picked for this file. Points to SK testing/references/smoke-specs.md. |
| `aruvii-api/AGENTS.md` | AP | nested AGENTS.md | CV5, SS13, SS14, SS15, SS18, MX8 | 6 | **AP1** — Return every error as `ApiResponse` with `success=false` and an `ErrorCode`, never a bare `ResponseEntity.status(...)`, because a bare error loses the `traceId` operators paste into tickets.<br>**AP3a** — Prove every role rule with an IT matrix — anonymous, each role, other-workspace member, API key — because a test of one wrong role let another workspace's editor get 200.<br>**AP4a** — Add a `PUBLIC_PATHS` entry only with an IT proving its replacement check refuses a bad caller, because one public path let an anonymous call complete setup. | Q1: CV5 (SetupControllerIT exception), SS13-15/SS18 (guards, PlatformRole, 401/403 body), MX8 (no scrape endpoint; actuator config in aruvii-api application.yml). AP1/AP3a/AP4a bodies in AP .agents/skills/code/references/api.md. Error shape = ApiResponse success=false (Q6) until #662. |
| `aruvii-tools/AGENTS.md` | AP | nested AGENTS.md | — | 0 | **TT1** — Ship every new tool type with `outputSchemaJson`, a `sampleResponseJson` and a dry-run smoke test, because without them the dry-run gate returns nothing.<br>**TT2** — Read a tool's required arguments off its handler; never declare a schema stricter than the handler, because a stricter schema stops a working tool on upgrade. | Q7. Bodies in AP .agents/skills/code/references/tool-types.md. |
| `aruvii-worker/AGENTS.md` | AP | nested AGENTS.md | MS1, MS2, MS3, MS5 | 4 | none picked | NEW file. Q1: Aruvii-only messaging rows; stream consumers + Kafka trigger live in aruvii-worker. MS5 also covers XADD publishers in aruvii-api (ArchUnit bounded-XADD rule exists). No MUSTs picked. Points to SK code/references/messaging.md. |
| `aruvii-guardrails/AGENTS.md` | AP | nested AGENTS.md | M7, P5, CV4 | 3 | none picked | NEW file. Q1: PIT is wired only here; Property.java lives in aruvii-guardrails/src/test. M7 reworded (research/33): PIT where wired, else test-first until #659; no wiring in a feature MR. No MUSTs picked. |
| `aruvii-infra/src/main/resources/db/migration/AGENTS.md` | AP | nested AGENTS.md | MG1, MG2, MG4, MG3 | 4 | **MG2** — Take max-across-all-branches + 1 for a new version, never `ls` of your tree, because two branches with one number fail at container start.<br>**MG1** — Never edit an applied `V*.sql`; fix it with a new version, because Flyway checksums then fail startup on every installed system.<br>**MG4** — Start every migration with a header naming each data change and lock and why, matching the statements, because an "expand-only" header once hid a rewrite of every row. | Q2. Primary home of MG1-MG4. Then pointers to AP who-migrates.md, flyway-migration skill, SK migrations references. MG1/MG2 hooks are Claude-only; CI twins (MG70-72) are L5/L7. |
| `docs/AGENTS.md` | AP | nested AGENTS.md | WD3, WD6 | 2 | none picked | NEW file. Q1: Aruvii-only doc rows (ARCHITECTURE.md §9 Doc drift; REQ-<issue>-slug, ADR numbering per docs/adr/README.md). No MUSTs picked. Points to SK planning/references/writing-docs.md. |
| `.agents/skills/code/references/api.md` | AP | reference | AP1, AP2, AP3, AP4, AP5, AP3a, AP4a | 7 | — | ND-3: whole file Aruvii. AP3a/AP4a sharpen AP3/AP4. Error shape = master today (Q6, ER9/AP1/SS18); #662 changes rule + code together. |
| `.agents/skills/code/references/tool-types.md` | AP | reference | TT1, TT2 | 2 | — | ND-3 / FL11. MUSTs in aruvii-tools/AGENTS.md (Q7). |
| `.agents/skills/code/references/layering.md` | AP | reference | LY4, JV10 | 2 | — | ND-2 / FL11. LY4 gated by ArchUnit (no Review check, OQ3). JV10 (no JPMS; Gradle modules + module_dependency_allowlist) is repo-wide with no nearer nested file, so it joins the module-boundary reference. Edit LY5 applied here. |
| `.agents/skills/migrations/references/who-migrates.md` | AP | reference | MG50, MG51, MG53, MG54, MG55 | 5 | — | Aruvii process facts. MG53 reworded (research/33): writer stops and reports; volume reset belongs to the human/gate owner. Edit MG56 applied here. |
| `.agents/skills/flyway-migration/SKILL.md` | AP | reference | MG60, MG61, MG62 | 3 | — | Flat workflow skill (G9c-MG-F3). MG60 reworded (writer stops and reports). MG61 reworded: version -> file -> header -> SQL (MG30-38, MG42) -> IT; deferred MG19/MG41+ out. |
| `docs/agents/testing.md` | AP | docs/agents answers | S3, TM2, TM3, IT2, TM4, SP3, K14, K19, P7, EB4 | (10) | — | Q1+Q10: Aruvii values (make targets, @EnableAruviiIT/@EnableAruviiSpec, fake-llm, Ollama, AruviiException, Toxiproxy BOM check) for generic SK rules. Secondary: ids also counted in their SK file. |
| `docs/agents/planning.md` | AP | docs/agents answers | GA1, GA2, AC9, SR2, SR3, SR4, SR6, PD6, DG6, WD5 | (10) | — | Q1+Q10: Aruvii values (REQ, /approved, docs/CONTEXT.md glossary, docs/design/). Secondary. |
| `docs/agents/code.md` | AP | docs/agents answers | SEAM1, CV3, ER2, ER10, ER11, SC1, SC10, SC13, X6 / SP23, SE1, SE7, SS1, SS12, SS22, SS25, SE7a, SS26 | (17) | — | Q1+Q10: Aruvii values (aruvii. key prefix, AruviiException, GlobalExceptionHandler, CredentialEncryptor, PUBLIC_PATHS, checked-fetch #527, line lengths 120/110). Secondary. |
| `docs/agents/obs.md` | AP | docs/agents answers | LG1, LG4 | (2) | — | Q1+Q10: Aruvii values (id names in action= lines, PiiRedactor). Secondary. |
| `docs/agents/meta.md` | AP | docs/agents answers | SRC1 | (1) | — | Q1+Q10: SRC1 names CLAUDE.md / "our docs"; the repo answer is its own instruction files. Secondary. Could fold into another answers file — operator call. |
| `plugins/rulebook/skills/testing/references/strategy.md` | SK | reference | S1, S2, S3, S4, S5, AT1, TM1, TM2, TM3 | 9 | — | AT1 was "testing (tiers)". S3/TM2/TM3 written neutral (values in docs/agents/testing.md). |
| `plugins/rulebook/skills/testing/references/coverage-design.md` | SK | reference | C1, C2, C3, C4 | 4 | — |  |
| `plugins/rulebook/skills/testing/references/boundaries.md` | SK | reference | B1, B2, B3 | 3 | — |  |
| `plugins/rulebook/skills/testing/references/value-bar.md` | SK | reference | V1, V2, V3, V4, V5 | 5 | — |  |
| `plugins/rulebook/skills/testing/references/unit-tests.md` | SK | reference | U1, U3, U2 | 3 | — | U2a DROPPED (operator 2026-10-23). U2 restored in full (labelled blocks + feature name = plain behaviour sentence); ledger status of U2 still reads SUPERSEDED and needs flipping. U4 body lives in code/java.md, pointed at from here. |
| `plugins/rulebook/skills/testing/references/integration-tests.md` | SK | reference | IT1, IT2, IT3, IT4, TM4, IT5, SP1, SP2, SP3, SP4, SP5, SP6, SP7, SP8, SP9, SP10, SP11 | 17 | — | IT4b merged detail = Decided edge of IT4. SP3 reworded (research/33): isolation from the reset @EnableAruviiIT/@EnableAruviiSpec installs. CV5 moved to aruvii-api/AGENTS.md (Q1). |
| `plugins/rulebook/skills/testing/references/spock.md` | SK | reference | K1, K2, K2b, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12, K13, K14, K15, K16, K17, K18, K19, K20 | 21 | — | K1 also a root «tests» MUST. K14 "correction owed to CLAUDE.md" -> AGENTS.md (CLAUDE.md = @AGENTS.md). |
| `plugins/rulebook/skills/testing/references/scenario-to-tests.md` | SK | reference | GT1, GT2, GT3, GT4, GT5, GT6, CV2 | 7 | — | Q4: was testing/workflows/; gherkin-to-test workflow skill points here and carries no rules. GT4 reworded: AC id goes in @Issue([...]) only (CV2). |
| `plugins/rulebook/skills/testing/references/mutation.md` | SK | reference | M1, M2, M3, M4, M5, M6, M8, M9, M10 | 9 | — | M10 reworded (research/33): prove a mutation-kill test with a temporary hand mutation. M7 moved to aruvii-guardrails/AGENTS.md. research/29 §2 M1 vs #68 (report -> blocking) not decided in #21: written as ledger. |
| `plugins/rulebook/skills/testing/references/property-based.md` | SK | reference | P1, P2, P3, P4, P6, P7, P8, P10 | 8 | — | P5, CV4 moved to aruvii-guardrails/AGENTS.md (Q1). P7 neutral. |
| `plugins/rulebook/skills/testing/references/smoke-specs.md` | SK | reference | EA1, EA2, EA3, EA4, EA5, EA6, EB2, EB3, EB4, EC1, EC2, EC3, EC4, EC5, ED3 | 15 | — | EB1, EC6, ED2, ED4, ED5 moved to aruvii-ui/playwright/AGENTS.md (Q1). EC1 count ("147 networkidle uses") goes to the follow-up issue (WD2). |
| `plugins/rulebook/skills/planning/references/acceptance-criteria.md` | SK | reference | GA1, GA2, GA3, GA4, GA5, GA6, CV1, AC7, AC8, AC9, AC10 | 11 | — | GA1 reworded: one AC home = REQ, quoted verbatim in the MR; "discovery". GA2/GA3: analyst -> discovery, developer -> writer. GA6 reworded: scenario title = plain behaviour sentence (U2a drop). |
| `plugins/rulebook/skills/planning/references/spec-review.md` | SK | reference | SR1, SR2, SR3, SR4, SR6, SR7 | 6 | — | Edit SR8 applied here (architecture-review A-E merged; F-01 -> Spec verdict). Stage numbers -> phase names (design §4). |
| `plugins/rulebook/skills/planning/references/program-design.md` | SK | reference | PD1, PD2, PD3, PD4, PD5, PD6, PD7 | 7 | — | PD7 "stage 6" -> phase name (build) per design §4. |
| `plugins/rulebook/skills/planning/references/diagrams.md` | SK | reference | DG1, DG2, DG3, DG4, DG5, DG6 | 6 | — |  |
| `plugins/rulebook/skills/planning/references/writing-docs.md` | SK | reference | WD1, WD2, WD4, WD5, WD7 | 5 | — | WD3, WD6 moved to docs/AGENTS.md (Q1). |
| `plugins/rulebook/skills/meta/references/writing-references.md` | SK | reference | SRC1 | 1 | — | Meta rule. GB2 not placed (see unplaced). |
| `plugins/rulebook/skills/code/references/java.md` | SK | reference | U4, JV1, JV2, JV3, JV4, JV5, JV6, JV7, JV8, JV9, CV3 | 11 | — | JV12 DROPPED; JV10 -> AP layering.md. CV3 reworded: line length only (ST2 dropped); X1 decided edge loses its ST1 clause. JV2/JV6/JV9 gate-twinned: no Review check (OQ3). |
| `plugins/rulebook/skills/code/references/design.md` | SK | reference | SEAM1 | 1 | — | Q3: generic seam principle (one job, record in / sealed out, pure decisions, I/O decides nothing, no null, rule lists, cyclomatic <=5, smell baseline). Precedence clause dropped (OQ1). S-1..S-7 Java text -> agent-platform #679 (FW7, SP13 unplaced). |
| `plugins/rulebook/skills/code/references/types.md` | SK | reference | TY1, TY2, TY3, TY7, TY9, TY12, TY8, TY4, TY5, TY6, TY11, TY10, TY13 | 13 | — | X2/TY13a DROPPED, so TY13 (no builder classes) stands unamended. TY1/TY2 also root «Java» MUSTs. |
| `plugins/rulebook/skills/code/references/errors.md` | SK | reference | ER1, ER2, ER7, ER10, ER11, ER3, ER4, ER5, ER6, ER8 | 10 | — | ER9 is an edit (applied in AGENTS.md / aruvii-api, Q6). |
| `plugins/rulebook/skills/code/references/comments.md` | SK | reference | CM1, CM2, CM3, CM4, CM5, CM7, CM6 | 7 | — |  |
| `plugins/rulebook/skills/code/references/smells.md` | SK | reference | NM1, NM2, NM3, NM4, DS1, DS2, DS3, DS4, DS6, DS11, DS12, DS14, FW1, FW2, FW5, FW6, FW8, FW9, FW3, SM1, SM2, SM3, SM5 | 23 | — | DS11 KEPT with no source (operator). FW9: drop the "12-smell subset" note (SM1 + R37-D8). |
| `plugins/rulebook/skills/code/references/services.md` | SK | reference | LY1, LY2, LY3 | 3 | — | LY6/LY7 written once, in spring.md (OQ-SC2). |
| `plugins/rulebook/skills/code/references/spring.md` | SK | reference | LY6, LY7, SC1, SC4, SC2, SC3, SC5, SC6, SC8, SC10, SC11, SC12, SC13, SC14, SC15, SC16, SC17, SC19, SC20, SC21, SC22, SC7, SC9, X6 / SP23, SX18 (R36 SP18), SX19 (R36 SP19), SX14 (R36 SP14) | 27 | — | SC18 DROPPED (X6/SP23 + Checkstyle win). SX20 DROPPED. LY6/LY7 = sharpened rows (ledger lists each id twice; Q11 qualify). |
| `plugins/rulebook/skills/code/references/concurrency.md` | SK | reference | CC1, CC2, CC3, CC9, CC8, CC4, CC5, CC6, CC7, CC10 | 10 | — |  |
| `plugins/rulebook/skills/code/references/security.md` | SK | reference | SE1, SE2, SE3, SE4, SE5, SE6, SE10, SE7, SE8, SS1, SS2, SS3, SS4, SS5, SS6, SS7, SS8, SS9, SS10, SS11, SS12, SS16, SS17, SS19, SS20, SS21, SS22, SS23, SS24, SS25, SE7a, SS26 | 32 | — | SS13-15, SS18 moved to aruvii-api/AGENTS.md (Q1). SE7 also root «credentials» MUST. |
| `plugins/rulebook/skills/code/references/messaging.md` | SK | reference | MS6, MS4 | 2 | — | MS1-3, MS5 -> aruvii-worker/AGENTS.md (Q1). Edit MS7 is for the old AP file; moot once neutral. |
| `plugins/rulebook/skills/code/references/angular-ui.md` | SK | reference | NGA1, NGA2, NGA3, NGA5, NGA6, NGA7, NGB1, NGB2, NGB3, NGC1, NGC3, NGD1, NGD2, NGD3 | 14 | — | NGA4, NGB4 DROPPED. Aruvii-only NG rows -> aruvii-ui/AGENTS.md. |
| `plugins/rulebook/skills/deslop/SKILL.md` | SK | reference | DS13, DS5, DS7, DS8, DS9 | 5 | — | Flat workflow skill (FL26). Edit DS15 applied: cite U2 only (research/33). |
| `plugins/rulebook/skills/obs/references/logging.md` | SK | reference | LG1, LG2, LG3, LG4, LG5, LG6, LG7, LG8, LG9, LG10 | 10 | — | LG2/LG3/LG4 also root «observability» MUSTs. |
| `plugins/rulebook/skills/obs/references/levels.md` | SK | reference | — | 0 | — | No APPROVED rows: holds the OQ4 DECIDED level table (FL25). |
| `plugins/rulebook/skills/obs/references/metrics.md` | SK | reference | MX7, MX1, MX2, MX3, MX4, MX5, MX6 | 7 | — | MX6 reworded (research/33): find the failure by trace id in logs (and traces) inside an IT. MX8 -> aruvii-api/AGENTS.md. Edit MX9 applied. |
| `plugins/rulebook/skills/obs/references/tracing.md` | SK | reference | TR1, TR2, TR3, TR4, TR5 | 5 | — | TR4 (Brave) kept; TR4a on HOLD until #55. |
| `plugins/rulebook/skills/migrations/references/review.md` | SK | reference | MG17, MG18, MG21, MG20 | 4 | — | MG20 "the lead" persona -> L2 #22 (Q8). |
| `plugins/rulebook/skills/migrations/references/postgres-design.md` | SK | reference | MG30, MG31, MG32, MG33, MG34, MG35, MG36, MG37, MG38, MG42 | 10 | — |  |

SK = chiyanram/skills · AP = agent-platform. Root-block and docs/agents ids are secondary (body counted in its reference). MUST ids not in the ledger: **IT-placement** (AGENTS.md / ADR-0009), **DEP-1..3** (research/32), **S2+V3** (one MUST from two rows). **U2** is SUPERSEDED in the ledger and restored by the U2a drop.

## 3 · Rows not placed

| id | reason |
|---|---|
| SP22, G-SP22, G-SP22.2, G-DS9, G-JV9, G-OQ2, G-X6, G-SC1, G-UnusedImports, G-CK1, G-DS2, G-FW1, G-CK4, G-ER3, G-ER4, G-JV6, G-JV2, G-SP19, G-SP18, G-LG6, G-CK3, G-CK2, G-CK2.2, CK2, CK3, CK4, CK5, CK1, CK6, CK7, CK8, CK9 | gate: Checkstyle / build-logic -> L5/L7 (Q12). CK5 KEPT by the operator despite no source (still a gate; ledger also names smells.md) |
| NGF1, NGF2, NGF3, NGF4 | gate: aruvii-ui/eslint.config.js -> L5/L7 (Q12) |
| MG70, MG71, MG72 | gate: migration checks / CI twins of the hooks -> L5/L7 (Q12, Q13). MG70 reworded: new .conf sidecar only, V92 exempt |
| WIRE-smoke | gate wiring work item -> L5/L7; retarget make test-scripts -> make test-doctor or a named target (research/33) |
| FL1, FL2, FL3, FL4, FL5, FL6, FL7, FL8, FL9, FL10, FL11, FL12, FL13, FL14, FL15, FL16, FL17, FL18, FL19, FL20, FL21, FL22, FL23, FL24, FL25, FL26, FL27 | build instruction (file fate) -> L5/L7 (Q12); FL13/14/16/17/19/20/21 retargeted to root or <dir>/AGENTS.md; FL19/OQ-NG7 -> reviewer Spec verdict |
| G9c-MG-F1, G9c-MG-F2, G9c-MG-F3, G9c-MG-F5 | build instruction (migration file fates) -> L5/L7 (Q12) |
| G9c-MG-F4 | build instruction -> L5/L7 (Q12); its one pointer line is written as the root «schema change» block |
| CUT-smoke | build instruction (deletion list) -> L5/L7 (Q12) |
| LY5, ER9, MX9, MS7, DS15, SR8, MG56 | edit instruction, not rule text: applied inside the L1 MR of its target file (LY5 layering.md/AGENTS.md, ER9 AGENTS.md+aruvii-api (Q6), MX9 metrics.md, MS7 messaging.md, DS15 deslop, SR8 spec-review.md, MG56 who-migrates.md) |
| G-CK5, ST1, ST2, JV12, NGA4, NGB4, X2 / TY13a, SX20 (R36 SP20) | DROPPED (no source; research/31, operator 2026-10-23) |
| U2a | DROPPED (operator 2026-10-23: does not fit Spock); U2 restored |
| SC18 | DROPPED (research/33: contradicts X6/SP23 + G-X6) |
| TR4a | HOLD until agent-platform #55 decides tracing (research/33, #21) |
| FW7, SP13 | Q3: S-1..S-7 Java seam text lands in agent-platform via #679; #679 owns the path, so no L1 file |
| GB2 | meta rule superseded in effect by G23 #93 Q3 (neutral Good/Bad pairs; research/29 §2); no explicit drop in #21 — operator to confirm |

Not APPROVED, so not counted: DECIDED rows (they become Decided edges, research/29 §1), DEFERRED MG rows (#57), and the other HOLD rows (E7, SR5, AC11, PD8, WD8, SX15, SX16, SM4).

## 4 · Totals

| | chiyanram/skills | agent-platform | total |
|---|---|---|---|
| files | 36 | 19 | 55 |
| — references | 36 | 5 | 41 |
| — nested AGENTS.md | 0 | 8 | 8 |
| — root AGENTS.md (blocks) | 0 | 1 (6) | 1 |
| — docs/agents answers | 0 | 5 | 5 |
| primary rules | 331 | 50 | 381 |
| MUSTs (secondary) | 0 | 25 | 25 |
| values in docs/agents (secondary) | — | 40 | — |

Check: 381 placed (380 ledger ids + U2) + 94 unplaced = 474 unique APPROVED ids + U2. LY6, LY7 are listed twice in the ledger and written once (spring.md).
Unplaced by kind: gate 40 · build instruction 33 · edit 7 · dropped 10 · HOLD 1 · other 3 (FW7, SP13 → #679; GB2).

Author-rule check against Q12: 393 author rows = 391 unique ids (LY6, LY7 twice) − 9 dropped (ST1, ST2, JV12, NGA4, NGB4, X2/TY13a, SX20, U2a, SC18) − TR4a (HOLD) − FW7, SP13 (#679) = 379, + SRC1 (meta) = 380 ledger ids placed; GB2 (meta) not placed.
