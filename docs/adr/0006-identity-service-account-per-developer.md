# 0006 · Identity: one service account per developer

Status: accepted 2026-10-20 (#1 "Identity DECIDED", operator 'D')

## Context

3 of 4 old agents posted on the operator's personal token (research/24). Verdicts appeared under the operator's
account (#4 area 2, item 2.3). More developers are joining (#19).

## Decision

```
agent-<name> service account, Developer role ─▶ push branches, open MRs, comment; cannot merge master
agent commit: Co-authored-by: <the human>     agent post: starts with its seat, e.g. [reviewer]
human account: /approved and merge only       tokens: made by the human, never by an agent
```

Team rule: the person who started the work does not approve it.

## Why

- The vendor default records both the human and the agent (GitLab composite identity, Copilot, GitHub Apps).
- Service accounts are free on GitLab Free since 18.11, up to 100 per group, no seat (research/24).
- A shared bot hides the actor and one revoke cuts every agent (research/24, NHI Mgmt Group).

## Alternatives rejected

| option | why rejected |
|---|---|
| the operator's personal token | hides who acted (research/24) |
| one shared bot for everyone | attribution and revocation (research/24) |
| project access token | needs Premium (research/24) |

Gap: GitLab Free cannot enforce "the starter does not approve", and a Developer can approve. It rests on the team rule
and the reviewer's prompt (#22 Q5). No doc recommends per-developer accounts directly; this is the nearest Free-tier
copy of the vendor default.

## Sources

#1 "Identity DECIDED" · #22 Q5 · research/24 identity follow-up · setup checklist: L6 #26
