# agent-factory

Planning repo for the agent factory: one coordinator AI that starts fresh workers and one rulebook of small markdown instruction files.
The map is issue #1 (wayfinder). Plan, don't do — nothing is built until the design is approved.
Start any session with `README.md`, then `docs/ARCHITECTURE.md` and `docs/open-items.md`; research lives in numbered files under `research/`.

## Agent skills

### Issue tracker

Issues, the wayfinder map and its tickets live in GitHub issues on chiyanram/agent-factory. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix); map tickets use only `wayfinder:*` labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the root, created only when a term or decision is resolved. See `docs/agents/domain.md`.
