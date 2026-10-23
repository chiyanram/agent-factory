# 0008 · `/dod` is removed

Status: accepted 2026-10-21 (#1 "Box 7"; old ND-5, chiyanram/skills#35)

## Context

`/dod` was a separate Definition-of-Done step. Its checks duplicated the gate and the review, and its stage-8 AC pass
repeated work (#16 phase 8; #18 stage settled).

## Decision

Each `/dod` check has one owner:

| check | owner |
|---|---|
| `make verify-full` + smoke | the gate, by kind of work |
| ACs cited both ways, nothing unrequested | the reviewer's Spec verdict, stage 7 |
| RBAC tested, an IT per endpoint | the reviewer's Standards verdict (testing rules) |

Until the VM runner exists, the writer runs the same `make` target locally and records SHA + result on the MR. The
temporary `/dod` in agent-platform stays until the gate runs (track 2).

## Why

- One owner per check; no second pass over the same thing (#18 stage settled).
- The old map already deleted it (ND-5).

## Alternatives rejected

| option | why rejected |
|---|---|
| keep `/dod` as stage 8 | duplicates gate and Spec verdict (#16 phase 8) |

## Sources

#1 "Box 7 DECIDED" · #16 phases 7–10 · #18 stage settled 2026-10-20 · chiyanram/skills#35
