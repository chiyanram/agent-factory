# 0003 · Rulebook layout that every agent tool reads

> Words: this record keeps the words it was written in. [GLOSSARY.md](../../GLOSSARY.md) maps each old word to today's ([ADR-0016](0016-adopt-the-software-factory-vocabulary.md)).

Status: accepted 2026-10-20 (#1 "Box 5"); file plan approved 2026-10-23 (#21)

## Context

Rules were contradictory across the 4 agents. The seam rule lived only on the operator's laptop. The approved rules
from the old ledger were written nowhere (docs/archive/docs/handoff-2026-10-18.md, area RULEBOOK). #18 Q2 AMENDED had chosen area files with
a `paths:` header. docs/archive/research/22 then showed that only Claude Code reads `paths:`.

## Decision

```
AGENTS.md (root, <200 lines, file-type blocks ≤3 MUSTs)      CLAUDE.md = @AGENTS.md
├─ <dir>/AGENTS.md                      area rules near their code
└─ .agents/skills/<domain>/references/*.md   rule bodies, five sections   (.claude/skills → symlink)
generic rules: chiyanram/skills → Claude plugin + `npx skills add` for other tools
```

Each reference has Rules · When X, use Y · Good/Bad · Decided edges · Review checks. A rule is imperative + because +
the failure it prevents, ≤35 words. One file serves the writer and the reviewer. `make lint` checks the sizes; a
sentinel probe proves each tool loads the rules.

## Why

- Nested AGENTS.md is read by Cursor, Copilot, Claude, Gemini and Codex (root→cwd) (docs/archive/research/22 table).
- Every tool reads `.agents/skills` (docs/archive/research/22).
- `npx skills add` reaches non-Claude tools; 4 references use it (mattpocock, addy, humanlayer, plinth).
- The old design (G1, G1b, G5, G20, G21, G23) was sound; the build failed, not the design (#16 Q1).

## Alternatives rejected

| option | why rejected |
|---|---|
| area files with `paths:` (#18 Q2 AMENDED) | Claude-only; Codex and Gemini have no glob scoping (#18 WITHDRAWN 2026-10-20) |
| six-field rule, ≤10 lines (#18 Q3) | no tool needs it; old G5 + G21 restored (#18 WITHDRAWN) |
| `.claude/rules` | harness-specific (old G1b) |
| generic rules copied into each project | copies drift (openclaw; #16 Q2) |

## Sources

#1 "Box 5 FIXED" · #16 Q1–Q3 · #18 WITHDRAWN 2026-10-20 · #21 Q1+Q10, Q5, RESOLUTION · docs/archive/research/22, 34
