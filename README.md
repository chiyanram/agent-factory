# agent-factory

[![ci](https://github.com/chiyanram/agent-factory/actions/workflows/ci.yml/badge.svg)](https://github.com/chiyanram/agent-factory/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

AI writers and reviewers on your merge requests, while humans keep approval and merge.

## What it is

You talk to one coordinator AI. A dispatcher (code, no LLM) takes each approved merge request and gets it written,
reviewed and gate-green by fresh AI workers in a box. Then a human merges it. The forge (GitLab or GitHub) holds
every piece of state, so a restart loses nothing.

- **Humans keep the gates.** A human approves before any code, and a human merges. The bot cannot merge.
- **Code dispatches, not the AI.** The coordinator talks with you; it holds no forge login and starts no worker.
- **Workers run in a box.** No forge token, no network except the model API and package registries. The host pushes.
- **Fresh workers.** Each job starts a new session, so no worker drifts or forgets its instructions.
- **One reviewer, two passes.** A find pass lists findings; a verify pass drops what does not hold. It may block,
  never approve.
- **Rules from the default branch.** A merge request cannot change the rules it is judged by.

> **Status (2026-11-06).** The design above is decided ([ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md),
> [ADR-0013](docs/adr/0013-typescript-package-cli-first.md), map #30). The bash scripts still run the old way: the
> writer runs unsandboxed with the bot's login and pushes itself, and the coordinator starts runs. The next step is
> a TypeScript package that builds the new design in; the laptop pilot runs on it.

The rules the workers follow live in the `rulebook` plugin in [chiyanram/skills](https://github.com/chiyanram/skills)
and in each project's own `AGENTS.md` files, not here.

## Quick start

You need bash, git, jq and the Claude Code CLI. Check the scripts:

```bash
git clone https://github.com/chiyanram/agent-factory.git
cd agent-factory
make lint && make test
```

Point the coordinator at a project. First set up its identity ([GUIDE.md](GUIDE.md#set-up-identity)), then:

```bash
export FACTORY_FORGE=gitlab              # or github
export FACTORY_PROJECT=group/project     # the GitLab project path, or owner/repo on GitHub
export FACTORY_REPO=~/src/project        # a local clone of it
export FACTORY_RULEBOOK=<rulebook plugin folder>
npx agent-factory poll                   # one line of facts per open merge request
```

Then start a Claude Code session in this repo and tell it to run the loop in [GUIDE.md](GUIDE.md#run-the-loop).
Until the dispatcher exists, you or the coordinator run the trigger table by hand.

## How it works

```mermaid
flowchart LR
    H([human]) -- "approve" --> C{{coordinator<br/>agent-factory approve + prompt}}
    C -- "local approval record" --> D{{dispatcher<br/>code}}
    F[(forge)] -- poll --> D
    D -- start --> W[writer<br/>in a box]
    W -- "exit + report" --> RC[ready check<br/>in a box]
    RC --> R[reviewer<br/>find + verify]
    R -- "Act on" --> W
    R -- "no Act on" --> G[gate<br/>CI, no secrets]
    G -- red --> W
    G -- green --> H2([human undrafts, merges])
```

1. A human approves the ticket's spec (the intent and the acceptance criteria): they say so in the terminal and
   confirm the harness prompt for `agent-factory approve`. A `/approved` note on the MR approves nothing.
2. The dispatcher claims the MR and starts a fresh **writer** in a box, in its own worktree.
3. The writer commits, writes `.factory/report.json` (done, asked or blocked) and exits. The host checks it, pushes and
   posts it.
4. A ready check re-runs the evidence. Then a fresh **reviewer** posts a verdict, plus a script-made box of protected
   files and new dependencies.
5. The writer fixes what the reviewer marks **Act on**. After three rounds, a human decides.
6. When the gate is green, a human reads the box, undrafts and merges. Zero findings is never a pass.

```mermaid
flowchart LR
    S["loop scripts<br/>poll · claim · release · status<br/>start-writer · start-reviewer · pack · reconcile"]
    S --> SEAM["forge seam<br/>scripts/lib/forge.sh"]
    SEAM --> GL["gitlab.sh → glab api"]
    SEAM --> GH["github.sh → gh api"]
```

Today the coordinator decides and the scripts act. In the target design the dispatcher decides from `poll` and the
coordinator only talks, asks and approves. Every script prints one line. Every call to the forge goes through one
seam, so the loop scripts do not know which forge they talk to. The tests stub the seam and the `claude` CLI, so they
need no network.

## Docs

- [GUIDE.md](GUIDE.md): set up the bot, the settings, run the loop, the guardrails and the terms.
- [CONTRIBUTING.md](CONTRIBUTING.md): set up, test, add a script or a check, commit messages.
- [AGENTS.md](AGENTS.md): instructions for coding agents that work in this repo.
- [docs/adr/](docs/adr/): the decisions behind the design.

## License

[MIT](LICENSE)
