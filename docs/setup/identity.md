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
| 1 | group owner | Create the service account `agent-<name>` (Group → Settings → Service accounts). | Free since GitLab 18.11, up to 100 per top-level group, no seat (research/24). |
| 2 | group owner | Add it to the project as **Developer**. | It can push branches, open MRs and comment. |
| 3 | group owner | Protect `master`: merge = Maintainers, push = no one. | An agent cannot merge into master. |
| 4 | developer | Create a token for the account: scopes `api` and `write_repository`, expiry 365 days. Store it in glab's config on the machine (`glab auth login`). Never put it in an environment variable. | Agents never handle tokens. The old fleet leaked tokens through env vars (audit 2026-10-18). |
| 5 | developer | Set the git author for agent commits to `agent-<name>`. Every agent commit carries `Co-authored-by: <developer>`. | The human and the agent are both on the record. |
| 6 | — | Every agent post starts with its seat: `[coordinator]`, `[writer]`, `[reviewer]`. | A reader sees who spoke. |
| 7 | team | Write down the rule: whoever started the work does not approve it. | GitLab Free cannot enforce it; a Developer can approve (#22 Q5). |
| 8 | group owner | When a developer leaves: revoke the token and block the account. | One revoke stops one developer's agents, nobody else's. |
| 9 | developer | Set a reminder two weeks before the token expires. | An expired token stops every agent of that developer. |

## Known gap

Agents run as the developer's OS user, so they can read the token in glab's config. Keeping it out of environment
variables removes the easy leak; the Developer role bounds what a stolen token can do. It is not a wall.
