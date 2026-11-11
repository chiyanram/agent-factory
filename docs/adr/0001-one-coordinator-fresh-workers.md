# 0001 · One coordinator AI and fresh workers

> Words: this record keeps the words it was written in. [GLOSSARY.md](../../GLOSSARY.md) maps each old word to today's ([ADR-0016](0016-adopt-the-software-factory-vocabulary.md)).

Status: accepted 2026-10-23 (supersedes the discovery seat of 2026-10-20 and #23 Q1)

Amended by [ADR-0011](0011-crq-pipeline-in-the-factory.md) and [ADR-0012](0012-safety-design-for-unattended-runs.md).

## Context

The old fleet ran 4 always-on persona agents. They produced 9 of 78 merged MRs and drifted over long sessions
(docs/archive/research/08, 10, 23). Two later ideas were tried on map #1: a separate discovery seat that talks to the human
(#1 "Roles DECIDED", 2026-10-20), and a coordinator that is stateless plumbing or a script on a timer (#23 Q1, Q3).

## Decision

```
human ⇄ COORDINATOR (one AI session: intake, grill, spec, design, retro)
              └─ starts per ticket ─▶ fresh WRITER ─▶ fresh REVIEWER ─▶ GATE
```

One coordinator AI talks with the human. It does intake, grilling, spec, design and retro. It starts a fresh writer
and a fresh reviewer per ticket. Workers do one job and go away. Workers never talk to the human.

## Why

- One point of contact for the human (firstmate, openclaw, Pocock chief-of-staff, Factory).
- A fresh worker avoids drift and context rot; never resume one (pstack, Factory, Cognition 2026, HumanLayer).
- Workers cannot ask questions, so human contact belongs to the coordinator (pstack, Claude Code subagents, firstmate).
- No source puts the human-facing planner in a separate agent (docs/archive/research/38 §4).
- The human agrees the design before any build (HumanLayer RPI; Factory Missions; docs/archive/research/38, 2026-10-23 section).

## Consequences

- For a small fix the full fleet costs more than it gives: pstack v1 landed 1 of 12 units against 12 for a plain agent
  (docs/archive/research/38). A developer can skip the fleet and run `/crq` in one session.
- Loop mechanics (poll GitLab, add a label, start a worker) stay small deterministic scripts that the coordinator calls,
  because long-running agent loops drift (Cursor orchestrate; HumanLayer "own your control flow"; docs/archive/research/38).

## Alternatives rejected

| option | why rejected |
|---|---|
| separate discovery seat | no source splits it out; docs/archive/research/23 left it "unverified" (#1 CORRECTION) |
| coordinator as stateless plumbing / script on a timer | withdrawn 2026-10-23: the human needs one AI to talk to; loop mechanics stay deterministic inside it (docs/archive/research/38 §4) |
| 4 always-on persona agents | 9 of 78 MRs, role confusion, drift (#4 Q2) |
| always-on daemon (old G6 + G30) | ≈2,400 lines around a 66-line prompt (#4 Q3a; docs/archive/research/05) |

## Sources

#1 CORRECTION 2026-10-23 · #4 Q2, Q3a · #23 Q1 SUPERSEDED · docs/archive/research/23, 24, 36, 38

Amended by [ADR-0011](0011-crq-pipeline-in-the-factory.md): a writer may post an open question and stop, one
writer per pull request, and a script checks "ready" before review.

## Amended 2026-11-06

By [ADR-0012](0012-safety-design-for-unattended-runs.md) ([Q15](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681316890)):
- A dispatcher written as code, with no LLM, now runs the loop mechanics: claims, starts, releases and reconciles. This revisits the
  rejected "script on a timer". The human still has one AI to talk to, but that AI no longer starts workers or holds
  the bot login.
- Writers ask through a file that the host posts (S13).
