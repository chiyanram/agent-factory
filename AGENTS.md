# agent-factory

Build repo for the agent factory: one coordinator AI that starts fresh workers. The rulebook lives in chiyanram/skills (ADR-0009).
Start any session with `README.md`, then `docs/ARCHITECTURE.md` and `docs/open-items.md`; research lives in numbered files under `research/`.

## Build

- Coordinator scripts live in `scripts/`. Each script has a plain-bash test `tests/<script>.test.sh` that exits non-zero on a failed assertion.
- Run `make lint` and `make test` before you hand over a change. CI runs the same two targets on every pull request.
- A change lands as one issue → one branch → one PR. The operator approves every commit and every push.

## Agent skills

### Issue tracker

Issues, the wayfinder map and its tickets live in GitHub issues on chiyanram/agent-factory. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix); map tickets use only `wayfinder:*` labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the root, created only when a term or decision is resolved. See `docs/agents/domain.md`.
