# Security policy

## Reporting a vulnerability

Report it privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public
issue or pull request.

Include what you found, where, and how to reproduce it. You will get an answer within 5 working days.

## Handling secrets

- Credentials never go into the repository, issues, comments or commit messages; refer to them by name.
- If a secret is committed by mistake, revoke it first, then remove it from history.

## Scope

agent-factory runs AI agents with no one watching, so its own safety design is in scope: a way for a run to reach a
git host login, read a credential, change what judges it, start without a human, or approve its own work. The design
is [ADR-0012](docs/adr/0012-safety-design-for-unattended-runs.md).
