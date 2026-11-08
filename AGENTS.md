# agent-factory

A coordinator AI that talks with the human, and a dispatcher (code) that starts fresh writer and reviewer workers
in a box on a project's merge requests ([ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md); the scripts
do not follow it yet). The rules those
workers follow live in chiyanram/skills, not here ([ADR-0009](docs/adr/0009-tool-and-rules-in-separate-repos.md)).
People start at `README.md`; `GUIDE.md` and `CONTRIBUTING.md` hold the rest.

## Check

```bash
make lint   # links resolve; AGENTS.md under 200 lines; tsc; Biome format (biome ci); oxlint rules (lint-ratchet)
make test   # every tests/*.test.sh; no network, glab, gh or claude needed
```

CI runs both on every pull request and on push to `main`.

## MUSTs

- Call the forge only through the `Forge` seam in `src/core/forge/` (or, in a bash script not yet ported, a `forge_*`
  call in `scripts/lib/forge.sh`), added to both adapters, because a direct `glab` or `gh` call breaks the other forge
  and cannot be stubbed in a test.
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
- Format with `npm run format` (Biome), and fix every oxlint finding in the code you touch; never add a disable
  comment or raise `scripts/lint-baseline.json`, because the baseline only shrinks (#148).
- Commit and push only with the operator's yes; one issue → one branch → one PR. The human merges.

## Where things go

```text
scripts/              the loop scripts and the lint checks
scripts/lib/          the bash forge seam, until its last caller is ported (#138), and run tracking (runs.sh)
src/core/forge/       the forge seam: one Forge interface, a GitHub and a GitLab adapter over gh api and glab api
src/core/egress/      the egress proxy: the allowlist, the Squid config, and the --internal network the box joins (#130)
src/core/box/         the box seam: one Box interface; FACTORY_BOX picks the place, openBox refuses a box that does not work
images/factory-box/   the base image of every vm box: git, Docker (run under Sysbox), Node and the pinned runner CLIs (#113)
src/core/dispatch/    the dispatcher: the decision table, the per-ticket run records, and one locked pass (dispatch --once)
src/core/review/      the reviewer: the context pack, one review round (find, verify, post), and the status box
src/core/ready/       the ready check and the local verifier: branch code run in a fresh box, never on the host (#91)
src/core/plugin/      the plugin contract: describe and call, the pinned registry, and the contract test kit (#134)
plugins/              the bundled plugins: github and gitlab serve the forge seam (lib/ built from dist/); discord pings
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
