# 0018 · A build deviation is a note on the PR, not a design edit

Status: accepted 2026-11-10 (operator, design audit). Not built.

## Context

The approval binds the spec's and the design's hashes, and any edit makes it stale (`src/core/approval.ts`); a stale
approval stops the work. The rulebook's PD7 (chiyanram/skills `planning/references/program-design.md`) tells the build
to record a changed type, signature or file placement in the design before coding past it. Following PD7 would stop
every build that deviates. The runner cannot reach the design anyway: it lives in the factory home.

OpenAI's ExecPlans and Kiro treat the plan as a living document with a decision log.

## Decision

1. The implementer never edits the design.
2. It posts a `[writer] DEVIATION:` note on the PR: what changed, why, and the `file:line`.
3. The approval stays valid. The automated review judges the change against the design plus its deviation notes.
4. A deviation that changes behaviour, meaning it touches an acceptance criterion, is not a deviation. It is an
   `OPEN:` question, and the work stops for the human.
5. PD7 in the rulebook is reworded to match.

## Considered

| option | why not |
|---|---|
| edit the design and approve again | every small deviation stops the build for a human |
| a deviation log file outside the hashed design | one more file the runner cannot reach; the PR is already the record |

## Consequences

- The human sees every deviation on the PR they review.
- The review pack reads the deviation notes.
- A change to an acceptance criterion still needs a human, as before.
