# Set up the runner's model login

The runner gets one model-only token, never your full login (ADR-0012 S6, #136). `claude setup-token` makes a one-year
token that "can only make model requests". It needs a Claude Pro, Max, Ultra, Team or Enterprise plan. Copilot has
its own token ([Copilot](#copilot)).

| # | who | step | why |
|---|---|---|---|
| 1 | developer | Run `claude setup-token` and approve in the browser. The token prints once; do not paste it anywhere but step 2. | The command does not save the token anywhere. |
| 2 | developer | Run `agent-factory setup claude` and paste the token at the hidden prompt. On the VM, run it as the user that runs the orchestrator: `sudo -u factory -H agent-factory setup claude`. | macOS keeps it in the login Keychain (passed to `security` on stdin, never in argv). Linux keeps it in `~/.factory/secrets/claude-token`, mode 600, in a folder of mode 700. A GitHub login (`gho_`, `ghp_`, `github_pat_`) is refused. |
| 3 | developer | Run `agent-factory setup status`. It prints the runner, its risks, and the token's days left; exit 0 means a runner may start. | A runner never starts with an expired token, or one with no expiry on record. |
| 4 | developer | When `status` warns (7 days before expiry), repeat steps 1 and 2. | The token lasts one year. |

The implementer step reads it before each run and passes it as `CLAUDE_CODE_OAUTH_TOKEN` with
`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, which keeps it out of Bash, hooks and MCP servers. No other secret goes onto the
runner: no git host token, no `PATH` or `HOME` of yours.
The vm runner takes each value through the docker CLI's environment (`docker exec --env NAME`), never its command line.

## Copilot

A Copilot run gets one fine-grained GitHub token with only the "Copilot requests" permission, as
`COPILOT_GITHUB_TOKEN`, and nothing else (#690). **Today:** no run uses it yet: a project file that names `copilot` for
a role is refused until a real run is checked on a machine with a Copilot subscription (#697); implementer, test-first and cleanup runs are not built (#698).

| # | who | step | why |
|---|---|---|---|
| 1 | developer | On GitHub, make a fine-grained personal access token with only the **Copilot requests** permission and an expiry date. Copy the token and the date. | A classic token (`ghp_`) or any other GitHub login can reach your repositories; a fine-grained token can stop at Copilot. |
| 2 | developer | Run `agent-factory setup copilot <YYYY-MM-DD>` with that date, and paste the token at the hidden prompt. On a terminal, leave the date out and it asks for it. | It keeps the token like the claude one (the Keychain, or `~/.factory/secrets/copilot-token`, mode 600). It refuses anything but `github_pat_`, a past date, and a date more than 366 days away. It makes no call, so it cannot see the token's permissions: pick only Copilot requests. |
| 3 | developer | Run `agent-factory setup status`. It adds the copilot token's days left. | A Copilot run never starts with an expired token. |
| 4 | developer | When `status` warns (7 days before expiry), make a new token and repeat step 2. | The token lasts until the date you picked. |

A Copilot run gets a fresh, empty `HOME` and `COPILOT_HOME` of its own, removed after it, so the CLI never falls back to
your own Copilot or `gh` login, and never `GH_TOKEN` or `GITHUB_TOKEN` (ADR-0012 S6).
