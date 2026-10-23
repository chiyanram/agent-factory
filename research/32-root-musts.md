# 32 — Root and nested AGENTS.md MUSTs: candidates and picks (2026-10-22)

For chiyanram/agent-factory#21 (L1 rulebook). Read-only research. Input to the writer of the root
`AGENTS.md` blocks and the four nested `AGENTS.md` files.

Sources: ledger `~/workspace/skills/research/19-approved-rules.md` · research/29 §1c · agent-platform
`AGENTS.md` (worktree crq-597) · `origin/master:.claude/rules/*.md` · `origin/master` code (counts below are
`git grep` over `origin/master` on 2026-10-22, approximate, regex-level) · research/10, 12 (they carry no
rule-breakage evidence for these blocks; they are about process and gates).

```
pick rule  =  broken in practice (ledger Bad, real; or a master count)  >  most damaging if broken
           -  already enforced by a tool that blocks (ArchUnit, javac, eslint error, blocking hook)
G21 form   =  imperative · because · the failure  (≤35 words)
```

Gates found on `origin/master`, so "enforced?" can be checked:

| gate | covers | does NOT cover |
|---|---|---|
| `checkstyle.xml` (root) | names, imports, `ModifierOrder`, `OneTopLevelClass`, `NoFinalizer` | braces, complexity, switch default, null, logging |
| `ArchitectureRulesTest.java` | domain/shared purity, Spring AI only in worker, Jackson 3, Jakarta, layer direction, module allow-list, bounded XADD, controllers not injecting repos | entity-in-DTO (AP2), decrypt sites, role guards |
| `aruvii-ui/eslint.config.js` | `no-explicit-any` = error, feature boundaries (`import/no-restricted-paths`), class suffixes | no `templateAccessibility`, no inline-template processor (NGF1 not done) |
| `.claude/hooks/` | **block**: edit of applied migration, migration version taken on another branch, commit on master · **warn**: JUnit test written, IT in `src/test`, `@MockitoBean` in IT | Claude Code only — a Codex or fleet worker has none of them (design §6) |

---

## 1 · root «Java» (fixed — the three are decided; evidence added)

| pick? | id | MUST text (G21 form) / rule | why picked / evidence | enforced by tool already? |
|---|---|---|---|---|
| **PICK** | TY2 (+ SEAM1 S-4) | Return a sealed result and switch over it exhaustively with no `default` arm, because a `default` arm lets a new case compile and be silently mishandled. | decided. 28 `default ->`/`default:` arms in `*/src/main/*.java` (not all over sealed types). Ledger TY2 reason. | no — javac checks exhaustiveness only when `default` is absent; nothing forbids `default` |
| **PICK** | TY1 | Never let `null` decide a case; use `Optional`, a sealed result or an enum, because a nullable field lets contradictory combinations compile and a caller forget the check. | decided. Ledger Bad, real: `aruvii-guardrails/…/GuardrailPipeline.java:35,43-44,113-114,123-124,132` @772736bf. 74 `return null;` in `*/src/main/*.java`. | no |
| **PICK** | SEAM1 (S-rules) · user CLAUDE.md | Keep each method at cyclomatic complexity 5 or less, using a rule list instead of an if-ladder, because a branching method hides paths no test reaches. | decided. Ledger SEAM1 = NO-REASON (needs this reason). Breakage **not measured** — no complexity tool runs. | no — `checkstyle.xml` has no `CyclomaticComplexity` module |
| — | LY4 | `domain/` and `aruvii-shared` hold no Spring, JPA, Spring AI or Jackson-databind type. | ND-2 put it in «Java»; ArchUnit already blocks it | **yes** — ArchUnit `domain_packages_have_no_framework_imports`, `shared_kernel_is_pure_java` |
| — | ER1 | A foreseeable non-success is a sealed outcome in the return type; only faults throw. | Bad, real: `DbConnectionService.java:69-85` | no |
| — | U4 | Logic a test must pin takes an injected `Clock`, never `Instant.now()`. | Bad, real: `PasswordResetService.java:76-81` | no |
| — | TY3 | Model forbidden combinations away with sealed variants first. | Bad, real: `TrustedCertificateRequest.java:10-16` | no |
| — | TY7 | A collection-returning method returns empty, never `null`. | no evidence | no |
| — | JV6 | `Optional` is a return type only. | no evidence | no |
| — | JV8 | Every `AutoCloseable` opened in a method is closed by try-with-resources. | no evidence | no |
| — | FW7 | An interface declares only the methods its consumer calls. | no evidence | no |
| — | SP13 | A seam's Spring implementation is `final`, package-private, no `Impl`. | no evidence | no |

## 2 · root «tests» (3)

| pick? | id | MUST text (G21 form) / rule | why picked / evidence | enforced by tool already? |
|---|---|---|---|---|
| **PICK** | S2 (+V3) | Assert observable behaviour, never a field default, a hand-copied enum list or the input you passed in, because such a test cannot fail for a real defect. | most-broken test rule in the ledger: Bad, real `RunModeSpec.groovy:49-60`, `AlertTriggerTypeSpec.groovy:8-13` @772736bf; !230 F1, F5. | no |
| **PICK** | IT placement (AGENTS.md, ADR-0009; no ledger row) | Put every IT under `src/integrationTest`, never `src/test`, because a misplaced IT compiles, runs class-parallel without the Testcontainers tuning, and still reports green. | most damaging: silent false green. AGENTS.md: "Nothing catches it" — scripted guard deleted in #440, verified with a planted probe. 0 misplaced `*IT` on master today. | advisory only — `warn-it-in-src-test.sh`, Claude Code only |
| **PICK** | K1 | In a Spock argument closure, write each check as its own top-level line, never inside `every{}`, because nested checks are never asserted and the test passes anyway. | broken in practice: #491 (!182) broke all five it-testing rules; Bad, real `FeedbackAdapterSpec.groovy:63-70`. Old `it-testing.md` rule 1 states it wrongly. | no |
| — | IT2 | ITs get containers only from the singleton initializer; never `@Testcontainers`/`@Container`/`@ServiceConnection`. | Bad, real: `FileToolHandlerS3IT.java:39-40,61-66` (1 file + the CV5 exception) | no |
| — | IT3 | ITs call HTTP with `RestTestClient` on `RANDOM_PORT`; never MockMvc or TestRestTemplate. | Bad, real: `WebhookControllerRunContextTest.java:63-65` (1 file) | no |
| — | IT4 | Swap an IT collaborator only with a fake port; never `@MockitoBean`. | 0 uses on master | advisory — `warn-mockitobean-in-it.sh` |
| — | Spock-new (AGENTS.md) | Every new test is a Spock specification. | 180 JUnit `*Test.java` remain (legacy, allowed) | advisory — `warn-junit-test-written.sh` |
| — | S4 | A bug fix lands with a test that failed for the bug's reason. | ledger: 12 sampled fix commits all comply | no |
| — | S1 | Pick the tier by what the behaviour depends on. | Bad, real: `HistoryCompressionTest.java:45-56` | no |
| — | K14 | Isolate a global-state Spock spec with `@Isolated`, not Jupiter annotations. | latent Bad: `SessionServiceSpec.groovy:36,51-57` | no |

## 3 · root «dependencies» (3)

Ledger has no rule rows for this block (FL17 is a file fate). Ids `DEP-n` are new; text from
`origin/master:.claude/rules/dependencies.md`.

| pick? | id | MUST text (G21 form) / rule | why picked / evidence | enforced by tool already? |
|---|---|---|---|---|
| **PICK** | DEP-1 | Never override a version the Spring Boot BOM manages; read the BOM first, because all three past overrides were wrong, two pinned backwards. | broken 3/3: `testcontainers`, `mssql-jdbc`, `ojdbc11` (`dependencies.md` §1). | no (`dependencyConvergence` off) |
| **PICK** | DEP-2 | Read a library's BOM before importing it, because an imported BOM wins over Boot's and can silently downgrade a shared library. | broken: `jjwt-bom` pinned `jackson-databind` 2.12.7.1 and broke 81 tests. | no |
| **PICK** | DEP-3 (+P5) | Check a new test dependency's stdout before adopting it, because agents read build logs, and jqwik prints an instruction telling agents to ignore its results. | broken: jqwik was wired, then removed (`JqwikExecutor#printMessageForCodingAgents`). Most damaging for an agent-run build. | no |
| — | DEP-4 | No pre-release dependencies. | held, not broken (MapStruct 1.7, WireMock 4.0) | no |
| — | DEP-5 | Versions that must match across ecosystems move in one commit. | broken once: Playwright Java vs npm 15 minors apart — runner-up | no |
| — | DEP-6 | Pin the analysis engine, not only its plugin. | broken once: Checkstyle 9.3 by default | no (fixed in catalog) |
| — | Jackson 3 / Jakarta / Spring AI in worker | from AGENTS.md | LY5 | **yes** — ArchUnit `no_jackson_2_imports_in_source`, `no_pre_jakarta_javax_imports`, `spring_ai_only_used_by_worker` |

## 4 · root «observability» (3 of LG1–LG10)

| pick? | id | MUST text (G21 form) / rule | why picked / evidence | enforced by tool already? |
|---|---|---|---|---|
| **PICK** | LG4 | Never log PII, prompts, tool arguments, secrets or tokens at INFO or above, because logs are a common data-leak path on a customer's system. | broken: `email=` at INFO/WARN in `OidcAuthService.java:37,41,47`, `OidcController.java:151`. Most damaging (self-hosted, customer ships logs). | no |
| **PICK** | LG2 | Log a failure once, where it is handled; do not log before rethrowing with the cause, because each layer then writes the same failure twice. | Bad, real: `NotificationConfigService.java:114,137-143` + `GlobalExceptionHandler.java:179-183`. ~28 `log.warn/error` followed by `throw new` within 2 lines. | no |
| **PICK** | LG3 | Log WARN with class and message only, and ERROR with the throwable last, because a placeholder throwable prints no stack for the operator. | Bad, real: `SessionMessageController.java:302-303,318-321`. | no |
| — | LG1 | Service entry logs one INFO `action=<verb>` line with the ids. | followed: 242 `log.info("action=` lines | no |
| — | LG5 | Strip CR/LF from untrusted text in a log message. | no evidence | no |
| — | LG6 | `{}` placeholders, never concatenation. | 1 site | partly (ledger G-LG6 Checkstyle twin, not in current `checkstyle.xml`) |
| — | LG7 | Long call logs duration; scheduled job logs tick and completion. | no evidence | no |
| — | LG8 | `private static final Logger log = LoggerFactory.getLogger(This.class)`. | — | partly — Checkstyle `ConstantName` allows `log` |
| — | LG9 | Multi-entry log streams carry `entryPoint`. | no evidence | no |
| — | LG10 | Tag temporary debug logs and remove before merge. | no evidence | no |

## 5 · root credentials (1)

| pick? | id | MUST text (G21 form) / rule | why picked / evidence | enforced by tool already? |
|---|---|---|---|---|
| **PICK** | SE7 | Encrypt every credential with `CredentialEncryptor` before storing it and mask it in every response, because a plain credential leaks to every database reader and API caller. | FL21 names SE7 as the one MUST. Most damaging: irreversible leak. No breakage found in the ledger. | no |
| — | SE2 | A decryption failure stops the call; never fall back to cached or default credentials. | broken: #118 — runner-up if the operator wants evidence over damage | no |
| — | ND-4 | Decrypt only in an allowlisted role (handlers, outbound adapters, key bootstrap). | 15 decrypt sites outside handlers; ledger says two return ciphertext on failure. Rule not settled (AGENTS.md) | no (semgrep deleted) |
| — | SE7a / SS21 | Passwords bcrypt; machine secrets HMAC-SHA-256; separate keys. | `AuthAutoConfiguration.java:16-19` | no |

## 6 · root «schema change» (1 pointer line)

| pick? | id | text | why | enforced? |
|---|---|---|---|---|
| **PICK** | G9c-MG-F4 | Before creating a `V*.sql`, read `aruvii-infra/src/main/resources/db/migration/AGENTS.md` and use the `flyway-migration` skill. | a nested file loads on **read**, not on create; #500 took `V99` while the rule was unloaded (AGENTS.md). The pointer is the only thing that loads it in time. | n/a |

---

## 7 · `aruvii-ui/AGENTS.md` (23 NG* → 3)

| pick? | id | MUST text (G21 form) / rule | why picked / evidence | enforced by tool already? |
|---|---|---|---|---|
| **PICK** | NGD2 (+NGD3) | Make anything clickable a `<button type="button">` or an `<a>`, never a clickable `div`, `span` or `tr`, because keyboard and screen-reader users cannot reach it. | broken: 17 `(click)` on `div/span/tr/li` excluding overlays, e.g. `agent-list.component.ts:230`. FL15 names it. | no — `templateAccessibility` not enabled |
| **PICK** | NGC4 | In every error branch call `toast.error(...)` or set an error state, never `error: () => {}`, because a swallowed error shows the user nothing. | broken: 18 non-spec `error: () => {}`, e.g. `notification.service.ts:105`. Ledger reason = NO-REASON; this supplies one. | no |
| **PICK** | NGA3 | Do not silence the compiler with `!` or `as`; add a check or fix the type, because each one hides a runtime crash the compiler could catch. | most frequent: ~97 `x!.` and ~78 ` as T` in `src/app` (non-spec, regex). | no |
| — | NGB3 | State in `signal()`, derived in `computed()`; `effect()` never copies state. | Bad, real: `pipeline-builder.component.ts:222-265` — runner-up | no |
| — | NGB2 | Every component `OnPush`; app is zoneless. | ~33 of 73 components set it; FL15 names it; low damage (app is zoneless, `app.config.ts:11`) | no |
| — | NGB1 | Standalone only; do not write `standalone: true`. | 73 files carry the redundant flag; harmless | no |
| — | NGD3 | Icon-only button has `aria-label`. | FL15 names it; counted with NGD2 | no |
| — | NGB4 | `input()/output()` not decorators. | 15 `@Input(` | no |
| — | NGC3 | Long-lived subscription uses `takeUntilDestroyed()`. | 0 uses, but only 1 long-lived source found | no |
| — | NGC2 | HTTP in a `core/` root service; components never inject `HttpClient`. | 3 feature components | no |
| — | NGD1 | `@if/@for`, never `*ngIf/ngClass/CommonModule`. | 7 hits | no |
| — | NGA2 | No `any`. | — | **yes** — eslint `no-explicit-any: error` |
| — | NGF3 (gate) | features never import features. | — | **yes** — `import/no-restricted-paths` (partial, 4 of 20 zones) |
| — | NGA1, NGA4, NGA5, NGA6, NGA7, NGB5, NGC1, NGE1, NGE2, NGE3, NGE4 | strict flags · literal unions · `never` exhaustive · narrowing order · OpenAPI DTOs · component renders only · `inject()` · `app-icon` · `app-select` · icon colour via parent · agent-icon exemption | no breakage found (0 `export enum`, 0 constructor injection, 0 `<mat-icon>`); NGA1/NGA4/NGB5/NGC1/NGE1/NGE4 are NO-REASON | NGA1 by tsconfig |

## 8 · `aruvii-api/AGENTS.md` (AP1–AP5, AP3a, AP4a → 3)

| pick? | id | MUST text (G21 form) / rule | why picked / evidence | enforced by tool already? |
|---|---|---|---|---|
| **PICK** | AP1 | Return every error as `ApiResponse` with `success=false` and an `ErrorCode`, never a bare `ResponseEntity.status(...)`, because a bare error loses the `traceId` operators paste into tickets. | broken most: ~25 error-status `ResponseEntity.status(HttpStatus.NOT_FOUND/CONFLICT/UNAUTHORIZED/…)` in `*/src/main`. Shape = master today (decided). | no |
| **PICK** | AP3a (covers AP3) | Prove every role rule with an IT matrix — anonymous, each role, other-workspace member, API key — because a test of one wrong role let another workspace's editor get 200. | Bad, real: `ToolControllerIT.java:328-354` @772736bf. | no |
| **PICK** | AP4a (covers AP4) | Add a `PUBLIC_PATHS` entry only with an IT proving its replacement check refuses a bad caller, because one public path let an anonymous call complete setup. | Bad, real: `SetupController.java:140-144`, `SetupControllerIT.java:271-280`. Security, most damaging. | no |
| — | AP5 | Paginate or `LIMIT` every list endpoint; no unbounded `findAll`. | 16 `.findAll()` in `src/main` (e.g. `UserService.java:52`, `ModelRoleController.java:65`) — runner-up | no |
| — | AP2 | No JPA entity in an `ApiResponse`, DTO or payload. | 0 controllers import `.entity.` | no (ArchUnit rule not written) |
| — | AP3 | Every role rule enforced and proven by an IT. | folded into AP3a | no |
| — | AP4 | `PUBLIC_PATHS` is a security decision; never widen a matcher to pass a test. | folded into AP4a | no |

## 9 · `aruvii-tools/AGENTS.md` (TT1, TT2 — both)

| pick? | id | MUST text (G21 form) / rule | why picked / evidence | enforced by tool already? |
|---|---|---|---|---|
| **PICK** | TT1 | Ship every new tool type with `outputSchemaJson`, a `sampleResponseJson` and a dry-run smoke test, because without them the dry-run gate returns nothing. | AGENTS.md: these "are review's job and have been missed". | no |
| **PICK** | TT2 | Read a tool's required arguments off its handler; never declare a schema stricter than the handler, because a stricter schema stops a working tool on upgrade. | `EmailToolHandler.java:116-127` (accepts `to` as string or array); #407: 9 of 12 tool types had empty schemas. | partly — `ToolHandlerPort.inputContract` has no default, so javac forces an answer, not a correct one |

## 10 · `aruvii-infra/src/main/resources/db/migration/AGENTS.md` (MG1–MG4 → 3)

| pick? | id | MUST text (G21 form) / rule | why picked / evidence | enforced by tool already? |
|---|---|---|---|---|
| **PICK** | MG2 | Take max-across-all-branches + 1 for a new version, never `ls` of your tree, because two branches with one number fail at container start. | broken most: #161; #502 and #496 both took `V104`; #500 took `V99`. | Claude-only — `check-migration-version.sh` blocks; no CI twin (MG71 owed) |
| **PICK** | MG1 | Never edit an applied `V*.sql`; fix it with a new version, because Flyway checksums then fail startup on every installed system. | most damaging: reaches customers. | Claude-only — `block-migration-edit.sh` blocks; no CI twin |
| **PICK** | MG4 | Start every migration with a header naming each data change and lock and why, matching the statements, because an "expand-only" header once hid a rewrite of every row. | broken once (ledger reason); no tool checks header vs statements. Recent `V97`–`V99` comply. | no |
| — | MG3 | DDL only in `aruvii-infra/.../db/migration/`, SQL only, no Java migrations. | ledger: Java migration broke Checkstyle `TypeName`; no recent breakage | partly — `TypeName` fails a Java migration class |

---

## Open points for the operator

1. **Hooks are Claude-only.** MG1 and MG2 are "enforced" only for Claude Code. If fleet workers run other
   harnesses, keep them as MUSTs; if CI twins land (MG70–72), they drop out of the file.
2. **Cyclomatic ≤5 has no measurement.** Picked because decided; evidence of breakage is unknown until a
   tool (Checkstyle `CyclomaticComplexity` or PMD) reports a baseline.
3. **Credentials:** SE7 (damage, FL21) vs SE2 (evidence, #118). Recommendation: SE7.
4. **Tests:** IT placement has 0 current violations; it is picked for its silent false green. If the
   operator prefers present breakage, swap in IT2 (`FileToolHandlerS3IT`).
5. NGC4, SEAM1, NGB2 carry NO-REASON in the ledger; the G21 texts above supply reasons that need a yes.
