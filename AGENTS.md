# agent-factory

A coordinator AI that talks with the human, and an orchestrator (code) that starts fresh implementer and automated
review runs on a runner for a project's pull requests ([ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md); the code
does not follow it everywhere yet). The rules those
runs follow live in chiyanram/skills, not here ([ADR-0009](docs/adr/0009-tool-and-rules-in-separate-repos.md)).
People start at `README.md`; the principles are `docs/CONSTITUTION.md`; `docs/explanation/architecture.md` is the design; `docs/` holds the how-to, reference and
explanation pages, and `CONTRIBUTING.md` the rest.

## Check

```bash
make lint   # links resolve; AGENTS.md under 200 lines; the MUSTs below (check-musts); no old words (check-words); tsc; Biome format (biome ci); oxlint rules (lint-ratchet)
make test   # build, then the vitest suite; no network, glab, gh or claude needed
```

CI runs both on every pull request and on push to `main`.

`make test` skips the rules-pack check unless `FACTORY_RULES_PACK` names a checkout of the commit pinned in
`.github/rules-pack.json`; CI sets it. Before you change how a role card or a process is read, fetch that commit and
set the variable as `.github/workflows/ci.yml` does, because a local run is otherwise green where CI fails.

## MUSTs

- Call the git host only through the `Forge` seam in `src/core/forge/`, added to both adapters, because a direct
  `glab` or `gh` call breaks the other git host and cannot be stubbed in a test.
- Call git on a project's clone only through `hostGit` (`src/core/git.ts`), because plain git runs the hooks and
  programs that a branch or an implementer can plant in the repo's own config.
- Ship no bash script: write each new component in the TypeScript package, with its vitest test, and call CLIs
  from it ([ADR-0013](docs/adr/0013-typescript-package-cli-first.md)), because one language is built and checked once.
- Keep `prompts/coordinator.md` and `docs/` in step with the code, because the coordinator follows them as its
  instructions. Mark each place where the code still differs from ADR-0012 with **Today:**, because a reader must not take a decided
  guardrail for an enforced one.
- Give no model run a git host token or a skip-permissions flag in new code, because ADR-0012 S2, S6 and S11 forbid it.
- Format with `npm run format` (Biome), and fix every oxlint finding in the code you touch; never add a disable
  comment or raise `scripts/lint-baseline.json`, because the baseline only shrinks (#148).
- Commit and push only with the operator's yes; one ticket → one branch → one PR. The human merges.

Codebase health: each change leaves the modules it touches no worse than it found them. If the change would make one
worse, say so in the design and propose the refactor as its own ticket. We care about the next change being easy, not
only this one working.

## Where things go

The module headers say what each folder under `src/core/` does. What they do not say:

- `plugins/*/lib/` is built from `dist/`: never edit it by hand.
- `prompts/roles/` holds the built-in role cards; a card in the project's rules pack wins over them
  (`src/core/process/cards.ts`).
- `src/core/ready/` runs branch code on a fresh runner, never on the host.
- `test/` holds one vitest file per module; `tests/fixtures/` holds planted input for the lint checks.
- `evals/reviewer/` is the automated review's golden set; changing a review input needs an eval pass
  (`check-eval-proof`).

## Pointers

- Tickets and the wayfinder map: GitHub issues on chiyanram/agent-factory. See
  `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.
- Terms: `GLOSSARY.md` (the software-factory words, #144); code names that still use an old word are renamed in #144
  phase 4. Decisions: `docs/adr/`. See `docs/agents/domain.md`.
- A cite `docs/archive/…` or `research/NN` means that file at git tag `docs-archive-2026-11`.
