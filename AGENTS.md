# agent-factory

A coordinator AI that talks with the human, and a dispatcher (code) that starts fresh writer and reviewer workers
in a box on a project's merge requests ([ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md); the scripts
do not follow it yet). The rules those
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
- Call git on a project's clone only through `hgit` (`scripts/lib/git.sh`) or `hostGit` (`src/core/git.ts`), and keep
  the two in step, because plain git runs the hooks and programs that a branch or a writer can plant in the repo's
  own config.
- Write each script and its test `tests/<script>.test.sh` together, for bash 3.2 and POSIX tools, because the scripts
  run on stock macOS and on Linux. New components go into the TypeScript package and call CLIs
  ([ADR-0013](docs/adr/0013-typescript-package-cli-first.md)).
- Keep `GUIDE.md` in step with the scripts, because the coordinator session follows it as its instructions. Mark
  each place where a script still differs from ADR-0012 with **Today:**, because a reader must not take a decided
  guardrail for an enforced one.
- Give no LLM seat a forge token or a skip-permissions flag in new code, because ADR-0012 S2, S6 and S11 forbid it.
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
