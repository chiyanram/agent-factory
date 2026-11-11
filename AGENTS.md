# agent-factory

A coordinator AI that talks with the human, and an orchestrator (code) that starts fresh implementer and automated
review runs on a runner for a project's pull requests ([ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md); the code
does not follow it everywhere yet). The rules those
runs follow live in chiyanram/skills, not here ([ADR-0009](docs/adr/0009-tool-and-rules-in-separate-repos.md)).
People start at `README.md`; `docs/explanation/architecture.md` is the design; `docs/` holds the how-to, reference and
explanation pages, and `CONTRIBUTING.md` the rest.

## Check

```bash
make lint   # links resolve; AGENTS.md under 200 lines; the MUSTs below (check-musts); no old words (check-words); tsc; Biome format (biome ci); oxlint rules (lint-ratchet)
make test   # build, then the vitest suite; no network, glab, gh or claude needed
```

CI runs both on every pull request and on push to `main`.

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

## Where things go

```text
scripts/              the lint checks and the release helpers, in TypeScript and Node; no bash
src/core/forge/       the git host seam: one Forge interface, a GitHub and a GitLab adapter over gh api and glab api
src/core/egress/      the egress proxy: the allowlist, the Squid config, and the --internal network the runner joins (#130)
src/core/box/         the runner seam: one Box interface; FACTORY_BOX picks the kind, openBox refuses a runner that does not work
images/factory-box/   the base image of every vm runner: git, Docker (run under Sysbox), Node and the pinned agent CLIs (#113)
src/core/dispatch/    the orchestrator: the decision table, the per-ticket run records, one locked pass, and the loop (#305)
src/core/review/      the automated review: the context pack, one round (finders, verify pass, post), and the status list
src/core/design/      the design review's two read-only runs before the approval: design-reviewer, then verify pass (#236)
src/core/onboard/     the onboarder: a project's brief and glossary, staged in the project home for a human, read by every run (#235)
src/core/ready/       the ready check and the local verifier: branch code run on a fresh runner, never on the host (#91)
src/core/settings/    the settings layers: team, project, user and machine; each key's class; config show/check (#229)
src/core/plugin/      the connector contract: describe and call, the pinned registry, and the contract test kit (#134)
src/core/process/     the project's plugin list and its pins (hash-checked each run), its process: lanes and baseline (#232), and role cards (#236)
plugins/              the bundled connectors: github and gitlab serve the git host seam (lib/ built from dist/); discord pings
prompts/              the automated review's default finder and verify-pass instructions, the eval's judge, and the built-in role cards (roles/)
evals/reviewer/       the automated review's golden set: base.sha, change.patch, golden.json per case (ADR-0015)
src/core/eval/        agent-factory eval reviewer: the harness, the judge, the $100 cap and the results file (#215)
test/                 the vitest suite; tests/fixtures/ holds planted input for the checks
docs/adr/             decision records
docs/agents/          ticket tracker, triage labels, domain-doc conventions
```

## Pointers

- Tickets and the wayfinder map: GitHub issues on chiyanram/agent-factory. See
  `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.
- Terms: `GLOSSARY.md` (the software-factory words, #144); code names that still use an old word are renamed in #144
  phase 4. Decisions: `docs/adr/`. See `docs/agents/domain.md`.
- A cite `docs/archive/…` or `research/NN` means that file at git tag `docs-archive-2026-11`.
