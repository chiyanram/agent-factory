# agent-factory

The agent factory: one coordinator AI that starts fresh writer and reviewer workers on a project's merge requests.
The rules those workers follow live in chiyanram/skills, not here ([ADR-0009](docs/adr/0009-tool-and-rules-in-separate-repos.md)).
Start with `README.md`, then `ARCHITECTURE.md`; setup and commands are in `DEVELOPMENT.md`, the change flow in `CONTRIBUTING.md`.

## Build

- Coordinator scripts live in `scripts/`; the forge seam in `scripts/lib/`. Each script has a plain-bash test `tests/<script>.test.sh` that exits non-zero on a failed assertion.
- The coordinator's instructions are `docs/playbooks/coordinator.md`; keep them in step with the scripts.
- Run `make lint` and `make test` before you hand over a change. CI runs the same two targets on every pull request.
- A change lands as one issue → one branch → one PR. The operator approves every commit and every push.
- `docs/archive/` is frozen history: read it for context, never edit it, never link to it from live docs as a source of truth.

## Agent skills

### Issue tracker

Issues, the wayfinder map and its tickets live in GitHub issues on chiyanram/agent-factory. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix); map tickets use only `wayfinder:*` labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the root, created only when a term or decision is resolved. See `docs/agents/domain.md`.
