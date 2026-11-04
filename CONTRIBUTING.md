# Contributing

Thanks for helping. This page says how a change gets in. For setup and commands, see
[DEVELOPMENT.md](DEVELOPMENT.md).

## The flow

```
issue ──▶ branch ──▶ make lint + make test ──▶ pull request ──▶ review ──▶ merge
```

1. **Start from an issue.** Open one on [chiyanram/agent-factory](https://github.com/chiyanram/agent-factory/issues),
   or pick an open one. Say what is wrong or missing and why it matters.
2. **Make one branch for it,** named `<type>/<issue>-<slug>`, for example `fix/56-approved-stale`.
3. **Change the code and its test together.** Run `make lint` and `make test`; both must pass.
4. **Open one pull request per issue.** Link the issue (`Closes #56`).
5. **Review.** A maintainer reviews every pull request. Answer each comment with a change or a reason.
6. **Merge.** A maintainer merges once CI is green and the review is resolved.

Rules, such as how to write tests or Java, do not belong here. They go to the `rulebook` plugin in
[chiyanram/skills](https://github.com/chiyanram/skills).

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`, lower case, no period.

| type | for |
|---|---|
| `feat` | a new script or behaviour |
| `fix` | a bug fix |
| `docs` | documentation, ADRs, the playbook, the glossary |
| `chore` | build, CI and repo upkeep |

Common scopes: `coordinator`, `playbook`, `adr`, `glossary`, `setup`, `repo`. Every commit has a body that says why.
An agent's commit names the human it worked for in a `Co-Authored-By:` trailer.

## What a good pull request has

- One issue, one concern. Split unrelated changes.
- A test that fails without the change and passes with it.
- The script's header comment updated when its usage, output or settings change.
- The playbook, [ARCHITECTURE.md](ARCHITECTURE.md) or an ADR updated when behaviour the coordinator relies on changes.
- No secrets, tokens or real project data in code, fixtures or messages.
- Green `make lint` and `make test`.

## How to add things

### A coordinator script

1. Write the test first: `tests/<script>.test.sh`, plain bash, using the helpers in `tests/lib.sh`. Watch it fail.
2. Add `scripts/<script>.sh`. Start it with a header comment: usage, what it prints, the settings it reads.
3. Call the forge only through `gl_api` in `scripts/lib/gitlab.sh`, so the test can stub it.
4. Print one line on success. Write errors to stderr and exit non-zero.
5. Add the script to the table in [docs/playbooks/coordinator.md](docs/playbooks/coordinator.md#scripts) and to
   [ARCHITECTURE.md](ARCHITECTURE.md).

### A lint check

1. Plant bad input under `tests/fixtures/<case>/`. `make lint` skips that folder.
2. Add `tests/<check>.test.sh` that expects the check to fail on it. Watch it fail.
3. Write `scripts/<check>.sh` and add it to the `lint` target in the `Makefile`.
4. Add a row to the checks table below.

| check | fails when |
|---|---|
| `scripts/check-links.sh` | a relative link in a tracked `.md` file names no file. It skips web links, `#anchor` links, code, `tests/fixtures/` and `docs/archive/`. |
| `scripts/check-size.sh` | the root `AGENTS.md` has 200 lines or more ([ADR-0003](docs/adr/0003-rulebook-layout-across-tools.md)) |

### A decision record

Add `docs/adr/NNNN-slug.md` with the next free number. Give it a Status line and the sections Context, Decision, Why,
Alternatives rejected and Sources. Add a row to the decisions table in [ARCHITECTURE.md](ARCHITECTURE.md). To change a decision,
write a new ADR that supersedes the old one; do not rewrite history.

### A glossary term

Add it to [GLOSSARY.md](GLOSSARY.md) once the term is settled: one line of meaning, then the words to avoid.

### A GitHub Actions step

Pin every action to a full commit SHA, with the version in a comment. Dependabot proposes updates.

## Code of conduct

Be kind, assume good intent, and keep criticism about the work. Maintainers may remove comments or contributors that
do not.
