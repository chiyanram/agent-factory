# 0002 · The MR is the one record; GitLab is the only memory

Status: accepted 2026-10-18 (#4 Q1), extended 2026-10-20 (#1 "Box 2")

## Context

Decisions lived in chat and were written down later (#4 area 2, item 2.5). The old fleet kept state in Discord and in
tmux, and a dead session went unnoticed for about 20 hours (docs/archive/research/11). Several hosts, people and agent tools must
see the same state (goals O6, O9).

## Decision

```
GitLab issue ─▶ MR: intent verbatim · ACs · thread of decisions · head SHA · gate result
                claim = label/assignee; liveness from GitLab, never by poking a worker
```

One issue = one MR = one story. The MR is the record every step reads and writes. The coordinator keeps no state of
its own, so a restart re-reads GitLab and loses nothing. Discord is a talk channel; every answer is copied verbatim
into the MR.

## Why

- It is the only record already shared by every person, host and agent tool (#4 Q1).
- Products and references keep the claim and state on the ticket or PR (forge, ClawSweeper, Copilot; docs/archive/research/37 P1).
- "Truth outside chat memory" is shared by Pocock, firstmate, pstack and Anthropic (docs/archive/research/38 §2).

## Alternatives rejected

| option | why rejected |
|---|---|
| pstack-style ledger file | a second store (#4 Q1) |
| firstmate-style task files | per host (#4 Q1) |
| Discord holds answers | a notifier never holds an answer (old G16; #1 "Box 2") |

## Sources

#4 Q1 · #1 "Box 2 coordinator DECIDED" · #23 Q2 · docs/archive/research/24, 37, 38
