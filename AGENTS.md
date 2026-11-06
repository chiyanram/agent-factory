# agent-factory

One coordinator AI that starts fresh writer and reviewer workers on a project's merge requests. The rules those
workers follow live in chiyanram/skills, not here ([ADR-0009](docs/adr/0009-tool-and-rules-in-separate-repos.md)).
People start at `README.md`; `GUIDE.md` and `CONTRIBUTING.md` hold the rest.

## Check

```bash
make lint   # every relative link resolves; the root AGENTS.md is under 200 lines
make test   # every tests/*.test.sh; no network, glab, gh or claude needed
```

CI runs both on every pull request and on push to `main`.

## MUSTs

- Call the forge only through a `forge_*` call in `scripts/lib/forge.sh`, added to both adapters, because a direct
  `glab` or `gh` call breaks the other forge and cannot be stubbed in a test.
- Write each script and its test `tests/<script>.test.sh` together, for bash 3.2 and POSIX tools, because the scripts
  run on stock macOS and on Linux.
- Keep `GUIDE.md` in step with the scripts, because the coordinator session follows it as its instructions.
- Commit and push only with the operator's yes; one issue → one branch → one PR. The human merges.

## Where things go

```text
scripts/              the loop scripts and the lint checks
scripts/lib/          the forge seam (forge.sh, gitlab.sh, github.sh, http.sh) and run tracking (runs.sh)
prompts/              the reviewer's default find and verify instructions
tests/                one plain-bash test per script; tests/lib.sh helpers; tests/fixtures/
docs/adr/             decision records
docs/agents/          issue tracker, triage labels, domain-doc conventions
```

## Pointers

- Issues, the wayfinder map and its tickets: GitHub issues on chiyanram/agent-factory. See
  `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.
- Terms: `GUIDE.md#terms`. Decisions: `docs/adr/`. See `docs/agents/domain.md`.
- A cite `docs/archive/…` or `research/NN` means that file at git tag `docs-archive-2026-11`.
