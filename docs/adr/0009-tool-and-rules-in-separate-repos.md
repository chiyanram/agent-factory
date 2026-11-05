# 0009 · The factory and the rulebook live in separate repos

Status: accepted 2026-10-26 (operator, step-0 decision D2)

## Context

The design is approved and map #1 is closed. The coordinator (L3, #23) needs its first code: `poll`, `claim` /
`release`, `start writer`, `start reviewer`, `status` and `reconcile`. No ADR said where that code lives
(docs/archive/research/45). ADR-0003 already gives chiyanram/skills one job: the generic rulebook plugin.

## Decision

```
agent-factory       the FACTORY: coordinator scripts, their tests, playbooks, ADRs, research
chiyanram/skills    the RULES:   the rulebook plugin, reached as a Claude plugin and by `npx skills add`
```

Neither repo holds the other's content. A script fix never changes the rulebook's version, and a rule change never
changes the factory.

## Why

- humanlayer keeps its tools (`humanlayer/humanlayer`, `claudelayer`) apart from `humanlayer/skills`, which holds only
  plugins (repo roots @99abe673, @558f7bc, @ca7c808).
- The tool and the rules change for different reasons and at different speeds.
- A developer without the fleet needs only the rules, and installs only the rules.

## Alternatives rejected

| option | why rejected |
|---|---|
| a second plugin `factory` inside chiyanram/skills | pstack (`poteto-mode/scripts/orch/orch.ts`) and firstmate (`skills/` + `bin/` in one repo) do this. The operator chose a clear split, as in humanlayer |
| scripts in each project | copies drift (ADR-0003, openclaw) |

## Sources

Step-0 decision D2 (operator, 2026-10-26) · ADR-0003 · docs/archive/research/44, 45 · rameezk/forge set aside as an example only
(operator, 2026-10-26)

Amended by [ADR-0010](0010-one-forge-seam-two-adapters.md): the coordinator scripts reach GitLab or GitHub through
one forge seam.
