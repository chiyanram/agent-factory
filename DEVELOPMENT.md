# Development

How to set up, check and test this repo. For how a change gets in, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Prerequisites

| tool | needed for |
|---|---|
| bash | everything; scripts run on bash 3.2 (stock macOS) and on Linux |
| git | the tests make throwaway clones |
| jq | the scripts parse every forge answer with it |
| make | the `lint` and `test` targets |
| `glab` | running the scripts against GitLab; the tests stub it |
| `claude` (Claude Code CLI) | running writers and reviewers; the tests stub it |

The tests need no network, no `glab` and no `claude`.

## Setup

```bash
git clone https://github.com/chiyanram/agent-factory.git
cd agent-factory
make help
```

## Make targets

| target | does |
|---|---|
| `make help` | lists the targets |
| `make lint` | runs `scripts/check-links.sh .` (every relative link in a tracked `.md` file resolves) and `scripts/check-size.sh .` (the root `AGENTS.md` is under 200 lines) |
| `make test` | runs every `tests/*.test.sh`; fails if any one fails |

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs `make lint` and `make test` on every pull request and
on every push to `main`.

## Running tests

```bash
make test                      # all tests
bash tests/poll.test.sh        # one script's tests
```

Each test file prints `ok   <name>` or `FAIL <name>: …` per assertion and exits non-zero on any failure. Tests are
plain bash with no framework. The shared helpers in [tests/lib.sh](tests/lib.sh):

| helper | does |
|---|---|
| `expect_pass`, `expect_fail`, `expect_eq` | assert on a command's exit code and output |
| `fixture_repo <case>` | copies `tests/fixtures/<case>/` into a fresh git repo |
| `glab_stub` / `respond` / `calls` | a fake `glab` for `FACTORY_GLAB`: replays canned answers and logs every call |
| `claude_stub` / `live` | a fake `claude` for `FACTORY_CLAUDE`, with a settable list of live sessions |
| `project_clone` | a throwaway clone with a bare origin, for scripts that need git |
| `finish` | ends the file with the right exit code |

## Running the scripts

The scripts read their settings from the environment.

| setting | meaning | default |
|---|---|---|
| `FACTORY_PROJECT` | the GitLab project path, for example `group/project` | — |
| `FACTORY_REPO` | a local clone of that project; worktrees, packs and pid files go in its `.claude/` | — |
| `FACTORY_RULEBOOK` | the rulebook plugin folder that holds `skills/<domain>/references/` | — |
| `FACTORY_CLAIM_LABEL` | the claim label | `agent::claimed` |
| `FACTORY_AGENT_PREFIX` | the start of every agent account's name | `agent-` |
| `FACTORY_MAX_RUNS` | live runs at once on this machine | `2` |
| `FACTORY_RUN_MODE` | `print` runs the writer as a foreground `claude -p` | background |
| `FACTORY_WRITER_MODEL` | the writer's model | Claude's default |
| `FACTORY_FIND_MODEL`, `FACTORY_RULE_MODEL`, `FACTORY_LOGIC_MODEL` | the reviewer's models | `sonnet`, `sonnet`, `opus` |
| `FACTORY_REVIEW_FIND`, `FACTORY_REVIEW_VERIFY` | the reviewer's instructions | `prompts/review-find.md`, `prompts/review-verify.md` |
| `FACTORY_GLAB`, `FACTORY_CLAUDE` | the `glab` and `claude` binaries | `glab`, `claude` |
| `FACTORY_MAX_TRIES`, `FACTORY_SLEEP` | tries per request on HTTP 429, and the wait command | `4`, `sleep` |

Before the first run on a machine, open `claude` once in `FACTORY_REPO` and accept the trust prompt, and add
`.claude/worktrees/`, `.claude/runs/` and `.claude/packs/` to the project's `.gitignore`.

## Project layout

```
scripts/
├─ poll.sh, claim.sh, release.sh, status.sh   read and write MR state
├─ start-writer.sh, start-reviewer.sh         start fresh workers
├─ pack.sh                                    the reviewer's context pack
├─ reconcile.sh                               clean up after a restart
├─ check-links.sh, check-size.sh              the lint checks
└─ lib/
   ├─ gitlab.sh                               the forge seam: gl_api, project_ref, require_bot, mr_get
   └─ runs.sh                                 live runs and worktrees on this machine
prompts/       default find and verify instructions for the reviewer
tests/         <script>.test.sh per script, lib.sh, fixtures/
docs/adr/      decision records
docs/playbooks/coordinator.md   the coordinator's instructions
docs/setup/identity.md          one service account per developer
docs/agents/   settings for the agent skills used in this repo
docs/archive/  frozen design history; not checked by make lint
research/      sources the rulebook's rules cite by path
```

## Conventions

- Write for bash 3.2 and POSIX tools: no GNU-only flags, no associative arrays.
- Library files in `scripts/lib/` are sourced, never run.
- Every forge call goes through `gl_api`. Every `claude` call goes through `${FACTORY_CLAUDE:-claude}`.
- A script prints one line on success and writes errors to stderr.

## Troubleshooting

| symptom | cause and fix |
|---|---|
| `broken link: <file>:<line>: <target>` from `make lint` | a relative link points at a missing file; fix the path, or link to the file's new place |
| `too long: AGENTS.md` | the root `AGENTS.md` reached 200 lines; move detail into `docs/` and link it |
| `refused: glab is logged in as <name>, a human account` | log `glab` in as the agent service account ([docs/setup/identity.md](docs/setup/identity.md)) |
| `FACTORY_PROJECT is not set` | export the GitLab project path |
| `FACTORY_REPO must be a local clone of the project` | point `FACTORY_REPO` at a git clone |
| `cannot list live runs: claude agents --json failed` | the `claude` CLI is missing or too old to list background sessions |
| `the writer for !<mr> did not start` | `claude --bg` refuses an untrusted folder: open `claude` once in `FACTORY_REPO` and accept the trust prompt |
| `gitlab: HTTP 429 after 4 tries` | the forge is rate-limiting; wait, or raise `FACTORY_MAX_TRIES` |
