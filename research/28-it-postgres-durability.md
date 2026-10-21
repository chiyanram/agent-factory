# 28 — IT Postgres durability: the fsync=off that was lost

Context: agent-factory **#20** (gate speed). On the VM, the gate `make verify-full` takes 87–93 min. On the VM, aruvii-api ITs take ~19 min. On an M5 Max they take ~7–10 min. A 4 KB write+fsync on the VM takes 1.2 ms.

## Headline

```
TestConstants.POSTGRES_IMAGE
        │
new PostgreSQLContainer(image)   ── ctor: setCommand("postgres","-c","fsync=off")   (Testcontainers default)
        │
.withCommand("postgres","-c","max_connections=300")   ── REPLACES the whole command
        │
container runs with fsync=ON  ◄── BROKEN: every IT commit + every per-test TRUNCATE waits on the VM's slow fsync
```

The shared IT Postgres runs **with fsync on**. The Testcontainers default turns fsync off. Our `withCommand` call replaced that default to raise `max_connections`. It did not add it back. Hypothesis "every commit waits on fsync" is confirmed **by code**, not yet by a measurement.

## Facts

| # | Fact | Where |
|---|---|---|
| F1 | Shared IT Postgres: `new PostgreSQLContainer(TestConstants.POSTGRES_IMAGE)…withCommand("postgres", "-c", "max_connections=300")` | `aruvii-test-support/src/main/java/ai/aruvii/testsupport/AruviiTestcontainersInitializer.java:49-54` |
| F2 | Testcontainers 2.0.5 ctor sets `setCommand("postgres", "-c", FSYNC_OFF_OPTION)`, `FSYNC_OFF_OPTION = "fsync=off"` | `testcontainers-postgresql-2.0.5-sources.jar` `PostgreSQLContainer.java:43,58` |
| F3 | `withCommand(String...)` calls `setCommand(commandParts)`, which replaces the command (no merge) | `testcontainers-2.0.5-sources.jar` `GenericContainer.java:946-948,1146-1148` |
| F4 | So F1 runs Postgres with `fsync=on`, `synchronous_commit=on`, `full_page_writes=on` (server defaults) | F1+F2+F3 |
| F5 | No `withTmpFs`, no `synchronous_commit`, no `full_page_writes` anywhere in test support | grep over `aruvii-test-support`, `aruvii-*/src/integrationTest` |
| F6 | Image `pgvector/pgvector:0.8.6-pg18`; Redis `redis:8.10.2-alpine`; same tags as compose | `TestConstants.java:16-17`, `docker-compose.yml:30` |
| F7 | Containers are JVM singletons, started once by `Startables.deepStart(POSTGRES, REDIS)`; Ryuk reaps them; no `withReuse` | `AruviiTestcontainersInitializer.java:63-65` |
| F8 | `@EnableAruviiIT` = initializer + `@Import(AruviiTestClientConfig)` + `DatabaseResetExtension`, `ResettableExtension`, `RedisReachabilityCheck` | `EnableAruviiIT.java:27-29` |
| F9 | Reset **before every test method**: `SET session_replication_role='replica'`, then one `TRUNCATE TABLE <all public tables except flyway_schema_history> RESTART IDENTITY CASCADE`, then batch re-INSERT of 9 preserved seed tables | `AruviiTestReset.java:144-169`, `PRESERVE` at `:45-59` |
| F10 | Then `FLUSHDB` on Redis, every test | `AruviiTestReset.java:171-177` |
| F11 | Reset cost is already measured: INFO `db-reset cumulative: resets= total= mean=` every 25 resets | `AruviiTestReset.java:100-111` |
| F12 | Flyway runs once per container (first context to refresh migrates; later contexts see "up to date"), not per class. `spring.flyway.enabled=true` forced | `AruviiTestcontainersInitializer.java:91,100` |
| F13 | ITs serial: `maxParallelForks = 1`, `junit.jupiter.execution.parallel.enabled=false`, heap 2g | `build-logic/src/main/kotlin/aruvii.integration-test-conventions.gradle.kts:30-36` |
| F14 | ~23 distinct Spring contexts in aruvii-api (javadoc estimate); cache keys broken by `@MockitoBean` (13 files), `@TestPropertySource` (1), `@DynamicPropertySource` (2); `@DirtiesContext`: 0 | `AruviiTestcontainersInitializer.java:41-48`; grep `aruvii-api/src/integrationTest` |
| F15 | aruvii-api IT tree: 82 IT/Spec files, ~872 test methods (`@Test`/`@ParameterizedTest`/Spock features) | grep count |
| F16 | Two aruvii-api ITs start their **own** Postgres without `withCommand` — these keep fsync=off: `SetupControllerIT` (per-class `@Container`), `UiModelSwapE2EIT` (+ Redis + Ollama) | `SetupControllerIT.java:55-58`, `UiModelSwapE2EIT.java:130-131` |
| F17 | ~60 `CREATE TABLE` across migrations → each reset TRUNCATEs ~60 tables (new relfilenodes per table + index) | grep `aruvii-infra/.../db/migration` |
| F18 | Compose Postgres (smoke/deploy): no `command:`, named volume `postgres_data:/var/lib/postgresql`, PG18 PGDATA = `/var/lib/postgresql/18/docker` | `docker-compose.yml:29-55` |
| F19 | No diff vs `origin/master` in `aruvii-test-support`, `build-logic`, `docker-compose.yml` from this worktree | `git diff --stat origin/master` |
| F20 | No reference project under `.scratch/one-rulebook/refs/` configures Postgres fsync/tmpfs for tests | grep for `fsync=off`, `withTmpFs`, `synchronous_commit` |

## External guidance

| Source | Says |
|---|---|
| [Postgres docs — Non-Durable Settings](https://www.postgresql.org/docs/current/non-durability.html) | RAM-disk data dir; `fsync` off; `synchronous_commit` off; `full_page_writes` off; larger `max_wal_size`/`checkpoint_timeout`; unlogged tables. Risk: "only an abrupt operating system crash creates a risk of data loss". `synchronous_commit=off` risks "transaction loss (though not data corruption)". |
| Testcontainers PostgreSQL module (F2) | Ships `fsync=off` as the default command — i.e. the library authors consider it the test default. |
| [Vlad Mihalcea — ITs at warp speed with tmpfs](https://vladmihalcea.com/how-to-run-integration-tests-at-warp-speed-with-docker-and-tmpfs/) | tmpfs data dir for test DBs. |
| [rieske/dbtest](https://github.com/rieske/dbtest) | fsync off is the main win; tmpfs adds "a tiny bit more"; migrations-per-test is the bigger cost (we already migrate once — F12). |
| [GitLab issue 60435](https://gitlab.com/gitlab-org/gitlab-foss/-/issues/60435) | Turned off Postgres fsync to speed up CI. |
| [dev.to — optimize Postgres containers for testing](https://dev.to/babakks/optimize-postgres-containers-for-testing-re15-2ge3) | Pair `fsync=off` with `full_page_writes=off`. |

For a throwaway container the "OS crash" risk is irrelevant: on crash the container is discarded anyway.

## Candidate fixes

| # | Change | Expected effect | Risk | How to measure |
|---|---|---|---|---|
| C1 | **Restore the lost default.** `withCommand("postgres", "-c", "fsync=off", "-c", "max_connections=300")` at `AruviiTestcontainersInitializer.java:54` | Largest. Removes fsync from every commit and every per-test TRUNCATE (~60 new relfilenodes ×872 resets). On VM (1.2 ms/fsync) plausibly several minutes of the 19; on M5 small | ~None. Disposable container; it is the library default we overrode by accident | (1) In an IT: `SHOW fsync` → `off`. (2) Compare `db-reset cumulative … mean=` (F11) before/after on the VM. (3) Compare `integrationTest` task wall clock for aruvii-api on the VM, `FRESH=1` |
| C2 | Add `-c synchronous_commit=off -c full_page_writes=off` | Small extra on top of C1 (with fsync off, WAL flush is a `write()` not a disk wait). full_page_writes cuts WAL volume after each checkpoint | ~None for tests. A test asserting crash-durability does not exist | Same as C1, measured separately from C1 so each lever's share is known |
| C3 | `withTmpFs(Map.of("/var/lib/postgresql", "rw"))` — **PG18 path, not `/var/lib/postgresql/data`** (F18) | Removes all disk I/O (writes, unlinks on TRUNCATE). Helps on slow VM disk beyond fsync | RAM use = DB size (small, seeded DB; check VM RAM headroom). Wrong path (`…/data`) silently does nothing on PG18. Not supported on Windows Docker | `docker exec <pg> df /var/lib/postgresql` shows tmpfs; time as C1 |
| C4 | Optional: `-c max_wal_size=1GB -c checkpoint_timeout=1h` | Fewer checkpoints during the run | More WAL space (moot with tmpfs if RAM allows) | `pg_stat_checkpointer` counts before/after |
| C5 | Apply C1–C3 to the two private containers (F16) only if they matter | Tiny — they already keep fsync=off | Touches 2 ITs | Skip unless they show up in timing |
| C6 | Cut distinct Spring contexts (F14) — e.g. shared `@MockitoBean` sets via a common config | Each context costs a boot (seconds) + Flyway check; ~23 boots | Structural; rule says fakes over `@MockitoBean` anyway | Count `Started … in` lines in IT log; time per context |
| C7 | Cheaper reset: TRUNCATE only tables that have rows (query `pg_stat_user_tables.n_live_tup` or a dirty-table trigger) | Fewer relfilenode swaps per test; strongest when fsync is still on | Stats lag → stale rows leak between tests; more complex. Do **after** C1 and re-measure first | `db-reset mean=` (F11) |
| C8 | Parallel IT forks (lift `maxParallelForks=1`) | Biggest theoretical, but VM has few shared vCPUs; contention | ADR-0009 / F13 deliberate; Ryuk/Docker contention seen before | Out of scope here |

**Not to change:** `docker-compose.yml` Postgres (F18). It serves smoke/deploy and must stay production-like — no `command:` flags, named volume.

## Recommended order

1. C1 alone, measure on VM (F11 mean + task time).
2. C2 + C3 together, measure again.
3. Only then consider C6/C7.
