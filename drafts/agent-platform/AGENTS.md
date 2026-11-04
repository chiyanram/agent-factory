# AGENTS.md

Aruvii is a self-hosted AI agent platform. Java 25 · Spring Boot 4.1 · Spring AI 2.0 · PostgreSQL 18 · Redis 7 ·
Angular 21 · Gradle · Spock 2 for new tests.

This file holds the MUSTs every change follows. A nested `AGENTS.md` or `CLAUDE.md` adds the MUSTs of its folder: read
the nearest one before you change a file there. The detail behind each rule lives in the file named under
[Read when relevant](#read-when-relevant). When two instructions disagree, the narrower file wins; update the owner
instead of adding a competing rule here.

## Workflow

- Start every change with `/crq`, and write production code only after a human posts `/approved` on its draft MR,
  because a spec is cheap to fix before code and costly after.
- Commit only on a branch in its own worktree, and leave the merge to a human, because `master` is protected and the
  merge is the review gate.
- Run `make secrets` only in the main checkout, because a new master key cannot decrypt the credentials already in the
  shared database.

## Java

- Return a sealed result and switch over each of its cases by name, because a `default` arm lets a new case compile
  and be silently mishandled.
- Decide a case with `Optional`, a sealed result or an enum, because a nullable field lets contradictory combinations
  compile and a caller forget the check.
- Keep each method at cyclomatic complexity 5 or less, using a rule list instead of an if-ladder, because a branching
  method hides paths no test reaches.

## Tests

- Assert the behaviour the code produces, because a test of a field default, a hand-copied enum list or its own input
  cannot fail for a real defect.
- Put every IT under `src/integrationTest`, because an IT anywhere else compiles, runs class-parallel without the
  Testcontainers tuning, and still reports green.
- In a Spock argument closure, write each check as its own top-level line, because a check nested inside `every{}` is
  never asserted and the test passes anyway.

## Dependencies

- Leave every version the Spring Boot BOM manages to the BOM, because all three past overrides were wrong, and two
  pinned a library backwards.
- Read a library's BOM before importing it, because an imported BOM wins over Boot's and can silently downgrade a
  shared library.
- Check a new test dependency's console output before adopting it, because agents read build logs, and jqwik prints an
  instruction telling agents to ignore its results.

## Observability

- Log PII, prompts, tool arguments, secrets and tokens at DEBUG only, because logs are a common data-leak path on a
  customer's system.
- Log a failure once, where it is handled, and rethrow with the cause without logging, because each layer that logs
  writes the same failure again.
- Log WARN with the exception class and message, and ERROR with the throwable as the last argument, because a
  placeholder throwable prints no stack trace for the operator.

## Credentials

- Encrypt every credential with `CredentialEncryptor` before you store it, and mask it in every response, because a
  plain credential leaks to every database reader and API caller.

## Schema change

- Before you create a `V*.sql` file, read [`migrations`](.claude/rules/migrations.md) and use the
  [`flyway-migration`](.claude/skills/flyway-migration/SKILL.md) skill.

## Read when relevant

Read the matching file in full before you act. Each one owns its topic; this file only points.

- **Orientation, modules, glossary:** [`docs/CONTEXT.md`](docs/CONTEXT.md).
- **Building, testing, the gate, the shared stack:** [`docs/guides/DEVELOPING.md`](docs/guides/DEVELOPING.md). `make` is
  the only front door; `make help` lists every target.
- **Branches, commits, MR titles, worktrees:** the [`aruvii-git`](.claude/skills/aruvii-git/SKILL.md) skill.
- **The change pipeline, and when tests come first:** [`/crq`](.claude/commands/crq.md).
- **Java code:** [`java-standards`](.claude/rules/java-standards.md) and the
  [`aruvii-standards`](.claude/skills/aruvii-standards/SKILL.md) examples.
- **Integration tests:** [`it-testing`](.claude/rules/it-testing.md) and the [`it-testing`](.claude/skills/it-testing/SKILL.md)
  skill.
- **Smoke specs:** [`smoke`](.claude/rules/smoke.md) and the [`smoke-spec`](.claude/skills/smoke-spec/SKILL.md) skill.
- **Angular UI:** [`angular-ui`](.claude/rules/angular-ui.md).
- **REST endpoints:** every `/api` response is `ApiResponse<T>`; an error is `ApiResponse` with `success=false` and a
  code. Roles: [`ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md). Adding a public path is a security decision.
- **Logging and failure paths:** [`observability`](.claude/rules/observability.md).
- **Dependencies:** [`dependencies`](.claude/rules/dependencies.md).
- **A module's own rules:** that module's `AGENTS.md` or `CLAUDE.md`.
- **Writing docs or a REQ:** [`DEVELOPING.md`](docs/guides/DEVELOPING.md) §Writing documentation.
- **Decisions and specs:** [`docs/adr/`](docs/adr/README.md) and `docs/spec/`. Take every name from the specs.
- **Writing or reviewing a spec or a design:** use the `planning` skill (rulebook plugin) and read its `spec-review`
  reference.
- **Issues and labels:** [`docs/agents/`](docs/agents/issue-tracker.md).
