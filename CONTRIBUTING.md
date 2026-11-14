# Contributing

This page says how to set up, test, and get a change in. Coding agents also read [AGENTS.md](AGENTS.md). Rules for
code in other projects, such as how to write tests or Java, go to the `rulebook` plugin in
[chiyanram/skills](https://github.com/chiyanram/skills), not here.

## Set up

| tool | needed for |
|---|---|
| git, make | everything; the package runs on macOS and on Linux |
| `glab` or `gh` | running the factory against GitLab or GitHub; the tests stub both |
| `claude` (Claude Code CLI) | running the implementer and the automated review; the tests stub it |
| Node 26 or later (npm 10 is fine) | the TypeScript package (ADR-0013): `make` runs `npm ci` from `package-lock.json` |
| npm 11 | only to change dependencies: `npx npm@11 install <pkg>`. npm 10 crashes when it re-resolves the tree (an arborist bug on vite's optional peer `vitest@*`), so never add `legacy-peer-deps` |

```bash
git clone https://github.com/chiyanram/agent-factory.git
cd agent-factory
make lint && make test
```

| target | does |
|---|---|
| `make lint` | `node scripts/check-links.ts .` (every relative link in a tracked `.md` file resolves), `node scripts/check-size.ts .` (the root `AGENTS.md` is under 200 lines), `node scripts/check-temp-dirs.ts .` (no test calls `tmpdir()` itself: it makes a temp folder with `tempDir()` from [test/temp.ts](test/temp.ts), which answers the real path behind macOS's `/var` symlink), `node scripts/check-evals.ts .` (each case of the automated review's golden set is well-formed: [evals/reviewer/README.md](evals/reviewer/README.md)), `node scripts/check-eval-proof.ts .` (a change to an automated review input adds an eval pass that proves it, and a change to the baseline carries the operator's label: [evals/reviewer/README.md](evals/reviewer/README.md#the-proof-check)), `node scripts/check-musts.ts .` (each `AGENTS.md` MUST that code can check: no `gh`, `glab` or `git` outside their seams, `node:child_process` only in the reviewed modules that start programs, no git host token or skip-permissions flag outside the git host seam, no disable comment, no raised `scripts/lint-baseline.json` against the default branch, and no bash script; the exceptions and their reasons are in the script), `node scripts/check-words.ts .` (no old word from `GLOSSARY.md` in the prose of `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, every `.md` under `docs/` but the ADRs, `prompts/coordinator.md` or a role card; an identifier goes in backticks), `node scripts/check-history.ts .` (no ticket, approval or dated decision in a comment or doc line the change adds, against the default branch; the exceptions are in the script), `tsc --noEmit`, `biome ci` and the oxlint ratchet |
| `make test` | builds, then runs the vitest suite. CI runs it on Linux and on macOS (`test-macos`), each with the pinned rules pack (`FACTORY_RULES_PACK`, see `AGENTS.md`). One file: `npx vitest run test/poll.test.ts` |
| `make build` | compiles the TypeScript package to `dist/` |
| `make garden` | prints the code's health from git history with repo-gardener: `gardener snapshot` (size, files over 800 lines, type escapes, lint suppressions), `gardener hotspots --days 60 --limit 10` (files that keep needing fixes) and `gardener window --days 7` (fix share, cleanup share and rework). Add `--transcripts` or `--github` only in a hand run of `npx gardener`: `--transcripts` reads the agent logs on your own machine. `gardener.config.json` leaves out `tests/fixtures/`, the planted bad input of the lint checks |
| `make garden-pr` | prints, for each code file a change touches, its lines, type escapes, lint suppressions and, in a test file, mocked modules and call assertions, at the merge base and at the head, then the numbers that got worse: a file over 800 lines that grew, more type escapes or suppressions over the touched files, more mocks in a test file ([src/core/garden/numbers.ts](src/core/garden/numbers.ts)). It compares `origin/main` with `HEAD`; set `BASE=` or `HEAD=` for another pair. `node scripts/garden-pr.ts --json` prints the same as JSON. It is a measure for you and for whoever reviews the change, not a gate: it always exits 0 once it has measured |
| `make help` | lists the targets |

Tests are vitest files under `test/`, one per module, named `<module>.test.ts`. A test makes its temp folders with
`tempDir()` from [test/temp.ts](test/temp.ts).

## How a change lands

```
ticket ──▶ branch ──▶ make lint + make test ──▶ pull request ──▶ review ──▶ merge
```

1. Open or pick a [ticket](https://github.com/chiyanram/agent-factory/issues). Say what is wrong and why it matters.
2. Make one branch for it, named `<type>/<ticket>-<slug>`, such as `fix/56-approved-stale`.
3. Change the code and its test together. Run `make lint` and `make test`.
4. Open one pull request per ticket. Its title and description become the commit on `main`; see
   [Commit messages](#commit-messages).
5. A maintainer reviews it. Answer each comment with a change or a reason.
6. A maintainer squash-merges it once `lint-and-test` is green on the branch with the latest `main` merged in, and
   the review is resolved. A merge queue would do that step, but a repo owned by a user cannot have one (#323).

A comment or doc line says what the code does and why. Who decided it, when, and on which ticket go in the PR
description and so the commit, or in an ADR; `make lint` fails a new note that says so in the code or the docs.

A good pull request has one concern, a test that fails without the change, and no secrets, tokens or real project
data. When it changes behaviour the coordinator relies on, it updates [prompts/coordinator.md](prompts/coordinator.md) or an ADR too.

## Add a command

No bash ships: every component is TypeScript in the package and calls CLIs
([ADR-0013](docs/adr/0013-typescript-package-cli-first.md), #138). `make lint` fails on any `.sh` file.

1. Write the test first: `test/<module>.test.ts`. Watch it fail.
2. Add the module under `src/core/` and its command to the `agent-factory` CLI. Start the module with a header
   comment: what it does, what it prints, the settings it reads.
3. Call the git host only through the `Forge` seam in `src/core/forge/`, and git on a project's clone only through
   `hostGit` (`src/core/git.ts`). Read a setting only through `settingOf`.
4. Print one line on success. Write errors to stderr and exit non-zero.
5. Add the command to its group in [docs/reference/cli.md](docs/reference/cli.md), and any new setting to
   [Settings](docs/reference/settings.md#settings).

## Add a check

1. Plant bad input under `tests/fixtures/<case>/`. `make lint` skips that folder.
2. Add `test/<check>.test.ts` that expects the check to fail on it. Watch it fail.
3. Write `scripts/<check>.ts` and add it to the `lint` target in the `Makefile`.

## Add a decision

Add `docs/adr/NNNN-slug.md` with the next free number: a Status line, then Context, Decision, Why, Alternatives
rejected and Sources. To change a decision, write a new ADR that supersedes the old one.

## Commit messages

One format in chiyanram/skills, chiyanram/agent-factory and chiyanram/rca-agent (#341). It has the commitizen
sections:

```
type(scope): lower-case summary (#issue)

Why the change is needed, in 1–3 sentences.

BREAKING CHANGE: what breaks and what to do instead
Refs #12
```

- **Title**: a type, a required lower-case scope, an imperative lower-case summary with no full stop, and the ticket as
  `(#N)` or `(owner/repo#N)`, such as `fix(dispatch): count a failed round's spend (#131)`. Add `!` after the scope for a breaking change. Only Dependabot
  (scope `deps`) and the release commit name no ticket.
- **Body**: why, not what; the diff shows what. Optional footers: `BREAKING CHANGE:`, `Closes #N` to close the ticket on
  merge, and `Refs #N` for other tickets.
- **No tool or co-author lines**: no `Co-Authored-By`, no "Generated with" line.

Pull requests are squash-merged. The commit on `main` is the **PR title** (GitHub adds `(#pr)`) and the **PR
description** as its body, so write the description as the commit body. The branch commits are dropped, so they can be
anything. CI checks the PR title.

To get the prompts, install [commitizen](https://commitizen-tools.github.io/commitizen/) once (`pipx install
commitizen`) and run `cz commit`. `.cz.toml` holds the prompts; it is the same file in all three repos. commitizen only
writes the message: semantic-release still cuts the releases.

Pin every GitHub Actions step to a full commit SHA, with the version in a comment.

## Releases

```text
merge to main          ──▶ ci.yml        checks only, no release
Run workflow on main   ──▶ release.yml
                             ├─ checks   ci.yml, called with workflow_call
                             └─ release  semantic-release, only after the checks pass
```

Releases are manual during the dev phase (#327). A merge to `main` runs the checks only. To release, open
**Actions → release → Run workflow** on `main`, or run `gh workflow run release.yml --ref main`. It runs the checks
from `ci.yml` first (#351); semantic-release (`release.config.mjs`, #153) then runs after the checks pass, the same
way as chiyanram/skills.

- Pull requests are squash-merged with the PR title as the commit subject, so **the PR title decides the release**.
  CI fails a title that is not `type(scope): lower-case summary (#ticket)`, such as `feat(box): one box seam (#112)`, and
  a title, description or commit that holds a skip-ci marker. The ticket can be in another repo:
  `(chiyanram/skills#276)`. Only Dependabot (scope `deps`) and the release commit name no ticket. chiyanram/skills and
  chiyanram/rca-agent use the same rule (#327).
- `feat` releases a minor version, `fix` and `perf` a patch, and `!` or a `BREAKING CHANGE:` footer a major one.
  `docs`, `chore`, `ci`, `style`, `refactor`, `test` and `build` release nothing.
- A release is a tag `vX.Y.Z`, a GitHub release and an entry in `CHANGELOG.md`, which semantic-release writes; do not
  edit it by hand. Nothing is published to npm; the release attaches the packed package
  (`chiyanram-agent-factory-<version>.tgz`, from `npm pack`) for the one-line install in `docs/how-to/install.md`.
- The release notes come from the PR titles on `main` (`scripts/release_notes.mjs`, #157). The sections are
  `⚠️ Breaking changes`, `✨ Features`, `🐛 Fixes`, `⚡ Performance` and `⏪ Reverts`, and each change is one bullet
  `**scope** — subject · #ticket (PR #pr)`. Put the ticket as `(#N)` at the end of the PR title; GitHub adds the PR
  number after it. `test/release-notes.test.ts` compares the notes for fixed commits to
  `tests/fixtures/release-notes/expected.md`; change both together.
- The versions are `0.x` until the pilot (#62) has run; `1.0.0` means the CLI is meant to stay stable.
- `npm run release:preview` shows the next version without releasing (it needs a GitHub login).

## Troubleshooting

| symptom | fix |
|---|---|
| `broken link: <file>:<line>: <target>` | a relative link points at a missing file; fix the path |
| `too long: AGENTS.md` | the root `AGENTS.md` reached 200 lines; move detail into `docs/` and link it |
| `refused: … a human account` | log the CLI in as the bot ([Set up identity](docs/how-to/set-up-identity.md)) |
| `FACTORY_PROJECT is not set` / `FACTORY_REPO must be a local clone` / `no project in …/projects` / `holds 2 projects` | run `agent-factory init` in the clone, which writes them to the project file; name the project (`agent-factory poll ledger`) when there are several; or export the setting ([Settings](docs/reference/settings.md)) |
| `cannot list live runs: claude agents --json failed` | the `claude` CLI is missing or too old |
| `github: rate limited until <time>: HTTP 200 after 1 try on graphql` | the git host is rate-limiting; the orchestrator loop waits until that time by itself; by hand, run again after it |

## Design history

The research, drafts and old pages from the design phase are at git tag `docs-archive-2026-11`. A cite
`docs/archive/…` or `research/NN` in a script, a test or an ADR means that file at that tag:
`git show docs-archive-2026-11:docs/archive/research/<file>`.

## Code of conduct

Be kind, assume good intent, and keep criticism about the work.
