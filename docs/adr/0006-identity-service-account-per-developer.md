# 0006 · Identity: one service account per developer

> Words: this record keeps the words it was written in. [GLOSSARY.md](../../GLOSSARY.md) maps each old word to today's ([ADR-0016](0016-adopt-the-software-factory-vocabulary.md)).

Status: accepted 2026-10-20 (#1 "Identity DECIDED", operator 'D')

Amended by [ADR-0012](0012-safety-design-for-unattended-runs.md).

## Context

3 of 4 old agents posted on the operator's personal token (docs/archive/research/24). Verdicts appeared under the operator's
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
- Service accounts are free on GitLab Free since 18.11, up to 100 per group, no seat (docs/archive/research/24).
- A shared bot hides the actor and one revoke cuts every agent (docs/archive/research/24, NHI Mgmt Group).

## Alternatives rejected

| option | why rejected |
|---|---|
| the operator's personal token | hides who acted (docs/archive/research/24) |
| one shared bot for everyone | attribution and revocation (docs/archive/research/24) |
| project access token | needs Premium (docs/archive/research/24) |

Gap: GitLab Free cannot enforce "the starter does not approve", and a Developer can approve. It rests on the team rule
and the reviewer's prompt (#22 Q5). No doc recommends per-developer accounts directly; this is the nearest Free-tier
copy of the vendor default.

## Sources

#1 "Identity DECIDED" · #22 Q5 · docs/archive/research/24 identity follow-up · setup checklist: L6 #26

## Amended 2026-11-06

By [ADR-0012](0012-safety-design-for-unattended-runs.md) ([gap 1 / Q11](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681534148)):
- **One bot per project, used only by code:** the dispatcher and the host push. It replaces the bot per developer. No LLM holds
  the bot login, including the writer and the coordinator.
- The human still approves and merges from their own account. They approve either by typing `/approved` on the
  PR, or in the terminal through `approve.sh`, which posts it with their own login behind a harness prompt
  ([W1](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6679395560)).
- The "Known gap" (agents can read the token as the developer's OS user) closes for the writer (S6). For the
  coordinator it narrows to the deny rules of S2.

## Amended 2026-11-06 (review of ADR-0012)

By [ADR-0012](0012-safety-design-for-unattended-runs.md) S14, as revised ([review 2](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682431737)):
- Identity is per project. By default the dispatcher pushes and posts with the developer's own `gh` or `glab` login
  (work has no bots). A project may use a bot (personal: a GitHub App), whose key belongs to a separate `factory` OS
  user on the VM. This replaces "one bot per project" in the amendment above.
- Agent text is marked by content (`[writer]`, `[reviewer]`, `[coordinator]` and an `Agent: <seat>` commit trailer),
  not by author.
- Approval is a local permission recorded by `approve.sh`, not a forge note ([review 3](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6682553870)).
