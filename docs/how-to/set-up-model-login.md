# Set up the runner's model login

The runner gets one model-only token, never your full login (ADR-0012 S6, #136). `claude setup-token` makes a one-year
token that "can only make model requests". It needs a Claude Pro, Max, Ultra, Team or Enterprise plan. Copilot follows
at stage B.

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
