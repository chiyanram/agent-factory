# agent-factory

The planning repo for the agent factory. It holds the design, the decisions and the research. It holds no code.

```
            human
              ⇅  talks (CLI, tmux, Discord optional)
        ┌─────────────┐   starts, per ticket   ┌────────┐   ┌──────────┐   ┌──────┐
        │ COORDINATOR │ ─────────────────────▶ │ WRITER │ ─▶│ REVIEWER │ ─▶│ GATE │ ─▶ a maintainer merges
        │ one AI      │                        │ fresh  │   │ fresh    │   │ CI   │
        └─────────────┘                        └────────┘   └──────────┘   └──────┘
              all state lives in GitLab: one issue + one MR per story
        ─────────────────────────────────────────────────────────────────────────────
        ONE RULEBOOK: small markdown files that every writer and reviewer loads
```

The factory has three parts. One coordinator AI talks with the human. Fresh workers do one job each and go away.
One rulebook tells every worker how to write and how to review. Source: map [#1](https://github.com/chiyanram/agent-factory/issues/1),
CORRECTION 2026-10-23.

## Status

| part | state | where decided |
|---|---|---|
| high-level design | **approved 2026-10-22** | #1 "HIGH-LEVEL DESIGN APPROVED" · [design page](https://claude.ai/artifact/XwqdmZw23eSWjCkF9DHzC3) · `docs/design.md` |
| one coordinator, no discovery seat | corrected 2026-10-23 | #1 CORRECTION · research/38 |
| low-level design L1–L7 | in progress | tickets #21–#27 on map #1 · `docs/open-items.md` |
| build | not started | plan, don't do: nothing is built before its low-level ticket closes |

## Where to start reading

1. `docs/ARCHITECTURE.md` — the factory as decided, in diagrams.
2. `GLOSSARY.md` — the words we use, and the words we avoid.
3. `docs/adr/` — one record per big decision, with its why and the rejected options.
4. `docs/open-items.md` — what is still open.
5. Map [#1](https://github.com/chiyanram/agent-factory/issues/1) — the live decision log.
6. `docs/DEVELOPMENT.md` — how to work in this repo.

## Repo layout

```
agent-factory/
├─ README.md               this page
├─ AGENTS.md               instructions for an agent session in this repo (CLAUDE.md = @AGENTS.md)
├─ GLOSSARY.md             terms, and the words we avoid
├─ docs/
│  ├─ ARCHITECTURE.md      the factory as built from the decisions
│  ├─ DEVELOPMENT.md       how to work here
│  ├─ adr/                 decision records 0001…
│  ├─ design.md            the approved high-level design text (2026-10-22)
│  ├─ open-items.md        everything not finished
│  ├─ handoff-*.md         session handoffs
│  ├─ briefs/              briefs for agents that run elsewhere (e.g. the VM gate diagnosis)
│  └─ agents/              answers for the mattpocock skills: issue tracker, labels, domain docs
├─ research/               one numbered file per research ticket (NN-slug.md)
└─ review/                 builders for review pages
```

## Related

- Design page (approved version): https://claude.ai/artifact/XwqdmZw23eSWjCkF9DHzC3
- Generic rulebook plugin and the old ledger of approved rules: [chiyanram/skills](https://github.com/chiyanram/skills)
  (old map #9 and its research).
- First project that uses the factory: agent-platform (Aruvii), on GitLab.
