# chiyanram/skills — step 0: a buildable plugin repo

## Problem

The rulebook plugin ships no skills yet, and nothing checks what it will ship. `plugins/rulebook/skills/` holds only
`.gitkeep`. The Makefile validates the manifests and nothing else. There is no CI and no test, and three builders
hard-code laptop paths. The README still says "plan only" and contradicts ADR-0003 on the repo's role (research/45).

The first rule file that lands must be checked the moment it lands. This ticket builds those checks before any rule is
written.

## Scope

In: the repo's own instructions, the `make` front door, CI, and the checks every later skill must pass.
Out: writing any rule or skill (L1 build tickets), evals, release automation, making the repo public.

The repo stays private until it ships real skills. The operator then makes it public, and protects `main` at that time
(operator, 2026-10-26). Until then, CI reports a red build but cannot block a merge, because GitHub Free does not
protect a private repo.

## Acceptance criteria

Instructions
- [ ] `AGENTS.md` says how to build and check the plugin, and names one tracker: GitHub issues. It names only files
      that exist. `CLAUDE.md` is the one line `@AGENTS.md`.
- [ ] `README.md` states the role from ADR-0003: the generic rulebook, reached as a Claude plugin and by
      `npx skills add`. No "plan only" line remains.

Front door
- [ ] `make lint` and `make test` exist. `make lint` exits non-zero on each failure below, and CI runs the same targets.

Checks in `make lint` (each one fails on a planted bad fixture, and the fixture is a test)
- [ ] Every `SKILL.md` has `name` and `description`. `name` equals its folder. `description` is at most 1024
      characters.
- [ ] `claude plugin validate . --strict` passes, and LICENSE, plugin README and icon exist.
- [ ] Every manifest carries the same version.
- [ ] Every relative link in a markdown file resolves.
- [ ] Each rule file stays inside the ADR-0003 size limit, and the always-loaded chain stays under 32 KiB.

Code
- [ ] Each Python builder reads its paths from arguments or the repo root. No `/Users/` path remains.
- [ ] Each builder has a test, and `make test` runs them.

CI
- [ ] One GitHub Actions workflow runs `make lint` and `make test` on every pull request and on push to `main`.
- [ ] Every action is pinned to a commit SHA, and Dependabot updates them.

Packaging
- [ ] The plugin ships only `plugins/rulebook/`, not the repo root.

## Sources

| criterion | references that do it (research/44) | or the issue we hit (research/45) |
|---|---|---|
| contributor AGENTS.md, CLAUDE.md as pointer | 7 repos; pointer: mattpocock, firstmate | tracker named two ways; dead file names |
| make as front door | Jeffallan | agent-platform: "`make` is the front door" (its AGENTS.md) |
| frontmatter check | addy, Jeffallan, plinth (cursor partly) | — |
| `claude plugin validate`, one version | cursor, addy; mattpocock removed hand-bumped versions after drift | validate reports 3 missing files |
| link check | addy, plinth | — |
| size limit, 32 KiB chain | — | ADR-0003:21-22 (decided) |
| tests for repo scripts, run in CI | cursor, addy, firstmate, Jeffallan, plinth | 0 tests; laptop paths |
| CI on every PR | the same 5 repos | no workflow |
| actions pinned + Dependabot | Jeffallan, plinth | — |
| ship only the plugin paths | Jeffallan, cursor | — |

Left out because only one reference does it: evals (addy), ShellCheck (firstmate), enforced conventional commits
(plinth), changesets (mattpocock).
