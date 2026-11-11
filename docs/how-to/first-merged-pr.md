# Your first merged PR

From install to a merged pull request on your own repo. Setup is three commands: install, `init`, `start`. The rest is
talking the ticket through, saying yes, and merging. Budget under 30 minutes.

You need Node 26 or later, git, the Claude Code CLI, and the `gh` (GitHub) or `glab` (GitLab) CLI logged in to the
repo's git host.

## 1. Install

```bash
V=$(curl -fsSL https://api.github.com/repos/chiyanram/agent-factory/releases/latest | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).tag_name.slice(1)')
npm i -g https://github.com/chiyanram/agent-factory/releases/download/v$V/chiyanram-agent-factory-$V.tgz
```

To pin another version, see [Install a pinned version](install.md).

## 2. Set up the project: `init`

```bash
cd ~/workspace/<your clone>
agent-factory init          # Enter takes every recommended choice
```

`init` reads the clone, asks one round of choices, writes the settings outside the repo, pins the rulebook plugin and
checks each piece, printing the fix for any that fails ([Set up with agent-factory init](set-up-with-init.md)). No
file to edit, no shell export.

`init` also writes the coordinator's settings, as `agent-factory setup coordinator` does (#485). **Today:** it prints
the model login (`claude setup-token`, then `agent-factory setup claude`) as a next command for you to run, since only
you hold that login; the clean-machine install test (`scripts/install-test.ts`, on Ubuntu and macOS in CI) checks that
install, `init` and a dry run work on a fresh home.

## 3. Let the factory read the project: `onboard`

```bash
agent-factory onboard <project>
agent-factory onboard accept <project> <brief hash> <glossary hash>
```

The onboarder reads the repo, read-only, and stages a short brief and glossary. Read them; `onboard accept` with the
hashes it printed makes every later run read them.

## 4. Talk the ticket through: the spec

```bash
agent-factory coordinator <project>
```

Tell the coordinator what you want. It asks what it needs to know, then writes the spec: the intent, numbered
acceptance criteria, the design when there is one, and the lane (tiny, bug, feature or one-way door). With the issue
store the spec is the ticket's issue body; otherwise `agent-factory spec <project> <ticket>` checks the local file and
prints its hash.

## 5. Start it: `start`, and `approve` above tiny

```bash
agent-factory start <project> <ticket>
agent-factory approve <project> <ticket> <spec hash> [<design hash>]    # bug, feature, one-way door
```

`start` opens the ticket and starts the orchestrator loop. In the tiny lane that is all; above it, the design review
runs, and the build waits for your `approve` with the hashes `spec` printed. Only you run these; the coordinator's
settings deny them.

## 6. Merge

The loop runs the implementer on a fresh runner, re-runs its evidence, reviews the pull request, and pings you when
it is ready. Read the pull request, its evidence and the review's findings, then merge it on the git host. The factory
never merges.

## When it stops

A ticket that needs you gets the `needs-human` label and a note saying why. `agent-factory usage <project>` shows what
the runs spent. Every command is in [the command reference](../reference/cli.md).
