# Identity setup — one service account per developer

A developer does this once. Decision: `docs/adr/0006`. Ticket: #26.

```
developer ──▶ agent-<name> (Developer role) ──▶ pushes branches, opens MRs, comments
              cannot merge master                every commit: Co-authored-by: <developer>
developer ──▶ own account: /approved and merge only
```

## Checklist

| # | who | step | why |
|---|---|---|---|
| 1 | group owner | Create the service account `agent-<name>` (Group → Settings → Service accounts). | Free since GitLab 18.11, up to 100 per top-level group, no seat (docs/archive/research/24). |
| 2 | group owner | Add it to the project as **Developer**. | It can push branches, open MRs and comment. |
| 3 | group owner | Protect `master`: merge = Maintainers, push = no one. | An agent cannot merge into master. |
| 4 | developer | Create a token for the account: scopes `api` and `write_repository`, expiry 365 days. Store it in glab's config on the machine (`glab auth login`). Never put it in an environment variable. | Agents never handle tokens. The old fleet leaked tokens through env vars (audit 2026-10-18). |
| 5 | developer | Set the git author for agent commits to `agent-<name>`. Every agent commit carries `Co-authored-by: <developer>`. | The human and the agent are both on the record. |
| 6 | — | Every agent post starts with its seat: `[coordinator]`, `[writer]`, `[reviewer]`. | A reader sees who spoke. |
| 7 | team | Write down the rule: whoever started the work does not approve it. | GitLab Free cannot enforce it; a Developer can approve (#22 Q5). |
| 8 | group owner | When a developer leaves: revoke the token and block the account. | One revoke stops one developer's agents, nobody else's. |
| 9 | developer | Set a reminder two weeks before the token expires. | An expired token stops every agent of that developer. |

## GitHub (ADR-0010)

On a GitHub project the account is a machine user, an ordinary GitHub account (#64 Q1).

| # | who | step | why |
|---|---|---|---|
| 1 | developer | Create the GitHub account `agent-<name>` with its own email. | GitHub has no service accounts; the `agent-` name is how the scripts tell it from a human. |
| 2 | repo owner | Invite it as a collaborator with **Write**. | It can push branches, open pull requests and comment. |
| 3 | repo owner | Add a ruleset on `main`: require a pull request, block force pushes, and allow merge only to the owner. | An agent cannot merge into `main`. A ruleset on a private repo of a personal account needs GitHub Pro. |
| 4 | developer | As the machine user, create a fine-grained token for this repository only: Contents, Pull requests and Issues read and write, Metadata read. Log `gh` in with it under its own config folder (`GH_CONFIG_DIR=~/.config/gh-agent gh auth login`), and point `FACTORY_GH` at a wrapper that sets that folder. Never put the token in an environment variable. | The operator's own `gh` login is never used by an agent. |

Steps 5 to 9 above apply as they are.

## Known gap

Agents run as the developer's OS user, so they can read the token in glab's config. Keeping it out of environment
variables removes the easy leak; the Developer role bounds what a stolen token can do. It is not a wall.
