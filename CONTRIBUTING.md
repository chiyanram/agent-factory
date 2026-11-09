# Contributing

This page says how to set up, test, and get a change in. Coding agents also read [AGENTS.md](AGENTS.md). Rules for
code in other projects, such as how to write tests or Java, go to the `rulebook` plugin in
[chiyanram/skills](https://github.com/chiyanram/skills), not here.

## Set up

| tool | needed for |
|---|---|
| git, make | everything; the package runs on macOS and on Linux |
| `glab` or `gh` | running the factory against GitLab or GitHub; the tests stub both |
| `claude` (Claude Code CLI) | running writers and reviewers; the tests stub it |
| Node 22 or later (npm 10 is fine) | the TypeScript package (ADR-0013): `make` runs `npm ci` from `package-lock.json` |
| npm 11 | only to change dependencies: `npx npm@11 install <pkg>`. npm 10 crashes when it re-resolves the tree (an arborist bug on vite's optional peer `vitest@*`), so never add `legacy-peer-deps` |

```bash
git clone https://github.com/chiyanram/agent-factory.git
cd agent-factory
make lint && make test
```

| target | does |
|---|---|
| `make lint` | `node scripts/check-links.ts .` (every relative link in a tracked `.md` file resolves), `node scripts/check-size.ts .` (the root `AGENTS.md` is under 200 lines), `node scripts/check-temp-dirs.ts .` (no test calls `tmpdir()` itself: it makes a temp folder with `tempDir()` from [test/temp.ts](test/temp.ts), which answers the real path behind macOS's `/var` symlink), `node scripts/check-evals.ts .` (each case of the automated review's golden set is well-formed: [evals/reviewer/README.md](evals/reviewer/README.md)), `node scripts/check-eval-proof.ts .` (a change to a reviewer input adds an eval pass that proves it, and a change to the baseline carries the operator's label: [evals/reviewer/README.md](evals/reviewer/README.md#the-proof-check)), `node scripts/check-musts.ts .` (each `AGENTS.md` MUST that code can check: no `gh`, `glab` or `git` outside their seams, `node:child_process` only in the reviewed runners, no forge token or skip-permissions flag outside the forge seam, no disable comment, no raised `scripts/lint-baseline.json` against the default branch, and no bash script; the exceptions and their reasons are in the script), `tsc --noEmit`, `biome ci` and the oxlint ratchet |
| `make test` | builds, then runs the vitest suite. CI runs it on Linux and on macOS. One file: `npx vitest run test/poll.test.ts` |
| `make build` | compiles the TypeScript package to `dist/` |
| `make help` | lists the targets |

Tests are vitest files under `test/`, one per module, named `<module>.test.ts`. A test makes its temp folders with
`tempDir()` from [test/temp.ts](test/temp.ts).

## How a change lands

```
issue ──▶ branch ──▶ make lint + make test ──▶ pull request ──▶ review ──▶ merge
```

1. Open or pick an [issue](https://github.com/chiyanram/agent-factory/issues). Say what is wrong and why it matters.
2. Make one branch for it, named `<type>/<issue>-<slug>`, such as `fix/56-approved-stale`.
3. Change the code and its test together. Run `make lint` and `make test`.
4. Open one pull request per issue, and link the issue (`Closes #56`).
5. A maintainer reviews it. Answer each comment with a change or a reason.
6. A maintainer merges once CI is green and the review is resolved.

A good pull request has one concern, a test that fails without the change, and no secrets, tokens or real project
data. When it changes behaviour the coordinator relies on, it updates [GUIDE.md](GUIDE.md) or an ADR too.

## Add a command

No bash ships: every component is TypeScript in the package and calls CLIs
([ADR-0013](docs/adr/0013-typescript-package-cli-first.md), #138). `make lint` fails on any `.sh` file.

1. Write the test first: `test/<module>.test.ts`. Watch it fail.
2. Add the module under `src/core/` and its command to the `agent-factory` CLI. Start the module with a header
   comment: what it does, what it prints, the settings it reads.
3. Call the forge only through the `Forge` seam in `src/core/forge/`, and git on a project's clone only through
   `hostGit` (`src/core/git.ts`). Read a setting only through `settingOf`.
4. Print one line on success. Write errors to stderr and exit non-zero.
5. Add the command to the Scripts table in [GUIDE.md](GUIDE.md#scripts), and any new setting to
   [Settings](GUIDE.md#settings).

## Add a check

1. Plant bad input under `tests/fixtures/<case>/`. `make lint` skips that folder.
2. Add `test/<check>.test.ts` that expects the check to fail on it. Watch it fail.
3. Write `scripts/<check>.ts` and add it to the `lint` target in the `Makefile`.

## Add a decision

Add `docs/adr/NNNN-slug.md` with the next free number: a Status line, then Context, Decision, Why, Alternatives
rejected and Sources. To change a decision, write a new ADR that supersedes the old one.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`, lower case, no period.
Every commit has a body that says why. An agent's commit names the human it worked for in a `Co-Authored-By:`
trailer.

| type | for |
|---|---|
| `feat` | a new script or behaviour |
| `fix` | a bug fix |
| `docs` | documentation and ADRs |
| `chore` | build, CI and repo upkeep |

Pin every GitHub Actions step to a full commit SHA, with the version in a comment.

## Releases

Every push to `main` runs semantic-release (`release.config.mjs`, #153), the same way as chiyanram/skills.

- Pull requests are squash-merged with the PR title as the commit subject, so **the PR title decides the release**.
  CI fails a title that is not a Conventional Commit, and a title, description or commit that holds a skip-ci marker.
- `feat` releases a minor version, `fix` and `perf` a patch, and `!` or a `BREAKING CHANGE:` footer a major one.
  `docs`, `chore`, `ci`, `style`, `refactor`, `test` and `build` release nothing.
- A release is a tag `vX.Y.Z`, a GitHub release and an entry in `CHANGELOG.md`, which semantic-release writes; do not
  edit it by hand. Nothing is published to npm.
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
| `too long: AGENTS.md` | the root `AGENTS.md` reached 200 lines; move detail into `GUIDE.md` and link it |
| `refused: … a human account` | log the CLI in as the bot ([GUIDE.md](GUIDE.md#set-up-identity)) |
| `FACTORY_PROJECT is not set` / `FACTORY_REPO must be a local clone` | export the setting ([GUIDE.md](GUIDE.md#settings)) |
| `cannot list live runs: claude agents --json failed` | the `claude` CLI is missing or too old |
| `gitlab: HTTP 429 after 4 tries` | the forge is rate-limiting; wait, or raise `FACTORY_MAX_TRIES` |

## Design history

The research, drafts and old pages from the design phase are at git tag `docs-archive-2026-11`. A cite
`docs/archive/…` or `research/NN` in a script, a test or an ADR means that file at that tag:
`git show docs-archive-2026-11:docs/archive/research/<file>`.

## Code of conduct

Be kind, assume good intent, and keep criticism about the work.
