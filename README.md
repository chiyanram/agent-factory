# agent-factory

One coordinator AI that takes an approved merge request and gets it written, reviewed and gate-green by fresh AI
workers, ready for a human to merge. The coordinator runs a small set of bash scripts; the forge (today GitLab) holds
every piece of state, so nothing is lost on a restart.

It is for teams that want AI writers and reviewers on their merge requests while humans keep approval and merge.

## Quick start

You need bash, git and jq. To run the scripts' tests:

```bash
git clone https://github.com/chiyanram/agent-factory.git
cd agent-factory
make lint && make test
```

To point the coordinator at a project, log `glab` in as an agent service account
([docs/setup/identity.md](docs/setup/identity.md)), then:

```bash
export FACTORY_PROJECT=group/project     # the GitLab project path
export FACTORY_REPO=~/src/project        # a local clone of it
scripts/poll.sh                          # one line of facts per open MR
```

The coordinator session follows [docs/playbooks/coordinator.md](docs/playbooks/coordinator.md).

## How it works

```mermaid
flowchart LR
    H([human]) -- "/approved" --> C{{coordinator}}
    C -- start --> W[writer<br/>fresh]
    W -- ready --> R[reviewer<br/>find + verify]
    R -- "Act on" --> W
    R -- clean --> G[gate<br/>project CI]
    G -- red --> W
    G -- green --> H2([human merges])
```

1. A human posts `/approved` on a draft MR whose description holds the intent and the acceptance criteria.
2. The coordinator claims the MR and starts a fresh **writer** in its own worktree.
3. A fresh **reviewer** checks the change against the rules and posts a verdict on the MR.
4. The writer fixes what the reviewer marks **Act on**. After three rounds, a human decides.
5. When the gate is green and nothing is open, a human maintainer merges.

The rules every worker follows come from the `rulebook` plugin in
[chiyanram/skills](https://github.com/chiyanram/skills) and from the project's own `AGENTS.md` files.

## Repo map

```
agent-factory/
├─ scripts/          the coordinator's loop scripts and the lint checks
│  └─ lib/           the forge seam (gitlab.sh) and run tracking (runs.sh)
├─ prompts/          default instructions for the reviewer's find and verify passes
├─ tests/            one plain-bash test per script, with fixtures
├─ docs/
│  ├─ adr/           architecture decision records
│  ├─ playbooks/     the coordinator's instructions
│  ├─ setup/         one-time setup (agent identity)
│  ├─ agents/        settings for the agent skills used in this repo
│  ├─ open-items.md  what is not finished yet, beside the map
│  └─ archive/       frozen design history
├─ drafts/
│  └─ agent-platform/ drafts of agent-platform's agent files, before they land there
├─ research/         sources the rulebook's rules cite
├─ GLOSSARY.md       the words we use
└─ Makefile          make lint, make test
```

## Read next

- [ARCHITECTURE.md](ARCHITECTURE.md): the moving parts, the loop and the key decisions.
- [CONTRIBUTING.md](CONTRIBUTING.md): how to propose a change.
- [DEVELOPMENT.md](DEVELOPMENT.md): setup, make targets, tests and layout.
- [GLOSSARY.md](GLOSSARY.md): the terms, and the words we avoid.

## Licence

No licence has been chosen yet. Until one is added, all rights are reserved by the repository owner.
