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

On a GitHub project the bot is a **GitHub App** that the developer's own account owns. It posts as `<slug>[bot]`,
and it has no login, no email and no password (#64 Q1, amended 2026-11-05). This is GitHub's service account.

| # | who | step | why |
|---|---|---|---|
| 1 | developer | Create the App: Settings → Developer settings → GitHub Apps → New. Name it, for example `ledger-factory`; its URL slug is `FACTORY_GH_APP_SLUG`. Turn the webhook off. Repository permissions: Contents, Issues and Pull requests read and write; Checks, Commit statuses and Metadata read. Install it on: only this account. | One App per developer, as one service account per developer on GitLab. |
| 2 | developer | Note the App ID. Generate a private key, move the `.pem` to `~/.config/agent-factory/`, and run `chmod 600` on it. | The key mints a one-hour token on demand (`scripts/github-app.sh`); no token is ever stored in a config file or an environment variable. |
| 3 | developer | Install the App on the project's repository only. | It can push branches, open pull requests and comment there, and nowhere else. |
| 4 | repo owner | Add a ruleset on `main`: require a pull request with one approval, block force pushes, and allow merge only to the owner. | An App cannot approve its own pull request, so an agent cannot merge into `main`. A ruleset on a private repo of a personal account needs GitHub Pro. |
| 5 | developer | In the factory's clone (`FACTORY_REPO`), set `git config factory.ghAppId <id>`, `factory.ghAppKey <pem path>`, `factory.project <owner/name>`, and `credential.https://github.com.helper "!<agent-factory>/scripts/github-app.sh git-credential"`. Set `user.name` to `<slug>[bot]`. | A writer pushes and runs `scripts/bin/gh` as the App with nothing in its environment; `start-writer` refuses a clone without the helper. |
| 6 | developer | For the coordinator scripts set `FACTORY_FORGE=github` and `FACTORY_GH_APP_SLUG`, plus `FACTORY_GH_APP_ID`, `FACTORY_GH_APP_KEY` and `FACTORY_PROJECT`. `FACTORY_GH` defaults to `scripts/bin/gh`. | The scripts refuse any token that is not the App's (`forge_require_bot`). |

Steps 5 to 7 above apply as they are. Step 8: when a developer leaves, delete the App's private key, or the App.
Step 9 does not apply: the key does not expire, and each token lasts one hour and is minted again on demand.

## Known gap

Agents run as the developer's OS user, so they can read the token in glab's config. Keeping it out of environment
variables removes the easy leak; the Developer role bounds what a stolen token can do. It is not a wall.
