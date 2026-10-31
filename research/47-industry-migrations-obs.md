# 47 · Migrations and observability rules from industry sources (T4 #34)

Rules for chiyanram/skills `migrations/` and `obs/`, re-sourced from industry practice (operator, 2026-10-31,
[#34](https://github.com/chiyanram/agent-factory/issues/34#issuecomment-6538572227)). A rule enters only if ≥2
independent sources state it, and its "because" names a maintainability, performance or scaling failure. agent-platform
history is not a reason. The old ledger rows were candidates, re-checked against the sources.

Network: this session reached only GitHub. Official text was read from each project's own repository (PostgreSQL,
Flyway, squawk, OpenTelemetry, Micrometer, Prometheus, OWASP, …). Not reachable: the PostgreSQL wiki "Don't Do This",
martinfowler.com, the Liquibase docs, sre.google, slf4j.org. A clause whose only second source was one of these was
dropped (§3, §4 dropped lists).

## 1 · Approved rules (operator, 2026-10-31)

§1 holds the approved text; §2 and §3 keep the research wording, quotes and pairs. Every rule is ≤35 words. "borderline" = both sources from one organisation; kept by the operator.

| id | target file | rule |
|---|---|---|
| MG30 | migrations/postgres-design | Declare every point-in-time column `timestamptz`, never `timestamp`, because `timestamp` drops the UTC offset, so instants written from different zones compare and sort wrongly. |
| MG31 | migrations/postgres-design | Declare new string columns `text` with `CHECK (char_length(col) <= n)` for a business limit, never `varchar(n)` or `char(n)`, because changing a varchar limit locks the table while a CHECK is replaced `NOT VALID`. |
| MG32 | migrations/postgres-design | Write an explicit `ON DELETE CASCADE \| SET NULL \| RESTRICT` on every `REFERENCES`, because the silent default `NO ACTION` makes parent deletes fail in ways nobody designed for. |
| MG33 | migrations/postgres-design | For every foreign key, create an index whose leading column is the referencing column, because PostgreSQL creates none and each parent `DELETE` then scans the child table. |
| MG35 | migrations/postgres-design | Make every column of a `UNIQUE` constraint `NOT NULL`, or declare it `NULLS NOT DISTINCT`, because NULLs count as distinct, so duplicate rows containing NULL pass. |
| MG36 | migrations/postgres-design | Never declare `serial`, `integer` keys, `char(n)` or `json`; use `bigint GENERATED … AS IDENTITY` (or `uuid`), `text` and `jsonb`, because int keys overflow, char(n) pads, json lacks equality, and serial complicates permissions. |
| MG38 | migrations/postgres-design | Name every index and constraint with a fixed prefix (`pk_`, `fk_`, `uq_`, `ck_`, `idx_`), because later `VALIDATE`, `DROP` and `IF NOT EXISTS` must name it, and a generated name hits the wrong object. |
| MG5 | migrations/review | Start every migration that locks an existing table with `SET lock_timeout` and retry on timeout, because a queued `ACCESS EXCLUSIVE` request blocks every later query on that table. |
| MG41 | migrations/review | On an existing table, `CREATE`/`DROP INDEX` only `CONCURRENTLY`, alone in a non-transactional migration, after `DROP INDEX CONCURRENTLY IF EXISTS`, because plain builds block writes and failed ones leave INVALID indexes. |
| MGN1 | migrations/review | Add `UNIQUE` or `PRIMARY KEY` to an existing table as `CREATE UNIQUE INDEX CONCURRENTLY` then `ADD CONSTRAINT … USING INDEX`, because the inline form builds the index while blocking reads and writes. |
| MG45 | migrations/review | On an existing table, add `CHECK`/FK as `NOT VALID`, validate in a later migration, and reach `SET NOT NULL` via a validated `CHECK`, because a direct add scans the table under lock. |
| MG44 | migrations/review | Add a column to an existing table nullable or with a constant `DEFAULT`; never `NOT NULL` without one, nor a volatile default, because the first breaks old-code inserts and the second rewrites the table. |
| MG10 | migrations/review | Never `RENAME`, `DROP` or retype a column or table the deployed app uses; expand, dual-write, backfill, switch reads, then drop next release, because running app versions still query the old shape. |
| MG22 | migrations/review | Run backfills in their own migration or job, never beside DDL, as `WHERE`-bounded batches each committed alone, because a whole-table statement holds locks and one long transaction for its whole run. |
| MG1 | migrations/review | Never edit, rename or delete a merged or applied versioned migration; write a new one, because its checksum then fails `validate` and environments that ran the old text diverge. |
| LG1 | obs/logging | Log a constant message with context as key-value fields (MDC or `addKeyValue`): trace id plus business ids, never ids pasted into text, because otherwise one request cannot be rebuilt from interleaved lines. |
| LG2 | obs/logging | Log a failure once, where it is handled; code that rethrows does not also log, because logging before a rethrow writes one failure once per layer and inflates error counts. *(borderline)* |
| LG3 | obs/logging | Pass the exception as the last argument, never `e.getMessage()` or `printStackTrace()`, because a message-only log loses the type and stack, and `printStackTrace` bypasses the logger. |
| LG4 | obs/logging | Never log passwords, tokens, session ids, auth or cookie headers, keys, connection strings, card data or sensitive PII; log the id and allowlisted fields, never whole bodies, because logs leak data. |
| LG5 | obs/logging | Emit production logs with a structured (JSON) encoder; on a plain pattern layout, strip CR/LF from untrusted values, exception messages included, because a newline in input forges a log line. |
| LG6 | obs/logging | Use a constant template with `{}` placeholders, never concatenation; pass an expensive argument as a `Supplier` or behind `isXEnabled()`, because concatenation runs while the level is off and lets input rewrite the template. |
| LG8 | obs/logging | Create the logger with `LoggerFactory.getLogger(DeclaringClass.class)`, never a string or another class, because levels are configured by class-name hierarchy and a misnamed logger cannot be tuned. |
| LGN1 | obs/logging | Write logs to stdout; add no file appender, rotation or log path in app config, because the platform owns routing and storage, and a file in a container is lost or fills the disk. |
| MX1 | obs/metrics | Tag a meter only with bounded values (route template, enum, exception class, `NOT_FOUND`), never an id, email, raw URL or message, because each new value is a new time series. |
| MX2 | obs/metrics | Time durations with `Timer` (`LongTaskTimer` for in-flight work), count only untimed events, gauge only a strongly held object, because a summary mis-scales time and a weak gauge reports NaN. |
| MXN1 | obs/metrics | Publish latency as a percentile histogram, never only an average or client-side `publishPercentiles()`, because averages hide the slow tail and client percentiles can't be aggregated across instances. |
| MX3 | obs/metrics | Name meters dot-separated lower case with the outcome as a tag; never `*.success`/`*.failed` pairs or generated names, because split meters make the error ratio unqueryable. |
| MXN2 | obs/metrics | Put no unit in a meter name; record a `Timer` with a `Duration`, set `baseUnit` on summaries, because the registry appends base units and a hand-written `ms` mixes units. |
| MX5 | obs/metrics | Give every endpoint and dependency rate, errors and duration (RED); every pool and queue utilisation, saturation and errors (USE), because overload otherwise stays invisible until users report it. |
| MXN3 | obs/metrics | Give a scheduled or batch job a last-success epoch-seconds gauge plus a `LongTaskTimer` while it runs, because a stalled job emits nothing an alert can see. |
| TR1 | obs/tracing | Carry trace context with the propagator (message headers, a context-propagating executor), never a hand-copied `traceId` field, because consumer spans then can't join the producer's trace. |
| TR2 | obs/tracing | Instrument through the API or facade (`ObservationRegistry`, `Tracer`), never SDK types, and never null-check tracing, because the API is a no-op without a backend and SDK types tie code to a vendor. |
| TR3 | obs/tracing | Put no secrets, tokens or sensitive PII in span names, attributes, events or status text (ids are fine), because span data is exported and stored like logs. |
| TRN1 | obs/tracing | Name a span for a class of operation (`orders.place`, `GET /orders/{id}`), with ids in attributes, never in the name, because per-id names explode cardinality. |
| TRN2 | obs/tracing | End every span you start: `observe(() -> …)`, or `stop()` in `finally` with the scope in try-with-resources, because an unended span leaks memory and never reaches the backend. |
| TRN3 | obs/tracing | Mark a span as an error only when its operation failed, once, where handled; never a handled or retried failure or a server-side 4xx, because false errors inflate error alerts. *(borderline)* |
| TR5 | obs/tracing | Use a parent-based sampler and set the root ratio in config per environment, never in code, because independent per-service ratios leave traces with missing spans. |

Also approved:
- **obs/levels**: the level table in §3.2, with the 400/401 row as "never ERROR; INFO or WARN is the project's choice"
  (option a). The project's choice goes in its own docs.
- **Dropped by the operator:** MG18 (no source says "never `outOfOrder`").
- **Dropped for want of a second independent source:** MG13, MG16, MG17, MG20, MG21, MG34, MG12, MG15, MG19, MG23,
  `timetz`/`money`/timestamp precision, a `statement_timeout` value, LG7, LG9 (folded into LG1), LG10, MX4, MX6, MX7.
  MX8 and MX9 are project items. TR4/TR4a stay on hold for agent-platform #55.

## 2 · Migrations: sources, quotes and pairs

### 1 · Sources

| Key | Source | URL |
|---|---|---|
| PG-ALT | PostgreSQL docs, ALTER TABLE | https://www.postgresql.org/docs/current/sql-altertable.html |
| PG-IDX | PostgreSQL docs, CREATE INDEX | https://www.postgresql.org/docs/current/sql-createindex.html |
| PG-DDL | PostgreSQL docs, 5.5 Constraints | https://www.postgresql.org/docs/current/ddl-constraints.html |
| PG-CFG | PostgreSQL docs, client config (lock_timeout) | https://www.postgresql.org/docs/current/runtime-config-client.html |
| PG-TYP | PostgreSQL docs, 8.3 character / 8.1 numeric types | https://www.postgresql.org/docs/current/datatype-character.html |
| PG-JSON | PostgreSQL docs, 8.14 JSON types | https://www.postgresql.org/docs/current/datatype-json.html |
| SM | ankane/strong_migrations README | https://github.com/ankane/strong_migrations |
| SQ-* | Squawk linter rule pages (`SQ-<rule>`) and "Applying migrations safely" (`SQ-safe`) | https://squawkhq.com/docs/rules |
| GL-STY | GitLab, Migration style guide | https://docs.gitlab.com/development/migration_style_guide/ |
| GL-DT | GitLab, Avoiding downtime in migrations | https://docs.gitlab.com/development/database/avoiding_downtime_in_migrations/ |
| GL-FK | GitLab, Foreign keys and associations | https://docs.gitlab.com/development/database/foreign_keys/ |
| GL-TXT | GitLab, Strings and the text data type | https://docs.gitlab.com/development/database/strings_and_the_text_data_type/ |
| GL-IDX | GitLab, Adding database indexes | https://docs.gitlab.com/development/database/adding_database_indexes/ |
| GL-BBM | GitLab, Batched background migrations | https://docs.gitlab.com/development/database/batched_background_migrations/ |
| GL-NAME | GitLab, Constraints naming conventions | https://docs.gitlab.com/development/database/constraint_naming_convention/ |
| FW-MIG | Flyway, Migrations concept (versioned/repeatable, checksums, transactions) | https://documentation.red-gate.com/fd/migrations-271585107.html |
| FW-VAL | Flyway, Validate command | https://documentation.red-gate.com/fd/validate-277578886.html |
| FW-OOO | Flyway, `flyway.outOfOrder` | https://documentation.red-gate.com/fd/flyway-out-of-order-setting-277578921.html |
| FW-TL | Flyway, `flyway.postgresql.transactional.lock` | https://documentation.red-gate.com/fd/flyway-postgresql-transactional-lock-setting-277579114.html |
| FW-PG | Flyway, PostgreSQL database driver page ("Lock Types") | https://documentation.red-gate.com/fd/postgresql-database-277579325.html |
| FW-RG | Flyway/Redgate code-review rules (SQLFluff library) | https://documentation.red-gate.com/fd/redgate-sqlfluff-rules-library-277578860.html |
| RAILS | Rails Guides, Active Record Migrations | https://guides.rubyonrails.org/active_record_migrations.html |
| DJ | Django docs, Migrations | https://docs.djangoproject.com/en/stable/topics/migrations/ |

Independence: FW-* count as one vendor, as do GL-* and SQ-*. Every rule below has at least two different vendors.

---

### 2 · `postgres-design` (types, constraints, keys, indexes)

#### MG30 · REWORD
**Rule:** Declare every point-in-time column `timestamptz`, never `timestamp` / `timestamp without time zone`, because `timestamp` drops the UTC offset, so instants written from different zones compare and sort wrongly.
- SQ-prefer-timestamptz: "When Postgres stores a datetime in a `timestamp` field, Postgres drops the UTC offset… even though they are eight hours apart in time"
- GL-STY: "one should use the following methods to store timestamps with time zones… existing timestamps don't suddenly use a different time zone when the system's time zone changes"
- Verdict: REWORD. The "no precision spec" clause is dropped: its only source is the PG wiki, which could not be read here.
- Misreadable: no

#### MG31 · REWORD
**Rule:** Declare new string columns `text` with `CHECK (char_length(col) <= n)` for a business limit, never `varchar(n)` or `char(n)`, because changing a varchar limit locks the table while a CHECK is replaced `NOT VALID`.
- PG-TYP: "There is no performance difference among these three types… character(n) is usually the slowest of the three"
- SQ-prefer-text-field: "Changing the size of a `varchar` field requires an `ACCESS EXCLUSIVE` lock… Use a text field with a `CHECK CONSTRAINT` makes it easier to change the max length"
- GL-TXT: "if you want to update their limit, you have to run an `ALTER TABLE`… texts are more or less equivalent to strings… adding a limit… does not require the very costly `EXCLUSIVE LOCK`"
- Verdict: REWORD. The failure is now named. Existing `varchar` columns are out of scope because the rule says "new". Converting them is a type change (MG10), although varchar→text is binary-coercible.
- Misreadable: yes (pair below)

#### MG32 · KEEP
**Rule:** Write an explicit `ON DELETE CASCADE | SET NULL | RESTRICT` on every `REFERENCES`, because the silent default `NO ACTION` makes parent deletes fail in ways nobody designed for.
- PG-DDL: "The default `ON DELETE` action is `ON DELETE NO ACTION`" (5.5.5, with RESTRICT/CASCADE/SET NULL described as the choices)
- GL-FK: "Every foreign key must define an `ON DELETE` clause"
- Verdict: KEEP. The second source is now external (GitLab).
- Misreadable: no

#### MG33 · KEEP
**Rule:** For every foreign key, create an index whose leading column is the referencing column, because PostgreSQL creates none and each parent `DELETE`/key `UPDATE` then scans the child table.
- PG-DDL: "a DELETE of a row from the referenced table… will require a scan of the referencing table… the declaration of a foreign key constraint does not automatically create an index on the referencing columns"
- GL-FK: "Without an index on the foreign key, it forces PostgreSQL to do a full table scan every time a record is deleted from the referenced table… OK to have a composite index… so long as the foreign key is in the first position"
- Verdict: KEEP. "leading column" is added so that a composite index counts.
- Misreadable: no

#### MG35 · REWORD
**Rule:** Make every column of a `UNIQUE` constraint or unique index `NOT NULL`, or declare it `NULLS NOT DISTINCT` (PG 15+), because NULLs count as distinct by default, so duplicate rows containing NULL pass.
- PG-DDL: "By default, two null values are not considered equal… it is possible to store duplicate rows that contain a null value in at least one of the constrained columns. This behavior can be changed by adding the clause NULLS NOT DISTINCT"
- GL-IDX: "By default, PostgreSQL treats `NULL` values as distinct in unique indexes… Use `nulls_not_distinct: true` when you need to enforce full uniqueness"
- Verdict: REWORD. `NULLS NOT DISTINCT` is added as the allowed alternative.
- Misreadable: yes (pair below)

#### MG36 · REWORD (absorbs MG37)
**Rule:** Never declare `serial`, `integer` keys, `char(n)` or `json`. Use `bigint GENERATED … AS IDENTITY` (or `uuid`), `text` and `jsonb`, because int keys overflow, char(n) pads, json lacks equality, and serial complicates permissions.
- SQ-prefer-identity: "Serial types make permissions and schema management difficult. Identity columns are standard SQL"
- SQ-prefer-bigint-over-int: "Using 32 bit integer fields can result in hitting the max int limit"; GL-DT: "To prevent the overflow risk for some tables with `integer` primary key (PK), we have to migrate their PK to `bigint`"
- PG-TYP: "character(n) is usually the slowest… text or character varying should be used instead"; SQ-ban-char-field: "Using `character` is likely a mistake"
- PG-JSON: "most applications should prefer to store JSON data as jsonb"; SM: "there's no equality operator for the `json` column type… Use `jsonb` instead"
- Verdict: REWORD. MG37 (jsonb) is merged into this rule. Dropped clauses: `timetz` and `money` (PG docs alone; the PG wiki was unreadable), the GIN-index clause ("a filtered path" cannot be decided by grep), and "ids are uuid" (a project choice, so identity *or* uuid is allowed).
- Misreadable: no

#### MG38 · REWORD
**Rule:** Name every index and constraint in the DDL with a fixed prefix convention (e.g. `pk_`, `fk_`, `uq_`, `ck_`, `idx_` + table + columns), because later `VALIDATE`, `DROP` and `IF NOT EXISTS` must name it, and a guessed generated name hits the wrong object.
- GL-NAME: "it is important to follow strict naming conventions to improve consistency and discoverability" (pk_/fk_/index_/unique_/check_ table)
- GL-STY: "it is required to specify the name of the index that is being removed… Explicitly specifying the name is important to ensure the correct index is removed"
- PG-IDX: "Index name is required when IF NOT EXISTS is specified" (VALIDATE CONSTRAINT in PG-ALT also takes `constraint_name`)
- Verdict: REWORD. This was "project decision?" and now has external sources. The because now names the failure.
- Misreadable: no

---

### 3 · `review` (safe change process: locking, online changes, versioning, verification)

#### MG5 · NEW here (was placed in a directory AGENTS file)
**Rule:** Begin every migration that alters or locks an existing table with `SET LOCAL lock_timeout = '…s'` (plain `SET` when non-transactional) and retry on timeout, because a queued `ACCESS EXCLUSIVE` request blocks every later query on that table.
- PG-ALT: "An ACCESS EXCLUSIVE lock is acquired unless explicitly noted"; PG-CFG: "Abort any statement that waits longer than the specified amount of time while attempting to acquire a lock"
- SQ-safe: "You must configure a `lock_timeout`… While the statement waits for a lock, all other reads and writes sent after will wait for this statement too, bringing your application to a halt"
- SM: "It's extremely important to set a short lock timeout for migrations. This way, if a migration can't acquire a lock in a timely manner, other statements won't be stuck behind it"
- GL-STY: "The lock request is waiting in a queue and it may also block other queries… `SET LOCAL lock_timeout to '100ms'`"
- Verdict: NEW (re-sourced MG5). `statement_timeout` is left out on purpose because the sources conflict: SQ-safe recommends a short one ("5s"), while SM wants "a long statement timeout so migrations can run for a while".
- Misreadable: yes (pair below)

#### MG41 · REWORD (absorbs MG42, MG43)
**Rule:** On an existing table, `CREATE`/`DROP INDEX` only `CONCURRENTLY`, alone in a non-transactional migration (Flyway: `postgresql.transactional.lock=false`), after `DROP INDEX CONCURRENTLY IF EXISTS`, because plain builds block writes and failed ones leave INVALID indexes.
- PG-IDX: "a standard index build locks out writes (but not reads)"; "a regular CREATE INDEX command can be performed within a transaction block, but CREATE INDEX CONCURRENTLY cannot"; "leave behind an 'invalid' index… The recommended recovery method… is to drop the index and try again"; IF NOT EXISTS: "no guarantee that the existing index is anything like the one that would have been created"
- SQ-require-concurrent-index-creation: "Ensure all index creations use the `CONCURRENTLY` option. This rule ignores indexes added to tables created in the same transaction"; SQ-ban-concurrent-index-creation-in-transaction: "ensure that the `CREATE INDEX` command is the only command in the migration"; SQ-require-concurrent-index-deletion: "A normal `DROP INDEX` acquires an `ACCESS EXCLUSIVE` lock"
- SM: "In Postgres, adding an index non-concurrently blocks writes"; GL-STY: "`CREATE INDEX CONCURRENTLY` must be performed outside a transaction"
- FW-TL: "This should be set to `false` for statements such as `CREATE INDEX CONCURRENTLY`"; FW-PG: "transactional locks can be replaced with session-level locks by setting `flyway.postgresql.transactional.lock=false`"
- Verdict: REWORD. MG41, the generic part of MG42 (the Flyway setting) and MG43 (drop the invalid index first) are merged. MG42's project-history clauses (the invented marker and the `.conf` sidecar) are dropped. An index created in the same migration as its `CREATE TABLE` stays plain.
- Misreadable: yes (pair below)

#### MGN1 · NEW
**Rule:** Add `UNIQUE` or `PRIMARY KEY` to an existing table as `CREATE UNIQUE INDEX CONCURRENTLY` then `ADD CONSTRAINT … USING INDEX`, never inline `ADD CONSTRAINT … UNIQUE/PRIMARY KEY`, because the inline form builds the index while blocking reads and writes.
- SQ-disallowed-unique-constraint: "Adding a `UNIQUE` constraint requires an `ACCESS EXCLUSIVE` lock which blocks reads and writes… Instead create an index `CONCURRENTLY` and create the `CONSTRAINT` `USING` the index"
- SQ-adding-serial-primary-key-field: "create the `CONSTRAINT` `USING` an index"
- SM: "In Postgres, adding a unique constraint creates a unique index, which blocks reads and writes"
- Verdict: NEW. It replaces part of MG15. MG15's "ship the duplicate query" step is dropped: no second source. A failed unique build is already handled by MG41.
- Misreadable: no

#### MG45 · REWORD (absorbs MG47)
**Rule:** On an existing table, add `CHECK`/`FOREIGN KEY` as `NOT VALID` and run `VALIDATE CONSTRAINT` in a later migration. Reach `SET NOT NULL` through a validated `CHECK (col IS NOT NULL)`, because a direct add scans the table while blocking writes.
- PG-ALT: "With NOT VALID, the ADD CONSTRAINT command does not scan the table… validation acquires only a SHARE UPDATE EXCLUSIVE lock"; "if a valid CHECK constraint exists… which proves no NULL can exist, then the table scan is skipped"
- SQ-constraint-missing-not-valid: "Using `NOT VALID` with a later `VALIDATE CONSTRAINT` call prevents the table scan"; SQ-adding-foreign-key-constraint: "add the constraint as `NOT VALID` in one transaction, then `VALIDATE CONSTRAINT` in another"; SQ-adding-not-nullable-field: "Use a check constraint instead of setting a column as `NOT NULL`"
- SM: "Adding a foreign key blocks writes on both tables"; "setting `NOT NULL` on an existing column blocks reads and writes while every row is checked… add a check constraint… validate it separately"
- GL-FK: "Add a `NOT VALID` FK constraint… Validate the FK constraint"
- Verdict: REWORD. MG45 and MG47 are merged. "Later migration" matters because VALIDATE in the same transaction keeps the ADD's lock.
- Misreadable: yes (pair below)

#### MG44 · REWORD
**Rule:** Add a column to an existing table as nullable, or `NOT NULL` with a constant (non-volatile) `DEFAULT`. Never add it `NOT NULL` without a default, nor with a volatile default, because the first fails on populated tables and old-code `INSERT`s, and the second rewrites the table.
- PG-ALT: "When a column is added… and a non-volatile DEFAULT is specified… In neither case is a rewrite of the table required. Adding a column with a volatile DEFAULT (e.g., clock_timestamp())… will cause the entire table and its indexes to be rewritten"
- SQ-adding-required-field: "This will fail immediately upon running for any populated table. Furthermore, old application code that is unaware of this column will fail to `INSERT`"; SQ-adding-field-with-default: "Adding a field with a `VOLATILE` `DEFAULT` will cause a table rewrite"
- SM: "Adding a column with a volatile default value to an existing table causes the entire table to be rewritten… add the column without a default value, then change the default"
- Verdict: REWORD. The old-code-INSERT failure and the nullable alternative are added.
- Misreadable: yes (`now()` is non-volatile; `gen_random_uuid()`/`clock_timestamp()` are volatile; pair below)

#### MG10 · REWORD (absorbs MG11, MG24, MG46)
**Rule:** Never `RENAME`, `DROP` or `ALTER COLUMN … TYPE` a column or table the deployed app uses. Add the new one, dual-write, backfill, switch reads, then drop in a later release, because running app versions still query the old shape.
- GL-DT: "Removing columns is tricky because running GitLab processes expect these columns to exist… three steps in three releases"; "Renaming columns the standard way requires downtime, as an application might continue to use the old column names"
- SM: "Renaming a column that's in use will cause errors in your application"; for type change: "create a new column, write to both, backfill, move reads, stop writing to the old column, then drop it"; "Changing the type of a column causes the entire table to be rewritten"
- SQ-renaming-table: "During deployments, you can have multiple versions of your app running at the same time"; SQ-ban-drop-column: "Update your application code to no longer read or write the column… delete the column once queries no longer select or modify the column"; SQ-changing-column-type: "blocks reads and writes while the table is rewritten"
- Verdict: REWORD. MG10 (expand → contract), MG11 (dual-write, read new), MG24 (destructive step later and alone) and MG46 (type change rewrites) are merged. Fowler's "Parallel Change" names the same pattern, but it could not be fetched here, so it is not cited.
- Misreadable: yes (pair below)

#### MG22 · REWORD (absorbs MG14 and the schema/data split)
**Rule:** Put data backfills in their own migration or job, never beside DDL. Write each `UPDATE`/`DELETE` with a `WHERE` on a bounded key range per committed batch, because a whole-table statement holds locks and one long transaction for its entire run.
- SM: "backfilling in the same transaction that alters a table keeps the table locked for the duration of the backfill… There are three keys to backfilling safely: batching, throttling, and running it outside a transaction"
- GL-STY: "when you insert, update, or delete (DML) a large amount of data, you should perform them in batches"; GL-BBM: "Don't use batched background migrations to perform schema migrations"
- DJ: "Migrations that alter data… are best written as separate migrations, sitting alongside your schema migrations"
- FW-RG RG09: "An UPDATE without a WHERE clause will modify every row in the table"; RG06: "A DELETE without a WHERE clause will delete every row"
- Verdict: REWORD. MG22 (batch), MG14 (WHERE on every UPDATE/DELETE) and the new "never mix schema and data" rule are merged. The old "unless the header names the table small" escape is dropped because no source gives a size cutoff in a form you can grep for.
- Misreadable: yes (pair below)

#### MG1 · NEW here (was placed in a directory AGENTS file)
**Rule:** Never edit, rename or delete a versioned migration once it is merged or applied anywhere. Write a new forward migration, because the stored checksum then fails `validate` and environments that already ran the old text diverge.
- FW-MIG: "The checksum is there to detect accidental changes"; FW-VAL: "Validation fails if differences in migration names, types or checksums are found"
- RAILS: "editing existing migrations that have been already committed to source control is not a good idea… cause major headaches if the existing version of the migration has already been run on production machines. Instead, you should write a new migration"
- Verdict: NEW in this file (re-sourced from external docs only)
- Misreadable: no

#### MG18 · REWORD
**Rule:** Resolve a migration version collision by renumbering the unmerged migration above the highest version on the main branch. Never enable `outOfOrder`, because environments then apply the same versions in different orders and their schemas diverge.
- FW-OOO: Default "`false`"; "If you already have versions `1.0` and `3.0` applied, and now a version `2.0` is found, it will be applied too instead of being ignored"
- DJ: "two migrations with the same number… it's possible to detect when there's two new migrations… that aren't ordered… it will offer to automatically linearize the two migrations"
- Verdict: REWORD, flagged weak. Both sources describe the mechanism (outOfOrder applies late versions; collisions get linearized). Neither says outright "never enable outOfOrder". The because is inferred from FW-OOO's example. Drop it if the reviewer wants a source that says it verbatim.
- Misreadable: no

---

### 4 · Other / dropped

| id | Verdict | Why |
|---|---|---|
| MG17 (`R__` idempotent, no DELETE/TRUNCATE) | DROP | Flyway alone ("your responsibility to ensure the same repeatable migration can be applied multiple times"). SQ-prefer-robust-stmts covers retrying a partially failed *versioned* migration, not repeatables. That leaves one vendor. |
| MG20 (lead never auto-dismisses a finding) | DROP | This is a review-process rule for agents. No industry migration source states it. |
| MG21 (context-load test ≠ migration verification) | DROP | Only source was an agent skill. No external second source. |
| MG34 (CHECK on nullable column) | DROP | PG-DDL alone ("satisfied if the check expression evaluates to true or the null value"). No second source found. |
| MG13 / MG16 (default meaning for old rows / changed default) | DROP | GL-DT alone (stale schema caches write the wrong default). |
| MG12 (count query before narrowing), MG15 (duplicate query before UNIQUE), MG19 (test from V(n-1)), MG23 (forward-only) | DROP | Single source each. On MG23 the sources conflict: Rails and GitLab expect reversible `down` migrations, and Flyway undo is optional. |
| `timetz`, `money`, timestamp precision | DROP | PG docs alone (the `numeric` docs say "especially recommended for storing monetary amounts"). The second source would be the PG wiki "Don't Do This", which was unreachable. Re-check once wiki.postgresql.org is allowed. |
| `statement_timeout` value | DROP | The sources conflict: SQ-safe "5s" versus SM "long statement timeout". |
| CREATE TABLE without PRIMARY KEY | not added | FW-RG RX013 alone ("could lead to performance problems"). |

---

### 5 · Good / Bad pairs (misreadable rules)

#### MG31 · text + CHECK
**Bad**
```sql
CREATE TABLE customers (
  id    bigint GENERATED ALWAYS AS IDENTITY,
  email varchar(120) NOT NULL,
  CONSTRAINT pk_customers PRIMARY KEY (id)
);
```
**Good**
```sql
CREATE TABLE customers (
  id    bigint GENERATED ALWAYS AS IDENTITY,
  email text NOT NULL,
  CONSTRAINT pk_customers PRIMARY KEY (id),
  CONSTRAINT ck_customers_email_length CHECK (char_length(email) <= 120)
);
```

#### MG35 · UNIQUE on a nullable column
**Bad**: two payments for one customer with `external_ref` NULL both pass.
```sql
SET LOCAL lock_timeout = '2s';
CREATE TABLE payments (
  id           bigint GENERATED ALWAYS AS IDENTITY,
  customer_id  bigint NOT NULL,
  external_ref text,
  CONSTRAINT pk_payments PRIMARY KEY (id),
  CONSTRAINT fk_payments_customer FOREIGN KEY (customer_id)
    REFERENCES customers (id) ON DELETE RESTRICT,
  CONSTRAINT uq_payments_customer_ref UNIQUE (customer_id, external_ref)
);
```
**Good**. When one NULL per customer is meant, keep it nullable and write `UNIQUE NULLS NOT DISTINCT` (PG 15+).
```sql
SET LOCAL lock_timeout = '2s';
CREATE TABLE payments (
  id           bigint GENERATED ALWAYS AS IDENTITY,
  customer_id  bigint NOT NULL,
  external_ref text NOT NULL,
  CONSTRAINT pk_payments PRIMARY KEY (id),
  CONSTRAINT fk_payments_customer FOREIGN KEY (customer_id)
    REFERENCES customers (id) ON DELETE RESTRICT,
  CONSTRAINT uq_payments_customer_ref UNIQUE (customer_id, external_ref)
);
```
Audit: both pairs are `CREATE TABLE`; MG35's add `lock_timeout` because the foreign key locks `customers` (MG5).

#### MG5 · A lock timeout before a lock on a live table
**Bad**
```sql
ALTER TABLE orders ADD COLUMN note text;
```
**Good**
```sql
SET LOCAL lock_timeout = '2s';
ALTER TABLE orders ADD COLUMN note text;
```

#### MG10 · Rename through expand and contract
**Bad**
```sql
SET LOCAL lock_timeout = '2s';
ALTER TABLE customers RENAME COLUMN name TO full_name;
```
**Good**
```sql
-- Release N   (V30): expand
SET LOCAL lock_timeout = '2s';
ALTER TABLE customers ADD COLUMN full_name text;
-- Release N   app: writes name and full_name, reads full_name, falls back to name
-- Release N   (V31, data job): batched backfill full_name from name (MG22)
-- Release N+1 app: reads and writes full_name only
-- Release N+2 (V40): contract
SET LOCAL lock_timeout = '2s';
ALTER TABLE customers DROP COLUMN name;
```

#### MG41 · A concurrent index in its own migration
**Bad**
```sql
SET LOCAL lock_timeout = '2s';
CREATE INDEX idx_orders_customer_id ON orders (customer_id);
```
**Good**
```sql
-- its own migration; Flyway runs a CONCURRENTLY script outside a transaction
-- (set flyway.postgresql.transactional.lock=false once, in the Flyway config)
SET lock_timeout = '2s';
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_customer_id;
CREATE INDEX CONCURRENTLY idx_orders_customer_id ON orders (customer_id);
```

#### MG45 · `NOT VALID`, then validate in a later migration
**Bad**
```sql
-- V19, its own migration: CREATE INDEX CONCURRENTLY idx_invoices_order_id ON invoices (order_id)
SET LOCAL lock_timeout = '2s';
ALTER TABLE invoices
  ADD CONSTRAINT fk_invoices_order_id FOREIGN KEY (order_id)
  REFERENCES orders (id) ON DELETE RESTRICT;
ALTER TABLE invoices ALTER COLUMN order_id SET NOT NULL;
```
**Good**
```sql
-- V19, its own migration: CREATE INDEX CONCURRENTLY idx_invoices_order_id ON invoices (order_id)
-- V20
SET LOCAL lock_timeout = '2s';
ALTER TABLE invoices
  ADD CONSTRAINT fk_invoices_order_id FOREIGN KEY (order_id)
  REFERENCES orders (id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE invoices
  ADD CONSTRAINT ck_invoices_order_id_nn CHECK (order_id IS NOT NULL) NOT VALID;
-- V21 (later migration)
SET LOCAL lock_timeout = '2s';
ALTER TABLE invoices VALIDATE CONSTRAINT fk_invoices_order_id;
ALTER TABLE invoices VALIDATE CONSTRAINT ck_invoices_order_id_nn;
ALTER TABLE invoices ALTER COLUMN order_id SET NOT NULL;
ALTER TABLE invoices DROP CONSTRAINT ck_invoices_order_id_nn;
```
#### MG44 · A new column on a populated table
**Bad**
```sql
SET LOCAL lock_timeout = '2s';
ALTER TABLE payments ADD COLUMN currency text NOT NULL;
ALTER TABLE payments ADD COLUMN token uuid NOT NULL DEFAULT gen_random_uuid();
```
**Good**
```sql
SET LOCAL lock_timeout = '2s';
ALTER TABLE payments ADD COLUMN currency text NOT NULL DEFAULT 'EUR';
ALTER TABLE payments ADD COLUMN captured_at timestamptz;
```
#### MG22 · A batched backfill, apart from the DDL
**Bad**
```sql
SET LOCAL lock_timeout = '2s';
ALTER TABLE orders ADD COLUMN total_cents bigint;
UPDATE orders SET total_cents = (total * 100)::bigint;
```
**Good**
```sql
-- DDL in V50; this file only DML. The job runs it once per key range, commits each,
-- and advances :from_id by 10000 until :from_id > max(id)
UPDATE orders
SET    total_cents = (total * 100)::bigint
WHERE  id >= :from_id AND id < :from_id + 10000
  AND  total_cents IS NULL;
```

Audit 2026-10-31: every statement on an existing table starts with `lock_timeout` (MG5); MG45 pairs index the FK
first (MG33); MG41 and MG22 comments corrected in review round 1. The skills reference copies these blocks.

## 3 · Observability: sources, quotes and pairs

### 1 · Sources

| Key | Source | URL (canonical; fetched from repo path in brackets) |
|---|---|---|
| OWASP-LOG | OWASP Logging Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html [OWASP/CheatSheetSeries cheatsheets/Logging_Cheat_Sheet.md] |
| OWASP-VOCAB | OWASP Application Logging Vocabulary Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Logging_Vocabulary_Cheat_Sheet.html |
| 12F | Twelve-Factor App, XI. Logs | https://12factor.net/logs [heroku/12factor content/en/logs.md] |
| K8S-LOG | Kubernetes docs, Logging Architecture | https://kubernetes.io/docs/concepts/cluster-administration/logging/ |
| SLF4J-FAQ | SLF4J FAQ | https://www.slf4j.org/faq.html [qos-ch/slf4j-site src/site/pages/faq.html] |
| LOG4J-API | Log4j 2 manual, API + best practices | https://logging.apache.org/log4j/2.x/manual/api.html [apache/logging-log4j2 2.x antora partials api-best-practice-*.adoc] |
| LOG4J-LEVEL | Log4j 2 `Level` javadoc | https://logging.apache.org/log4j/2.x/javadoc/log4j-api/org/apache/logging/log4j/Level.html |
| LOG4J-SEC | Apache Logging Services security FAQ, CRLF injection | https://logging.apache.org/security/faq.html#crlf-injection |
| SB-LOG | Spring Boot reference, Logging (structured logging) | https://docs.spring.io/spring-boot/reference/features/logging.html |
| SB-TRACE | Spring Boot reference, Tracing | https://docs.spring.io/spring-boot/reference/actuator/tracing.html |
| OTEL-LOGS | OpenTelemetry Logs Data Model (severity, TraceId) | https://opentelemetry.io/docs/specs/otel/logs/data-model/ |
| OTEL-EXC-LOG | OTel semantic conventions, exceptions in logs (severity guidance) | https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-logs/ |
| OTEL-ERR | OTel semantic conventions, Recording errors | https://opentelemetry.io/docs/specs/semconv/general/recording-errors/ |
| OTEL-HTTP | OTel semantic conventions, HTTP spans | https://opentelemetry.io/docs/specs/semconv/http/http-spans/ |
| OTEL-MSG | OTel semantic conventions, Messaging spans (context propagation) | https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/ |
| OTEL-SEMMX | OTel semantic conventions, Metrics (units) | https://opentelemetry.io/docs/specs/semconv/general/metrics/ |
| OTEL-TRACE | OTel specification, Trace API | https://opentelemetry.io/docs/specs/otel/trace/api/ |
| OTEL-SDK | OTel specification, Trace SDK (sampling) | https://opentelemetry.io/docs/specs/otel/trace/sdk/ |
| OTEL-CTX | OTel specification, Propagators API | https://opentelemetry.io/docs/specs/otel/context/api-propagators/ |
| OTEL-LIB | OTel specification, Library guidelines | https://opentelemetry.io/docs/specs/otel/library-guidelines/ |
| MM-NAME | Micrometer, Naming Meters | https://docs.micrometer.io/micrometer/reference/concepts/naming.html |
| MM-TIMER | Micrometer, Timers | https://docs.micrometer.io/micrometer/reference/concepts/timers.html |
| MM-COUNTER | Micrometer, Counters | https://docs.micrometer.io/micrometer/reference/concepts/counters.html |
| MM-GAUGE | Micrometer, Gauges | https://docs.micrometer.io/micrometer/reference/concepts/gauges.html |
| MM-LTT | Micrometer, Long Task Timers | https://docs.micrometer.io/micrometer/reference/concepts/long-task-timers.html |
| MM-HIST | Micrometer, Histograms and Percentiles | https://docs.micrometer.io/micrometer/reference/concepts/histogram-quantiles.html |
| MM-OBS | Micrometer Observation, Introduction + Components | https://docs.micrometer.io/micrometer/reference/observation/introduction.html |
| MM-TRACING | Micrometer Tracing, index + API | https://docs.micrometer.io/tracing/reference/ |
| PROM-NAME | Prometheus, Metric and label naming | https://prometheus.io/docs/practices/naming/ [prometheus/docs docs/practices/naming.md] |
| PROM-INSTR | Prometheus, Instrumentation | https://prometheus.io/docs/practices/instrumentation/ |
| PROM-HIST | Prometheus, Histograms and summaries | https://prometheus.io/docs/practices/histograms/ |
| PROM-ALERT | Prometheus, Alerting (summarises Rob Ewaschuk's Google "Philosophy on Alerting") | https://prometheus.io/docs/practices/alerting/ |
| GRAFANA-BP | Grafana docs, dashboard best practices (USE, RED, four golden signals) | https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/ |
| SRE-MON | Google SRE book ch. 6, Monitoring Distributed Systems | https://sre.google/sre-book/monitoring-distributed-systems/ — **not fetched (host blocked)**; only cited where GRAFANA-BP or PROM-ALERT reproduces it, and never counted as a separate source |

Could not reach: Tom Wilkie's RED post and Brendan Gregg's USE page, both cited only via GRAFANA-BP; Honeycomb/Charity Majors on wide events, so no wide-events rule; Logback manual, so SLF4J and Log4j cover it. For any of these to count directly, the operator has to allow the host in the session's network settings.

---

### 2 · `levels` — log-level table (target: obs/references/levels.md)

SLF4J has no FATAL, so the FATAL row maps to ERROR.

| Situation | Level | Why | Sources (verbatim) |
|---|---|---|---|
| The process cannot go on (bad config at startup, out of memory) | ERROR (FATAL where the API has it), then exit | The event ends the process | OTEL-EXC-LOG "Exceptions that usually result in application shutdown SHOULD be recorded with severity `FATAL`" · LOG4J-LEVEL FATAL "A fatal event that will prevent the application from continuing." |
| A failure that application code did not handle: it reaches the top-level handler (5xx), or a consumer gives up on a message | ERROR, with the throwable | Someone must look at it | OTEL-EXC-LOG "Exceptions that are unhandled by application code and don't result in application shutdown SHOULD be recorded with severity `ERROR`" (examples: "An HTTP server framework error handler catches an exception not handled by the application code") · OTEL-LOGS ERROR "An error event. Something went wrong." · LOG4J-LEVEL ERROR "An error in the application, possibly recoverable." |
| A dependency call failed and the code handled it (timeout, I/O error, retries used up, then a fallback) | WARN, once, with the throwable | Not yet an error, but it may become one | OTEL-EXC-LOG "Exceptions that are expected to be handled by application code SHOULD be reported with severity `WARN`" (e.g. "A connection attempt to a remote service times out") · LOG4J-LEVEL WARN "An event that might possible lead to an error." · OTEL-LOGS WARN "Not an error but is likely more important than an informational event." |
| A single retry attempt inside a retry loop | DEBUG; the final outcome gets the one WARN | Logging every attempt multiplies one failure | OTEL-EXC-LOG "fails after exhausting retries … records a single WARN log; logging of individual retry attempts is left to the lower-level instrumentation" · OTEL-ERR "Errors that were retried or handled … SHOULD NOT be recorded on spans or metrics" (both OpenTelemetry) |
| A client error: request validation fails (400), or authentication fails (401) | Never ERROR. **INFO or WARN is open** — see the note below | It is a client fault, not a server fault | OTEL-HTTP "For HTTP status codes in the 4xx range span status MUST be left unset in case of `SpanKind.SERVER`" · OWASP-LOG "Treat these as suspicious events, not proof of an attack … Evaluate severity and alerting using repetition, correlation, and request context." · OWASP-VOCAB `input_validation_fail` → `"level": "WARN"`, `authn_login_fail` → `"level": "WARN"` |
| Authorization denied (403) | At least WARN | A possible probe, which OWASP lists as an event to log | OWASP-LOG "Authorization (access control) failures" (in the list of events to log) · OWASP-VOCAB `authz_fail` → `"level": "CRITICAL"` |
| An exception that shows no real problem (the client cancelled the request) | DEBUG | Nothing to act on | OTEL-EXC-LOG "Exceptions that don't indicate an actual issue SHOULD be recorded with severity `DEBUG`" · LOG4J-LEVEL DEBUG "A general debugging event." |
| A business or lifecycle event happened (order placed, job finished, service started) | INFO | It records that something happened | OTEL-LOGS INFO "An informational event. Indicates that an event happened." · LOG4J-LEVEL INFO "An event for informational purposes." · OWASP-VOCAB `authn_login_success`, `upload_complete` → INFO |
| Diagnostic detail that helps while debugging | DEBUG | Off by default in production | OTEL-LOGS DEBUG "A debugging event." · LOG4J-LEVEL DEBUG |
| Fine-grained flow (method entry and exit, loop iterations) | TRACE | Too noisy unless switched on for one logger | OTEL-LOGS TRACE "A fine-grained debugging event. Typically disabled in default configurations." · LOG4J-LEVEL TRACE "A fine-grained debug message, typically capturing the flow through the application." |

**Note on OQ4.** OQ4 says INFO for 400/401 and WARN for 403. The external sources do not back the INFO half. OWASP-VOCAB assigns WARN to `input_validation_fail` and `authn_login_fail`, and CRITICAL to `authz_fail`. No external source assigns INFO. The only point the sources agree on is "not ERROR" (OTEL-HTTP; OWASP-LOG "not proof of an attack"). So the levels.md row should either say "not ERROR; INFO or WARN by project choice", or keep INFO and label it a project decision rather than an industry rule. OWASP-VOCAB is aimed at a security event stream ("the goal of logging is to be able to alert on specific security events"), and its levels are not internally consistent (it puts `sys_startup` at WARN), so it is weak as a general level authority. Since OQ4 is not mine to decide, I left that call to the operator.

---

### 3 · `logging` (target: obs/references/logging.md)

**LG1 · REWORD (absorbs LG9)** · misreadable: yes
Rule: Log a constant message with context as key-value fields (MDC or `addKeyValue`): trace id plus business ids, never ids pasted into text, because otherwise one request cannot be rebuilt from interleaved lines.
Sources:
- OWASP-LOG "The 'Interaction identifier' is a method of linking all (relevant) events for a single user interaction … this should be recorded instead of losing the information and forcing subsequent correlation techniques to re-construct the separate events."
- OTEL-LOGS TraceId "Can be set for logs that are part of request processing and have an assigned trace ID."
- SB-LOG "This format also adds every key value pair contained in the MDC to the JSON object. You can also use the SLF4J fluent logging API to add key value pairs".
- SB-TRACE "Correlation IDs provide a helpful way to link lines in your log files to spans/traces."

Why: the old `action=<verb>` message string and the project-specific id list are not industry practice. Sources favour named fields (OTEL-LOGS "Named top-level fields"; OWASP-LOG "when, where, who and what"). LG9 (`entryPoint` field) has a single source (OWASP-LOG "entry point URL and HTTP method"), so it is folded in here as one possible field rather than kept as its own rule.

**LG2 · KEEP** · misreadable: yes
Rule: Log a failure once, where it is handled. Code that rethrows (or wraps with the cause) does not also log, because logging before a rethrow writes one failure once per layer and inflates error counts.
Sources:
- OTEL-ERR "It's NOT RECOMMENDED to record the same exception more than once. … Exceptions which are propagated to the caller should be recorded (or logged) once."
- OTEL-EXC-LOG "The client library instrumentation records a single WARN log; logging of individual retry attempts is left to the lower-level instrumentation."

Caveat: both sources are OpenTelemetry documents. I found no second organisation in the reachable set; the Log4j and SLF4J docs are silent. Treat this as borderline on independence.

**LG3 · REWORD** · misreadable: yes
Rule: Pass the exception as the last argument (`log.warn("… {}", id, e)`), never `e.getMessage()` or `printStackTrace()`, because a message-only log loses the type and stack, and `printStackTrace` bypasses the logger.
Sources:
- SLF4J-FAQ "If the exception is not the last argument, it will be treated as a plain object and its stack trace will NOT be printed."
- LOG4J-API "Don't use `Throwable#getMessage()`! This prevents the log event from getting enriched with the exception." and "Don't call `Throwable#printStackTrace()`! This not only circumvents the logging but can also leak sensitive information!"

Why: which level to use now lives in the levels table. The old clause "WARN: class and message, no stack" is dropped. No source supports it, and OTEL-EXC-LOG lists `exception.stacktrace` as `Recommended` on exception log events at any severity.

**LG4 · REWORD** · misreadable: no
Rule: Never log passwords, tokens, session ids, `Authorization`/cookie headers, keys, connection strings, card data or sensitive PII; log the id and allowlisted fields, never whole bodies, because logs leak data.
Sources:
- OWASP-LOG "The following should usually not be recorded directly in the logs, but instead should be removed, masked, sanitized, hashed, or encrypted: … Session identification values … Access tokens … Sensitive personal data … Authentication passwords … Database connection strings … Encryption keys … Bank account or payment card holder data".
- LOG4J-API "`printStackTrace()` … can also leak sensitive information".
- OTEL-HTTP "`url.full` MUST NOT contain credentials … Sensitive content provided in `url.full` SHOULD be scrubbed".

Why: drops the project's redactor class name. The "DEBUG/TRACE only through a redactor" clause has no external source; OWASP's list applies at every level.

**LG5 · REWORD** · misreadable: no
Rule: Emit production logs with a structured (JSON) encoder. On a plain pattern layout, strip CR and LF from untrusted values, exception messages included, because a newline in input forges a log line nobody wrote.
Sources:
- OWASP-LOG "Do not use unstructured text log formats. … susceptible to log entry injection through Carriage Return (CR) or Line Feed (LF) characters … Instead, use structured log formats, such as JSON." and "Parameterized logging alone does not prevent CR/LF log injection; use a structured encoder that escapes values correctly."
- LOG4J-SEC "If your logs are consumed … Parsed automatically by a downstream tool … avoid Pattern layout and use a structured layout instead" and "If you must use Pattern layout, sanitize all inputs explicitly … The implicit `%ex` pattern specifier (exception stack traces), which are a frequent and overlooked source of CRLF characters".

**LG6 · KEEP** · misreadable: no
Rule: Use a constant template with `{}` placeholders, never concatenation; pass an expensive argument as a `Supplier` or behind `isXEnabled()`, because concatenation runs while the level is off and lets input rewrite the template.
Sources:
- SLF4J-FAQ "the second form will outperform the first form by a factor of at least 30, in case of a disabled logging statement."
- LOG4J-API "Don't use `String` concatenation to format arguments! … this approach is prone to attacks!" and "Use `Supplier`s to pass arguments containing computationally expensive items".
- OWASP-LOG "Keep message templates constant with Log4j and SLF4J".

**LG8 · REWORD** · misreadable: no
Rule: Create the logger with `LoggerFactory.getLogger(DeclaringClass.class)`, never a string literal or another class, because logger levels are configured by dotted class-name hierarchy and a misnamed logger cannot be tuned.
Sources:
- LOG4J-API "Most logging implementations use a hierarchical scheme for matching logger names with logging configuration … applications name their loggers by passing the current class's name".
- SLF4J-FAQ recommended idiom `final (static) Logger logger = LoggerFactory.getLogger(MyClass.class);`

Why: SLF4J says static or instance "is left to the user", so `static` is not mandated. Static is cheaper ("requires less CPU time"), which makes it the house default rather than a rule.

**LGN1 · NEW** · misreadable: no
Rule: Write logs to stdout; add no file appender, rotation or log path in application config, because the platform owns routing and storage, and a file in a replaceable container is lost or fills disk.
Sources:
- 12F "A twelve-factor app never concerns itself with routing or storage of its output stream. It should not attempt to write to or manage logfiles. Instead, each running process writes its event stream, unbuffered, to `stdout`."
- K8S-LOG "The easiest and most adopted logging method for containerized applications is writing to standard output and standard error streams."
- SB-LOG "By default, Spring Boot logs only to the console and does not write log files."

Dropped:
- **LG7** (log the duration of a long call; log scheduled-job start and finish). No external source asks for this in logs. The industry form is a metric, so it moved to **MXN3** (job last-success timestamp plus LongTaskTimer) and **MX2** (Timer for durations).
- **LG9**: folded into LG1 (single source).
- **LG10** (tag temporary debug logs with a marker): no industry source; it is a debugging workflow habit from one skills repo.

---

### 4 · `metrics` (target: obs/references/metrics.md)

**MX1 · KEEP** · misreadable: yes
Rule: Tag a meter only with bounded values (route template, enum, exception class, `NOT_FOUND`), never an id, email, raw URL, user input or exception message, because each new value is a new time series.
Sources:
- PROM-NAME "every unique combination of key-value label pairs represents a new time series … Do not use labels to store dimensions with high cardinality (many different label values), such as user IDs, email addresses, or other unbounded sets of values."
- MM-NAME "Beware of the potential for tag values coming from user-supplied sources to blow up the cardinality of a metric. … If we do not constrain 404s to a value like NOT_FOUND, the dimensionality of the metric would grow".
- MM-OBS "Only low cardinality key values are used as meter tags."

**MX2 · REWORD** · misreadable: no
Rule: Time durations with `Timer` (in-flight work: `LongTaskTimer`), count only untimed events with `Counter`, and gauge only a strongly held object, because a summary mis-scales time and a weakly held gauge reports NaN.
Sources:
- MM-TIMER "In every case where you want to measure time, you should use a `Timer` rather than a `DistributionSummary`."
- MM-COUNTER "Never count something you can time with a `Timer` … Both `Timer` and `DistributionSummary` always publish a count".
- MM-GAUGE "It is your responsibility to hold a strong reference … Once the object being gauged is de-referenced and is garbage collected, Micrometer starts reporting a NaN or nothing".
- MM-LTT "A normal Timer only records the duration *after* the task is complete."
- PROM-INSTR "if the value can go down, it is a gauge."

**MXN1 · NEW (split from MX2)** · misreadable: yes
Rule: Publish latency as a percentile histogram (`publishPercentileHistogram()` or SLO buckets), never only an average or client-side `publishPercentiles()`, because averages hide the slow tail, and client-side percentiles cannot be aggregated across instances.
Sources:
- MM-HIST "`publishPercentiles`: Used to publish percentile values computed in your application. These values are non-aggregable across dimensions." and "`publishPercentileHistogram`: … suitable for computing aggregable (across dimensions) percentile approximations".
- PROM-HIST "you cannot aggregate quantiles (e.g. to calculate the total 90th percentile latency for a service backed by multiple replicated workers)".
- SRE-MON (via GRAFANA-BP, "Duration - … distribution of latency measurements") — secondary.

**MX3 · REWORD** · misreadable: yes
Rule: Name a meter dot-separated lower case for the thing measured, with the outcome as a tag; never paired `*.success`/`*.failed` meters or generated names, because split meters make the error ratio unqueryable.
Sources:
- MM-NAME "Micrometer employs a naming convention that separates lowercase words with a `.` (dot) character" and its Bad Approach ("This time series is not useful without further dimensional drill-down").
- PROM-INSTR "rather than `http_responses_500_total` and `http_responses_403_total`, create a single metric called `http_responses_total` with a `code` label" and "no part of a metric name should ever be procedurally generated (use labels instead)".
- OTEL-ERR "It's RECOMMENDED to report one metric that includes successes and failures as opposed to reporting two (or more) metrics depending on the operation status."

Why: the old clause "a rename is a migration in its own change" has no second source and is dropped. ECS principles ("Adding more fields in the future is less complicated than changing or removing established ones") is about log fields and is the only nearby source.

**MXN2 · NEW** · misreadable: no
Rule: Put no unit in a meter name; record a `Timer` with a `Duration` and set `baseUnit` on a `DistributionSummary`, because the registry appends base units and a hand-written `ms` name mixes units.
Sources:
- OTEL-SEMMX "metrics that have their units included in OpenTelemetry metadata … SHOULD NOT include the units in the metric name" and "When instruments are measuring durations, seconds (i.e. `s`) SHOULD be used."
- PROM-NAME "MUST refer to a single unit (e.g. do not mix seconds with milliseconds)" and "SHOULD use base units (e.g. seconds, bytes …)".
- MM-NAME, where `registry.timer("http.server.requests")` becomes Prometheus `http_server_requests_duration_seconds`.

**MX5 · KEEP + add reason** · misreadable: no
Rule: Give every endpoint and outbound dependency rate, errors and duration; every pool and queue utilisation, saturation (depth, wait) and errors, because otherwise overload stays invisible until users report it.
Sources:
- GRAFANA-BP "RED … Rate - Requests per second; Errors - Number of requests that are failing; Duration - Amount of time these requests take" and "USE … Utilization … Saturation - Amount of work a resource has to do, often queue length".
- PROM-INSTR "The key metrics in such a system are the number of performed queries, errors, and latency" and "For any sort of threadpool, the key metrics are the number of queued requests, the number of threads in use … It is also useful to track how long things were waiting in the queue."
- SRE-MON four golden signals (via GRAFANA-BP "if you can only measure four metrics of your user-facing system, focus on these four").

**MXN3 · NEW (replaces LG7)** · misreadable: no
Rule: Give a scheduled or batch job a gauge holding the epoch seconds of its last success, never "seconds since", plus a `LongTaskTimer` while it runs, because a stalled job emits nothing that alerts can see.
Sources:
- PROM-INSTR "The key metric of a batch job is the last time it succeeded." and "export the Unix timestamp at which it happened - not the time since it happened … protecting you against the update logic getting stuck."
- PROM-ALERT "For batch jobs it makes sense to page if the batch job has not succeeded recently enough".
- MM-LTT "it is common for such long running processes to be implemented with `@Scheduled`. Micrometer provides a special `@Timed` annotation for instrumenting these processes with a long task timer".

Dropped:
- **MX4** (a Spock spec asserts each meter's name and tags): one source only. MM-OBS ships `TestObservationRegistry` for unit-testing observations, but no second source requires a test per meter, and Spock is house style. Keep it as a project rule if wanted, not as an industry rule.
- **MX6** (force one failure and find it in all three signals): no external source.
- **MX7** (name the on-call question; "metrics say that it broke, traces where, logs why"): no external source states it in these words. The nearby industry rule is about alerting rather than code: PROM-ALERT "alert on symptoms … avoid having pages where there is nothing to do" and GRAFANA-BP "alert on symptoms rather than causes". Add that only if the rulebook covers alert rules.
- **MX8, MX9**: project decision and fix item; not re-checked against industry by design.

---

### 5 · `tracing` (target: obs/references/tracing.md)

**TR1 · REWORD** · misreadable: yes
Rule: Carry trace context with the propagator (message headers across processes, a context-propagating executor across threads), never a hand-copied `traceId` field, because then consumer spans cannot join the producer's trace.
Sources:
- OTEL-MSG "A producer SHOULD attach a message creation context to each message. … Consumer traces cannot be directly correlated with producer traces if the message creation context is not attached and propagated with the message."
- OTEL-CTX "`Propagator`s leverage the `Context` to inject and extract data for each cross-cutting concern … Injects the value into a carrier. For example, into the headers of an HTTP request."
- SB-TRACE "Correlation IDs rely on context propagation."
- MM-TRACING API "how to continue a span in a new thread that was started in another thread".

Why: the old TR1 ("a field on the message") is the outcome the sources argue against. A plain id field correlates log lines but builds no parent link.

**TR2 · REWORD** · misreadable: yes
Rule: Instrument through the API or facade (`ObservationRegistry`, `Tracer`), never SDK types, and never null-check tracing, because the API is a no-op without a backend and SDK types tie code to one vendor.
Sources:
- OTEL-LIB "Libraries, frameworks, and applications that want to be instrumented with OpenTelemetry take a dependency only on the API packages. … When the SDK is not installed, the API calls should be no-ops which generate minimal overhead."
- OTEL-TRACE "in the absence of an installed SDK, the Trace API is a 'no-op' API."
- MM-TRACING "a simple facade for the most popular tracer libraries, letting you instrument your JVM-based application code without vendor lock-in"; Micrometer `ObservationRegistry.NOOP` ("No-op implementation of ObservationRegistry").

Why: "take `Tracer` through `ObjectProvider`" was a project decision. The industry form is "rely on the no-op". `ObjectProvider` stays valid where the container may not define the bean.

**TR3 · REWORD** · misreadable: no
Rule: Put no secrets, tokens, credentials or sensitive PII in span names, attributes, events or status descriptions (ids are fine), because span data is exported and stored like logs.
Sources:
- OTEL-HTTP "`url.full` MUST NOT contain credentials … Sensitive content provided in `url.full` SHOULD be scrubbed" and "Query string values for the following keys SHOULD be redacted by default".
- OTEL-ERR "SHOULD set the span status description when it has additional information about the error which is not expected to contain sensitive details".
- OWASP-LOG data-to-exclude list (same data classes).

Why: the old clause "no high-cardinality value in a span attribute" is **contradicted** by the sources. OTEL-TRACE says "`get_account` [is] Good, and account_id=42 would make a nice Span attribute". MM-OBS puts high-cardinality key values on spans and only keeps them out of meters ("High cardinality key values are not included in meters"). The "end in `finally`" half moved to TRN2.

**TRN1 · NEW** · misreadable: yes
Rule: Name a span or observation for a class of operation (`orders.place`, `GET /orders/{id}`) and put ids in `highCardinalityKeyValue` attributes, never in the name, because names feed metrics and grouping, and per-id names explode cardinality.
Sources:
- OTEL-TRACE "The span name SHOULD be the most general string that identifies a (statistically) interesting *class of Spans* … 'get_user/314159', where '314159' is a user ID, is not a good name due to its high cardinality."
- OTEL-HTTP "HTTP span names SHOULD be `{method} {target}` if there is a (low-cardinality) `target` available."
- MM-OBS "*Low cardinality* means that a key value will have a bounded number of possible values. A *templated* HTTP URL is a good example".

**TRN2 · NEW (from TR3's second half)** · misreadable: yes
Rule: End every span or observation you start: use `observation.observe(() -> …)`, or else `start()` with `stop()` in `finally` and the scope in try-with-resources, because an unended span leaks memory and never reaches the backend.
Sources:
- OTEL-TRACE "Any span that is created MUST also be ended. This is the responsibility of the user. API implementations MAY leak memory or other resources … if the user forgot to end the span."
- MM-OBS "Calling `observe(() -> ...)` leads to starting the Observation, putting it in scope, running the lambda, putting an error on the Observation if one took place, closing the scope and stopping the Observation." and "The Scope must be closed when no longer used."

**TRN3 · NEW** · misreadable: yes
Rule: Mark a span as an error only when its operation failed: call `observation.error(e)` once, where it is handled. Never mark a handled or retried failure, or a server-side 4xx, because false errors inflate error-rate alerts.
Sources:
- OTEL-TRACE "Instrumentation Libraries SHOULD leave the status code as `Unset` unless there is an error".
- OTEL-ERR "Errors that were retried or handled (allowing an operation to complete gracefully) SHOULD NOT be recorded on spans or metrics" and "Span Status Code MUST be left unset if the instrumented operation has ended without any errors."
- OTEL-HTTP "For HTTP status codes in the 4xx range span status MUST be left unset in case of `SpanKind.SERVER`".

Caveat: all three sources are OpenTelemetry (spec and semconv). Micrometer `Observation#error` follows the same model (MM-OBS "`error` - An error occurred while observing").

**TR5 · REWORD** · misreadable: no
Rule: Use a parent-based sampler so each service honours the incoming sampled flag, and set the root ratio in configuration per environment, never in code, because independent per-service ratios leave traces with missing spans.
Sources:
- OTEL-SDK "The default sampler is `ParentBased(root=AlwaysOn)`." and "The `TraceIdRatioBased` MUST ignore the parent `SampledFlag`. To respect the parent `SampledFlag`, the `TraceIdRatioBased` should be used as a delegate of the `ParentBased` sampler".
- SB-TRACE "By default, Spring Boot samples only 10% of requests to prevent overwhelming the trace backend. The `management.tracing.sampling.probability` property can be used to configure this", plus its parent-based sampler options.

Why: "keep sampling at 1.0" has no external support. Sources treat the ratio as a cost choice (OTEL-SDK "Sampling is a mechanism to control the noise and overhead"). TR5's stated reason is also not supported: an unsampled span still carries its `SpanContext` (OTEL-TRACE "The API MUST return a non-recording `Span` with the `SpanContext` in the parent `Context`"), so trace ids still reach the logs. 1.0 can remain a project setting.

**TR4 / TR4a (on hold — notes only)**
- TR4 ("Brave bridge; no OpenTelemetry API or `@WithSpan`") is a project decision. The generic rule it reduces to is TR2: code against the facade.
- What the sources say on TR4a:
  - OTEL-LIB: instrumented code "take[s] a dependency only on the API packages".
  - MM-TRACING: the facade sits over either bridge, "`micrometer-tracing-bridge-brave` or `micrometer-tracing-bridge-otel`".
  - SB-TRACE: Spring Boot auto-configures "Micrometer Tracing, a facade for popular tracer libraries", and offers OpenTelemetry samplers via `management.opentelemetry.tracing.sampler`.
- No source requires one bridge. Both "Micrometer facade + OTel bridge" and "OTel API directly" are sourced patterns, and the choice belongs to #55. Mixing them in business code (OTel `@WithSpan` next to Micrometer `Observation`) is what the facade sources warn against ("without vendor lock-in").

---

### 6 · Good/Bad pairs (misreadable rules)

#### LG1 — Ids as fields, not in the text
**Bad**
```java
log.info("order {} placed by customer {}", orderId, customerId);
```
**Good**
```java
// the trace id comes from the MDC
log.atInfo()
    .setMessage("order placed")
    .addKeyValue("orderId", orderId)
    .addKeyValue("customerId", customerId)
    .log();
```

#### LG2 — Log once, where the failure is handled
**Bad**
```java
try {
    paymentGateway.charge(invoice);
} catch (GatewayException e) {
    log.error("charge failed", e);
    throw new PaymentFailedException(invoice.id(), e);
}
```
**Good**
```java
try {
    paymentGateway.charge(invoice);
} catch (GatewayException e) {
    throw new PaymentFailedException(invoice.id(), e);
}
```

#### LG3 — The exception as the last argument
**Bad**
```java
log.warn("refund failed: {}", e.getMessage());
```
**Good**
```java
// the payment id is in the MDC (LG1)
log.warn("refund failed", e);
```

Audit 2026-10-31: ids leave the message text in every pair (LG1), so the LG2 and LG3 pairs break only their own
rule; the LG1 Bad uses `{}` placeholders so it breaks only LG1, not LG6. The skills reference copies these blocks.

#### MX1 — Bounded tag values only
**Bad**
```java
meterRegistry.counter(
        "invoices.sent",
        "customerId", customer.id().toString(),
        "path", request.getRequestURI())
    .increment();
```
**Good**
```java
meterRegistry.counter(
        "invoices.sent",
        "channel", invoice.channel().name(),
        "outcome", outcome.name())
    .increment();
```

#### MXN1 — An aggregable histogram
**Bad**
```java
final var timer = Timer.builder("payments.authorize")
    .publishPercentiles(0.5, 0.95, 0.99)
    .register(meterRegistry);
```
**Good**
```java
final var timer = Timer.builder("payments.authorize")
    .publishPercentileHistogram()
    .register(meterRegistry);
```

#### MX3 — The outcome as a tag on one meter
**Bad**
```java
meterRegistry.counter("orders.placed.success").increment();
meterRegistry.counter("orders.placed.failed").increment();
```
**Good**
```java
meterRegistry.counter(
        "orders.placed",
        "outcome", failed ? "failure" : "success")
    .increment();
```

#### TR1 — Propagate the context, not a copied field
**Bad**
```java
final var message = new OrderPlaced(
    order.id(),
    MDC.get("traceId"));
kafkaTemplate.send(
    "orders",
    message);
```
**Good**
```java
// the template is built with observation enabled, so it writes the trace headers
kafkaTemplate.send(
    "orders",
    new OrderPlaced(order.id()));
```

#### TR2 — The facade, with no null check
**Bad**
```java
private final SdkTracerProvider tracerProvider;

if (tracerProvider != null) {
    final var span = tracerProvider.get("orders").spanBuilder("orders.place").startSpan();
    try {
        orderService.place(command);
    } finally {
        span.end();
    }
}
```
**Good**
```java
Observation.createNotStarted("orders.place", observationRegistry)
    .observe(() -> orderService.place(command));
```

#### TRN1 — A span name for a class of operation
**Bad**
```java
Observation.createNotStarted("customers.load." + customerId, observationRegistry)
    .observe(() -> repository.load(customerId));
```
**Good**
```java
Observation.createNotStarted("customers.load", observationRegistry)
    .highCardinalityKeyValue("customer.id", customerId.toString())
    .observe(() -> repository.load(customerId));
```

#### TRN2 — End every span
**Bad**
```java
final var observation = Observation.start("invoices.render", observationRegistry);
renderer.render(invoice);
observation.stop();
```
**Good**
```java
Observation.createNotStarted("invoices.render", observationRegistry)
    .observe(() -> renderer.render(invoice));
```

#### TRN3 — An error status only for a failed operation
**Bad**
```java
try {
    return cache.get(orderId);
} catch (CacheMissException e) {
    observation.error(e);
    return repository.load(orderId);
}
```
**Good**
```java
try {
    return cache.get(orderId);
} catch (CacheMissException e) {
    observation.event(Observation.Event.of("cache.miss"));
    return repository.load(orderId);
}
```

Audit 2026-10-31: multi-line calls put one argument per line (house style), and the TR2 Bad ends its span so it
breaks only TR2, not TRN2. The skills references copy these blocks.

## 4 · Quotes added in review round 1 (2026-10-31)

Fetched from postgres/postgres `doc/src/sgml/` (the source of the PostgreSQL docs pages).

- PG-SET (`ref/set.sgml:113-117`, https://www.postgresql.org/docs/current/sql-set.html): `LOCAL` "Specifies that the
  command takes effect for only the current transaction. … Issuing this outside of a transaction block emits a warning
  and otherwise has no effect."
- PG-LOCK (`mvcc.sgml:1096-1099`, https://www.postgresql.org/docs/current/explicit-locking.html): `ACCESS EXCLUSIVE`
  is "Acquired by the DROP TABLE, TRUNCATE, REINDEX, CLUSTER, VACUUM FULL, and REFRESH MATERIALIZED VIEW (without
  CONCURRENTLY) commands. … Many forms of ALTER INDEX and ALTER TABLE also acquire" it.
