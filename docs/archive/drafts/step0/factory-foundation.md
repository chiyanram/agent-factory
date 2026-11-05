# agent-factory — step 0: from a planning repo to a build repo

## Problem

The design is approved and map #1 is closed, but the repo still describes itself as a planning repo. `AGENTS.md:4`,
`README.md:3,28` and `DEVELOPMENT.md:3` say "plan, don't do". `docs/open-items.md` still lists #23 and #25–#27 as
open. The repo has no Makefile, no lint and no CI (research/45).

The coordinator scripts (L3, #23) are the next code, and they live here (ADR-0009). They need a front door, tests and CI before the first script
lands.

## Scope

In: the repo's own instructions, the `make` front door, CI, and the test harness for scripts.
Out: writing any coordinator script (L3 build tickets), the rulebook (chiyanram/skills), agent-platform changes.

## Acceptance criteria

Instructions
- [ ] `AGENTS.md`, `README.md` and `docs/DEVELOPMENT.md` describe a build repo: where scripts live, how to run
      `make lint` and `make test`, and that a change lands as one issue → one branch → one PR.
- [ ] `docs/open-items.md` shows map #1 closed and lists the build tickets instead.

Front door
- [ ] `make lint` and `make test` exist, and CI runs the same targets.
- [ ] `make lint` fails on a markdown file with a broken relative link, and on a file over the ADR-0003 size limit.
      Each case is a planted fixture that a test runs.
- [ ] `make test` runs every `tests/*.test.sh` and fails if any one fails. With no script yet, it runs the lint
      fixture tests only.

CI
- [ ] One GitHub Actions workflow runs `make lint` and `make test` on every pull request and on push to `main`.
- [ ] Every action is pinned to a commit SHA, and Dependabot updates them.

## Sources

| criterion | references that do it (research/44) | or the issue we hit (research/45) |
|---|---|---|
| contributor AGENTS.md | 7 repos | "plan, don't do" at AGENTS.md:4 and 4 more lines |
| make as front door | Jeffallan | no Makefile; agent-platform: "`make` is the front door" |
| link check | addy, plinth | — |
| size limit | — | ADR-0003:21 (decided) |
| tests for repo scripts, run in CI | cursor, addy, firstmate, Jeffallan, plinth | — |
| CI on every PR | the same 5 repos | no workflow |
| actions pinned + Dependabot | Jeffallan, plinth | — |

Script tests are plain bash files, `tests/<script>.test.sh`, each exiting non-zero on a failed assertion. No test
framework. Two references test shell this way: addy (`hooks/*-test.sh`) and firstmate (`tests/*.test.sh`). agent-platform does the same (`scripts/stack-lock.test.sh`).
