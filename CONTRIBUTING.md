# Contributing

This page says how to set up, test, and get a change in. Coding agents also read [AGENTS.md](AGENTS.md). Rules for
code in other projects, such as how to write tests or Java, go to the `rulebook` plugin in
[chiyanram/skills](https://github.com/chiyanram/skills), not here.

## Set up

| tool | needed for |
|---|---|
| bash, git, jq, make | everything; scripts run on bash 3.2 (stock macOS) and on Linux |
| `glab` or `gh` | running the scripts against GitLab or GitHub; the tests stub both |
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
| `make lint` | `scripts/check-links.sh .` (every relative link in a tracked `.md` file resolves), `scripts/check-size.sh .` (the root `AGENTS.md` is under 200 lines) and `tsc --noEmit` |
| `make test` | runs every `tests/*.test.sh`, then the vitest suite; fails if any one fails. One file: `bash tests/poll.test.sh` or `npx vitest run test/poll.test.ts` |
| `make build` | compiles the TypeScript package to `dist/` |
| `make help` | lists the targets |

Each test file prints `ok   <name>` or `FAIL <name>: …` per assertion and exits non-zero on any failure. Tests are
plain bash. The helpers are in [tests/lib.sh](tests/lib.sh):

| helper | does |
|---|---|
| `expect_pass`, `expect_fail`, `expect_eq` | assert on a command's exit code and output |
| `fixture_repo <case>` | copies `tests/fixtures/<case>/` into a fresh git repo |
| `glab_stub` / `respond` / `calls` | a fake `glab` (`FACTORY_GLAB`) or `gh` (`FACTORY_GH`): replays canned answers and logs every call |
| `claude_stub` / `live` | a fake `claude` (`FACTORY_CLAUDE`), with a settable list of live sessions |
| `project_clone` | a throwaway clone with a bare origin |
| `finish` | ends the file with the right exit code |

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

## Add a script

1. Write the test first: `tests/<script>.test.sh`, using the helpers in `tests/lib.sh`. Watch it fail.
2. Add `scripts/<script>.sh`. Start it with a header comment: usage, what it prints, the settings it reads.
3. Call the forge only through a `forge_*` call in `scripts/lib/forge.sh`, and add it to both adapters.
4. Print one line on success. Write errors to stderr and exit non-zero.
5. Add the script to the Scripts table in [GUIDE.md](GUIDE.md#scripts), and any new setting to
   [Settings](GUIDE.md#settings).

The factory moves to a TypeScript package that calls CLIs ([ADR-0013](docs/adr/0013-typescript-package-cli-first.md)).
Until a script is ported, keep it in bash. Write for bash 3.2 and POSIX tools: no GNU-only flags, no associative arrays. Files in `scripts/lib/` are sourced,
never run. Every `claude` call goes through `${FACTORY_CLAUDE:-claude}`.

## Add a check

1. Plant bad input under `tests/fixtures/<case>/`. `make lint` skips that folder.
2. Add `tests/<check>.test.sh` that expects the check to fail on it. Watch it fail.
3. Write `scripts/<check>.sh` and add it to the `lint` target in the `Makefile`.

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

## Troubleshooting

| symptom | fix |
|---|---|
| `broken link: <file>:<line>: <target>` | a relative link points at a missing file; fix the path |
| `too long: AGENTS.md` | the root `AGENTS.md` reached 200 lines; move detail into `GUIDE.md` and link it |
| `refused: … a human account` | log the CLI in as the bot ([GUIDE.md](GUIDE.md#set-up-the-bot)) |
| `FACTORY_PROJECT is not set` / `FACTORY_REPO must be a local clone` | export the setting ([GUIDE.md](GUIDE.md#settings)) |
| `cannot list live runs: claude agents --json failed` | the `claude` CLI is missing or too old |
| `the writer for !<mr> did not start` | open `claude` once in `FACTORY_REPO` and accept the trust prompt |
| `gitlab: HTTP 429 after 4 tries` | the forge is rate-limiting; wait, or raise `FACTORY_MAX_TRIES` |

## Design history

The research, drafts and old pages from the design phase are at git tag `docs-archive-2026-11`. A cite
`docs/archive/…` or `research/NN` in a script, a test or an ADR means that file at that tag:
`git show docs-archive-2026-11:docs/archive/research/<file>`.

## Code of conduct

Be kind, assume good intent, and keep criticism about the work.
