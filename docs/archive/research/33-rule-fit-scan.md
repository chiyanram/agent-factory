# 33 · Rule-fit scan: approved rules that do not fit agent-platform (2026-10-23)

Scope: every row of `~/workspace/skills/research/19-approved-rules.md`. Rows already decided were skipped: U2a, CV6,
GA6, ST1, ST2, JV12, NGA4, NGB4, G-CK5, X2/TY13a, SX20. Each row was checked against agent-platform `origin/master` @
`a699d261` (read-only) and `agent-factory/docs/design.md`. Ledger cites are `19:<line>`. A rule that is only a target
the repo does not meet yet (fast-check, Toxiproxy, NeedBraces, 15-minute tokens) is not flagged.

Severity order: the first rows would make an agent write code that fails the build, or touch the shared stack.

| id | rule (≤20 words) | kind | what's wrong (≤25 words) | evidence file:line | suggested fix |
|---|---|---|---|---|---|
| SC18 | `@PostConstruct` only checks injected state or builds in-memory structures | CONTRADICTS-RULE | X6/SP23 bans `@PostConstruct` in main code and G-X6 makes Checkstyle fail it. SC18 still APPROVED, so an agent writes one and the build fails. | 19:423 vs 19:532 (X6/SP23), G-X6 row | drop SC18, or mark it SUPERSEDED by X6/SP23 |
| TR4 | Trace through Micrometer Tracing with the Brave bridge; never the OpenTelemetry API | CONTRADICTS-RULE | TR4a (APPROVED) says "use OpenTelemetry instead of Brave". Master uses Brave. Both cannot hold. | 19:317 vs 19:392; `aruvii-api/build.gradle.kts:35`, `aruvii-worker/build.gradle.kts:35` (bridge-brave) | keep TR4 for now; mark TR4a HOLD until #55 decides |
| ED5 | `make smoke` while developing, `make smoke FULL=1` as the gate | CONTRADICTS-DESIGN | `make smoke` deploys the shared stack. Writers never deploy it, and the gate is CI. | `Makefile:406,411` ("deploys: yes"); design.md:84,86 | reword to: the writer runs Testcontainers targets; smoke runs only in the gate |
| MG53 (+MG60) | Higher version already in the shared dev volume → reset the volume; never renumber | CONTRADICTS-DESIGN | Resetting runs `make db-reset`. That deletes the shared postgres volume, which other worktrees use. Writers must not touch the shared stack. | `Makefile:477-481` (destroys postgres volume); design.md:86 | retarget to the human/gate owner; the writer stops and reports instead |
| MX6 | After adding telemetry, force a failure and find it by trace id in logs, metrics, traces | CONTRADICTS-RULE | Metrics cannot carry a trace id (MX1). Meters are not scraped (MX8), and there is no trace exporter (X2). It also needs a deployed stack. | 19:311 vs 19:306, 19:312, 19:391; `aruvii-api/.../application.yml:85` (no prometheus); no zipkin/otlp in `gradle/libs.versions.toml` | reword to: find the failure by trace id in the logs, inside an IT |
| MG61 | Skill steps: version → file → header → SQL (MG41–47) → IT (MG19) → `make verify-module` | CONTRADICTS-RULE | MG19 and MG41/43–47 are DEFERRED to the first production deploy. MG61 makes them mandatory steps now. | 19:503 vs 19:517, 19:520-527 | reword to: SQL (MG30–38, MG42) → IT for new behaviour; add MG19/MG41+ when undeferred |
| SP3 | Never `@Transactional` on a RANDOM_PORT IT; isolation comes from `DatabaseResetExtension` | CONTRADICTS-STACK | `DatabaseResetExtension` is the JUnit Jupiter adapter only. New ITs are Spock and reset through `AruviiSpecResetInterceptor` via `@EnableAruviiSpec`. | `aruvii-test-support/.../DatabaseResetExtension.java:23-26`; `.../spock/AruviiSpecResetInterceptor.java` | reword to: "from the reset that `@EnableAruviiIT` / `@EnableAruviiSpec` installs" |
| M7 | Run `make mutation` for guardrails; for another module wire PIT in first and say so | CONTRADICTS-DESIGN | The design says modules without PIT stay test-first until #659. `make mutation` is hardcoded to guardrails. | design.md:65; `Makefile:249-251`; `aruvii-guardrails/build.gradle.kts:3` (only module) | reword to: PIT where it is wired; elsewhere test-first until #659; no wiring in a feature MR |
| MG70 | `check-migrations.sh` fails on … a `.conf` sidecar … | CONTRADICTS-STACK | Master already has a sidecar that must be kept (V92). The check would fail on master from day one. | `aruvii-infra/src/main/resources/db/migration/V92__…sql.conf`; `aruvii-api/.../application.yml:49-52` | reword to: "a new `.conf` sidecar (V92's inert one exempt)" |
| GT4 | Test carries `@Issue("#NNN")` plus the GA2 scenario id in the name or annotation | CONTRADICTS-RULE | "In the name" breaks GT1 (name = scenario title verbatim) and CV1 (AC id not in the title). CV2 already fixes it to the annotation. | 19:72 vs 19:69, 19:138, 19:139 | reword to: the AC id goes in `@Issue([...])` only (CV2) |
| WIRE-smoke | `check-antipatterns.test.sh` in `make test-scripts` … | STALE-PATH | There is no `test-scripts` target. The script tests run through `test-doctor` and `test-next`. | `Makefile:319,332` (only script-test targets); script at `.claude/skills/smoke-spec/scripts/check-antipatterns.test.sh` | retarget to `make test-doctor` (or add a target and name it) |
| FL13/14/16/17/19/20/21 | Split/merge MUSTs into `.claude/rules/{java,observability,dependencies,api,angular-ui}.md` | CONTRADICTS-DESIGN | G9c-MG-F2 records that `.claude/rules/` is deleted (G1b #72). The rulebook tree is AGENTS.md + `<dir>/AGENTS.md` + references. | 19:358-366 vs 19:474; design.md:43-45 | retarget each MUST to root or `<dir>/AGENTS.md` |
| OQ-NG7 (+FL19) | "UI wired to the real API" is a once-per-change stage-8 / DoD check | CONTRADICTS-DESIGN | `/dod` and stage 8 are gone. Its checks belong to the gate or the reviewer (Spec verdict at stage 7). | 19:399, 19:364; design.md:75,84 | retarget to the reviewer's Spec verdict |
| GA1 | The analyst writes scenarios in the REQ's `## Acceptance criteria` as one gherkin block | CONTRADICTS-DESIGN | The design puts ACs in the MR description ("intent + ACs in the MR"). "Analyst" is an old persona; the seat is discovery. | 19:64; design.md:33,62 | name one home (REQ, quoted verbatim in MR) and say "discovery" |
| CV3 (+X1) | ST2 (one arg per line) applies to Java/Groovy at 120; TS Prettier at 110 | CONTRADICTS-RULE | ST2 was dropped, so CV3 applies a rule that no longer exists. X1 (DECIDED) also says "keep ST1", which was dropped. | 19:140 → 19:137; 19:536; `.editorconfig` (120), `aruvii-ui/.prettierrc.json` (110) | reword CV3 to line length only; drop X1's ST1 clause |
| DS15 | Remove deslop's `shouldXxx`/AssertJ wording that contradicts CV6 and U2 | CONTRADICTS-RULE | CV6 was merged into U2a, and U2a was dropped. U2's naming clause is still marked SUPERSEDED, so DS15 has no live rule to cite. | 19:254; 19:28 (U2 status), 19:127 | cite U2 only; restore U2's naming clause status to APPROVED |
| M10 | A mutation-kill test is a narrow exception to "never skip Red" | CONTRADICTS-DESIGN | The design requires test-first for bugs only, so "never skip Red" is not a general rule to make an exception to. | 19:96; design.md:65 | reword to: prove a mutation-kill test with a temporary hand mutation |
| GA2, GA3 | "the analyst assigns" AC ids; "the tier is the developer's call" | CONTRADICTS-DESIGN | These name old personas. The design uses seats (discovery, writer). | 19:65-66; design.md:17-27 | analyst → discovery; developer → writer |

## Counts

| kind | rows |
|---|---|
| CONTRADICTS-RULE | 7 (SC18, TR4, MX6, MG61, GT4, CV3, DS15) |
| CONTRADICTS-DESIGN | 8 (ED5, MG53, M7, FL13…, OQ-NG7, GA1, M10, GA2/GA3) |
| CONTRADICTS-STACK | 2 (SP3, MG70) |
| STALE-PATH | 1 (WIRE-smoke) |
| **total** | **18 rows** (~26 ledger ids including the FL group and the "+" rows) |

These checks found nothing wrong:

- No rule text uses `mvn`, `./mvnw` or pom-only wording. MS7, FL4 and FL9 already correct it.
- No rule relies on semgrep.
- These targets and paths all exist: `test-module`, `it-module`, `test ONLY=arch`, `mutation`, `fixtures.ts`, `defaultWorkspaceId`, `playwright.core.config.ts`, `check-flaky.mjs`, `FakePortsConfig`, `@EnableAruviiSpec`, `AruviiTestReset.PRESERVE`, `PiiRedactor`, `module_dependency_allowlist`, `ARCHITECTURE.md` §9, `LUCIDE`, and `CheckedHost`.
- These facts match master: Spock 2.4 (K10 `@Verify`), the zoneless app (NGB2), AES/GCM (SE7), `log` as the ConstantName (LG8), and api as the sole migrator (MG50).
